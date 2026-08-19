/**
 * Slash-command palette (plan todo 15): opens when the composer text starts
 * with "/" (todo-15 rules in pickers/logic.ts `detectSlashQuery`), lists the
 * capabilities-driven commands verbatim — builtins and custom/OMO names as
 * DATA — and runs the selected command through the todo-3 `runCommand` wire
 * request.
 *
 * Two layers (the repo's SSR testing discipline: no jsdom, so the
 * presentational layer must render every row through renderToStaticMarkup):
 * - {@link CommandPalette} — pure presentational rows (listbox + options +
 *   empty state), all state in props.
 * - {@link SlashCommandPalette} — the container T14 anchors next to its
 *   textarea: derives the query from `text`, subscribes the capability
 *   store, and on select runs {@link runSlashSelection}. COMPOSITION
 *   CONTRACT for T14's composer: render it as a sibling directly above the
 *   textarea (its menu opens upward), pass the live text, and clear the text
 *   in `onAccepted` (the selected command text is consumed, not sent as a
 *   prompt). There is deliberately no active-session write here — without a
 *   session the select is a no-op (documented, tested).
 */

import { useEffect, useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { useApp, type AppContextValue } from "../../app/context.js";
import { useActiveSession } from "../activeSession.js";
import type { CommandEntry } from "./constants.js";
import { attachCapabilityStore, useCapabilitySnapshot } from "./capabilityStore.js";
import { detectSlashQuery, filterCommands } from "./logic.js";

const MENU_CLASS =
  "absolute bottom-full left-0 z-50 mb-1 max-h-60 min-w-48 overflow-y-auto rounded border border-border bg-panel-bg p-1 shadow-lg";
const ROW_CLASS =
  "flex cursor-default select-none items-baseline gap-2 rounded px-2 py-1 text-xs text-fg hover:bg-hover-bg data-[active=true]:bg-hover-bg";

export interface CommandPaletteProps {
  readonly commands: readonly CommandEntry[];
  readonly query: string;
  /** Row treated as current (aria-selected + data-active); clamped inside. */
  readonly activeIndex: number;
  onSelect(name: string): void;
  onHover?(index: number): void;
}

/** Pure rows: listbox when there are matches, the localized empty state else. */
export function CommandPalette(props: CommandPaletteProps): ReactNode {
  const { t } = useStrings();
  const matches = filterCommands(props.commands, props.query);
  const active = Math.min(Math.max(props.activeIndex, 0), Math.max(matches.length - 1, 0));
  return (
    <div role="listbox" aria-label={t("commands.title")} className={MENU_CLASS}>
      {matches.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-fg">{t("commands.empty")}</div>
      ) : (
        matches.map((command, index) => (
          <div
            key={command.name}
            role="option"
            aria-selected={index === active}
            data-active={index === active}
            className={ROW_CLASS}
            onMouseDown={(event) => {
              // mousedown (not click) so the textarea blur race cannot eat it.
              event.preventDefault();
              props.onSelect(command.name);
            }}
            onMouseEnter={() => {
              props.onHover?.(index);
            }}
          >
            <span className="shrink-0 font-medium">{command.name}</span>
            {command.description === undefined ? null : (
              <span className="min-w-0 truncate text-muted-fg">{command.description}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface SlashRunDeps {
  readonly send: AppContextValue["send"];
  readonly sessionId: string | undefined;
}

/**
 * The wire step for a palette selection, separated so the runCommand payload
 * contract is testable without rendering: no session -> no request (the old
 * pre-session UI can type "/" but nothing runs).
 */
export function runSlashSelection(deps: SlashRunDeps, command: string): void {
  if (deps.sessionId === undefined) return;
  void deps.send("runCommand", { sessionId: deps.sessionId, command, args: [] });
}

export interface SlashCommandPaletteProps {
  /** Live composer text; "/" at message start opens the palette. */
  readonly text: string;
  /** T14 hook: called after a selection fires (clear the consumed text). */
  onAccepted?(): void;
}

export function SlashCommandPalette(props: SlashCommandPaletteProps): ReactNode {
  const { messenger, send } = useApp();
  const sessionId = useActiveSession();
  const snapshot = useCapabilitySnapshot();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  const query = detectSlashQuery(props.text);
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (query === null) return null;

  const select = (name: string): void => {
    runSlashSelection({ send, sessionId }, name);
    setActiveIndex(0);
    props.onAccepted?.();
  };

  return (
    <CommandPalette
      commands={snapshot?.commands ?? []}
      query={query}
      activeIndex={activeIndex}
      onSelect={select}
      onHover={setActiveIndex}
    />
  );
}

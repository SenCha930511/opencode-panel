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
 * - {@link SlashCommandPalette} — the container the Composer anchors in a
 *   relative wrapper directly around its textarea (the menu opens upward):
 *   derives the query from `text`, subscribes the capability store, and on
 *   select runs {@link runSlashSelection}. The composer passes its live
 *   text, clears it in `onAccepted` (the selected command is consumed, not
 *   sent as a prompt), and routes keystrokes through the optional `keyRef`
 *   handler while the menu is open. There is deliberately no active-session
 *   write here — without a session the select is a no-op (documented,
 *   tested).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { useApp, type AppContextValue } from "../../app/context.js";
import { useActiveSession } from "../activeSession.js";
import type { CommandEntry } from "./constants.js";
import {
  attachCapabilityStore,
  requestCapabilityRefresh,
  useCapabilitySnapshot,
} from "./capabilityStore.js";
import { detectSlashQuery, filterCommands, slashKeyAction } from "./logic.js";

/**
 * Keyboard seam between the composer and the open palette. The composer asks
 * before its own Enter/send handling; true = the palette consumed the key
 * (composer must preventDefault and stop). Decided by {@link slashKeyAction}.
 */
export type SlashKeyHandler = { (event: { key: string; shiftKey: boolean }): boolean };
export interface SlashKeyRef {
  current: SlashKeyHandler | null;
}

function CommandGlyph(props: { readonly name: string }): ReactNode {
  let colorClass = "bg-accent/15 text-accent";
  if (props.name.includes("init")) colorClass = "bg-emerald-500/15 text-emerald-400";
  else if (props.name.includes("review")) colorClass = "bg-blue-500/15 text-blue-400";
  else if (props.name.includes("git")) colorClass = "bg-amber-500/15 text-amber-400";
  else if (props.name.includes("test") || props.name.includes("playwright")) colorClass = "bg-purple-500/15 text-purple-400";
  else if (props.name.includes("debug") || props.name.includes("slop")) colorClass = "bg-pink-500/15 text-pink-400";
  return (
    <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded text-[10px] font-mono font-bold ${colorClass}`}>
      /
    </span>
  );
}

const MENU_CLASS =
  "absolute bottom-full left-0 right-0 z-50 mb-2 max-h-60 overflow-y-auto rounded-2xl border border-card-border bg-panel-bg p-1.5 shadow-2xl ring-1 ring-black/20 text-xs";

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
    <div
      data-oc-command-palette
      role="listbox"
      aria-label={t("commands.title")}
      className={MENU_CLASS}
    >
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-muted-fg border-b border-card-border/40 mb-1">
        <span className="flex items-center gap-1.5">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-accent/20 text-accent text-[9px] font-bold">/</span>
          <span>{t("commands.title")}</span>
        </span>
        <span className="text-[10px] text-muted-fg/60">
          {matches.length}
        </span>
      </div>
      {matches.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-fg">{t("commands.empty")}</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {matches.map((command, index) => {
            const isActive = index === active;
            return (
              <li key={command.name}>
                <div
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-1.5 text-start transition-colors cursor-pointer group ${
                    isActive ? "bg-hover-bg text-fg font-medium" : "text-fg/90 hover:bg-hover-bg/70 hover:text-fg"
                  }`}
                  onMouseDown={(event) => {
                    // mousedown (not click) so the textarea blur race cannot eat it.
                    event.preventDefault();
                    props.onSelect(command.name);
                  }}
                  onMouseEnter={() => {
                    props.onHover?.(index);
                  }}
                >
                  <div className="flex min-w-0 shrink-0 items-center gap-2">
                    <CommandGlyph name={command.name} />
                    <span className="font-medium text-fg">{command.name}</span>
                  </div>
                  {command.description !== undefined && (
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-fg/70 group-hover:text-muted-fg text-right font-normal">
                      {command.description}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
  /**
   * Composer-side keyboard seam: the palette publishes its key handler here
   * so the textarea's Enter/arrows/Escape drive the open menu instead of
   * sending the raw "/..." text. Optional (standalone use stays mouse-only).
   */
  readonly keyRef?: SlashKeyRef;
}

export function SlashCommandPalette(props: SlashCommandPaletteProps): ReactNode {
  const { messenger, send } = useApp();
  const sessionId = useActiveSession();
  const snapshot = useCapabilitySnapshot();
  const [activeIndex, setActiveIndex] = useState(0);
  // Escape hides the menu until the query changes (typing reopens it).
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  const query = detectSlashQuery(props.text);
  useEffect(() => {
    setActiveIndex(0);
    setDismissed(false);
  }, [query]);

  const open = query !== null && !dismissed;
  const matches = filterCommands(snapshot?.commands ?? [], query ?? "");

  // Fresh lists on open: commands added mid-session (config edit while the
  // server runs) are absent from the connect-time snapshot until pulled.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) requestCapabilityRefresh(messenger);
    wasOpen.current = open;
  }, [open, messenger]);

  const select = (name: string): void => {
    runSlashSelection({ send, sessionId }, name);
    setActiveIndex(0);
    props.onAccepted?.();
  };

  // Publish the composer's key handler. Runs every render so the closure
  // always sees the live matches/index; cleared on unmount.
  const keyRef = props.keyRef;
  useEffect(() => {
    if (keyRef === undefined) return undefined;
    keyRef.current = (event) => {
      const action = slashKeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        open,
        matchCount: matches.length,
      });
      if (action === null) return false;
      if (action.type === "move") {
        setActiveIndex((index) =>
          Math.min(Math.max(index + action.delta, 0), Math.max(matches.length - 1, 0)),
        );
      } else if (action.type === "accept") {
        const target = matches[Math.min(activeIndex, matches.length - 1)];
        if (target !== undefined) select(target.name);
      } else {
        setDismissed(true);
      }
      return true;
    };
    return () => {
      if (keyRef.current !== null) keyRef.current = null;
    };
  });

  if (!open) return null;

  return (
    <CommandPalette
      commands={snapshot?.commands ?? []}
      query={query ?? ""}
      activeIndex={activeIndex}
      onSelect={select}
      onHover={setActiveIndex}
    />
  );
}

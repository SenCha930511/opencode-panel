/**
 * Session menu (plan todo 19, webview side): the overflow actions for the
 * active session — Summarize/compact and Share link copy (todo-12 share
 * wire + clipboard, toast on copied). The row model + items renderer live
 * in ./sessionMenuRows; this file is the wired wrapper (guards, select
 * orchestration, trigger). The shell command + export transcript rows were
 * retired from this menu; the shell wire itself stays reachable from the
 * VS Code command palette (`opencodePanel.runShell` / `.exportTranscript`).
 *
 * SHELL GUARD (plan hard rule: never show shell when hasShell is false): the
 * production wrapper folds the todo-20 capability-flag store's `shell` bit —
 * the ONLY wire carrier of hasShell (todo-3 init names fork/question/todo
 * only) — into the resolved availability via {@link applyShellFlag}, and
 * attaches the store to the messenger (idempotent; the integration wave may
 * attach it earlier from bootstrap, which changes nothing). The injected
 * `availability` prop stays verbatim for tests.
 */

import { useEffect, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStrings } from "../../../lib/i18n.js";
import { useApp } from "../../app/context.js";
import { attachCapabilityFlags, useCapabilityFlags } from "../../mcp/capabilityFlags.js";
import {
  copyShareLink,
  requestSummarize,
  type ClipboardLike,
  type MessageOpReporter,
} from "./actions.js";
import {
  applyShellFlag,
  resolveMessageOpAvailability,
  type MessageOpAvailability,
} from "./logic.js";
import {
  SessionMenuItems,
  sessionMenuModel,
  type SessionMenuAction,
} from "./sessionMenuRows.js";

export type { SessionMenuAction } from "./sessionMenuRows.js";

export interface SessionMenuProps {
  readonly sessionId: string | undefined;
  readonly availability?: MessageOpAvailability;
  readonly reporter?: MessageOpReporter;
  readonly clipboard?: ClipboardLike;
}

export function SessionMenu(props: SessionMenuProps): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const flags = useCapabilityFlags();
  useEffect(() => {
    attachCapabilityFlags(app.messenger);
  }, [app.messenger]);
  const reporter =
    props.reporter ??
    ({
      unsupported: () => {
        app.pushToast("warning", t("capability.hidden"));
      },
      error: (message) => {
        app.pushToast("error", message);
      },
    } satisfies MessageOpReporter);
  const availability =
    props.availability ??
    applyShellFlag(resolveMessageOpAvailability(app.init.capabilities), flags.shell);
  const model = sessionMenuModel({
    availability,
    hasSession: props.sessionId !== undefined,
  });

  const onSelect = (action: SessionMenuAction): void => {
    const sessionId = props.sessionId;
    if (sessionId === undefined) return;
    switch (action) {
      case "summarize":
        void requestSummarize(app.messenger, { id: sessionId }, reporter);
        return;
      case "share": {
        const clipboard = props.clipboard ?? {
          writeText: (text: string) => navigator.clipboard.writeText(text), // i18n-allow-literal
        };
        void copyShareLink(app.messenger, sessionId, clipboard).then((outcome) => {
          switch (outcome.kind) {
            case "copied":
              app.pushToast("info", t("sessions.shareCopied"));
              return;
            case "share-failed":
              reporter.error(outcome.message);
              return;
            case "clipboard-failed":
              return;
            default: {
              const exhaustive: never = outcome;
              return exhaustive;
            }
          }
        });
        return;
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("commands.title")}
          className="rounded p-1.5 text-muted-fg hover:bg-hover-bg hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded border border-border bg-panel-bg p-1 shadow-lg"
        >
          <SessionMenuItems
            model={model}
            labels={{
              summarize: t("messages.summarize"),
              share: t("sessions.share"),
            }}
            onSelect={onSelect}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

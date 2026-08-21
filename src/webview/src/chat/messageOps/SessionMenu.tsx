import { useEffect, type ReactNode } from "react";
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
import { sessionMenuModel } from "./sessionMenuRows.js";

export type { SessionMenuAction } from "./sessionMenuRows.js";

export interface SessionMenuProps {
  readonly sessionId: string | undefined;
  readonly availability?: MessageOpAvailability;
  readonly reporter?: MessageOpReporter;
  readonly clipboard?: ClipboardLike;
}

function CompressIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2.5v2.5H3.5M10 2.5v2.5h2.5M6 13.5v-2.5H3.5M10 13.5v-2.5h2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8h11"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeDasharray="1.5 1.5"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="m5.8 7.1 4.4-2.2M5.8 8.9l4.4 2.2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
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

  const onSummarize = (): void => {
    const sessionId = props.sessionId;
    if (sessionId === undefined) return;
    void requestSummarize(app.messenger, { id: sessionId }, reporter);
  };

  const onShare = (): void => {
    const sessionId = props.sessionId;
    if (sessionId === undefined) return;
    const clipboard = props.clipboard ?? {
      writeText: (text: string) => navigator.clipboard.writeText(text),
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
  };

  return (
    <div aria-label={t("commands.title")} className="flex items-center gap-1 shrink-0 whitespace-nowrap">
      {model.summarize ? (
        <button
          type="button"
          title={t("messages.summarize")}
          aria-label={t("messages.summarize")}
          onClick={onSummarize}
          className="group flex h-6.5 items-center gap-0 rounded-lg border border-card-border/60 bg-card-bg/60 px-1.5 text-muted-fg shadow-2xs transition-all duration-200 ease-out hover:bg-hover-bg hover:text-fg hover:border-card-border hover:gap-1 hover:px-2 cursor-pointer select-none shrink-0"
        >
          <CompressIcon />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-medium opacity-0 transition-all duration-200 ease-out group-hover:max-w-xs group-hover:opacity-100">
            壓縮
          </span>
        </button>
      ) : null}
      {model.share ? (
        <button
          type="button"
          title={t("sessions.share")}
          aria-label={t("sessions.share")}
          onClick={onShare}
          className="group flex h-6.5 items-center gap-0 rounded-lg border border-card-border/60 bg-card-bg/60 px-1.5 text-muted-fg shadow-2xs transition-all duration-200 ease-out hover:bg-hover-bg hover:text-fg hover:border-card-border hover:gap-1 hover:px-2 cursor-pointer select-none shrink-0"
        >
          <ShareIcon />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-medium opacity-0 transition-all duration-200 ease-out group-hover:max-w-xs group-hover:opacity-100">
            {t("sessions.share")}
          </span>
        </button>
      ) : null}
    </div>
  );
}

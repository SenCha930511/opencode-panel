import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import type { PartVM } from "../types.js";
import { useChatActions } from "../chatContext.js";

type PatchPart = Extract<PartVM, { kind: "patch" }>;

function GitDiffIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 6v4M6 4h4a2 2 0 0 1 2 2v0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Patch part: a modern card button opening the session diff in the editor. */
export function PatchPartView(props: { readonly part: PatchPart }) {
  const { t } = useStrings();
  const actions = useChatActions();
  const sessionId = props.part.sessionID ?? "";
  return (
    <div className="flex items-center">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-card-border/80 bg-card-bg/90 px-3 py-1.5 text-xs font-medium text-fg shadow-2xs transition-all hover:bg-hover-bg hover:border-focus-ring/60 active:scale-98 cursor-pointer group"
        onClick={() => {
          if (sessionId.length === 0) return;
          if (props.part.messageID !== undefined) {
            actions.openDiff({ sessionId, messageID: props.part.messageID });
          } else {
            actions.openDiff({ sessionId });
          }
        }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-accent/15 text-accent group-hover:bg-accent group-hover:text-accent-fg transition-colors">
          <GitDiffIcon />
        </span>
        <span className="font-semibold text-fg/90 group-hover:text-fg">{t("dock.diffs.openDiff")}</span>
        <span className="text-[11px] text-muted-fg/70 font-normal transition-transform group-hover:translate-x-0.5">➔</span>
      </button>
    </div>
  );
}

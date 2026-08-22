import type { ReactNode } from "react";
import type { PartVM } from "../types.js";
import { useStrings } from "../../../lib/i18n.js";
import { Markdown } from "./markdown.js";

const SNIPPET_LENGTH = 96;

function snippet(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (firstLine.length <= SNIPPET_LENGTH) return firstLine;
  return firstLine.slice(0, SNIPPET_LENGTH);
}

function BrainIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted-fg">
      <path
        d="M6 3a3 3 0 0 0-3 3c0 1.1.6 2.1 1.5 2.6A3 3 0 0 0 6 13M10 3a3 3 0 0 1 3 3c0 1.1-.6 2.1-1.5 2.6A3 3 0 0 1 10 13M8 3v10M5 7h6M5 10h6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { scrollElementIntoViewSafe } from "./scrollHelper.js";

/** Reasoning renders collapsed by default; summary = localized Thinking label + the data's own lead. */
export function ReasoningPartView(props: { readonly part: Extract<PartVM, { kind: "reasoning" }> }) {
  const { t } = useStrings();
  return (
    <details
      className="group m-0 overflow-hidden rounded-lg text-xs transition-all scroll-mb-24 scroll-mt-12"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          scrollElementIntoViewSafe(e.currentTarget);
        }
      }}
    >
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 pr-1.5 text-muted-fg hover:text-fg font-medium transition-colors">
        <span className="text-[10px] text-muted-fg/60 transition-transform group-open:rotate-90 shrink-0">
          ▶
        </span>
        <BrainIcon />
        <span className="font-semibold text-fg/90 shrink-0">{t("messages.thinking")}</span>
        <span className="truncate opacity-70 italic font-normal text-[11px] min-w-0 flex-1">
          {snippet(props.part.text)}
        </span>
      </summary>
      <div className="mt-1 pl-4 border-l border-card-border/60 font-mono text-[11px] leading-relaxed text-muted-fg">
        <Markdown text={props.part.text} className="leading-relaxed break-words" />
      </div>
    </details>
  );
}

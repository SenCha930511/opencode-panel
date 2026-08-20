import type { PartVM } from "../types.js";
import { useStrings } from "../../../lib/i18n.js";
import { Markdown } from "./Markdown.js";

const SNIPPET_LENGTH = 96;

function snippet(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (firstLine.length <= SNIPPET_LENGTH) return firstLine;
  return firstLine.slice(0, SNIPPET_LENGTH);
}

/** Reasoning renders collapsed by default; summary = localized Thinking label + the data's own lead. */
export function ReasoningPartView(props: { readonly part: Extract<PartVM, { kind: "reasoning" }> }) {
  const { t } = useStrings();
  return (
    <details className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-[0.92em] opacity-80">
      <summary className="cursor-pointer select-none truncate italic">
        <span className="mr-1.5 not-italic font-medium">{t("messages.thinking")}</span>
        <span className="opacity-70">{snippet(props.part.text)}</span>
      </summary>
      <Markdown text={props.part.text} className="mt-1 leading-relaxed break-words" />
    </details>
  );
}

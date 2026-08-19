import { useStrings } from "../../../lib/i18n.js";
import type { StringId } from "../../../../shared/strings.js";
import type { PartVM, ToolStatus } from "../types.js";
import { ToolIcon, toolIconKind } from "./toolIcon.js";

type ToolPart = Extract<PartVM, { kind: "tool" }>;

const STATUS_LABEL: Readonly<Record<ToolStatus, StringId>> = {
  pending: "tool.status.pending",
  running: "tool.status.running",
  completed: "tool.status.completed",
  error: "tool.status.failed",
};

const STATUS_CLASS: Readonly<Record<ToolStatus, string>> = {
  pending: "text-[var(--vscode-descriptionForeground)] border-[var(--vscode-panel-border)]",
  running: "text-[var(--vscode-charts-blue)] border-[var(--vscode-charts-blue)]",
  completed: "text-[var(--vscode-charts-green)] border-[var(--vscode-charts-green)]",
  error: "text-[var(--vscode-errorForeground)] border-[var(--vscode-errorForeground)]",
};

function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * OMO HARD REQUIREMENT (plan §OMO caveat 2): this card is fully data-driven.
 * The title is the payload's tool name VERBATIM, the icon comes from a
 * name-morphology heuristic, the summary is `state.title` verbatim, and the
 * status chip maps the state machine — nothing ever switches on a literal
 * tool name anywhere in the renderer, so unknown names (skill_mcp,
 * team_*, plain-opencode built-ins) render identically by construction.
 */
export function GenericToolCard(props: { readonly part: ToolPart }) {
  const { t } = useStrings();
  const { part } = props;
  const iconKind = toolIconKind(part.tool);
  return (
    <details className="rounded border border-[var(--vscode-panel-border)] text-[0.92em]">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1">
        <ToolIcon kind={iconKind} />
        <span className="font-medium break-all">{part.tool}</span>
        {part.title !== undefined && part.title !== part.tool ? (
          <span className="truncate text-[var(--vscode-descriptionForeground)]">{part.title}</span>
        ) : null}
        <span
          className={`ml-auto rounded border px-1.5 py-0.5 text-[0.85em] leading-none ${STATUS_CLASS[part.status]}`}
        >
          {t(STATUS_LABEL[part.status])}
        </span>
      </summary>
      <div className="space-y-1 border-t border-[var(--vscode-panel-border)] px-2 py-1">
        {part.input !== undefined ? (
          <pre className="overflow-x-auto rounded bg-[var(--vscode-textCodeBlock-background)] p-2 text-[0.9em]">
            {prettyJson(part.input)}
          </pre>
        ) : null}
        {part.output !== undefined ? (
          <pre className="overflow-x-auto rounded bg-[var(--vscode-textCodeBlock-background)] p-2 text-[0.9em]">
            {part.output}
          </pre>
        ) : null}
        {part.error !== undefined ? (
          <pre className="overflow-x-auto rounded border border-[var(--vscode-errorForeground)] p-2 text-[0.9em] text-[var(--vscode-errorForeground)]">
            {part.error}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

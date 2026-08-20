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
  pending: "text-muted-fg bg-panel-bg border-border",
  running: "text-accent bg-accent/10 border-accent/30 animate-pulse-subtle",
  completed: "text-ok bg-ok/10 border-ok/30",
  error: "text-err bg-err/10 border-err/30",
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
    <details className="my-2 overflow-hidden rounded-xl border border-card-border bg-card-bg/60 text-xs shadow-2xs transition-all">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 font-medium text-fg transition-colors hover:bg-hover-bg/60">
        <ToolIcon kind={iconKind} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="font-semibold truncate text-fg">{part.tool}</span>
          {part.title !== undefined && part.title !== part.tool ? (
            <span className="truncate text-muted-fg text-[11px]">{part.title}</span>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider leading-none shadow-2xs ${STATUS_CLASS[part.status]}`}
        >
          {t(STATUS_LABEL[part.status])}
        </span>
      </summary>
      <div className="space-y-2 border-t border-card-border/60 bg-bg/40 p-2.5">
        {part.input !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2.5 font-mono text-[11px] text-fg">
            {prettyJson(part.input)}
          </pre>
        ) : null}
        {part.output !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2.5 font-mono text-[11px] text-fg">
            {part.output}
          </pre>
        ) : null}
        {part.error !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-err/30 bg-err/10 p-2.5 font-mono text-[11px] text-err">
            {part.error}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

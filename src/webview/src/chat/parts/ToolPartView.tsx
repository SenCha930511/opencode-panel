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
  pending: "text-muted-fg",
  running: "text-accent font-semibold",
  completed: "text-ok",
  error: "text-err font-semibold",
};

function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function verbForTool(tool: string): string {
  const lower = tool.toLowerCase();
  if (
    lower.includes("read") ||
    lower.includes("view") ||
    lower.includes("list") ||
    lower.includes("dir") ||
    lower.includes("glob") ||
    lower.includes("fetch")
  ) {
    return "Explored";
  }
  if (
    lower.includes("replace") ||
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("patch")
  ) {
    return "Edited";
  }
  if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) {
    return "Searched";
  }
  if (
    lower.includes("command") ||
    lower.includes("bash") ||
    lower.includes("terminal") ||
    lower.includes("exec")
  ) {
    return "Ran";
  }
  return tool;
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
  const verb = verbForTool(part.tool);
  const isRunning = part.status === "running";

  return (
    <details className="group my-1 overflow-hidden rounded-lg text-xs transition-all">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 text-muted-fg hover:text-fg font-medium transition-colors">
        <span className="text-[10px] text-muted-fg/60 transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="text-muted-fg/80 font-normal">
          {isRunning ? `${verb.replace(/ed$/, "ing")}...` : verb}
        </span>
        <ToolIcon kind={iconKind} />
        <span className="font-semibold text-fg/90 truncate max-w-[calc(100%-130px)]">
          {part.title !== undefined && part.title !== part.tool ? part.title : part.tool}
        </span>
        {isRunning ? (
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse ml-0.5" />
        ) : (
          <span className={`ml-auto text-[10px] font-mono ${STATUS_CLASS[part.status]}`}>
            {t(STATUS_LABEL[part.status])}
          </span>
        )}
      </summary>
      <div className="mt-1 pl-4 space-y-1.5 border-l border-card-border/60">
        {part.input !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2 font-mono text-[11px] text-fg">
            {prettyJson(part.input)}
          </pre>
        ) : null}
        {part.output !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2 font-mono text-[11px] text-fg">
            {part.output}
          </pre>
        ) : null}
        {part.error !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-err/30 bg-err/10 p-2 font-mono text-[11px] text-err">
            {part.error}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

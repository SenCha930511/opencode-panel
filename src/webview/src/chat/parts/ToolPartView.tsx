import { useStrings } from "../../../lib/i18n.js";
import type { StringId } from "../../../../shared/strings.js";
import { isRecord } from "../../../../shared/protocol.js";
import type { PartVM, ToolStatus } from "../types.js";
import { ToolIcon, toolIconKind } from "./toolIcon.js";

type ToolPart = Extract<PartVM, { kind: "tool" }>;

const STATUS_LABEL: Readonly<Record<ToolStatus, StringId>> = {
  pending: "tool.status.pending",
  running: "tool.status.running",
  completed: "tool.status.completed",
  error: "tool.status.failed",
};

/** Terminal-status glyphs (no words): ✓ completed, ✗ failed. */
const STATUS_GLYPH: Readonly<Partial<Record<ToolStatus, string>>> = {
  completed: "✓",
  error: "✗",
};

const STATUS_CLASS: Readonly<Record<ToolStatus, string>> = {
  pending: "text-muted-fg",
  running: "text-accent font-semibold",
  completed: "text-ok",
  error: "text-err font-semibold",
};

interface FileDiffStat {
  readonly additions: number;
  readonly deletions: number;
}

/**
 * A file-editing tool reports its line delta through
 * `state.metadata.filediff.{additions,deletions}` (opencode edit/write shape,
 * data-driven: any tool emitting the same shape gets the counter — no tool
 * name switching, per the card's OMO contract).
 */
export function readFileDiffStat(raw: Readonly<Record<string, unknown>>): FileDiffStat | undefined {
  const state = isRecord(raw.state) ? raw.state : undefined;
  const metadata = state !== undefined && isRecord(state.metadata) ? state.metadata : undefined;
  const filediff = metadata !== undefined && isRecord(metadata.filediff) ? metadata.filediff : undefined;
  if (
    filediff === undefined ||
    typeof filediff.additions !== "number" ||
    typeof filediff.deletions !== "number"
  ) {
    return undefined;
  }
  return { additions: filediff.additions, deletions: filediff.deletions };
}

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
  // Completed file edits headline their diff counters instead of a bare ✓.
  const diffStat = part.status === "completed" ? readFileDiffStat(part.raw) : undefined;

  return (
    <details className="group m-0 overflow-hidden rounded-lg text-xs transition-all">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 pr-1.5 text-muted-fg hover:text-fg font-medium transition-colors">
        <span className="text-[10px] text-muted-fg/60 transition-transform group-open:rotate-90 shrink-0">
          ▶
        </span>
        <span className="text-muted-fg/80 font-normal shrink-0">
          {isRunning ? `${verb.replace(/ed$/, "ing")}...` : verb}
        </span>
        <ToolIcon kind={iconKind} />
        <span className="font-semibold text-fg/90 truncate min-w-0 flex-1">
          {part.title !== undefined && part.title !== part.tool ? part.title : part.tool}
        </span>
        {isRunning ? (
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse shrink-0 ml-1" />
        ) : diffStat !== undefined ? (
          <span className="flex shrink-0 items-center gap-1 ml-1 text-[10px] font-mono">
            <span className="text-ok">+{diffStat.additions}</span>
            <span className="text-err">−{diffStat.deletions}</span>
          </span>
        ) : (
          <span
            aria-label={t(STATUS_LABEL[part.status])}
            title={t(STATUS_LABEL[part.status])}
            className={`shrink-0 ml-1 text-[11px] font-semibold leading-none ${STATUS_CLASS[part.status]}`}
          >
            {STATUS_GLYPH[part.status] ?? t(STATUS_LABEL[part.status])}
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

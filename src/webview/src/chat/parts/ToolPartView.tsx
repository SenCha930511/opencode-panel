import { useMemo, useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { getWebviewMessenger } from "../../../lib/messenger.js";
import type { StringId } from "../../../../shared/strings.js";
import { isRecord, type PermissionResponse } from "../../../../shared/protocol.js";
import type { PartVM, ToolStatus } from "../types.js";
import { getActiveSession } from "../activeSession.js";
import { QuestionCard } from "../cards/QuestionCard.js";
import { PermissionCard } from "../cards/PermissionCard.js";
import { parseQuestionPrompt, parsePermissionCard } from "../cards/cardParsers.js";
import type { QuestionPromptVM, PermissionCardVM } from "../cards/cardTypes.js";
import { ToolIcon, toolIconKind } from "./toolIcon.js";

const TOOL_OUTPUT_LINE_CAP = 80;

interface OutputSlice {
  readonly text: string;
  readonly truncated: boolean;
  readonly remaining: number;
}

/** First N lines of an output string, plus the hidden-tail size for the +N chip. */
export function truncateToolOutput(output: string, cap = TOOL_OUTPUT_LINE_CAP): OutputSlice {
  const lines = output.split("\n");
  if (lines.length <= cap) return { text: output, truncated: false, remaining: 0 };
  return {
    text: lines.slice(0, cap).join("\n"),
    truncated: true,
    remaining: lines.length - cap,
  };
}

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

function ToolOutputBlock({ output }: { readonly output: string }): ReactNode {
  const { t } = useStrings();
  const [expanded, setExpanded] = useState(false);
  const slice = expanded ? { text: output, truncated: false, remaining: 0 } : truncateToolOutput(output);
  if (!slice.truncated) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2 font-mono text-[11px] text-fg [contain:content]">
        {slice.text}
      </pre>
    );
  }
  return (
    <div className="[contain:content]">
      <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2 font-mono text-[11px] text-fg">
        {slice.text}
      </pre>
      <button
        type="button"
        data-oc-tool-output-expand
        className="mt-1.5 text-[10px] font-semibold text-accent/90 hover:text-accent hover:underline cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        {t("tool.output.expand").replace("{count}", `+${Math.max(slice.remaining, 0)}`)}
      </button>
    </div>
  );
}

/**
 * OMO HARD REQUIREMENT (plan §OMO caveat 2): this card is fully data-driven.
 * The title is the payload's tool name VERBATIM, the icon comes from a
 * name-morphology heuristic, the summary is `state.title` verbatim, and the
 * status chip maps the state machine — nothing ever switches on a literal
 * tool name anywhere in the renderer, so unknown names (skill_mcp,
 * team_*, plain-opencode built-ins) render identically by construction.
 */

const answeredQuestionsMap = new Map<string, readonly string[]>();

function getQuestionKey(part: ToolPart): string {
  return part.callID ?? part.id;
}

function extractAnswers(
  submitted: readonly string[] | null,
  output: string | undefined,
): readonly string[] {
  if (submitted && submitted.length > 0) return submitted;
  if (output) {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
      if (isRecord(parsed)) {
        if (Array.isArray(parsed.answers)) {
          return (parsed.answers as unknown[]).map(String);
        }
        if (Array.isArray(parsed.response)) {
          return (parsed.response as unknown[]).map(String);
        }
        if (typeof parsed.answer === "string") {
          return [parsed.answer];
        }
      }
    } catch {
      if (output.trim().length > 0 && output !== "null" && output !== "undefined") {
        return [output.trim()];
      }
    }
  }
  return [];
}

function QuestionToolCard(props: { readonly part: ToolPart }) {
  const { t } = useStrings();
  const { part } = props;
  const qKey = getQuestionKey(part);
  const previouslySubmitted = answeredQuestionsMap.get(qKey);
  const isCompleted =
    part.status === "completed" ||
    part.output !== undefined ||
    previouslySubmitted !== undefined;

  const [localStatus, setLocalStatus] = useState<"pending" | "replying" | "replied">(
    isCompleted ? "replied" : "pending"
  );
  const [submittedAnswers, setSubmittedAnswers] = useState<readonly string[] | null>(
    previouslySubmitted ?? null
  );

  const parsedCard = useMemo(() => {
    if (!isRecord(part.input) || !Array.isArray(part.input.questions)) return null;
    const questions = (part.input.questions as unknown[])
      .map(parseQuestionPrompt)
      .filter((q): q is QuestionPromptVM => q !== undefined);
    if (questions.length === 0) return null;
    return {
      kind: "question" as const,
      sessionId: getActiveSession() ?? "",
      requestId: part.callID ?? part.id,
      questions,
      status: isCompleted || localStatus === "replied" ? ("replied" as const) : localStatus === "replying" ? ("replying" as const) : ("pending" as const),
    };
  }, [part.input, part.callID, part.id, isCompleted, localStatus]);

  if (!parsedCard) {
    return <StandardToolDetails part={part} />;
  }

  if (isCompleted || part.status === "completed" || localStatus === "replied") {
    const effectiveAnswers = extractAnswers(
      submittedAnswers ?? (qKey ? answeredQuestionsMap.get(qKey) ?? null : null),
      part.output,
    );

    return (
      <div className="my-2 rounded-2xl border border-ok/30 bg-panel-bg/95 p-3.5 text-xs text-fg shadow-md backdrop-blur-md transition-all">
        <div className="flex items-center justify-between gap-2 border-b border-card-border/40 pb-2">
          <div className="flex items-center gap-2 text-ok font-semibold text-xs">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 text-ok text-[11px] font-bold">✓</span>
            <span>{t("question.title")} - 已完成</span>
          </div>
        </div>

        <div className="mt-2.5 space-y-2">
          {parsedCard.questions.map((q, qIdx) => {
            const answer = effectiveAnswers[qIdx] ?? (effectiveAnswers.length === 1 ? effectiveAnswers[0] : undefined);
            return (
              <div key={qIdx} className="rounded-xl border border-card-border/50 bg-card-bg/60 p-2.5">
                <div className="text-[11px] font-medium text-fg/90 mb-1.5">
                  {q.prompt}
                </div>
                {answer ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-fg shrink-0">已選擇：</span>
                    <span className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-semibold text-fg shadow-2xs">
                      <span className="text-ok font-bold">✓</span>
                      <span>{answer}</span>
                    </span>
                  </div>
                ) : effectiveAnswers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px] text-muted-fg shrink-0">已選擇：</span>
                    {effectiveAnswers.map((ans, aIdx) => (
                      <span
                        key={aIdx}
                        className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-semibold text-fg shadow-2xs"
                      >
                        <span className="text-ok font-bold">✓</span>
                        <span>{ans}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <QuestionCard
      card={parsedCard}
      onSubmit={(answers) => {
        setSubmittedAnswers(answers);
        answeredQuestionsMap.set(qKey, answers);
        setLocalStatus("replying");
        const sessionId = getActiveSession() ?? "";
        const questionID = part.callID ?? part.id;
        void getWebviewMessenger()
          .request("answerQuestion", {
            sessionId,
            questionID,
            answers,
          })
          .then(() => {
            setLocalStatus("replied");
          })
          .catch((err) => {
            console.warn("answerQuestion request failed:", err);
            setLocalStatus("pending");
          });
      }}
      onDismiss={() => {
        answeredQuestionsMap.set(qKey, []);
        setLocalStatus("replied");
      }}
    />
  );
}

function extractCommand(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input.CommandLine === "string") return input.CommandLine;
  if (typeof input.command === "string") return input.command;
  if (typeof input.cmd === "string") return input.cmd;
  if (typeof input.script === "string") return input.script;
  return undefined;
}

function extractFilePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const path =
    input.TargetFile ??
    input.targetFile ??
    input.AbsolutePath ??
    input.filePath ??
    input.path ??
    input.file ??
    input.DirectoryPath ??
    input.SearchPath;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function extractQueryOrUrl(input: unknown): { query?: string; url?: string } | undefined {
  if (!isRecord(input)) return undefined;
  const query = typeof input.query === "string" ? input.query : typeof input.Query === "string" ? input.Query : undefined;
  const url = typeof input.url === "string" ? input.url : typeof input.Url === "string" ? input.Url : undefined;
  if (query || url) return { query, url };
  return undefined;
}

function PermissionToolCard(props: { readonly part: ToolPart }) {
  const { t } = useStrings();
  const { part } = props;
  const [localStatus, setLocalStatus] = useState<"pending" | "replying" | "replied">(
    part.status === "completed" ? "replied" : "pending"
  );

  const parsedCard = useMemo(() => {
    const card = parsePermissionCard({
      id: part.callID ?? part.id,
      sessionID: getActiveSession() ?? "",
      ...(isRecord(part.input) ? part.input : {}),
      ...(isRecord(part.raw) ? part.raw : {}),
    });
    return card ?? null;
  }, [part.input, part.raw, part.callID, part.id]);

  if (!parsedCard) {
    return <StandardToolDetails part={part} />;
  }

  if (part.status === "completed" || localStatus === "replied") {
    return (
      <div className="my-2 rounded-2xl border border-ok/30 bg-panel-bg/95 p-3 text-xs text-fg shadow-md backdrop-blur-md">
        <div className="flex items-center gap-2 text-ok font-semibold text-xs">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 text-ok text-[11px]">✓</span>
          <span>{t("permission.title")} - 已核准 (Approved)</span>
        </div>
      </div>
    );
  }

  return (
    <PermissionCard
      card={parsedCard}
      onReply={(response) => {
        setLocalStatus("replying");
        const sessionId = getActiveSession() ?? "";
        const permissionID = part.callID ?? part.id;
        void getWebviewMessenger()
          .request("answerPermission", {
            sessionId,
            permissionID,
            response,
          })
          .then(() => {
            setLocalStatus("replied");
          })
          .catch((err) => {
            console.warn("answerPermission request failed:", err);
            setLocalStatus("pending");
          });
      }}
      onDismiss={() => {
        setLocalStatus("replied");
      }}
    />
  );
}

function StandardToolDetails(props: { readonly part: ToolPart }) {
  const { t } = useStrings();
  const { part } = props;
  const iconKind = toolIconKind(part.tool);
  const verb = verbForTool(part.tool);
  const isRunning = part.status === "running";
  // Completed file edits headline their diff counters instead of a bare ✓.
  const diffStat = part.status === "completed" ? readFileDiffStat(part.raw) : undefined;
  const cmd = extractCommand(part.input);
  const filePath = extractFilePath(part.input);
  const queryOrUrl = extractQueryOrUrl(part.input);
  const [copied, setCopied] = useState(false);

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
        {cmd ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-emerald-400 border border-card-border/40 overflow-hidden">
            <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1">
              <span className="text-muted-fg/60 select-none">$</span>
              <span className="text-fg font-medium whitespace-pre">{cmd}</span>
            </div>
            <button
              type="button"
              className="shrink-0 text-[10px] text-muted-fg hover:text-fg transition-colors px-1.5 py-0.5 rounded hover:bg-hover-bg cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(cmd);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "已複製 ✓" : "複製"}
            </button>
          </div>
        ) : filePath ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-card-bg/80 hover:bg-hover-bg px-2.5 py-1 text-[11px] font-mono text-accent hover:underline transition-all cursor-pointer border border-card-border/60 shadow-2xs"
              onClick={(e) => {
                e.stopPropagation();
                void getWebviewMessenger().request("openFile", { path: filePath });
              }}
            >
              <span>📄 {filePath}</span>
              <span className="text-[10px] text-muted-fg">↗</span>
            </button>
          </div>
        ) : queryOrUrl ? (
          <div className="rounded-lg bg-card-bg/60 p-2 text-[11px] text-fg border border-card-border/40">
            {queryOrUrl.query && <div>🔍 搜尋詞：<span className="font-semibold">{queryOrUrl.query}</span></div>}
            {queryOrUrl.url && <div className="truncate font-mono text-accent">🌐 {queryOrUrl.url}</div>}
          </div>
        ) : part.input !== undefined ? (
          <pre className="overflow-x-auto rounded-lg border border-card-border/60 bg-black/20 p-2 font-mono text-[11px] text-fg">
            {prettyJson(part.input)}
          </pre>
        ) : null}

        {part.output !== undefined ? (
          <ToolOutputBlock output={part.output} />
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

export function GenericToolCard(props: { readonly part: ToolPart }) {
  const { part } = props;

  const isQuestionTool =
    (part.tool.toLowerCase().includes("question") ||
      (isRecord(part.input) && Array.isArray((part.input as any).questions))) &&
    isRecord(part.input) &&
    Array.isArray((part.input as any).questions);

  if (isQuestionTool) {
    return <QuestionToolCard part={part} />;
  }

  const isPermissionTool =
    part.tool.toLowerCase().includes("permission") ||
    (isRecord(part.input) && typeof (part.input as any).permission === "string");

  if (isPermissionTool) {
    return <PermissionToolCard part={part} />;
  }

  return <StandardToolDetails part={part} />;
}

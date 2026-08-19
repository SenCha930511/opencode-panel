/**
 * The 7 canned scenario scripts. Each SSE sequence matches the v2 taxonomy the
 * plan consumes (`message.part.delta`, `permission.asked`, `question.asked`,
 * `session.status`, ...). The executor that drives them lives in scenarios.ts.
 */
import type {
  AssistantMessageInfo,
  JsonObject,
  MockPart,
  PartId,
  ScenarioName,
  TextPart,
  ToolPart,
  ToolState,
  UserMessageInfo,
} from "./types.js";
import type { MockState, SessionRecord } from "./state.js";

export interface ReplayContext {
  state: MockState;
  session: SessionRecord;
  user: UserMessageInfo;
  assistant: AssistantMessageInfo;
  emit: (type: string, properties: unknown) => void;
  addPart: (part: MockPart) => void;
  newPartId: () => PartId;
  sleep: (ms: number) => Promise<void>;
  aborted: () => boolean;
}

const PERMISSION_TIMEOUT_MS = 30_000;
const QUESTION_TIMEOUT_MS = 30_000;

const BASIC_TEXT =
  "Here is your mock assistant reply. It streams over the event bus as " +
  "message.part.delta chunks, then the message completes with full text. " +
  "The panel can render me like a real opencode response.";

/** Exactly 200 chunks by construction — the plan pins the long-stream count. */
const LONG_STREAM_CHUNKS: ReadonlyArray<string> = Array.from(
  { length: 200 },
  (_, i) => `chunk-${String(i + 1).padStart(3, "0")} `,
);

interface TextStream {
  chunks: ReadonlyArray<string>;
  delayMs: number;
}

/** Delta emitter: appends text to `part` and streams `message.part.delta` chunks. */
async function streamText(ctx: ReplayContext, part: TextPart, stream: TextStream): Promise<void> {
  for (const chunk of stream.chunks) {
    if (ctx.aborted()) return;
    part.text += chunk;
    ctx.emit("message.part.delta", {
      sessionID: ctx.session.info.id,
      messageID: ctx.assistant.id,
      partID: part.id,
      field: "text",
      delta: chunk,
    });
    if (stream.delayMs > 0) await ctx.sleep(stream.delayMs);
  }
  part.time.end = ctx.state.now();
}

function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function textPart(ctx: ReplayContext): TextPart {
  return {
    id: ctx.newPartId(),
    sessionID: ctx.session.info.id,
    messageID: ctx.assistant.id,
    type: "text",
    text: "",
    time: { start: ctx.state.now() },
  };
}

interface ToolCallSpec {
  tool: string;
  input: JsonObject;
  output: string;
  title: string;
}

function completedToolPart(ctx: ReplayContext, call: ToolCallSpec): ToolPart {
  const start = ctx.state.now();
  const state: ToolState = {
    status: "completed",
    input: call.input,
    output: call.output,
    title: call.title,
    metadata: {},
    time: { start, end: ctx.state.now() },
  };
  return {
    id: ctx.newPartId(),
    sessionID: ctx.session.info.id,
    messageID: ctx.assistant.id,
    type: "tool",
    callID: ctx.state.requestId("call"),
    tool: call.tool,
    state,
  };
}

type ReplayFn = (ctx: ReplayContext) => Promise<void>;

export const replayByScenario: Record<ScenarioName, ReplayFn> = {
  "basic-chat": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: splitEvery(BASIC_TEXT, 24), delayMs: 4 });
  },

  "permission-flow": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: ["I need permission for that. "], delayMs: 2 });
    if (ctx.aborted()) return;
    const request = {
      id: ctx.state.requestId("per"),
      sessionID: ctx.session.info.id,
      permission: "bash",
      patterns: ["ls -la"],
      metadata: {},
      always: [],
      tool: { messageID: ctx.assistant.id, callID: ctx.state.requestId("call") },
    };
    let settle!: (response: "once" | "always" | "reject") => void;
    const promise = new Promise<"once" | "always" | "reject">((resolve) => {
      settle = resolve;
    });
    ctx.state.pendingPermissions.set(request.id, { request, promise, settle });
    ctx.emit("permission.asked", { ...request });
    const response = await Promise.race([
      promise,
      ctx.sleep(PERMISSION_TIMEOUT_MS).then(() => "reject" as const),
    ]);
    ctx.state.pendingPermissions.delete(request.id);
    ctx.emit("permission.replied", {
      sessionID: ctx.session.info.id,
      permissionID: request.id,
      response,
    });
    if (response === "reject") {
      await streamText(ctx, part, { chunks: ["Permission rejected; stopping."], delayMs: 2 });
      return;
    }
    await streamText(ctx, part, { chunks: ["Permission granted, continuing the task. "], delayMs: 2 });
  },

  "question-flow": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: ["One question before I proceed. "], delayMs: 2 });
    if (ctx.aborted()) return;
    const request = {
      id: ctx.state.requestId("qst"),
      sessionID: ctx.session.info.id,
      questions: [
        {
          question: "Which variant should I build?",
          header: "Variant",
          options: [
            { label: "minimal", description: "Smallest working version" },
            { label: "full", description: "All features" },
          ],
          multiple: false,
        },
      ],
      tool: { messageID: ctx.assistant.id, callID: ctx.state.requestId("call") },
    };
    let settle!: (answer: { answers?: unknown; reject?: boolean }) => void;
    const promise = new Promise<{ answers?: unknown; reject?: boolean }>((resolve) => {
      settle = resolve;
    });
    ctx.state.pendingQuestions.set(request.id, { request, promise, settle });
    ctx.emit("question.asked", { ...request });
    const answer = await Promise.race([
      promise,
      ctx.sleep(QUESTION_TIMEOUT_MS).then(() => ({ reject: true }) as const),
    ]);
    ctx.state.pendingQuestions.delete(request.id);
    if (answer.reject) {
      ctx.emit("question.rejected", { sessionID: ctx.session.info.id, requestID: request.id });
      await streamText(ctx, part, { chunks: ["Question rejected; using defaults. "], delayMs: 2 });
      return;
    }
    ctx.emit("question.replied", {
      sessionID: ctx.session.info.id,
      requestID: request.id,
      answers: answer.answers ?? [],
    });
    await streamText(ctx, part, { chunks: ["Got it, building your choice. "], delayMs: 2 });
  },

  "long-stream": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: LONG_STREAM_CHUNKS, delayMs: 1 });
  },

  "error-revert": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: ["Working on it", "... something went wrong. "], delayMs: 5 });
    ctx.assistant.error = {
      name: "APIError",
      data: { message: "mock upstream failure", isRetryable: false, statusCode: 502 },
    };
    ctx.emit("session.error", {
      sessionID: ctx.session.info.id,
      error: { name: "APIError", data: { message: "mock upstream failure" } },
    });
  },

  "omo-agents": async (ctx) => {
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: ["Delegating to custom agents. "], delayMs: 2 });
    // Unknown-to-core tool names must still render generically downstream.
    ctx.addPart(
      completedToolPart(ctx, {
        tool: "skill_mcp",
        input: { mcp_name: "flux-image-gen", tool_name: "generate_image", arguments: "{\"prompt\":\"mock\"}" },
        output: "generated mock-image.png",
        title: "skill_mcp: generate_image",
      }),
    );
    ctx.addPart(
      completedToolPart(ctx, {
        tool: "grep_app_searchGitHub",
        input: { query: "startMockServer(" },
        output: "3 matches in mock repos",
        title: "grep_app_searchGitHub",
      }),
    );
    await streamText(ctx, part, { chunks: ["Custom tools finished. "], delayMs: 2 });
  },

  "old-server": async (ctx) => {
    // Old servers still stream; they only lack fork/question/todo/prompt_async.
    const part = textPart(ctx);
    ctx.addPart(part);
    await streamText(ctx, part, { chunks: splitEvery("Legacy reply from a v0.2 server.", 12), delayMs: 4 });
  },
};

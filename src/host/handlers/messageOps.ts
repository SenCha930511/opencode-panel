/**
 * Message-ops host handlers (plan todo 19): `revert`, `unrevert`,
 * `summarize`, `runShell` — registered through the todo-10 registry seam
 * (`RegisterHandler`, the structural twin from ./sessions.ts), so this module
 * NEVER touches src/providers or src/shared beyond the frozen envelope types.
 * The client comes from the todo-12 {@link SessionClientSource} seam
 * (production: ServerManager.onboardClient), exactly like the prompt domain.
 *
 * SDK CONTRACT (verified against @opencode-ai/sdk 1.18.18, gen/types.gen.d.ts):
 * - `session.revert({path:{id}, body:{messageID}})`   -> Session
 * - `session.unrevert({path:{id}})`                   -> Session
 * - `session.summarize({path:{id}, body:{providerID, modelID}})` -> boolean
 * - `session.shell({path:{id}, body:{agent, model?, command}})`  -> AssistantMessage
 * All arrive as hey-api's `{data, error, response}` union (`throwOnError:
 * false`); failures unwrap into the typed errors below.
 *
 * HOST-SIDE RESOLUTION (the frozen todo-3 payloads carry ids only):
 * - summarize needs `{providerID, modelID}` but the wire `summarize` payload
 *   is `{id}` only — the plan's "current selection" cannot cross the frozen
 *   wire from the todo-15 composer pickers, so the ONLY honest "current
 *   model" the host can resolve is the server's configured default: read it
 *   from `client.config.get()`'s `model` string ("provider/model") through
 *   todo-14's exported {@link parseModelString} (FIRST-"/" split). The
 *   pickers themselves default to this same server value, so the resolution
 *   matches the user's current selection whenever it was never overridden.
 *   No configured model is a typed {@link SummarizeModelUnavailableError},
 *   never an invented one.
 * - shell needs `agent` (the route's body is `{agent, model?, command}`) but
 *   the wire `runShell` payload is `{sessionId, input}` — the agent is
 *   resolved data-driven from `client.app.agents()`: the FIRST advertised
 *   agent with `mode === "primary"`, else the first advertised agent, else a
 *   typed {@link ShellAgentUnavailableError}. OMO/custom agents are data like
 *   any other — names are never hardcoded. `model` is omitted so the server
 *   applies its own default, matching how sendPrompt treats an unset model.
 *
 * TYPED ERROR CONTRACT (webview consumes via the todo-3 error reply text):
 * - Any op route answering HTTP 404 becomes {@link MessageOpUnsupportedError}
 *   (an old server missing the route — the todo-7 capability rule: the wire
 *   capabilities carry no revert/summarize/shell bits, so the 404 IS the
 *   detection signal; the webview maps this name to the `capability.hidden`
 *   toast and hides nothing it couldn't already detect).
 * - Any other failure becomes {@link MessageOpError} carrying the HTTP status
 *   (QA failure scenario: revert mocked 500 -> error reply text includes
 *   "HTTP 500"; the webview toasts and — because no SSE invalidation follows
 *   a failed op — removes no local messages).
 *
 * Output is NEVER fabricated: summarize/shell effects arrive as real messages/
 * compaction events over the todo-9 SSE bridge, like prompt results.
 */

import type { Agent, OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../logger.js";
import type { ServerConnection } from "../../server/ServerManager.js";
import type { FromWebviewResponse } from "../../shared/protocol.js";
import type {
  RegisterHandler,
  SessionClientSource,
  SessionListRefresher,
} from "./sessions.js";
import { parseModelString } from "./promptPipeline.js";

// ---------------------------------------------------------------------------
// Typed errors (the webview keys behavior off the class names verbatim).

export type MessageOp = "revert" | "unrevert" | "summarize" | "shell";

/** One failed message-op server call (non-404); carries no credentials. */
export class MessageOpError extends Error {
  readonly operation: MessageOp;
  readonly status: number | undefined;

  constructor(operation: MessageOp, detail: string, status: number | undefined) {
    super(`${operation} failed: ${detail}`);
    this.name = "MessageOpError";
    this.operation = operation;
    this.status = status;
  }
}

/**
 * The op route answered HTTP 404: the connected server predates it (todo-7
 * capability rule — no wire bit exists for revert/summarize/shell). The
 * webview matches `message.startsWith("MessageOpUnsupportedError:")` and
 * degrades to one `capability.hidden` toast.
 */
export class MessageOpUnsupportedError extends MessageOpError {
  constructor(operation: MessageOp, detail: string) {
    super(operation, detail, 404);
    this.name = "MessageOpUnsupportedError";
  }
}

/** summarize cannot run: the server config names no default model. */
export class SummarizeModelUnavailableError extends Error {
  constructor(detail: string) {
    super(`summarize has no model to run with: ${detail}`);
    this.name = "SummarizeModelUnavailableError";
  }
}

/** runShell cannot run: the server advertises no agents at all. */
export class ShellAgentUnavailableError extends Error {
  constructor(detail: string) {
    super(`shell has no agent to run with: ${detail}`);
    this.name = "ShellAgentUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// SDK result unwrapping (domain-local, same hey-api union shape as
// ./answers.ts — this module never depends on a sibling domain's internals).

interface SdkResultLike<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly response: Response;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const data = record.data;
    if (typeof data === "object" && data !== null) {
      const message = (data as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}

async function unwrapOpResult<T>(
  deps: MessageOpsServiceDeps,
  operation: MessageOp,
  call: (client: OpencodeClient) => Promise<SdkResultLike<T>>,
): Promise<T> {
  const connection = await deps.source.connect();
  const result = await call(connection.client);
  if (result.error !== undefined || result.data === undefined) {
    const status = result.response.status;
    const detail = `${errorDetail(result.error)} (HTTP ${String(status)})`;
    deps.logger.warn(`message-ops domain: ${operation} failed: ${detail}`);
    if (status === 404) throw new MessageOpUnsupportedError(operation, detail);
    throw new MessageOpError(operation, detail, status);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Host-side payload resolution: summarize model + shell agent.

async function resolveSummarizeModel(
  deps: MessageOpsServiceDeps,
  connection: ServerConnection,
): Promise<{ readonly providerID: string; readonly modelID: string }> {
  const result = await connection.client.config.get();
  if (result.error !== undefined || result.data === undefined) {
    const detail = `config.get failed: ${errorDetail(result.error)}`;
    deps.logger.warn(`message-ops domain: summarize setup failed: ${detail}`);
    throw new SummarizeModelUnavailableError(detail);
  }
  const model = parseModelString(result.data.model);
  if (model === undefined) {
    deps.logger.warn("message-ops domain: summarize setup failed: no default model configured");
    throw new SummarizeModelUnavailableError("server config carries no default model");
  }
  return model;
}

/**
 * FIRST primary-mode advertised agent wins; with none advertised as primary
 * the first advertised agent runs; an empty agent list is the typed setup
 * error. Data-driven only — agent names never appear in this file.
 */
export function pickShellAgent(agents: readonly Agent[]): Agent | undefined {
  return agents.find((agent) => agent.mode === "primary") ?? agents[0];
}

export interface MessageOpsServiceDeps {
  readonly source: SessionClientSource;
  readonly logger: PanelLogger;
}

export interface MessageOpsService {
  revertAt(id: string, messageID: string): Promise<void>;
  unrevert(id: string): Promise<void>;
  summarize(id: string): Promise<void>;
  runShell(sessionId: string, input: string): Promise<void>;
}

export function createMessageOpsService(deps: MessageOpsServiceDeps): MessageOpsService {
  return {
    async revertAt(id, messageID) {
      await unwrapOpResult(deps, "revert", (client) =>
        client.session.revert({ path: { id }, body: { messageID } }),
      );
    },

    async unrevert(id) {
      await unwrapOpResult(deps, "unrevert", (client) => client.session.unrevert({ path: { id } }));
    },

    async summarize(id) {
      const connection = await deps.source.connect();
      const model = await resolveSummarizeModel(deps, connection);
      await unwrapOpResult(deps, "summarize", (client) =>
        client.session.summarize({ path: { id }, body: model }),
      );
    },

    async runShell(sessionId, input) {
      const connection = await deps.source.connect();
      const agentsResult = await connection.client.app.agents();
      if (agentsResult.error !== undefined || agentsResult.data === undefined) {
        const detail = `app.agents failed: ${errorDetail(agentsResult.error)}`;
        deps.logger.warn(`message-ops domain: shell setup failed: ${detail}`);
        throw new MessageOpError("shell", detail, undefined);
      }
      const agent = pickShellAgent(agentsResult.data);
      if (agent === undefined) {
        deps.logger.warn("message-ops domain: shell setup failed: server advertised no agents");
        throw new ShellAgentUnavailableError("server advertises no agents");
      }
      await unwrapOpResult(deps, "shell", (client) =>
        client.session.shell({ path: { id: sessionId }, body: { agent: agent.name, command: input } }),
      );
      deps.logger.info(`message-ops domain: shell dispatched with agent '${agent.name}'`);
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration (todo-10 registry seam). revert/unrevert wait one
// session-list broadcast afterwards — both mutate the session record
// server-side (time.updated), the exact stroke the sessions domain applies
// after every mutation; summarize/shell leave the session record untouched
// (their effects stream in as messages, so no list refresh is owed).

export interface MessageOpsDomainDeps {
  readonly service: MessageOpsService;
  readonly sync: SessionListRefresher;
}

export function registerMessageOpsHandlers(register: RegisterHandler, deps: MessageOpsDomainDeps): void {
  const { service, sync } = deps;

  register("revert", async ({ id, messageID }): Promise<FromWebviewResponse["revert"]> => {
    await service.revertAt(id, messageID);
    await sync.refresh();
    return null;
  });

  register("unrevert", async ({ id }): Promise<FromWebviewResponse["unrevert"]> => {
    await service.unrevert(id);
    await sync.refresh();
    return null;
  });

  register("summarize", async ({ id }): Promise<FromWebviewResponse["summarize"]> => {
    await service.summarize(id);
    return null;
  });

  register("runShell", async ({ sessionId, input }): Promise<FromWebviewResponse["runShell"]> => {
    await service.runShell(sessionId, input);
    return null;
  });
}

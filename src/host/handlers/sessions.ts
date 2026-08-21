/**
 * Sessions domain: list/create/rename/delete/share/unshare/fork host handlers
 * (plan todo 12). Handlers are registered against the todo-3 envelope types
 * through the todo-10 registry seam (`PanelViewComposite.registerHandler`),
 * so this module NEVER touches src/providers or src/shared.
 *
 * SDK CONTRACT (verified against @opencode-ai/sdk 1.18.18, v2 `Session2`):
 * - `client.session.list()` -> `Session[]` (sorted by most recently updated)
 * - `client.session.create({title?})` -> `Session`
 * - `client.session.update({sessionID, title})` -> `Session` (rename)
 * - `client.session.delete({sessionID})` -> `boolean`
 * - `client.session.share({sessionID})` -> `Session` with `share.url` set
 * - `client.session.unshare({sessionID})` -> `Session` (the REAL verb: the SDK
 *   issues `DELETE /session/:id/share` — no POST /unshare is invented here)
 * - `client.session.fork({sessionID, messageID?})` -> NEW `Session`
 * All SDK results arrive as `{data, error: undefined} | {data: undefined, error}`
 * (hey-api RequestResult with `throwOnError: false`); an error result is
 * unwrapped into a {@link SessionOperationError} so the todo-3 messenger turns
 * it into a protocol-level error reply (the webview surfaces it as a toast /
 * error banner; optimistic updates roll back there).
 *
 * WIRE SHAPE NOTE (binding): todo-3's `SessionSummary` is `{id,title,updatedAt}`
 * and src/shared is read-only for this todo, but todo 12 requires a "shared"
 * badge in the webview driven by `share.url` presence. The gap is carried NOT
 * by changing the shared type but by posting {@link SessionListEntry}, a
 * structural EXTENSION of SessionSummary with one extra `shared` boolean.
 * `SessionListEntry[]` is assignable to the `sessionList` payload's
 * `readonly SessionSummary[]`, and the webview boundary-parses the extra flag
 * (a missing flag degrades to "not shared"). No other producer of SessionSummary
 * is affected.
 *
 * Every mutating handler awaits `sync.refresh()` after the op so ALL views
 * receive a fresh `sessionList` broadcast before the reply lands; refresh
 * itself NEVER throws (a lost server yields a debug log, not a failed op).
 */

import type { OpencodeClient, Session } from "@opencode-ai/sdk";
import { isRecord } from "../../shared/protocol.js";
import type { PanelLogger } from "../logger.js";
import type { Handler } from "../messenger.js";
import type { ServerConnection } from "../../server/ServerManager.js";
import type {
  FromWebviewProtocol,
  FromWebviewResponse,
  SessionSummary,
} from "../../shared/protocol.js";

// ---------------------------------------------------------------------------
// Seams and value types.

/** Wire-side session entry: todo-3 SessionSummary plus the shared badge flag. */
export interface SessionListEntry extends SessionSummary {
  /** True when the server reports `share.url` present (todo-12 shared badge). */
  readonly shared: boolean;
}

/**
 * The smallest connection source the sessions domain needs. Production value
 * wraps `ServerManager.onboardClient()` (todo 8) — starting the server counts
 * as connecting, matching the plan's auto-start default. Tests hand a fake
 * over a mock-server panel client.
 */
export interface SessionClientSource {
  readonly connect: () => Promise<ServerConnection>;
}

/** Build a SessionClientSource over a fixed connection (no lifecycle). */
export function staticSessionSource(connection: ServerConnection): SessionClientSource {
  return { connect: () => Promise.resolve(connection) };
}

/**
 * Poll-refetch + broadcast seam (todo-12 sync). Implemented by
 * `SessionSync` in ./sync.ts; never rejects.
 */
export interface SessionListRefresher {
  readonly refresh: () => Promise<void>;
}

export type SessionOperation =
  | "list"
  | "create"
  | "delete"
  | "rename"
  | "share"
  | "unshare"
  | "fork"
  | "setSessionAuto"
  | "getSessionAuto";

/** One failed session-domain server call, carries no credentials. */
export class SessionOperationError extends Error {
  readonly operation: SessionOperation;
  readonly status: number | undefined;

  constructor(operation: SessionOperation, detail: string, status: number | undefined) {
    super(`session ${operation} failed: ${detail}`);
    this.name = "SessionOperationError";
    this.operation = operation;
    this.status = status;
  }
}

export interface SessionServiceDeps {
  readonly source: SessionClientSource;
  readonly logger: PanelLogger;
}

// ---------------------------------------------------------------------------
// Mapping.

/** SDK `Session` -> wire entry. `shared` derives from `share.url` presence. */
export function toSessionListEntry(session: Session): SessionListEntry {
  return {
    id: session.id,
    title: session.title,
    updatedAt: new Date(session.time.updated).toISOString(),
    shared: session.share !== undefined && typeof session.share.url === "string",
  };
}

// ---------------------------------------------------------------------------
// SDK result unwrapping. hey-api's RequestResult<..., false, "fields"> is
// `{data, error: undefined} | {data: undefined, error}` plus {request,response};
// this reifies the union into either the typed value or a thrown typed error.

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
    // Plain error objects (e.g. {_tag:"InternalServerError"}) must never
    // reach the UI as "[object Object]".
    try {
      return JSON.stringify(record);
    } catch {
      // fall through to String below
    }
  }
  return String(error);
}

async function fromSdk<T>(
  deps: SessionServiceDeps,
  operation: SessionOperation,
  call: (client: OpencodeClient) => Promise<SdkResultLike<T>>,
): Promise<T> {
  const connection = await deps.source.connect();
  const result = await call(connection.client);
  if (result.error !== undefined || result.data === undefined) {
    const status = result.response.status;
    const detail = `${errorDetail(result.error)} (HTTP ${String(status)})`;
    deps.logger.warn(`sessions domain: ${operation} failed: ${detail}`);
    throw new SessionOperationError(operation, detail, status);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// The typed session-domain service every host handler + the sync poll uses.

export interface SessionService {
  listSessions(): Promise<readonly SessionListEntry[]>;
  createSession(title: string | undefined): Promise<SessionListEntry>;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  shareSession(id: string): Promise<{ readonly url: string }>;
  unshareSession(id: string): Promise<void>;
  forkSession(id: string, messageID: string | undefined): Promise<SessionListEntry>;
  /**
   * Toggle the session-level permission wildcard rule (panel "auto" mode):
   * `PATCH /session/:id {permission: [...]}` with a `{*: '*' allow}` entry when
   * on, `{*: '*' ask}` when off. Session rules ARE the opencode-auto path the
   * TUI uses; SDK ships no wrapper, so this is a raw probeFetch PATCH (the
   * `SessionUpdateData.body` type hides `permission`, hence raw).
   */
  setSessionAuto(id: string, enabled: boolean): Promise<void>;
  /**
   * Query the session-level permission wildcard rule to detect whether auto mode
   * is currently armed for this session on the server.
   */
  getSessionAuto(id: string): Promise<boolean>;
  getSubagentLogs(input: {
    readonly sessionId: string;
    readonly taskId?: string;
    readonly hint?: string;
  }): Promise<{ readonly steps: readonly string[]; readonly isRunning: boolean }>;
}

export function isSessionAutoArmed(sessionData: unknown): boolean {
  if (typeof sessionData !== "object" || sessionData === null) return false;
  const data = sessionData as Record<string, unknown>;
  const rules = Array.isArray(data.permission)
    ? data.permission
    : Array.isArray(data.permissions)
      ? data.permissions
      : undefined;
  if (!rules || rules.length === 0) return false;

  // Rules are evaluated in order; the latest wildcard/general match dictates auto state.
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (typeof rule === "object" && rule !== null) {
      const r = rule as Record<string, unknown>;
      if (r.permission === "*" || r.permission === "all" || !r.permission) {
        return r.action === "allow";
      }
    }
  }
  return false;
}

export function isSubagentSession(session: { title?: string; parentID?: string }): boolean {
  const lower = (session.title ?? "").toLowerCase().trim();
  if (
    lower.startsWith("subtask:") ||
    lower.startsWith("subagent:") ||
    lower.startsWith("[subagent]") ||
    lower.startsWith("subtask ") ||
    lower.startsWith("subagent ") ||
    lower.includes("(subagent)") ||
    lower.includes("[subtask]")
  ) {
    return true;
  }
  if (session.parentID && !lower.endsWith("(fork)")) {
    return true;
  }
  return false;
}

/**
 * The session's already-issued share link, if any (used to fold the
 * duplicate-share 500 into a successful idempotent reply). A lookup failure
 * or an unshared session yields undefined — the original error stands then.
 */
async function existingShareUrl(
  deps: SessionServiceDeps,
  id: string,
): Promise<string | undefined> {
  try {
    const connection = await deps.source.connect();
    const result = await connection.client.session.get({ path: { id } });
    if (result.error !== undefined || !isRecord(result.data)) return undefined;
    const share = (result.data as { share?: { url?: string } }).share;
    return typeof share?.url === "string" ? share.url : undefined;
  } catch {
    return undefined;
  }
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  return {
    async listSessions() {
      const raw = await fromSdk(deps, "list", (client) => client.session.list());
      return raw.filter((s) => !isSubagentSession(s)).map(toSessionListEntry);
    },

    async createSession(title) {
      const body = title !== undefined && title.length > 0 ? { title } : {};
      const raw = await fromSdk(deps, "create", (client) => client.session.create({ body }));
      return toSessionListEntry(raw);
    },

    async deleteSession(id) {
      await fromSdk(deps, "delete", (client) => client.session.delete({ path: { id } }));
    },

    async renameSession(id, title) {
      await fromSdk(deps, "rename", (client) =>
        client.session.update({ path: { id }, body: { title } }),
      );
    },

    async shareSession(id) {
      try {
        const raw = await fromSdk(deps, "share", (client) =>
          client.session.share({ path: { id } }),
        );
        const url = raw.share?.url;
        if (typeof url !== "string" || url.length === 0) {
          throw new SessionOperationError("share", "server replied without a share url", undefined);
        }
        return { url };
      } catch (error) {
        if (error instanceof SessionOperationError && error.status === 500) {
          const reused = await existingShareUrl(deps, id);
          if (reused !== undefined) {
            deps.logger.info(`sessions domain: folded 500 into existing share ${reused}`);
            return { url: reused };
          }
        }
        throw error;
      }
    },

    async unshareSession(id) {
      await fromSdk(deps, "unshare", (client) => client.session.unshare({ path: { id } }));
    },

    async forkSession(id, messageID) {
      const body = messageID !== undefined ? { messageID } : {};
      const raw = await fromSdk(deps, "fork", (client) =>
        client.session.fork({ path: { id }, body }),
      );
      return toSessionListEntry(raw);
    },

    async setSessionAuto(id, enabled) {
      const connection = await deps.source.connect();
      const payload = {
        permission: enabled
          ? [{ permission: "*", pattern: "*", action: "allow" }]
          : [{ permission: "*", pattern: "*", action: "ask" }],
      };
      const response = await connection.probeFetch(
        new Request(`${connection.baseUrl}/session/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const detail = `PATCH /session/${id} failed: ${text || response.statusText} (HTTP ${response.status})`;
        deps.logger.warn(`sessions domain: ${detail}`);
        throw new SessionOperationError("setSessionAuto", detail, response.status);
      }
    },

    async getSessionAuto(id) {
      try {
        const connection = await deps.source.connect();
        const response = await connection.probeFetch(
          new Request(`${connection.baseUrl}/session/${encodeURIComponent(id)}`, {
            method: "GET",
            headers: { "content-type": "application/json" },
          }),
        );
        if (!response.ok) return false;
        const data: unknown = await response.json();
        return isSessionAutoArmed(data);
      } catch (error) {
        deps.logger.warn(
          `sessions domain: getSessionAuto failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },

    async getSubagentLogs(input) {
      try {
        const connection = await deps.source.connect();
        const listResult = await connection.client.session.list();
        if (listResult.error !== undefined || !Array.isArray(listResult.data)) {
          return { steps: [], isRunning: false };
        }

        // Find child sessions for this parent session or matching title/task
        const allSessions = listResult.data as any[];
        const childSessions = allSessions.filter((s) => {
          const parent = s.parentID || s.parentId || s.parent_id;
          if (parent === input.sessionId) return true;
          if (input.taskId && typeof s.title === "string" && s.title.includes(input.taskId)) return true;
          if (input.taskId && typeof s.id === "string" && s.id.includes(input.taskId)) return true;
          if (s.id && s.id !== input.sessionId && typeof s.title === "string" && isSubagentSession(s)) return true;
          return false;
        });

        if (childSessions.length === 0) {
          // Fallback: inspect parent session for task description or background launcher parts
          try {
            const parentMsgResult = await connection.client.session.messages({ path: { id: input.sessionId } });
            if (parentMsgResult.data && Array.isArray(parentMsgResult.data)) {
              const steps: string[] = [];
              for (const envelope of parentMsgResult.data) {
                const parts = (envelope.parts ?? []) as any[];
                for (const p of parts) {
                  const partType = p.type ?? p.kind ?? "";
                  const toolState = (p.state && typeof p.state === "object") ? p.state : p;
                  const toolName = p.tool ?? p.name ?? toolState.tool ?? "";
                  if (partType === "tool" && (toolName === "task" || toolName === "explore" || toolName === "background_task" || toolName === "subagent")) {
                    const inputObj = toolState.input ?? p.input ?? {};
                    const desc = inputObj.description || inputObj.prompt || inputObj.task || inputObj.command || "";
                    if (desc) steps.push(`🚀 [任務指令] ${desc}`);
                  }
                }
              }
              if (steps.length > 0) {
                return { steps, isRunning: false };
              }
            }
          } catch {
            // ignore
          }
          return { steps: [], isRunning: false };
        }

        // Sort child sessions by newest first
        childSessions.sort((a, b) => {
          const timeA = a.time?.updated ?? a.time?.created ?? 0;
          const timeB = b.time?.updated ?? b.time?.created ?? 0;
          return timeB - timeA;
        });

        let targetSession = childSessions[0];
        if (input.taskId) {
          const match = childSessions.find((s) => typeof s.title === "string" && s.title.includes(input.taskId!));
          if (match) targetSession = match;
        } else if (input.hint) {
          const lowerHint = input.hint.toLowerCase();
          const match = childSessions.find((s) => typeof s.title === "string" && s.title.toLowerCase().includes(lowerHint));
          if (match) targetSession = match;
        }

        const msgResult = await connection.client.session.messages({ path: { id: targetSession.id } });
        if (msgResult.error !== undefined || !Array.isArray(msgResult.data)) {
          return { steps: [], isRunning: false };
        }

        const steps: string[] = [];
        for (const envelope of msgResult.data) {
          const role = envelope.info?.role;
          const parts = (envelope.parts ?? []) as any[];
          for (const p of parts) {
            const partType = p.type ?? p.kind ?? "";
            const toolState = (p.state && typeof p.state === "object") ? p.state : p;

            if (partType === "tool") {
              const toolName = p.tool ?? p.name ?? toolState.tool ?? "tool";
              const st = toolState.status ?? p.status;
              const status = st === "completed" ? "✓" : st === "running" ? "⚡" : "○";
              const inputObj = toolState.input ?? p.input ?? {};
              let summary = "";
              if (inputObj && typeof inputObj === "object") {
                if (typeof inputObj.path === "string") summary = inputObj.path;
                else if (typeof inputObj.filePath === "string") summary = inputObj.filePath;
                else if (typeof inputObj.command === "string") summary = inputObj.command;
                else if (typeof inputObj.CommandLine === "string") summary = inputObj.CommandLine;
                else if (typeof inputObj.query === "string") summary = inputObj.query;
                else if (typeof inputObj.description === "string") summary = inputObj.description;
                else if (typeof inputObj.prompt === "string") summary = inputObj.prompt.slice(0, 50);
              }
              steps.push(`${status} [${toolName}] ${summary}`.trim());
            } else if (partType === "subtask") {
              const title = p.title ?? toolState.title ?? p.prompt ?? "Subtask";
              steps.push(`📋 [子任務] ${title}`);
            } else if (partType === "patch") {
              const fileCount = Array.isArray(p.files) ? p.files.length : 1;
              steps.push(`📝 檔案變更 (${fileCount} files)`);
            } else if (partType === "reasoning") {
              const txt = (p.text ?? toolState.text ?? "").trim();
              if (txt) {
                const lines = txt.split("\n").map((l: string) => l.trim()).filter(Boolean);
                if (lines.length <= 2) {
                  steps.push(`🧠 思考: ${lines.join(" ")}`);
                } else {
                  const lastSnippet = lines.slice(-2).join(" ");
                  steps.push(`🧠 思考: ...${lastSnippet}`);
                }
              }
            } else if (partType === "text" && role === "assistant") {
              const txt = (p.text ?? toolState.text ?? "").trim();
              if (txt && !txt.startsWith("<system-reminder>") && !txt.startsWith("<!--")) {
                const firstLine = txt.split("\n")[0] ?? "";
                steps.push(`💬 ${firstLine.slice(0, 80)}`);
              }
            }
          }
        }

        return { steps, isRunning: false };
      } catch {
        return { steps: [], isRunning: false };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration (todo-10 registry seam).

/** Structural twin of `PanelViewComposite.registerHandler` (todo 10). */
export type RegisterHandler = <K extends keyof FromWebviewProtocol>(
  type: K,
  handler: Handler<K>,
) => void;

export interface SessionsDomainDeps {
  readonly service: SessionService;
  readonly sync: SessionListRefresher;
}

/**
 * Register the session-domain message handlers. Each mutating op awaits a
 * sync refresh so every view gets the fresh list broadcast before the reply;
 * a server failure throws, which the todo-3 messenger converts into an error
 * reply (webview: toast + optimistic rollback; see plan todo-12 QA scenario).
 */
export function registerSessionHandlers(register: RegisterHandler, deps: SessionsDomainDeps): void {
  const { service, sync } = deps;

  register("listSessions", async (): Promise<FromWebviewResponse["listSessions"]> => {
    const sessions = await service.listSessions();
    return { sessions };
  });

  register("createSession", async ({ title }): Promise<FromWebviewResponse["createSession"]> => {
    const session = await service.createSession(title);
    await sync.refresh();
    return { id: session.id };
  });

  register("deleteSession", async ({ id }): Promise<FromWebviewResponse["deleteSession"]> => {
    await service.deleteSession(id);
    await sync.refresh();
    return null;
  });

  register("renameSession", async ({ id, title }): Promise<FromWebviewResponse["renameSession"]> => {
    await service.renameSession(id, title);
    await sync.refresh();
    return null;
  });

  register("share", async ({ id }): Promise<FromWebviewResponse["share"]> => {
    const { url } = await service.shareSession(id);
    await sync.refresh();
    return { url };
  });

  register("unshare", async ({ id }): Promise<FromWebviewResponse["unshare"]> => {
    await service.unshareSession(id);
    await sync.refresh();
    return null;
  });

  register("fork", async ({ id, messageID }): Promise<FromWebviewResponse["fork"]> => {
    const session = await service.forkSession(id, messageID);
    await sync.refresh();
    return { id: session.id };
  });

  register("setSessionAuto", async ({ sessionId, enabled }): Promise<FromWebviewResponse["setSessionAuto"]> => {
    // PATCH bumps the session's timestamp — not list-worthy, so skip refresh.
    await service.setSessionAuto(sessionId, enabled);
    return null;
  });

  register("getSessionAuto", async ({ sessionId }): Promise<FromWebviewResponse["getSessionAuto"]> => {
    const auto = await service.getSessionAuto(sessionId);
    return { auto };
  });

  register("getSubagentLogs", async ({ sessionId, taskId, hint }): Promise<FromWebviewResponse["getSubagentLogs"]> => {
    const result = await service.getSubagentLogs({
      sessionId,
      ...(taskId !== undefined ? { taskId } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
    return result;
  });
}

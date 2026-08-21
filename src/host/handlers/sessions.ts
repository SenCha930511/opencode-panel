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
    const share = isRecord(result.data.share) ? result.data.share : undefined;
    return share !== undefined && typeof share.url === "string" ? share.url : undefined;
  } catch {
    return undefined;
  }
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  return {
    async listSessions() {
      const sessions = await fromSdk(deps, "list", (client) => client.session.list());
      return sessions.filter((session) => !isSubagentSession(session)).map(toSessionListEntry);
    },

    async createSession(title) {
      const session = await fromSdk(deps, "create", (client) =>
        client.session.create({ ...(title === undefined ? {} : { body: { title } }) }),
      );
      return toSessionListEntry(session);
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
        const session = await fromSdk(deps, "share", (client) =>
          client.session.share({ path: { id } }),
        );
        const url = session.share?.url;
        if (url === undefined) {
          // A 200 share reply without share.url is a server contract violation;
          // fall through to the recovery lookup before failing hard.
          const recovered = await existingShareUrl(deps, id);
          if (recovered !== undefined) return { url: recovered };
          throw new SessionOperationError(
            "share",
            "server returned 200 share response without share.url",
            200,
          );
        }
        return { url };
      } catch (error) {
        // Idempotency: if already shared, opencode returns a 500 whose body is
        // generic; fetch the existing share URL so a double-click resolves cleanly.
        const recovered = await existingShareUrl(deps, id);
        if (recovered !== undefined) return { url: recovered };
        throw error;
      }
    },

    async unshareSession(id) {
      // SDK `session.unshare` issues DELETE /session/:id/share (the real verb).
      await fromSdk(deps, "unshare", (client) => client.session.unshare({ path: { id } }));
    },

    async forkSession(id, messageID) {
      const session = await fromSdk(deps, "fork", (client) =>
        client.session.fork({
          path: { id },
          ...(messageID === undefined ? {} : { body: { messageID } }),
        }),
      );
      return toSessionListEntry(session);
    },

    async setSessionAuto(id, enabled) {
      const connection = await deps.source.connect();
      const response = await connection.probeFetch(
        new Request(`${connection.baseUrl}/session/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            permission: [
              { permission: "*", pattern: "*", action: enabled ? "allow" : "ask" },
            ],
          }),
        }),
      );
      if (!response.ok) {
        const detail = `PATCH /session permission: HTTP ${String(response.status)}`;
        deps.logger.warn(`sessions domain: setSessionAuto failed: ${detail}`);
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
}

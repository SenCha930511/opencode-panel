/**
 * Message-list sync controller (plan todo 13, registry-side host handler).
 *
 * WHY THE EVENT CHANNEL (binding deviation, recorded in the task-13 report):
 * the todo-3 typed protocol is frozen (src/shared/** is out of bounds for
 * this todo) and names neither a `session.messages` request key nor a
 * `messageList` host push type. Both trust boundaries ENFORCE the closed
 * key sets — the host dispatcher rejects unknown request types
 * (`parseRequestEnvelope` -> UnknownMessageTypeError) and the webview
 * messenger rejects unknown push types — so a new request/response pair
 * cannot cross without editing frozen files. The only open channel is the
 * `event` passthrough (`{type, payload}`). This controller therefore mirrors
 * the todo-12 `sessionList` precedent: the HOST owns poll-sync (refetch on
 * the todo-9 bridge invalidation, on active-session change) and pushes the
 * result as a `messages.sync` event; the webview chat store (todo-13
 * webview side) consumes it. Same fetch, same payload, one-way transport.
 *
 * WIRE CONTRACT (webview consumes; ForwardedEvent over ToWebview `event`):
 * - `MESSAGES_SYNC_EVENT_TYPE` = "messages.sync" with payload
 *   {@link MessagesSyncPayload}:
 *   - `{ kind: "full", sessionId, messages }` — verbatim replacement list
 *     (`Array<{info, parts}>` from the SDK `session.messages` route).
 *   - `{ kind: "delta", sessionId, upserted, removed }` — appended-delta
 *     merge for large sessions (see THRESHOLD below); `upserted` entries are
 *     whole `{info, parts}` messages keyed by `info.id`, `removed` carries
 *     message ids absent from the latest fetch.
 *
 * WATCH-OUT (plan todo-13 note, binding): poll-sync refetches the FULL list
 * per invalidation. Once a session exceeds
 * {@link MESSAGE_FULL_SYNC_THRESHOLD} (250) messages AND a baseline cache
 * exists for it, the controller switches to keyed appended-delta merges:
 * every fetched message is compared to the cached JSON by `info.id` and only
 * new/changed messages are posted. The first fetch of a large (or any)
 * session is always a full sync — a merge needs a baseline. Any message
 * lacking a string `info.id` while over threshold forces a full resync
 * (a merge cannot key it).
 *
 * SEAMS (wired by the integration wave; none resolved here):
 * - `fetchMessages` — production value: {@link createSdkMessagesFetcher}
 *   over the todo-8 onboarded `ServerConnection.client`. The controller is
 *   constructed per connection by the wiring that owns the client.
 * - `postEvent` — matches `ChatViewProvider.postEvent(type, payload)`
 *   (todo 10) exactly; posts ToWebview `event` envelopes.
 * - `invalidate` — todo-9 {@link InvalidateSink}-compatible member: the
 *   EventBridge's 250ms-debounced `messages` signal drives refetches. Other
 *   kinds are ignored (sessions/todos syncs are todos 12/18).
 * - `setActiveSession(sessionId)` — the todo-12 active-session contract:
 *   T12's selection logic (host Memento-backed) calls this; the controller
 *   records the id and refetches immediately. Until T12 lands, the last
 *   sessionId seen on the invalidation signal is remembered as the active
 *   fallback, so streamed sessions sync without any selection signal.
 *
 * CONCURRENCY: a per-session sequence token ensures only the LATEST fetch
 * for a session posts; a stale in-flight fetch resolving late is discarded,
 * so a fast refetch can never be overwritten by an older payload.
 */

import type { PanelLogger } from "../logger.js";
import type { InvalidateSink } from "../../server/eventBridge.js";
import { isRecord } from "../../shared/protocol.js";
import type { OpencodeClient } from "@opencode-ai/sdk";

export const MESSAGES_SYNC_EVENT_TYPE = "messages.sync";

/** Plan todo-13 watch-out: appended-delta merges kick in past this size. */
export const MESSAGE_FULL_SYNC_THRESHOLD = 250;

export interface FullMessagesSync {
  readonly kind: "full";
  readonly sessionId: string;
  readonly messages: readonly unknown[];
}

export interface DeltaMessagesSync {
  readonly kind: "delta";
  readonly sessionId: string;
  readonly upserted: readonly unknown[];
  readonly removed: readonly string[];
}

export type MessagesSyncPayload = FullMessagesSync | DeltaMessagesSync;

export type FetchMessagesOutcome =
  | { readonly ok: true; readonly messages: readonly unknown[] }
  | { readonly ok: false; readonly error: unknown };

/** Narrow fetch seam the controller consumes (SDK adapter below). */
export type FetchMessages = (sessionId: string) => Promise<FetchMessagesOutcome>;

export interface MessageSyncDeps {
  readonly fetchMessages: FetchMessages;
  readonly postEvent: (type: string, payload: unknown) => void;
  readonly logger: PanelLogger;
}

/**
 * Production adapter over the todo-8 onboarded SDK client: calls
 * `client.session.messages({ path: { id } })` and folds the hey-api result
 * union into {@link FetchMessagesOutcome}. The JSON payload passes through
 * untouched — the boundary parse into view-models belongs to the webview.
 */
export function createSdkMessagesFetcher(client: OpencodeClient): FetchMessages {
  return async (sessionId) => {
    const result = await client.session.messages({ path: { id: sessionId } });
    if (result.error !== undefined) {
      return { ok: false, error: result.error };
    }
    return { ok: true, messages: result.data };
  };
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Best-effort `info.id` extraction; rename/delete-proof merge keys. */
function messageIdOf(message: unknown): string | undefined {
  if (!isRecord(message) || !isRecord(message.info)) return undefined;
  return typeof message.info.id === "string" ? message.info.id : undefined;
}

interface SessionCache {
  readonly byId: Map<string, string>;
}

export class MessageSync {
  private readonly deps: MessageSyncDeps;
  private activeSessionId: string | undefined;
  private readonly caches = new Map<string, SessionCache>();
  private readonly tokens = new Map<string, number>();

  constructor(deps: MessageSyncDeps) {
    this.deps = deps;
  }

  /** The session future invalidations without an id refetch (T12 contract). */
  get activeSession(): string | undefined {
    return this.activeSessionId;
  }

  /** Todo-12 seam: selection change records the id and refetches it. */
  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    void this.refresh(sessionId);
  }

  /**
   * Todo-9 bridge seam (`invalidate(kind, sessionId)`): only `messages`
   * signals refetch here; a missing id falls back to the active session.
   * The LAST sessionId seen becomes the active fallback (pre-T12 flow).
   */
  readonly invalidate: InvalidateSink = (kind, sessionId) => {
    if (kind !== "messages") return;
    const target = sessionId ?? this.activeSessionId;
    if (sessionId !== undefined && this.activeSessionId === undefined) {
      this.activeSessionId = sessionId;
    }
    if (target === undefined) return;
    void this.refresh(target);
  };

  /** Refetch one session and post the full/delta `messages.sync` event. */
  async refresh(sessionId: string): Promise<void> {
    const token = (this.tokens.get(sessionId) ?? 0) + 1;
    this.tokens.set(sessionId, token);
    const outcome = await this.deps.fetchMessages(sessionId);
    if (this.tokens.get(sessionId) !== token) return; // a newer fetch posted
    if (!outcome.ok) {
      this.deps.logger.warn(
        `messages sync: fetch for session ${sessionId} failed: ${errorSummary(outcome.error)}`,
      );
      return;
    }
    const payload = this.buildPayload(sessionId, outcome.messages);
    this.deps.postEvent(MESSAGES_SYNC_EVENT_TYPE, payload);
  }

  private buildPayload(sessionId: string, messages: readonly unknown[]): MessagesSyncPayload {
    const previous = this.caches.get(sessionId);
    if (messages.length <= MESSAGE_FULL_SYNC_THRESHOLD || previous === undefined) {
      this.caches.set(sessionId, { byId: snapshotById(messages) });
      return { kind: "full", sessionId, messages };
    }
    const upserted: unknown[] = [];
    const seen = new Map<string, string>();
    for (const message of messages) {
      const id = messageIdOf(message);
      if (id === undefined) {
        // A merge cannot key this entry; resync fully (never lose a message).
        this.caches.set(sessionId, { byId: snapshotById(messages) });
        return { kind: "full", sessionId, messages };
      }
      const json = JSON.stringify(message);
      seen.set(id, json);
      if (previous.byId.get(id) !== json) upserted.push(message);
    }
    const removed: string[] = [];
    for (const id of previous.byId.keys()) {
      if (!seen.has(id)) removed.push(id);
    }
    this.caches.set(sessionId, { byId: seen });
    return { kind: "delta", sessionId, upserted, removed };
  }
}

/** Snapshot of id -> JSON for the merge baseline; unkeyed entries skipped. */
function snapshotById(messages: readonly unknown[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const message of messages) {
    const id = messageIdOf(message);
    if (id !== undefined) byId.set(id, JSON.stringify(message));
  }
  return byId;
}

export type MessageSyncRegisterSeam = <K extends keyof import("../../shared/protocol.js").FromWebviewProtocol>(
  type: K,
  handler: import("../messenger.js").Handler<K>,
) => void;

export function registerMessageSyncHandlers(
  register: MessageSyncRegisterSeam,
  messageSync: MessageSync,
  dockSync?: { setActiveSession(sessionId: string): void },
  capabilitySync?: { refresh(): Promise<void> },
): void {
  register("selectSession", async ({ sessionId }) => {
    messageSync.setActiveSession(sessionId);
    if (dockSync !== undefined) {
      dockSync.setActiveSession(sessionId);
    }
    if (capabilitySync !== undefined) {
      void capabilitySync.refresh();
    }
    return null;
  });
}

/**
 * Forwarded-event router (todo 13): maps T9's sink envelope (carried over the
 * todo-3 `event` push channel) onto the MessageStore, plus the host
 * `messages.sync` poll-sync payloads from src/host/handlers/messages.ts
 * (both payload kinds documented there verbatim).
 *
 * Session gating: {@link adoptSessionFrom} lets the store-free era adopt the
 * first observed session; afterwards only events for the ACTIVE session
 * mutate state — events for other sessions are ignored at this seam (not
 * dropped mid-stream: they belong to a different view's data).
 */

import { isRecord } from "../../../shared/protocol.js";
import type { WebviewMessenger } from "../../lib/messenger.js";
import { adoptSessionFrom, getActiveSession } from "./activeSession.js";
import type { MessageStore } from "./messageStore.js";
import { parseDeltaBatch, parseDeltaEntry } from "./types.js";

export const DELTA_EVENT_TYPE = "message.part.delta";
export const DELTA_BATCH_EVENT_TYPE = "message.part.deltaBatch";
export const PART_UPDATED_EVENT_TYPE = "message.part.updated";
export const SESSION_STATUS_EVENT_TYPE = "session.status";
export const SESSION_IDLE_EVENT_TYPE = "session.idle";
export const MESSAGES_SYNC_EVENT_TYPE = "messages.sync";

export interface ChatEvent {
  readonly type: string;
  readonly payload: unknown;
}

export type Unsubscribe = { (): void };
export type ChatEventListener = { (event: ChatEvent): void };

/** Subscription seam: the default impl wraps the todo-3 webview messenger. */
export interface ChatEventSource {
  subscribeEvent(listener: ChatEventListener): Unsubscribe;
}

export function createMessengerEventSource(messenger: WebviewMessenger): ChatEventSource {
  return {
    subscribeEvent: (listener) =>
      messenger.on("event", (payload) => {
        listener({ type: payload.type, payload: payload.payload });
      }),
  };
}

function sessionStatusType(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.status)) {
    if (typeof payload.status.type === "string") return payload.status.type;
  }
  return typeof payload.status === "string" ? payload.status : undefined;
}

function sessionIdOf(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.sessionID !== "string") return undefined;
  return payload.sessionID;
}

/** Adopt-then-bind: the store tracks the (possibly newly adopted) session. */
function bindSession(store: MessageStore, payload: unknown): void {
  adoptSessionFrom(payload);
  const active = getActiveSession();
  if (store.getState().sessionId === undefined && active !== undefined) {
    store.setSession(active);
  }
}

export function routeChatEvent(store: MessageStore, event: ChatEvent): void {
  switch (event.type) {
    case DELTA_BATCH_EVENT_TYPE: {
      for (const entry of parseDeltaBatch(event.payload)) {
        bindSession(store, entry);
        store.applyStreamDelta(entry);
      }
      return;
    }
    case DELTA_EVENT_TYPE: {
      // T9 malformed-delta fallback: forwarded unbatched, never dropped.
      const entry = parseDeltaEntry(event.payload);
      if (entry === undefined) return;
      bindSession(store, entry);
      store.applyStreamDelta(entry);
      return;
    }
    case PART_UPDATED_EVENT_TYPE: {
      bindSession(store, event.payload);
      store.applyPartUpdated(event.payload);
      return;
    }
    case SESSION_STATUS_EVENT_TYPE: {
      bindSession(store, event.payload);
      store.applySessionStatus(sessionIdOf(event.payload), sessionStatusType(event.payload));
      return;
    }
    case SESSION_IDLE_EVENT_TYPE: {
      bindSession(store, event.payload);
      store.applySessionStatus(sessionIdOf(event.payload), "idle");
      return;
    }
    case MESSAGES_SYNC_EVENT_TYPE: {
      bindSession(store, event.payload);
      if (!isRecord(event.payload) || typeof event.payload.sessionId !== "string") return;
      const sessionId = event.payload.sessionId;
      if (event.payload.kind === "full") {
        store.applyFullSync(sessionId, event.payload.messages);
      } else if (event.payload.kind === "delta") {
        const removed = Array.isArray(event.payload.removed)
          ? event.payload.removed.filter((id): id is string => {
              return typeof id === "string";
            })
          : [];
        store.applyDeltaSync(sessionId, event.payload.upserted, removed);
      }
      return;
    }
    default:
      // Unknown event families (permission/question/todo/...) are other
      // todos' domains; the router deliberately does not touch the store.
      return;
  }
}

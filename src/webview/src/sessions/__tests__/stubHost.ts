import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import type { SessionEntry } from "../constants.js";

/**
 * In-memory todo-3 protocol loopback: a stub HOST that answers webview
 * requests with scripted streamed envelopes and pushes typed `sessionList` /
 * event-carried `sessions.list` broadcasts — the webview-side half of the
 * todo-12 QA story (filter + selection persistence with a stub messenger).
 */

export interface RecordedRequest {
  readonly messageId: string;
  readonly type: string;
  readonly payload: unknown;
}

type Reply = { readonly ok: true; readonly content: unknown } | { readonly ok: false; readonly error: string };

type Responder = (payload: unknown) => Reply | Promise<Reply>; // i18n-allow-literal

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class StubHost {
  readonly requests: RecordedRequest[] = [];
  private readonly responders = new Map<string, Responder>();
  private toWebview: (message: unknown) => void = () => {
    throw new Error("loopback not wired");
  };

  /** Register the response builder for one request type. */
  respond(type: string, responder: Responder): void {
    this.responders.set(type, responder);
  }

  /** Push the TYPED todo-3 sessionList message (production carrier A). */
  pushSessionList(entries: readonly SessionEntry[]): void {
    this.toWebview({ type: "sessionList", payload: { sessions: entries } });
  }

  /** Push the todo-12 event-channel broadcast (production carrier B). */
  pushSessionsEvent(entries: readonly SessionEntry[]): void {
    this.toWebview({ type: "event", payload: { type: "sessions.list", payload: { sessions: entries } } });
  }

  private receive(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.messageId !== "string" || typeof raw.type !== "string") {
      throw new Error("bad test envelope");
    }
    const { messageId, type, payload } = raw;
    this.requests.push({ messageId, type, payload });
    const responder = this.responders.get(type);
    const reply: Promise<Reply> =
      responder === undefined
        ? Promise.resolve({ ok: false, error: `unhandled request type in test: ${type}` })
        : Promise.resolve(responder(payload));
    void reply.then((outcome) => {
      const status = outcome.ok ? "success" : "error";
      this.toWebview({
        type: "streamChunk",
        payload: {
          messageId,
          status,
          done: true,
          content: outcome.ok ? outcome.content : outcome.error,
        },
      });
    });
  }

  /** Wire the host end of the loopback (called by createLoopback). */
  connect(toWebview: (message: unknown) => void): void {
    this.toWebview = toWebview;
  }

  handle(raw: unknown): void {
    this.receive(raw);
  }
}

export function createLoopback(): { readonly messenger: WebviewMessenger; readonly host: StubHost } {
  const host = new StubHost();
  let listener: ((message: unknown) => void) | undefined; // i18n-allow-literal
  const port: WebviewPort = {
    postMessage: (message) => {
      host.handle(message);
    },
    onMessage: (registered) => {
      listener = registered;
    },
  };
  host.connect((message) => {
    if (listener === undefined) throw new Error("webview messenger not listening");
    listener(message);
  });
  return { messenger: new WebviewMessenger(port), host };
}

/** Fixed entry factory so tests stay terse and deterministic. */
export function makeEntry(id: string, title: string, shared = false): SessionEntry {
  return { id, title, updatedAt: "2026-01-01T00:00:00.000Z", shared };
}

import {
  isRecord,
  isToWebviewMessageType,
  MalformedMessageError,
  RemoteError,
  UnknownMessageIdError,
  UnknownMessageTypeError,
  type EventPayload,
  type FromWebviewProtocol,
  type FromWebviewResponse,
  type HostMessage,
  type InitPayload,
  type SessionListPayload,
  type StreamChunkPayload,
  type ToastPayload,
  type ToWebviewProtocol,
} from "../../shared/protocol.js";

/**
 * Webview-side wrapper for the typed messenger protocol.
 *
 * `request()` returns a Promise correlated by a uuid `messageId`; streamed
 * chunks are delivered through an optional chunk callback. The single
 * `acquireVsCodeApi()` handle is created lazily inside this module and is
 * never exported or attached to `window`.
 */

export interface WebviewPort {
  readonly postMessage: (message: unknown) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
}

export type ChunkCallback = (chunk: unknown) => void;

type PushMessageType = Exclude<keyof ToWebviewProtocol, "streamChunk">;

type PushListener<K extends PushMessageType> = (payload: ToWebviewProtocol[K]) => void;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onChunk: ChunkCallback | undefined;
}

export class WebviewMessenger {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pushListeners = new Map<string, Set<(payload: never) => void>>();

  constructor(port: WebviewPort) {
    port.onMessage((message) => {
      this.handleIncoming(message);
    });
    this.port = port;
  }

  private readonly port: WebviewPort;

  request<K extends keyof FromWebviewProtocol>(
    type: K,
    ...args: FromWebviewProtocol[K] extends Record<string, never>
      ? [payload?: FromWebviewProtocol[K], onChunk?: ChunkCallback]
      : [payload: FromWebviewProtocol[K], onChunk?: ChunkCallback]
  ): Promise<FromWebviewResponse[K]> {
    const [payload, onChunk] = args;
    const messageId = globalThis.crypto.randomUUID();
    const promise = new Promise<FromWebviewResponse[K]>((resolve, reject) => {
      this.pending.set(messageId, {
        // Wire boundary: envelope fields are parsed before this fires; the
        // content shape is trusted to the protocol contract for type K.
        resolve: (value: unknown) => {
          resolve(value as FromWebviewResponse[K]);
        },
        reject,
        onChunk,
      });
    });
    this.port.postMessage({ messageId, type, payload: payload ?? {} });
    return promise;
  }

  /** Subscribes to a host push message; returns an unsubscribe function. */
  on<K extends PushMessageType>(type: K, listener: PushListener<K>): () => void {
    let set = this.pushListeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.pushListeners.set(type, set);
    }
    // Erased at the registry boundary; K pins the payload for the caller.
    const erased = listener as (payload: never) => void;
    set.add(erased);
    return () => {
      set.delete(erased);
    };
  }

  /** Throws synchronously on malformed messages and forged reply envelopes. */
  private handleIncoming(raw: unknown): void {
    const message = this.parse(raw);
    switch (message.type) {
      case "streamChunk":
        this.handleChunk(message.payload);
        return;
      case "init":
        this.emit("init", message.payload);
        return;
      case "event":
        this.emit("event", message.payload);
        return;
      case "sessionList":
        this.emit("sessionList", message.payload);
        return;
      case "toast":
        this.emit("toast", message.payload);
        return;
      default:
        assertNever(message);
    }
  }

  private handleChunk(payload: StreamChunkPayload): void {
    const entry = this.pending.get(payload.messageId);
    if (entry === undefined) {
      throw new UnknownMessageIdError(payload.messageId);
    }
    if (payload.status === "error") {
      this.pending.delete(payload.messageId);
      entry.reject(new RemoteError(typeof payload.content === "string" ? payload.content : "host handler failed"));
      return;
    }
    if (payload.done) {
      this.pending.delete(payload.messageId);
      entry.resolve(payload.content);
      return;
    }
    entry.onChunk?.(payload.content);
  }

  private emit<K extends PushMessageType>(type: K, payload: ToWebviewProtocol[K]): void {
    const set = this.pushListeners.get(type);
    if (set === undefined) {
      return;
    }
    for (const listener of set) {
      (listener as PushListener<K>)(payload);
    }
  }

  private parse(raw: unknown): HostMessage {
    if (!isRecord(raw)) {
      throw new MalformedMessageError("host message is not an object");
    }
    const { type, payload } = raw;
    if (typeof type !== "string") {
      throw new MalformedMessageError("type must be a string");
    }
    if (!isToWebviewMessageType(type)) {
      throw new UnknownMessageTypeError(type);
    }
    if (!isRecord(payload)) {
      throw new MalformedMessageError("payload must be an object");
    }
    // Parse, don't validate: each payload is checked into its typed shape at
    // this boundary; everything downstream works with typed values only.
    switch (type) {
      case "init":
        if (!isInitPayload(payload)) {
          throw new MalformedMessageError("bad init payload");
        }
        return { type, payload };
      case "streamChunk":
        if (!isStreamChunkPayload(payload)) {
          throw new MalformedMessageError("bad streamChunk payload");
        }
        return { type, payload };
      case "event":
        if (!isEventPayload(payload)) {
          throw new MalformedMessageError("bad event payload");
        }
        return { type, payload };
      case "sessionList":
        if (!isSessionListPayload(payload)) {
          throw new MalformedMessageError("bad sessionList payload");
        }
        return { type, payload };
      case "toast":
        if (!isToastPayload(payload)) {
          throw new MalformedMessageError("bad toast payload");
        }
        return { type, payload };
      default:
        assertNever(type);
    }
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isInitPayload(value: Record<string, unknown>): value is Record<string, unknown> & InitPayload {
  return (
    typeof value.locale === "string" &&
    isStringRecord(value.strings) &&
    isRecord(value.server) &&
    typeof value.server.url === "string" &&
    isRecord(value.capabilities) &&
    isRecord(value.settings)
  );
}

function isStreamChunkPayload(value: Record<string, unknown>): value is Record<string, unknown> & StreamChunkPayload {
  return (
    typeof value.messageId === "string" &&
    value.messageId.length > 0 &&
    (value.status === "success" || value.status === "error") &&
    typeof value.done === "boolean"
  );
}

function isEventPayload(value: Record<string, unknown>): value is Record<string, unknown> & EventPayload {
  return typeof value.type === "string";
}

function isSessionListPayload(value: Record<string, unknown>): value is Record<string, unknown> & SessionListPayload {
  return Array.isArray(value.sessions);
}

function isToastPayload(value: Record<string, unknown>): value is Record<string, unknown> & ToastPayload {
  return (
    (value.level === "info" || value.level === "warning" || value.level === "error") &&
    typeof value.text === "string"
  );
}

function assertNever(value: never): never {
  throw new Error(`unreachable host message: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Lazy singleton wired to the real VSCode webview runtime. The module must
// also compile in node (tests) and under a tsconfig without the DOM lib, so
// the runtime globals are declared as minimal module-local ambient types and
// touched only inside getWebviewMessenger().
// ---------------------------------------------------------------------------

interface VsCodeWebviewApi {
  readonly postMessage: (message: unknown) => void;
  readonly getState: () => unknown;
  readonly setState: (state: unknown) => void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;

declare const window: {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
};

let vsCodeApi: VsCodeWebviewApi | null = null;
let singleton: WebviewMessenger | null = null;

function getVsCodeApi(): VsCodeWebviewApi {
  if (vsCodeApi === null) {
    // VSCode throws if acquireVsCodeApi() is called twice — cache the handle.
    vsCodeApi = acquireVsCodeApi();
  }
  return vsCodeApi;
}

export function getWebviewMessenger(): WebviewMessenger {
  if (singleton !== null) {
    return singleton;
  }
  const api = getVsCodeApi();
  singleton = new WebviewMessenger({
    postMessage: (message) => {
      api.postMessage(message);
    },
    onMessage: (listener) => {
      window.addEventListener("message", (event) => {
        listener(event.data);
      });
    },
  });
  return singleton;
}

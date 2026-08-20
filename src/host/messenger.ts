import {
  parseRequestEnvelope,
  UnknownMessageTypeError,
  type FromWebviewProtocol,
  type HostMessage,
  type StreamChunkPayload,
} from "../shared/protocol";

/**
 * Host-side dispatcher for the typed messenger protocol.
 *
 * The postMessage/onMessage pair is injected, so the whole dispatcher is
 * unit-testable without VSCode. Register one handler per message type; a
 * handler may return a value, a Promise, or an AsyncGenerator which is
 * streamed chunk-by-chunk with a terminal `done:true` envelope.
 */

export interface HostPort {
  readonly postMessage: (message: HostMessage) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
}

export interface HandlerContext {
  readonly messageId: string;
}

export type HandlerResult = unknown | Promise<unknown> | AsyncGenerator<unknown, unknown>;

export type Handler<K extends keyof FromWebviewProtocol> = (
  payload: FromWebviewProtocol[K],
  context: HandlerContext,
) => HandlerResult;

export class HostMessenger {
  private readonly port: HostPort;
  // Handlers are stored payload-erased; register() is the typed boundary.
  private readonly handlers = new Map<string, (payload: unknown, context: HandlerContext) => HandlerResult>();
  private readonly inflight = new Map<string, AsyncGenerator<unknown, unknown>>();
  private readonly terminated = new Set<string>();

  constructor(port: HostPort) {
    this.port = port;
    port.onMessage((message) => {
      this.handleIncoming(message);
    });
  }

  register<K extends keyof FromWebviewProtocol>(type: K, handler: Handler<K>): this {
    this.handlers.set(type, (payload: unknown, context: HandlerContext) => {
      // Typed boundary: the webview payload contract was parsed at the
      // envelope boundary; K pins payload to the registered type.
      return handler(payload as FromWebviewProtocol[K], context);
    });
    return this;
  }

  /**
   * Terminates every inflight stream. The terminal `done:true` envelope is
   * intentionally NOT emitted for disposed streams.
   */
  dispose(): void {
    for (const [messageId, generator] of this.inflight) {
      this.terminated.add(messageId);
      void generator.return(undefined);
    }
    this.inflight.clear();
  }

  /**
   * Dispatch one inbound webview envelope. Throws synchronously on malformed
   * envelopes and unknown message types.
   *
   * Public for the todo-24 transport seam: the integration harness's dev-only
   * `_test.receiveFromWebview` feeds test envelopes through this SAME
   * dispatch the real `webview.onDidReceiveMessage` listener drives, so the
   * suite exercises the real messenger/handler chain end-to-end.
   */
  handleIncoming(message: unknown): void {
    const request = parseRequestEnvelope(message);
    const handler = this.handlers.get(request.type);
    if (handler === undefined) {
      throw new UnknownMessageTypeError(request.type);
    }
    void this.run(request.messageId, request.payload, handler);
  }

  private async run(
    messageId: string,
    payload: unknown,
    handler: (payload: unknown, context: HandlerContext) => HandlerResult,
  ): Promise<void> {
    let result: unknown;
    try {
      result = await handler(payload, { messageId });
    } catch (error) {
      this.reply({ messageId, status: "error", done: true, content: errorText(error) });
      return;
    }
    if (!isAsyncGenerator(result)) {
      this.reply({ messageId, status: "success", done: true, content: result ?? null });
      return;
    }
    this.inflight.set(messageId, result);
    try {
      let step = await result.next();
      while (!step.done) {
        this.reply({ messageId, status: "success", done: false, content: step.value });
        step = await result.next();
      }
      if (!this.terminated.has(messageId)) {
        this.reply({ messageId, status: "success", done: true, content: step.value ?? null });
      }
    } catch (error) {
      if (!this.terminated.has(messageId)) {
        this.reply({ messageId, status: "error", done: true, content: errorText(error) });
      }
    } finally {
      this.inflight.delete(messageId);
      this.terminated.delete(messageId);
    }
  }

  private reply(payload: StreamChunkPayload): void {
    this.port.postMessage({ type: "streamChunk", payload });
  }
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, "next") === "function" &&
    typeof Reflect.get(value, "return") === "function" &&
    typeof Reflect.get(value, Symbol.asyncIterator) === "function"
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * SSE event bridge (plan todo 9): the `client.event.subscribe()` loop with
 * reconnect, chat-sink forwarding, delta batching, and poll invalidation.
 * This module ships the bridge ONLY — no webview wiring (todo 10+).
 *
 * allow: SIZE_OK — the todo-9 binding requires the injected-seam contract to
 * live in this module header verbatim for T10/T12/T13 (below), and the
 * behavior is one indivisible subscribe→dispatch→backoff loop whose inline
 * state (batch map, debounce tokens, outage queue, failure counter) mutually
 * owns the outage/bookkeeping invariants; the plan's ownership boundary for
 * this todo is exactly this file plus its test (same sanction as T8's
 * ServerManager.ts).
 *
 * WIRE EVENT SHAPE: every event arriving from the source is
 * `{ type, properties }` (the SDK `/event` stream shape; the todo-5 mock
 * mirrors it). `properties` is opaque JSON — the bridge only reads
 * `sessionID` / `info` for its own routing signals and never parses part
 * payloads beyond the delta envelope below.
 *
 * INJECTED SEAMS (implemented by later todos; keep these signatures stable):
 * - `source: EventStreamFactory` (T8): ONE subscription attempt per call;
 *   resolves to the async-iterable event stream. Production value:
 *   {@link createSdkEventSource}(connection.client). Tests hand a fake
 *   push-stream (see `__tests__/eventBridge.test.ts`).
 * - `isServerAlive: () => boolean` (T8): ServerManager state
 *   `managed | attached`. Reconnect runs FOREVER while true; when it flips
 *   false the loop exits quietly (no `serverLost` — the manager owns
 *   stop/lost semantics).
 * - `sink: EventSink` (T10 ChatViewProvider): receives every chat-relevant
 *   event as `ForwardedEvent { type, payload }` — T10 wraps it into the T3
 *   wire message `{ type: "event", payload: ForwardedEvent }` and
 *   postMessages it. `message.part.delta` never crosses this sink raw: deltas
 *   are merged per (messageID, partID, field) inside a 30ms window and
 *   flushed as ONE `message.part.deltaBatch` envelope whose payload is
 *   `DeltaBatchPayload { parts }` (T13 reassembles text from each
 *   `DeltaBatchEntry.delta`, already ordered and pre-concatenated, with
 *   `count` = the merged delta count).
 * - `invalidate: InvalidateSink` (T12 sessions / T13 messages / T18 todos):
 *   session-scoped events (`session.*`, `message.*`, `todo.*`) fire a
 *   `SyncKind` signal DEBOUNCED 250ms per kind carrying the LAST sessionId
 *   seen in the window. Consumers poll-refetch there; the bridge carries no
 *   entity data and never refetches itself.
 * - `resync: ResyncSink` (T7 + T10): fires ONCE per `server.connected`
 *   event, AFTER the outage queue has been replayed in order. T10's contract
 *   per the T7 detector: `detector.invalidate(baseUrl)` + full refetch +
 *   `init`-refresh. The notice reports `droppedEventCount` — queued events
 *   shed during the outage for the 1000-cap.
 * - `serverLost: ServerLostSink` (T10 `server-lost` banner + retry): fires
 *   ONCE per outage epoch, on the first subscription error / stream close;
 *   later attempts of the same epoch only log at debug.
 * - `logger`, `clock` (the T8 `Clock` seam — every delay rides it), `random`
 *   (jitter source, default `Math.random`), `timing` (below — every constant
 *   injectable for deterministic tests).
 *
 * EVENT TAXONOMY RULES:
 * - `pty.*` and `tui.*` events are NEVER forwarded to the chat sink
 *   (TUI-control traffic; counted + debug-logged).
 * - `server.connected` is CONSUMED by the bridge (drives `resync`) and is
 *   not forwarded.
 * - Events observed before the first (or next) `server.connected` are
 *   queued in arrival order — cap {@link EventBridgeTiming.queueCap}
 *   (1000), drop-oldest, shed count rides the next `resync` notice — and
 *   replayed in order on connect. The real server always emits
 *   `server.connected` first, so in production the queue stays empty; it
 *   exists for replay-capable sources.
 * - A malformed delta (non-record properties, missing messageID/partID,
 *   non-string delta) falls back to immediate unbatched forwarding — user
 *   content is never dropped.
 *
 * RECONNECT: exponential backoff 0.5s → 15s (`base * 2^(failures-1)`,
 * capped) with ±20% symmetric jitter, FOREVER while `isServerAlive()`; the
 * failure counter resets on every `server.connected`. The SDK's own SSE
 * layer retries internally forever by default, so the production adapter
 * passes `sseMaxRetryAttempts: 0` — THIS loop owns the schedule.
 *
 * DISPOSE: idempotent. Aborts the in-flight subscribe/iteration (abort
 * signal + dispose race), flushes the pending delta batch through the sink,
 * clears the outage queue and pending debounces, and stops the loop
 * promptly. No sink/invalidate/resync/serverLost callback fires after
 * `dispose()` has returned.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../host/logger.js";
import { createSystemClock, type Clock } from "./serverLifecycle.js";

// ---------------------------------------------------------------------------
// Public contracts (the injected seams named in the module header).

export interface WireEvent {
  readonly type: string;
  readonly properties: unknown;
}

export type EventStreamFactory = (signal: AbortSignal) => Promise<AsyncIterable<WireEvent>>;

export interface ForwardedEvent {
  readonly type: string;
  readonly payload: unknown;
}
export type EventSink = (event: ForwardedEvent) => void;

export type SyncKind = "sessions" | "messages" | "todos";
export type InvalidateSink = (kind: SyncKind, sessionId: string | undefined) => void;

export interface ResyncNotice {
  readonly droppedEventCount: number;
}
export type ResyncSink = (notice: ResyncNotice) => void;

export type ServerLostReason = "stream-closed" | "stream-error" | "subscribe-failed";
export interface ServerLostNotice {
  readonly reason: ServerLostReason;
  /** Consecutive failures so far in the current outage epoch (1 on first). */
  readonly failures: number;
  readonly detail: string;
}
export type ServerLostSink = (notice: ServerLostNotice) => void;

export interface DeltaBatchEntry {
  readonly sessionID: string | undefined;
  readonly messageID: string;
  readonly partID: string;
  readonly field: string | undefined;
  /** Deltas concatenated in arrival order. */
  readonly delta: string;
  /** How many raw deltas were merged into {@link delta}. */
  readonly count: number;
}
export interface DeltaBatchPayload {
  readonly parts: readonly DeltaBatchEntry[];
}

export const DELTA_EVENT_TYPE = "message.part.delta";
export const DELTA_BATCH_EVENT_TYPE = "message.part.deltaBatch";
export const SERVER_CONNECTED_EVENT_TYPE = "server.connected";

export interface EventBridgeTiming {
  /** Delta merge window (plan: 30ms). */
  readonly batchWindowMs: number;
  /** Per-kind invalidate debounce (plan: 250ms). */
  readonly debounceMs: number;
  /** Backoff first-step delay (plan: 500ms). */
  readonly backoffBaseMs: number;
  /** Backoff ceiling (plan: 15000ms). */
  readonly backoffCapMs: number;
  /** Symmetric jitter ratio applied to each backoff step (plan: 0.2 = ±20%). */
  readonly jitterRatio: number;
  /** Outage queue bound (plan: 1000, drop-oldest). */
  readonly queueCap: number;
}

export const DEFAULT_EVENT_BRIDGE_TIMING: EventBridgeTiming = {
  batchWindowMs: 30,
  debounceMs: 250,
  backoffBaseMs: 500,
  backoffCapMs: 15000,
  jitterRatio: 0.2,
  queueCap: 1000,
};

export interface EventBridgeDeps {
  readonly source: EventStreamFactory;
  readonly isServerAlive: () => boolean;
  readonly sink: EventSink;
  readonly invalidate: InvalidateSink;
  readonly resync: ResyncSink;
  readonly serverLost: ServerLostSink;
  readonly logger: PanelLogger;
  readonly clock?: Clock;
  readonly random?: () => number;
  readonly timing?: Partial<EventBridgeTiming>;
}

// ---------------------------------------------------------------------------
// Internals.

interface MutableDeltaEntry {
  readonly sessionID: string | undefined;
  readonly messageID: string;
  readonly partID: string;
  readonly field: string | undefined;
  delta: string;
  count: number;
}

type PumpOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" };

interface DebounceSlot {
  readonly token: number;
  readonly sessionId: string | undefined;
}

const DISPOSED: unique symbol = Symbol("opencode-panel.eventBridge.disposed");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function syncKindFor(type: string): SyncKind | undefined {
  if (type.startsWith("session.")) return "sessions";
  if (type.startsWith("message.")) return "messages";
  if (type.startsWith("todo.")) return "todos";
  return undefined;
}

/** Best-effort session id extraction for the debounce signal (see header). */
function sessionIdForSync(kind: SyncKind, properties: unknown): string | undefined {
  if (!isRecord(properties)) return undefined;
  if (typeof properties.sessionID === "string") return properties.sessionID;
  if (isRecord(properties.info)) {
    if (typeof properties.info.sessionID === "string") return properties.info.sessionID;
    // session.* events carry `{ info: Session }` whose own id IS the session.
    if (kind === "sessions" && typeof properties.info.id === "string") return properties.info.id;
  }
  return undefined;
}

export class EventBridge {
  private readonly deps: EventBridgeDeps;
  private readonly timing: EventBridgeTiming;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly logger: PanelLogger;
  private readonly abortController = new AbortController();
  private readonly disposeHandle: { readonly promise: Promise<void>; readonly resolve: () => void };

  private disposed = false;
  private connected = false;
  private outageOpen = false;
  private failures = 0;
  private queue: WireEvent[] = [];
  private droppedDuringOutage = 0;
  private runPromise: Promise<void> | undefined;

  private readonly batchParts = new Map<string, MutableDeltaEntry>();
  private batchArmed = false;
  private readonly debounce = new Map<string, DebounceSlot>();

  constructor(deps: EventBridgeDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.clock = deps.clock ?? createSystemClock();
    this.random = deps.random ?? Math.random;
    this.timing = { ...DEFAULT_EVENT_BRIDGE_TIMING, ...deps.timing };
    let resolveFn: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    this.disposeHandle = {
      promise,
      resolve: () => {
        if (resolveFn !== undefined) resolveFn();
      },
    };
  }

  /** Launch the subscription loop (idempotent; no-op after dispose). */
  start(): void {
    if (this.disposed || this.runPromise !== undefined) return;
    this.runPromise = this.run().catch((error: unknown) => {
      // The loop never throws by construction; safety net only.
      this.logger.error(`event bridge loop failed unexpectedly: ${String(error)}`);
    });
  }

  /** Resolves when the subscription loop has fully exited. */
  get stopped(): Promise<void> {
    return this.runPromise ?? Promise.resolve();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.flushBatch();
    this.batchArmed = false;
    this.queue = [];
    this.droppedDuringOutage = 0;
    this.debounce.clear();
    this.disposeHandle.resolve();
  }

  // -- subscription loop -----------------------------------------------------

  private async run(): Promise<void> {
    for (;;) {
      if (this.disposed) return;
      if (!this.deps.isServerAlive()) {
        this.logger.debug("event bridge: server no longer managed/attached; stopping the loop");
        return;
      }
      let stream: AsyncIterable<WireEvent>;
      try {
        stream = await this.deps.source(this.abortController.signal);
      } catch (error) {
        // A rejected subscribe is one failure step of the same outage epoch.
        await this.handleFailure("subscribe-failed", error);
        continue;
      }
      if (this.disposed) return;
      const outcome = await this.pump(stream);
      switch (outcome.kind) {
        case "aborted":
          return;
        case "closed":
          if (this.disposed) return;
          await this.handleFailure("stream-closed", undefined);
          break;
        case "error":
          if (this.disposed) return;
          await this.handleFailure("stream-error", outcome.error);
          break;
      }
    }
  }

  /** Consume one stream until it ends, errors, or dispose wins the race. */
  private async pump(stream: AsyncIterable<WireEvent>): Promise<PumpOutcome> {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (!this.disposed) {
        const step = await Promise.race([
          iterator.next(),
          this.disposeHandle.promise.then((): typeof DISPOSED => DISPOSED),
        ]);
        if (step === DISPOSED) return { kind: "aborted" };
        if (step.done === true) return { kind: "closed" };
        this.ingest(step.value);
      }
      return { kind: "aborted" };
    } catch (error) {
      return this.disposed ? { kind: "aborted" } : { kind: "error", error };
    } finally {
      if (iterator.return !== undefined) {
        try {
          await iterator.return();
        } catch {
          // Half-close is best-effort; a broken stream may reject here.
        }
      }
    }
  }

  private async handleFailure(reason: ServerLostReason, error: unknown): Promise<void> {
    this.connected = false;
    this.failures += 1;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "stream ended";
    if (!this.outageOpen) {
      this.outageOpen = true;
      this.droppedDuringOutage = 0;
      this.logger.warn(
        `opencode event stream lost (${reason}: ${detail}); reconnecting with backoff`,
      );
      this.deps.serverLost({ reason, failures: this.failures, detail });
    }
    const delayMs = this.backoffDelay(this.failures);
    this.logger.debug(
      `event bridge: retry ${this.failures} scheduled in ${delayMs}ms (${reason}: ${detail})`,
    );
    await this.sleep(delayMs);
  }

  private backoffDelay(failures: number): number {
    const grown = this.timing.backoffBaseMs * 2 ** (failures - 1);
    const capped = Math.min(grown, this.timing.backoffCapMs);
    const jitter = 1 + (this.random() * 2 - 1) * this.timing.jitterRatio;
    return Math.max(1, Math.round(capped * jitter));
  }

  private sleep(ms: number): Promise<void> {
    return Promise.race([this.clock.delay(ms), this.disposeHandle.promise]).then(() => undefined);
  }

  // -- event intake -----------------------------------------------------------

  private ingest(event: WireEvent): void {
    if (this.disposed) return;
    if (event.type === SERVER_CONNECTED_EVENT_TYPE) {
      this.onConnected();
      return;
    }
    if (!this.connected) {
      this.enqueue(event);
      return;
    }
    this.dispatch(event);
  }

  private onConnected(): void {
    this.connected = true;
    this.failures = 0;
    this.outageOpen = false;
    const queued = this.queue;
    this.queue = [];
    for (const event of queued) this.dispatch(event);
    const droppedEventCount = this.droppedDuringOutage;
    this.droppedDuringOutage = 0;
    this.logger.info(
      `opencode event stream connected; replayed ${queued.length} queued event(s)` +
        (droppedEventCount > 0 ? `, shed ${droppedEventCount} over the queue cap` : ""),
    );
    this.deps.resync({ droppedEventCount });
  }

  private enqueue(event: WireEvent): void {
    this.queue.push(event);
    const overflow = this.queue.length - this.timing.queueCap;
    if (overflow > 0) {
      this.queue.splice(0, overflow);
      this.droppedDuringOutage += overflow;
    }
  }

  private dispatch(event: WireEvent): void {
    if (event.type.startsWith("pty.") || event.type.startsWith("tui.")) {
      this.logger.debug(`event bridge: filtered ${event.type} (TUI-control traffic)`);
      return;
    }
    if (event.type === DELTA_EVENT_TYPE) {
      this.batchDelta(event.properties);
    } else {
      this.deps.sink({ type: event.type, payload: event.properties });
    }
    const kind = syncKindFor(event.type);
    if (kind !== undefined) this.noteSync(kind, event.properties);
  }

  // -- delta batching ----------------------------------------------------------

  private batchDelta(properties: unknown): void {
    if (
      !isRecord(properties) ||
      typeof properties.messageID !== "string" ||
      typeof properties.partID !== "string" ||
      typeof properties.delta !== "string"
    ) {
      // Malformed delta: forward unbatched rather than drop user content.
      this.deps.sink({ type: DELTA_EVENT_TYPE, payload: properties });
      return;
    }
    const messageID = properties.messageID;
    const partID = properties.partID;
    const field = typeof properties.field === "string" ? properties.field : undefined;
    const sessionID = typeof properties.sessionID === "string" ? properties.sessionID : undefined;
    const key = `${messageID} ${partID} ${field ?? ""}`;
    let entry = this.batchParts.get(key);
    if (entry === undefined) {
      entry = { sessionID, messageID, partID, field, delta: "", count: 0 };
      this.batchParts.set(key, entry);
    }
    entry.delta += properties.delta;
    entry.count += 1;
    if (!this.batchArmed) {
      this.batchArmed = true;
      void this.clock.delay(this.timing.batchWindowMs).then(() => {
        this.batchArmed = false;
        if (this.disposed) return;
        this.flushBatch();
      });
    }
  }

  private flushBatch(): void {
    if (this.batchParts.size === 0) return;
    const parts: DeltaBatchEntry[] = [];
    for (const entry of this.batchParts.values()) parts.push({ ...entry });
    this.batchParts.clear();
    this.deps.sink({ type: DELTA_BATCH_EVENT_TYPE, payload: { parts } satisfies DeltaBatchPayload });
  }

  // -- poll invalidation --------------------------------------------------------

  private noteSync(kind: SyncKind, properties: unknown): void {
    const sessionId = sessionIdForSync(kind, properties);
    // Debounce per (kind, sessionId) so a burst from a foreign session can
    // never overwrite the slot carrying the ACTIVE session's invalidation;
    // within one session the burst still collapses to a single fire.
    const slotKey = `${kind} ${sessionId ?? ""}`;
    const previous = this.debounce.get(slotKey);
    const token = (previous?.token ?? 0) + 1;
    this.debounce.set(slotKey, { token, sessionId });
    void this.clock.delay(this.timing.debounceMs).then(() => {
      if (this.disposed) return;
      const current = this.debounce.get(slotKey);
      if (current === undefined || current.token !== token) return;
      this.debounce.delete(slotKey);
      this.deps.invalidate(kind, sessionId);
    });
  }
}

// ---------------------------------------------------------------------------
// Production source adapter over the todo-7 SDK client (todo 8 hands it
// `ServerConnection.client`).

/**
 * Build the {@link EventStreamFactory} for a connected SDK client.
 *
 * The SDK's SSE helper retries internally FOREVER by default and swallows
 * transport errors into a normal stream completion; both are undone here so
 * the bridge owns the reconnect schedule: `sseMaxRetryAttempts: 0` disables
 * internal retry and the first captured `onSseError` is re-raised from the
 * iterator, so error-driven outages look exactly like throws to the loop.
 */
export function createSdkEventSource(client: OpencodeClient): EventStreamFactory {
  return async (signal) => {
    let sseError: unknown;
    const result = await client.event.subscribe({
      signal,
      sseMaxRetryAttempts: 0,
      onSseError: (error: unknown) => {
        sseError = error;
      },
    });
    const stream = result.stream;
    return {
      [Symbol.asyncIterator](): AsyncIterator<WireEvent> {
        return {
          async next(): Promise<IteratorResult<WireEvent>> {
            const step = await stream.next();
            if (step.done === true) {
              if (sseError !== undefined) {
                const error = sseError;
                sseError = undefined;
                throw error;
              }
              return { done: true, value: undefined };
            }
            return { done: false, value: step.value };
          },
          async return(value?: unknown): Promise<IteratorResult<WireEvent>> {
            await stream.return(value);
            return { done: true, value: undefined };
          },
        };
      },
    };
  };
}

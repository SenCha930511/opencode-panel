/**
 * EventBridge (plan todo 9) acceptance suite.
 *
 * Unit cases run against a hand-driven {@link FakeEventStream} (the
 * EventStreamFactory seam): delta batching under a 30ms window with fake
 * timers, the 0.5s→15s ±20% jitter backoff schedule, 250ms per-kind
 * invalidation debounce, serverLost/resync semantics, the 1000-entry outage
 * queue (drop-oldest + shed count on resync), pty/tui filtering and prompt
 * idempotent dispose. Integration cases run the REAL
 * {@link createSdkEventSource} against the todo-5 mock server, including
 * the QA failure: mock SSE closed mid-basic-chat ⇒ serverLost within 2s.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import type { Clock } from "../serverLifecycle.js";
import {
  DELTA_BATCH_EVENT_TYPE,
  DELTA_EVENT_TYPE,
  EventBridge,
  type DeltaBatchEntry,
  type EventStreamFactory,
  type ForwardedEvent,
  type InvalidateSink,
  type ResyncNotice,
  type ServerLostNotice,
  type SyncKind,
  type WireEvent,
  createSdkEventSource,
} from "../eventBridge.js";
import { startMockServer, type MockServer } from "../../test/mock-server/index.js";
import { isRecord } from "../../shared/protocol.js";

// ---------------------------------------------------------------------------
// Test seams.

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
  }
}

/** Instant clock recording every scheduled delay (reconnect/batch/debounce). */
class RecordingClock implements Clock {
  readonly delays: number[] = [];
  delay(ms: number): Promise<void> {
    this.delays.push(ms);
    return Promise.resolve();
  }
}

/** Clock over real/fake `setTimeout` (used with vitest fake timers). */
function timerClock(recorded?: number[]): Clock {
  return {
    delay: (ms) => {
      recorded?.push(ms);
      return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    },
  };
}

/** Hand-driven AsyncIterable: push events, close/fail to end the stream. */
class FakeEventStream implements AsyncIterable<WireEvent> {
  private readonly pending: WireEvent[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<WireEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended: { readonly kind: "closed" } | { readonly kind: "error"; readonly error: unknown } | undefined;

  push(event: WireEvent): void {
    if (this.ended !== undefined) throw new Error("FakeEventStream: push after end");
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: event });
    else this.pending.push(event);
  }

  close(): void {
    this.finish({ kind: "closed" });
  }

  fail(error: unknown): void {
    this.finish({ kind: "error", error });
  }

  private finish(
    end: { readonly kind: "closed" } | { readonly kind: "error"; readonly error: unknown },
  ): void {
    if (this.ended !== undefined) return;
    this.ended = end;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      if (end.kind === "closed") waiter.resolve({ done: true, value: undefined });
      else waiter.reject(end.error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<WireEvent> {
    return {
      next: () => {
        const buffered = this.pending.shift();
        if (buffered !== undefined) return Promise.resolve({ done: false, value: buffered });
        if (this.ended !== undefined) {
          return this.ended.kind === "closed"
            ? Promise.resolve({ done: true, value: undefined })
            : Promise.reject(this.ended.error);
        }
        return new Promise((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
      return: () => {
        this.finish({ kind: "closed" });
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }
}

interface HarnessOptions {
  readonly clock?: Clock;
  readonly random?: () => number;
  readonly alive?: () => boolean;
}

interface Harness {
  readonly bridge: EventBridge;
  readonly streams: FakeEventStream[];
  readonly forwarded: ForwardedEvent[];
  readonly invalidations: InvalidateRecord[];
  readonly resyncs: ResyncNotice[];
  readonly losts: ServerLostNotice[];
  readonly channel: CapturingChannel;
  readonly attempts: number;
}

interface InvalidateRecord {
  readonly kind: SyncKind;
  readonly sessionId: string | undefined;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const streams: FakeEventStream[] = [];
  const forwarded: ForwardedEvent[] = [];
  const invalidations: InvalidateRecord[] = [];
  const resyncs: ResyncNotice[] = [];
  const losts: ServerLostNotice[] = [];
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  let attempts = 0;
  const clock = options.clock ?? new RecordingClock();
  const source: EventStreamFactory = () => {
    attempts += 1;
    const stream = new FakeEventStream();
    streams.push(stream);
    return Promise.resolve(stream);
  };
  const bridge = new EventBridge({
    source,
    isServerAlive: options.alive ?? (() => true),
    sink: (event) => forwarded.push(event),
    invalidate: (kind, sessionId) => invalidations.push({ kind, sessionId }),
    resync: (notice) => resyncs.push(notice),
    serverLost: (notice) => losts.push(notice),
    logger,
    clock,
    ...(options.random === undefined ? {} : { random: options.random }),
  });
  return {
    bridge,
    streams,
    forwarded,
    invalidations,
    resyncs,
    losts,
    channel,
    get attempts() {
      return attempts;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers.

async function tick(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`waitFor timeout: ${label}`);
}

/** Real-time poller for the integration suite (no fake timers). */
async function until(cond: () => boolean, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`until timeout (${timeoutMs}ms): ${label}`);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing: ${label}`);
  return value;
}

function deltaEvent(
  index: number,
  ids: { readonly messageID?: string; readonly partID?: string; readonly field?: string } = {},
): WireEvent {
  return {
    type: DELTA_EVENT_TYPE,
    properties: {
      sessionID: "S1",
      messageID: ids.messageID ?? "M1",
      partID: ids.partID ?? "P1",
      field: ids.field ?? "text",
      delta: `chunk-${String(index).padStart(3, "0")} `,
    },
  };
}

function expectedChunkText(count: number): string {
  return Array.from({ length: count }, (_, i) => `chunk-${String(i + 1).padStart(3, "0")} `).join("");
}

/** Boundary check shared by batch assertions: envelope must carry a parts array. */
function batchParts(payload: unknown, label: string): readonly DeltaBatchEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.parts)) {
    throw new Error(`malformed deltaBatch payload (${label})`);
  }
  return payload.parts as readonly DeltaBatchEntry[];
}

function batchEnvelopes(forwarded: readonly ForwardedEvent[]): ForwardedEvent[] {
  return forwarded.filter((event) => event.type === DELTA_BATCH_EVENT_TYPE);
}

function sessionEvent(id: string): WireEvent {
  return { type: "session.updated", properties: { info: { id } } };
}

// ---------------------------------------------------------------------------
// Unit: delta batching.

describe("delta batching", () => {
  it("merges 200 deltas into <=12 ordered envelopes within a 30ms window", async () => {
    vi.useFakeTimers();
    try {
      const recorded: number[] = [];
      const harness = makeHarness({ clock: timerClock(recorded) });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      const stream = must(harness.streams[0], "stream");
      stream.push({ type: "server.connected", properties: {} });
      await tick();

      // 8 rounds x 25 deltas; each round occupies its own 30ms window.
      for (let round = 0; round < 8; round += 1) {
        for (let j = 0; j < 25; j += 1) stream.push(deltaEvent(round * 25 + j + 1));
        await vi.advanceTimersByTimeAsync(30);
        await tick();
      }

      const batches = batchEnvelopes(harness.forwarded);
      expect(batches.length).toBeGreaterThanOrEqual(2);
      expect(batches.length).toBeLessThanOrEqual(12);
      // Every scheduled window used the plan's 30ms constant.
      expect(recorded.filter((ms) => ms === 30).length).toBe(batches.length);

      let text = "";
      let count = 0;
      for (const [i, envelope] of batches.entries()) {
        const parts = batchParts(envelope.payload, `envelope ${i}`);
        // Single part in this trace; part-first-seen order preserved.
        expect(parts.map((part) => part.partID)).toEqual(["P1"]);
        for (const part of parts) {
          text += part.delta;
          count += part.count;
        }
      }
      expect(count).toBe(200);
      expect(text).toBe(expectedChunkText(200));
      harness.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("merges interleaved parts of one window into a single ordered envelope", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness({ clock: timerClock() });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      const stream = must(harness.streams[0], "stream");
      stream.push({ type: "server.connected", properties: {} });
      await tick();
      stream.push(deltaEvent(1, { partID: "PA" }));
      stream.push(deltaEvent(2, { partID: "PB" }));
      stream.push(deltaEvent(3, { partID: "PA" }));
      await vi.advanceTimersByTimeAsync(30);
      await tick();

      const batches = batchEnvelopes(harness.forwarded);
      expect(batches.length).toBe(1);
      const parts = batchParts(must(batches[0], "batch").payload, "interleaved");
      expect(parts.map((part) => part.partID)).toEqual(["PA", "PB"]);
      expect(must(parts[0], "PA").delta).toBe("chunk-001 chunk-003 ");
      expect(must(parts[0], "PA").count).toBe(2);
      expect(must(parts[1], "PB").delta).toBe("chunk-002 ");
      harness.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards a malformed delta unbatched instead of dropping it", async () => {
    const harness = makeHarness();
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    const stream = must(harness.streams[0], "stream");
    stream.push({ type: "server.connected", properties: {} });
    await tick();
    stream.push({ type: DELTA_EVENT_TYPE, properties: { messageID: "M9" } });
    await tick();
    expect(harness.forwarded.map((event) => event.type)).toEqual([DELTA_EVENT_TYPE]);
    harness.bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Unit: immediate forwarding, filtering, invalidation.

describe("forwarding and invalidation", () => {
  it("debounces per (kind, sessionId): a foreign-session burst no longer suppresses the active session", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness({ clock: timerClock() });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      const stream = must(harness.streams[0], "stream");
      stream.push({ type: "server.connected", properties: {} });
      await tick();

      // Active session A's completion, then foreign session B's events in the
      // SAME 250ms window — OLD behavior: B overwrote A's slot so invalidate
      // fired only for B and A went stale. New: both sessions fire.
      stream.push({ type: "message.updated", properties: { info: { sessionID: "ses_A" } } });
      await vi.advanceTimersByTimeAsync(40);
      stream.push({ type: "message.updated", properties: { info: { sessionID: "ses_B" } } });
      await vi.advanceTimersByTimeAsync(30);
      stream.push({ type: "message.updated", properties: { info: { sessionID: "ses_B" } } });

      await vi.advanceTimersByTimeAsync(250);
      await tick();
      const msgs = harness.invalidations.filter((inv) => inv.kind === "messages");
      expect(msgs).toEqual([
        { kind: "messages", sessionId: "ses_A" },
        { kind: "messages", sessionId: "ses_B" },
      ]);
      harness.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });


  it("forwards non-delta events immediately and debounces invalidation 250ms per (kind, session)", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness({ clock: timerClock() });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      const stream = must(harness.streams[0], "stream");
      stream.push({ type: "server.connected", properties: {} });
      await tick();

      // Burst of 5 events per session-scoped kind, inside one 250ms window.
      for (let k = 1; k <= 5; k += 1) {
        stream.push(sessionEvent(`s${k}`));
        stream.push({ type: "message.updated", properties: { info: { sessionID: `m${k}` } } });
        stream.push({ type: "todo.updated", properties: { sessionID: `t${k}` } });
        if (k < 5) await vi.advanceTimersByTimeAsync(40);
      }
      await tick();
      // All 15 non-delta events crossed the sink immediately.
      expect(harness.forwarded.length).toBe(15);
      expect(harness.forwarded.filter((event) => event.type === "session.updated").length).toBe(5);

      // Events at t=0,40,80,120,160; each (kind,session) slot fires at its
      // own event_time + 250ms, so the s1..s4 slots (12 fires) land by t+249.
      await vi.advanceTimersByTimeAsync(249);
      await tick();
      expect(harness.invalidations.length).toBe(12);
      await vi.advanceTimersByTimeAsync(1);
      await tick();
      // One fire per (kind, session) slot. The burst carried 5 DISTINCT
      // session ids per kind, so every session survives the window — the old
      // per-kind slot would have collapsed them to the last id.
      const msgs = harness.invalidations.filter((inv) => inv.kind === "messages");
      expect(msgs.map((inv) => inv.sessionId)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      const sess = harness.invalidations.filter((inv) => inv.kind === "sessions");
      expect(sess.map((inv) => inv.sessionId)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
      const todos = harness.invalidations.filter((inv) => inv.kind === "todos");
      expect(todos.map((inv) => inv.sessionId)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
      await vi.advanceTimersByTimeAsync(1000);
      await tick();
      expect(harness.invalidations.length).toBe(15);
      harness.bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never forwards pty.* or tui.* events to the chat sink", async () => {
    const harness = makeHarness();
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    const stream = must(harness.streams[0], "stream");
    stream.push({ type: "server.connected", properties: {} });
    await tick();
    stream.push({ type: "pty.created", properties: { info: { id: "pty1" } } });
    stream.push({ type: "tui.toast.show", properties: { message: "hi" } });
    stream.push({ type: "pty.deleted", properties: { id: "pty1" } });
    stream.push({ type: "file.edited", properties: { file: "ok.ts" } });
    await tick();
    expect(harness.forwarded.map((event) => event.type)).toEqual(["file.edited"]);
    const log = harness.channel.joined();
    expect(log).toContain("filtered pty.created");
    expect(log).toContain("filtered tui.toast.show");
    harness.bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Unit: reconnect schedule + serverLost/resync.

describe("reconnect", () => {
  it("schedules 500->15000 capped backoff, fired serverLost once per outage", async () => {
    const clock = new RecordingClock();
    const harness = makeHarness({ clock, random: () => 0.5 });
    harness.bridge.start();
    for (let n = 1; n <= 6; n += 1) {
      await waitFor(() => harness.streams.length === n, `subscription ${n}`);
      must(harness.streams[n - 1], `stream ${n}`).fail(new Error(`boom-${n}`));
      await waitFor(() => clock.delays.length === n, `delay ${n}`);
    }
    expect(clock.delays).toEqual([500, 1000, 2000, 4000, 8000, 15000]);
    expect(harness.losts.length).toBe(1);
    expect(must(harness.losts[0], "lost").reason).toBe("stream-error");
    expect(must(harness.losts[0], "lost").failures).toBe(1);
    harness.bridge.dispose();
    await harness.bridge.stopped;
  });

  it("applies symmetric +/-20% jitter around each backoff step", async () => {
    for (const [random, expected] of [
      [() => 0, 400],
      [() => 1, 600],
    ] as const) {
      const clock = new RecordingClock();
      const harness = makeHarness({ clock, random });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      must(harness.streams[0], "stream").fail(new Error("boom"));
      await waitFor(() => clock.delays.length === 1, "first delay");
      expect(clock.delays[0]).toBe(expected);
      harness.bridge.dispose();
      await harness.bridge.stopped;
    }
  });

  it("treats a rejected subscribe as a failure step (subscribe-failed)", async () => {
    const clock = new RecordingClock();
    const streams: FakeEventStream[] = [];
    const losts: ServerLostNotice[] = [];
    const channel = new CapturingChannel();
    const source: EventStreamFactory = () => {
      streams.push(new FakeEventStream());
      return Promise.reject(new Error("dial down"));
    };
    const bridge = new EventBridge({
      source,
      isServerAlive: () => true,
      sink: () => undefined,
      invalidate: () => undefined,
      resync: () => undefined,
      serverLost: (notice) => losts.push(notice),
      logger: new PanelLogger(channel, () => true),
      clock,
      random: () => 0.5,
    });
    bridge.start();
    // With an instant clock + always-rejecting source the loop never blocks,
    // so only >= is stable (an === probe can race past the exact value).
    await waitFor(() => clock.delays.length >= 2, "two retries");
    expect(clock.delays.slice(0, 2)).toEqual([500, 1000]);
    expect(losts.length).toBe(1);
    expect(must(losts[0], "lost").reason).toBe("subscribe-failed");
    bridge.dispose();
    await bridge.stopped;
  });

  it("fires serverLost once when the stream closes mid-run", async () => {
    const clock = new RecordingClock();
    const harness = makeHarness({ clock, random: () => 0.5 });
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    const stream = must(harness.streams[0], "stream");
    stream.push({ type: "server.connected", properties: {} });
    stream.push(sessionEvent("S-live"));
    await tick();
    expect(harness.forwarded.map((event) => event.type)).toEqual(["session.updated"]);
    stream.close();
    await waitFor(() => harness.losts.length === 1, "serverLost");
    expect(must(harness.losts[0], "lost").reason).toBe("stream-closed");
    await waitFor(() => harness.streams.length === 2, "reconnect attempt");
    // Instant-clock backoff already elapsed; no second outage notification.
    must(harness.streams[1], "stream 2").close();
    await waitFor(() => clock.delays.length === 2, "second backoff");
    expect(harness.losts.length).toBe(1);
    harness.bridge.dispose();
    await harness.bridge.stopped;
  });

  it("fires resync once per connect and replays the outage queue in order", async () => {
    const harness = makeHarness({ random: () => 0.5 });
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    const stream1 = must(harness.streams[0], "stream 1");
    stream1.push({ type: "server.connected", properties: {} });
    stream1.push(sessionEvent("S-old"));
    await tick();
    expect(harness.resyncs).toEqual([{ droppedEventCount: 0 }]);
    stream1.close();
    await waitFor(() => harness.streams.length === 2, "reconnect");
    const stream2 = must(harness.streams[1], "stream 2");
    // Arrives BEFORE server.connected of the new epoch => queued, then replayed.
    stream2.push(sessionEvent("S-queued"));
    stream2.push({ type: "server.connected", properties: {} });
    stream2.push(sessionEvent("S-live"));
    await tick();
    expect(harness.forwarded.map((event) => event.type)).toEqual([
      "session.updated",
      "session.updated",
      "session.updated",
    ]);
    const ids = harness.forwarded.map((event) =>
      isRecord(event.payload) && isRecord(event.payload.info) ? event.payload.info.id : undefined,
    );
    expect(ids).toEqual(["S-old", "S-queued", "S-live"]);
    expect(harness.resyncs).toEqual([{ droppedEventCount: 0 }, { droppedEventCount: 0 }]);
    harness.bridge.dispose();
    await harness.bridge.stopped;
  });

  it("caps the outage queue at 1000, drops oldest, surfaces the shed count", async () => {
    const harness = makeHarness({ random: () => 0.5 });
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    const stream1 = must(harness.streams[0], "stream 1");
    stream1.push({ type: "server.connected", properties: {} });
    await tick();
    stream1.close();
    await waitFor(() => harness.streams.length === 2, "reconnect");
    const stream2 = must(harness.streams[1], "stream 2");
    for (let i = 1; i <= 1200; i += 1) {
      stream2.push({ type: "file.edited", properties: { file: `f${i}` } });
    }
    stream2.push({ type: "server.connected", properties: {} });
    await waitFor(() => harness.resyncs.length === 2, "resync after reconnect");
    expect(harness.forwarded.length).toBe(1000);
    const files = harness.forwarded.map((event) =>
      isRecord(event.payload) ? event.payload.file : undefined,
    );
    expect(files[0]).toBe("f201");
    expect(files[999]).toBe("f1200");
    expect(must(harness.resyncs[1], "resync").droppedEventCount).toBe(200);
    harness.bridge.dispose();
    await harness.bridge.stopped;
  });

  it("stops retrying quietly once the server is no longer alive", async () => {
    const clock = new RecordingClock();
    let alive = true;
    const harness = makeHarness({ clock, random: () => 0.5, alive: () => alive });
    harness.bridge.start();
    await waitFor(() => harness.streams.length === 1, "first subscription");
    alive = false;
    must(harness.streams[0], "stream").fail(new Error("boom"));
    await waitFor(() => clock.delays.length === 1, "backoff scheduled");
    await tick();
    await harness.bridge.stopped;
    // Exactly one subscribe attempt total: no resubscribe while dead.
    expect(harness.attempts).toBe(1);
    harness.bridge.dispose();
  });
});

// ---------------------------------------------------------------------------
// Unit: dispose.

describe("dispose", () => {
  it("flushes the pending batch, stops promptly, and is idempotent", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness({ clock: timerClock() });
      harness.bridge.start();
      await waitFor(() => harness.streams.length === 1, "first subscription");
      const stream = must(harness.streams[0], "stream");
      stream.push({ type: "server.connected", properties: {} });
      await tick();
      stream.push(deltaEvent(1));
      stream.push(deltaEvent(2));
      stream.push(deltaEvent(3));
      stream.push({ type: "session.idle", properties: { sessionID: "S1" } });
      await tick();
      // Immediate event crossed; the three deltas are still inside the window.
      expect(harness.forwarded.map((event) => event.type)).toEqual(["session.idle"]);

      harness.bridge.dispose();
      // Dispose flushed the pending batch through the sink (3 merged deltas).
      expect(harness.forwarded.map((event) => event.type)).toEqual([
        "session.idle",
        DELTA_BATCH_EVENT_TYPE,
      ]);
      const parts = batchParts(must(harness.forwarded[1], "batch").payload, "dispose");
      expect(parts.length).toBe(1);
      expect(must(parts[0], "part").delta).toBe("chunk-001 chunk-002 chunk-003 ");

      // No further forwards: timers are dead, the queue is cleared, the
      // session.idle debounce never fires.
      await vi.advanceTimersByTimeAsync(5000);
      await tick();
      expect(harness.forwarded.length).toBe(2);
      expect(harness.invalidations.length).toBe(0);
      expect(harness.attempts).toBe(1);
      expect(harness.losts.length).toBe(0);

      // Prompt exit out of the dangling mid-stream next().
      let settled = false;
      void harness.bridge.stopped.then(() => {
        settled = true;
      });
      await tick();
      expect(settled).toBe(true);

      // Second dispose is a no-op.
      harness.bridge.dispose();
      expect(harness.forwarded.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: real SDK source over the todo-5 mock server.

describe("mock-server integration", () => {
  let server: MockServer | undefined;
  let bridge: EventBridge | undefined;

  afterEach(async () => {
    bridge?.dispose();
    await bridge?.stopped;
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    bridge = undefined;
  });

  function wireRealBridge(): {
    forwarded: ForwardedEvent[];
    invalidations: InvalidateRecord[];
    resyncs: ResyncNotice[];
    losts: ServerLostNotice[];
    channel: CapturingChannel;
    attempts: () => number;
    client: OpencodeClient;
  } {
    const current = must(server, "mock server");
    const forwarded: ForwardedEvent[] = [];
    const invalidations: InvalidateRecord[] = [];
    const resyncs: ResyncNotice[] = [];
    const losts: ServerLostNotice[] = [];
    const channel = new CapturingChannel();
    const client = createOpencodeClient({ baseUrl: current.url });
    const sdkSource = createSdkEventSource(client);
    let attempts = 0;
    bridge = new EventBridge({
      source: (signal) => {
        attempts += 1;
        return sdkSource(signal);
      },
      isServerAlive: () => true,
      sink: (event) => forwarded.push(event),
      invalidate: (kind, sessionId) => invalidations.push({ kind, sessionId }),
      resync: (notice) => resyncs.push(notice),
      serverLost: (notice) => losts.push(notice),
      logger: new PanelLogger(channel, () => true),
      // Real timing: production constants are the subject of this suite.
    });
    return {
      forwarded,
      invalidations,
      resyncs,
      losts,
      channel,
      attempts: () => attempts,
      client,
    };
  }

  async function pushServerConnected(harness: { readonly resyncs: readonly ResyncNotice[] }): Promise<void> {
    const deadline = Date.now() + 3000;
    while (harness.resyncs.length === 0) {
      if (Date.now() > deadline) throw new Error("mock SSE never delivered server.connected");
      must(server, "mock server").pushEvent("server.connected", {});
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  async function createSessionId(client: OpencodeClient): Promise<string> {
    const response = await fetch(`${must(server, "mock server").url}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "eventBridge integration" }),
    });
    const created: unknown = await response.json();
    if (!isRecord(created) || typeof created.id !== "string") {
      throw new Error("mock /session returned no id");
    }
    return created.id;
  }

  it("batches the long-stream scenario deltas end-to-end with a flat post count", async () => {
    server = await startMockServer(0, { scenario: "long-stream" });
    const harness = wireRealBridge();
    must(bridge, "bridge").start();
    await pushServerConnected(harness);
    expect(harness.resyncs).toEqual([{ droppedEventCount: 0 }]);

    const sessionId = await createSessionId(harness.client);
    await fetch(`${must(server, "mock server").url}/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const totalDeltas = (): number =>
      harness.forwarded
        .filter((event) => event.type === DELTA_BATCH_EVENT_TYPE)
        .reduce((sum, event) => sum + batchParts(event.payload, "integration").length, 0);
    const mergedCount = (): number =>
      harness.forwarded
        .filter((event) => event.type === DELTA_BATCH_EVENT_TYPE)
        .reduce(
          (sum, event) =>
            sum + batchParts(event.payload, "integration").reduce((n, part) => n + part.count, 0),
          0,
        );
    await until(() => mergedCount() === 200, "all 200 streamed deltas", 10000);

    const batches = batchEnvelopes(harness.forwarded);
    let text = "";
    for (const [i, envelope] of batches.entries()) {
      for (const part of batchParts(envelope.payload, `envelope ${i}`)) text += part.delta;
    }
    expect(text).toBe(expectedChunkText(200));
    // Pressure stays flat: 200 raw deltas collapsed to a handful of envelopes.
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.length).toBeLessThanOrEqual(30);
    expect(totalDeltas()).toBe(batches.length);

    // Poll invalidation signals fire at the trailing 250ms edge after the
    // last session-scoped event of the stream.
    await until(
      () => harness.invalidations.some((record) => record.kind === "messages"),
      "messages poll-invalidation signal",
      2000,
    );
    // message.updated / session.status crossed the sink individually.
    expect(harness.forwarded.some((event) => event.type === "message.updated")).toBe(true);
  }, 15000);

  it("QA failure: mock SSE closed mid-basic-chat => serverLost within 2s and backoff engaged", async () => {
    server = await startMockServer(0, { scenario: "basic-chat" });
    const harness = wireRealBridge();
    must(bridge, "bridge").start();
    await pushServerConnected(harness);
    expect(harness.resyncs).toEqual([{ droppedEventCount: 0 }]);

    const sessionId = await createSessionId(harness.client);
    const prompt = fetch(`${must(server, "mock server").url}/session/${sessionId}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // The sync /message awaits the full replay; closing the server rejects it.
    prompt.catch(() => undefined);
    await until(
      () => harness.forwarded.some((event) => event.type === DELTA_BATCH_EVENT_TYPE),
      "basic-chat deltas streaming",
      5000,
    );

    const t0 = Date.now();
    await must(server, "mock server").close();
    await until(() => harness.losts.length === 1, "serverLost", 2000);
    const lostMs = Date.now() - t0;
    await until(() => harness.attempts() >= 2, "backoff resubscribe attempt", 2000);
    const retryMs = Date.now() - t0;

    expect(lostMs).toBeLessThan(2000);
    const lost = must(harness.losts[0], "serverLost notice");
    const warnLine = harness.channel.lines.find((line) => line.includes("event stream lost")) ?? "";
    console.log(
      `[task9-qa] mock SSE closed mid-basic-chat: serverLost fired after ${lostMs}ms ` +
        `(reason=${lost.reason}); resubscribe attempt #${harness.attempts()} after ${retryMs}ms; ` +
        `bridge log: ${warnLine}`,
    );
    expect(warnLine).toContain("event stream lost");
    server = undefined; // already closed above; afterEach skips the second close
  }, 15000);
});

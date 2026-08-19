/**
 * MessageSync (todo 13, registry-side) acceptance suite.
 *
 * Runs against scripted {@link FetchMessages} seams (SDK-shaped fixtures
 * mirroring the todo-5 mock `{info, parts}` shape): full sync below the
 * 250 threshold, appended-delta merges above it (append / edit / removal /
 * unkeyed fallback), InvalidateSink routing, the T12 active-session
 * contract, stale-fetch sequencing, and the error path (no event, warn
 * logged).
 */
import { describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import {
  MESSAGE_FULL_SYNC_THRESHOLD,
  MESSAGES_SYNC_EVENT_TYPE,
  MessageSync,
  type FetchMessagesOutcome,
  type MessagesSyncPayload,
} from "../messages.js";

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
  }
}

function makeLogger(): { logger: PanelLogger; channel: CapturingChannel } {
  const channel = new CapturingChannel();
  return { logger: new PanelLogger(channel, () => true), channel };
}

function makeMessage(id: string, text = `${id} text`): unknown {
  return {
    info: { id, sessionID: "ses_1", role: "assistant", time: { created: 1 } },
    parts: [{ id: `${id}_prt`, sessionID: "ses_1", messageID: id, type: "text", text }],
  };
}

function messageRange(count: number, start = 1): unknown[] {
  return Array.from({ length: count }, (_, i) => makeMessage(`msg_${i + start}`));
}

interface ScriptedFetch {
  readonly calls: string[];
  queue: FetchMessagesOutcome[];
  run: (sessionId: string) => Promise<FetchMessagesOutcome>;
}

function scriptedFetch(...outcomes: FetchMessagesOutcome[]): ScriptedFetch {
  const fetch: ScriptedFetch = {
    calls: [],
    queue: [...outcomes],
    run: async (sessionId) => {
      fetch.calls.push(sessionId);
      const next = fetch.queue.shift();
      return next ?? { ok: false, error: new Error("scripted fetch exhausted") };
    },
  };
  return fetch;
}

function ok(messages: readonly unknown[]): FetchMessagesOutcome {
  return { ok: true, messages };
}
function failure(error: unknown): FetchMessagesOutcome {
  return { ok: false, error };
}

interface Harness {
  readonly sync: MessageSync;
  readonly posted: Array<{ type: string; payload: unknown }>;
  readonly channel: CapturingChannel;
  readonly fetch: ScriptedFetch;
}

function harness(...outcomes: FetchMessagesOutcome[]): Harness {
  const fetch = scriptedFetch(...outcomes);
  const { logger, channel } = makeLogger();
  const posted: Array<{ type: string; payload: unknown }> = [];
  const sync = new MessageSync({
    fetchMessages: fetch.run,
    postEvent: (type, payload) => {
      posted.push({ type, payload });
    },
    logger,
  });
  return { sync, posted, channel, fetch };
}

function payloadsOf(posted: Array<{ type: string; payload: unknown }>): MessagesSyncPayload[] {
  return posted
    .filter((entry) => entry.type === MESSAGES_SYNC_EVENT_TYPE)
    .map((entry) => entry.payload as MessagesSyncPayload);
}

describe("MessageSync", () => {
  it("posts a verbatim full sync below the 250-message threshold", async () => {
    const messages = [makeMessage("msg_1"), makeMessage("msg_2")];
    const { sync, posted } = harness(ok(messages));
    await sync.refresh("ses_1");
    expect(payloadsOf(posted)).toEqual([
      { kind: "full", sessionId: "ses_1", messages },
    ]);
  });

  it("routes only messages-kind invalidations, honoring the carried id", async () => {
    const { sync, posted, fetch } = harness(ok([makeMessage("msg_1")]));
    sync.invalidate("sessions", "ses_9");
    sync.invalidate("todos", "ses_9");
    expect(fetch.calls).toEqual([]);
    sync.invalidate("messages", "ses_1");
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch.calls).toEqual(["ses_1"]);
    expect(payloadsOf(posted)).toHaveLength(1);
  });

  it("setActiveSession refetches immediately; bare invalidations reuse it", async () => {
    const { sync, fetch } = harness(ok([]), ok([]));
    sync.setActiveSession("ses_2");
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch.calls).toEqual(["ses_2"]);
    sync.invalidate("messages", undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch.calls).toEqual(["ses_2", "ses_2"]);
  });

  it("adopts the last seen session as the pre-T12 active fallback", async () => {
    const { sync } = harness(ok([]));
    expect(sync.activeSession).toBeUndefined();
    sync.invalidate("messages", "ses_7");
    expect(sync.activeSession).toBe("ses_7");
  });

  it("switches to appended-delta merges once the threshold is crossed", async () => {
    const base = messageRange(MESSAGE_FULL_SYNC_THRESHOLD + 1);
    const appended = [...base, makeMessage("msg_appended")];
    const { sync, posted } = harness(ok(base), ok(appended));
    await sync.refresh("ses_1");
    await sync.refresh("ses_1");
    const [first, second] = payloadsOf(posted);
    expect(first?.kind).toBe("full");
    expect(second).toEqual({
      kind: "delta",
      sessionId: "ses_1",
      upserted: [makeMessage("msg_appended")],
      removed: [],
    });
  });

  it("delta upserts edited messages and reports removed ids", async () => {
    const base = messageRange(MESSAGE_FULL_SYNC_THRESHOLD + 2);
    const edited = base.map((message) => message);
    edited[6] = makeMessage("msg_7", "edited body");
    // Removing index 4 (msg_5) keeps the list above the merge threshold.
    const withoutFifth = edited.filter((_, index) => index !== 4);
    const { sync, posted } = harness(ok(base), ok(withoutFifth));
    await sync.refresh("ses_1");
    await sync.refresh("ses_1");
    const [, second] = payloadsOf(posted);
    expect(second?.kind).toBe("delta");
    if (second?.kind !== "delta") return;
    expect(second.upserted).toEqual([makeMessage("msg_7", "edited body")]);
    expect(second.removed).toEqual(["msg_5"]);
  });

  it("falls back to a full resync when any message lacks info.id", async () => {
    const base = messageRange(MESSAGE_FULL_SYNC_THRESHOLD + 1);
    const withUnkeyed = [...base, { info: { role: "assistant" }, parts: [] }];
    const { sync, posted } = harness(ok(base), ok(withUnkeyed));
    await sync.refresh("ses_1");
    await sync.refresh("ses_1");
    const [, second] = payloadsOf(posted);
    expect(second?.kind).toBe("full");
  });

  it("posts nothing and logs a warning when the fetch fails", async () => {
    const { sync, posted, channel } = harness(failure(new Error("boom")));
    await sync.refresh("ses_1");
    expect(payloadsOf(posted)).toEqual([]);
    expect(channel.joined()).toContain("ses_1");
    expect(channel.joined()).toContain("boom");
  });

  it("only the latest in-flight fetch posts (stale fetch discarded)", async () => {
    let resolveSlow: ((outcome: FetchMessagesOutcome) => void) | undefined;
    const slowFirst = new Promise<FetchMessagesOutcome>((resolve) => {
      resolveSlow = resolve;
    });
    const fast: FetchMessagesOutcome = ok([makeMessage("msg_new")]);
    const { logger } = makeLogger();
    const posted: Array<{ type: string; payload: unknown }> = [];
    const outcomes = [slowFirst, Promise.resolve(fast)];
    const sync = new MessageSync({
      fetchMessages: async () => {
        const next = outcomes.shift();
        return next ?? { ok: false, error: new Error("exhausted") };
      },
      postEvent: (type, payload) => {
        posted.push({ type, payload });
      },
      logger,
    });
    void sync.refresh("ses_1");
    await sync.refresh("ses_1");
    resolveSlow?.(ok([makeMessage("msg_stale")]));
    await slowFirst;
    await Promise.resolve();
    expect(payloadsOf(posted)).toEqual([
      { kind: "full", sessionId: "ses_1", messages: [makeMessage("msg_new")] },
    ]);
  });
});

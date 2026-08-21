/* eslint-disable @typescript-eslint/no-unsafe-argument */
// i18n-allow-literal — test fixtures are wire shapes, not display copy.
/**
 * messageStore sync-path regressions (Sweep A):
 * A1 applyDeltaSync re-sorts with `?? 0`, pinning in-flight placeholders
 *    (info:{} has no `created`) to the FRONT of the list;
 * A2 applyMessageUpdated skips entries whose created is undefined, so a
 *    finalized message appends AFTER a streaming placeholder instead of
 *    taking its server-time slot;
 * A3 a reconnect-replayed delta re-appends text the full sync already
 *    folded in (idempotent-stream guard);
 * A4 session.idle leaves stale inFlight flags on messages whose
 *    message.updated never arrived (aborted/crashed turn).
 */
import { describe, expect, it } from "vitest";

import { MessageStore } from "../messageStore.js";

const SESSION = "ses_1";

function infoMsg(id: string, created: number): Record<string, unknown> {
  return { id, sessionID: SESSION, role: "assistant", time: { created } };
}

function msg(id: string, created: number): Record<string, unknown> {
  return { info: infoMsg(id, created), parts: [] };
}

function msgWithText(id: string, created: number, partID: string, text: string): Record<string, unknown> {
  return {
    info: infoMsg(id, created),
    parts: [
      { id: partID, sessionID: SESSION, messageID: id, type: "text", text, time: { start: created } },
    ],
  };
}

describe("applyDeltaSync ordering (A1)", () => {
  it("never re-sorts an in-flight placeholder to the front", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [msg("msg_1", 1000), msg("msg_2", 1001)]);
    store.applyStreamDelta({
      sessionID: SESSION,
      messageID: "msg_stream",
      partID: "prt_s",
      field: "text",
      delta: "streaming…",
    });
    store.applyDeltaSync(SESSION, [msg("msg_3", 1002)], []);
    const ids = store.getState().messages.map((message) => message.id);
    expect(ids).toEqual(["msg_1", "msg_2", "msg_3", "msg_stream"]);
  });
});

describe("applyMessageUpdated insertion (A2)", () => {
  it("inserts a finalized message at its server-time slot, before the streaming placeholder", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [msg("msg_1", 1001)]);
    store.applyStreamDelta({
      sessionID: SESSION,
      messageID: "msg_stream",
      partID: "prt_s",
      field: "text",
      delta: "streaming…",
    });
    store.applyMessageUpdated({
      info: { id: "msg_9", sessionID: SESSION, role: "assistant", time: { created: 2000 } },
    });
    const ids = store.getState().messages.map((message) => message.id);
    expect(ids).toEqual(["msg_1", "msg_9", "msg_stream"]);
  });
});

describe("reconnect replay idempotence (A3)", () => {
  it("a full-sync-folded delta replayed by SSE does NOT duplicate text", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [msgWithText("msg_1", 1000, "prt_1", "hello")]);
    store.applyStreamDelta({
      sessionID: SESSION,
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: " world",
    });
    // Reconnect: the authoritative snapshot already contains the folded tail.
    store.applyFullSync(SESSION, [msgWithText("msg_1", 1000, "prt_1", "hello world")]);
    // SSE replays the same delta post-replay…
    store.applyStreamDelta({
      sessionID: SESSION,
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: " world",
    });
    const part = store.getState().messages[0]?.parts[0];
    expect(part).toBeDefined();
    expect(part?.kind).toBe("text");
    if (part?.kind === "text") {
      expect(part.text).toBe("hello world");
    }
  });
});

describe("applySessionStatus idle (A4)", () => {
  it("clears stale inFlight flags when the turn goes idle", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, []);
    store.applySessionStatus(SESSION, "busy");
    store.applyStreamDelta({
      sessionID: SESSION,
      messageID: "msg_x",
      partID: "prt_x",
      field: "text",
      delta: "started…",
    });
    expect(store.getState().messages[0]?.inFlight).toBe(true);
    store.applySessionStatus(SESSION, "idle");
    const current = store.getState().messages[0];
    expect(current?.inFlight).toBe(false);
  });
});

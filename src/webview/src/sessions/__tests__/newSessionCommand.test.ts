// i18n-allow-literal — test fixtures/assertions carry literal wire data.
/**
 * New-session command intake suite (FIX-E): the host forwards
 * `opencodeChatSidebar.newSession` as a `command.newSession` event; the webview
 * must create AND select a session through the real SessionsStore (never a
 * parallel path). Uses the todo-3 protocol loopback shape the sessions
 * suites established (real WebviewMessenger + scripted host replies).
 */

import { describe, expect, it } from "vitest";
import { isRecord } from "../../../../shared/protocol.js";
import { WebviewMessenger } from "../../../lib/messenger.js";
import { attachNewSessionCommand, NEW_SESSION_COMMAND_EVENT } from "../newSessionCommand.js";
import { SessionsStore } from "../sessionsStore.js";

function makeLoopback(replyContent: unknown): {
  readonly messenger: WebviewMessenger;
  readonly requests: { readonly type: string; readonly payload: unknown }[];
  readonly fromHost: (message: unknown) => void;
} {
  const requests: { type: string; payload: unknown }[] = [];
  const failures = replyContent instanceof Error;
  let listener: (message: unknown) => void = () => undefined;
  const messenger = new WebviewMessenger({
    postMessage: (message) => {
      if (!isRecord(message) || typeof message.messageId !== "string") return;
      requests.push({ type: String(message.type), payload: message.payload });
      const messageId = message.messageId;
      const envelope = {
        type: "streamChunk",
        payload: {
          messageId,
          status: failures ? "error" : "success",
          done: true,
          content: failures ? String(replyContent.message) : replyContent,
        },
      };
      queueMicrotask(() => {
        listener(envelope);
      });
    },
    onMessage: (registered) => {
      listener = registered;
    },
  });
  return {
    messenger,
    requests,
    fromHost: (message) => {
      listener(message);
    },
  };
}

function commandEvent(type: string): unknown {
  return { type: "event", payload: { type, payload: null } };
}

describe("attachNewSessionCommand", () => {
  it("pins the mirrored host literal", () => {
    expect(NEW_SESSION_COMMAND_EVENT).toBe("command.newSession");
  });

  it("the new-session command routes HOME immediately — no session hits the wire until the first prompt lands", async () => {
    // Given: an attached store with an already-selected session
    const loop = makeLoopback({ id: "ses_old" });
    const store = new SessionsStore({ messenger: loop.messenger });
    store.applySelection("ses_old");
    const detach = attachNewSessionCommand(loop.messenger, store);
    // When: the host forwards the new-session command event
    loop.fromHost(commandEvent("command.newSession"));
    await Promise.resolve();
    // Then: NOTHING crossed the wire — the composer opens as a draft-only
    // chat; the session gets created only when the first prompt dispatches.
    expect(loop.requests).toEqual([]);
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(store.getSnapshot().sessions).toEqual([]);
    detach();
  });

  it("ignores unrelated event types (no request fires)", async () => {
    // Given: an attached store
    const loop = makeLoopback({ id: "ses_x" });
    const store = new SessionsStore({ messenger: loop.messenger });
    const detach = attachNewSessionCommand(loop.messenger, store);
    // When: a different event arrives
    loop.fromHost(commandEvent("sessions.list"));
    await Promise.resolve();
    // Then: nothing was requested
    expect(loop.requests).toEqual([]);
    detach();
  });

});

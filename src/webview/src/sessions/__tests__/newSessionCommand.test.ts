// i18n-allow-literal — test fixtures/assertions carry literal wire data.
/**
 * New-session command intake suite (FIX-E): the host forwards
 * `opencodePanel.newSession` as a `command.newSession` event; the webview
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

  it("creates AND selects a session through the real store on the command event", async () => {
    // Given: an attached store whose host answers createSession with an id
    const loop = makeLoopback({ id: "ses_new" });
    const store = new SessionsStore({ messenger: loop.messenger });
    const detach = attachNewSessionCommand(loop.messenger, store);
    // And: a completion subscription (never a timed poll)
    const selected = new Promise<void>((resolve) => {
      const off = store.subscribe(() => {
        if (store.getSnapshot().selectedId === "ses_new") {
          off();
          resolve();
        }
      });
    });
    // When: the host forwards the new-session command event
    loop.fromHost(commandEvent("command.newSession"));
    // Then: a createSession request crossed the wire and the reply is selected
    await selected;
    expect(loop.requests.map((request) => request.type)).toEqual(["createSession"]);
    expect(store.getSnapshot().sessions.some((session) => session.id === "ses_new")).toBe(true);
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

  it("surfaces a createSession failure via the store's error banner state", async () => {
    // Given: an attached store whose host rejects createSession
    const loop = makeLoopback(new Error("boom"));
    const store = new SessionsStore({ messenger: loop.messenger });
    const detach = attachNewSessionCommand(loop.messenger, store);
    const failed = new Promise<void>((resolve) => {
      const off = store.subscribe(() => {
        if (store.getSnapshot().status === "error") {
          off();
          resolve();
        }
      });
    });
    // When: the command event fires
    loop.fromHost(commandEvent("command.newSession"));
    // Then: the store's error state carries the failure; no selection is made
    await failed;
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(store.getSnapshot().errorMessage).toContain("boom");
    detach();
  });
});

/**
 * Todo-24 (c) permission flow: the mock's `permission-flow` scenario pushes
 * `permission.asked` over SSE; the bridge forwards the card model to the
 * webview; the webview's `answerPermission` reply travels the REAL messenger
 * into the todo-16 handler, which calls the mock's reply endpoint. Evidence:
 * the reply envelope closes success AND the mock emits `permission.replied`
 * (it only settles a pending request when the endpoint is hit).
 */
import * as assert from "node:assert/strict";
import {
  createMockSession,
  type EventMessage,
  focusChatView,
  isEventOfType,
  isTerminalChunkFor,
  postedBaseline,
  sendFromWebview,
  startHarness,
  waitForPosted,
} from "./helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("todo-24 (c) permission flow", () => {
  it("permission.asked card model posts; answerPermission reply settles the mock", async () => {
    // Given the permission-flow scenario and a resolved chat view
    const harness = await startHarness();
    const { chatHooks, mock } = harness;
    assert.ok(mock !== undefined, "mock must be running for the flow");
    await focusChatView(chatHooks);
    mock.setScenario("permission-flow");
    const session = await createMockSession(mock, "t24 permission flow");

    try {
      // When the webview sends the prompt the scenario asks permission for
      const baseline = postedBaseline(chatHooks);
      sendFromWebview(chatHooks, {
        messageId: "t24-perm-prompt",
        type: "sendPrompt",
        payload: { text: "run ls -la", sessionId: session.id, attachments: [] },
      });

      // Then the card model crosses as a forwarded `permission.asked` event
      const askedPosted = await waitForPosted(chatHooks, {
        from: baseline,
        matches: (message): message is EventMessage => isEventOfType(message, "permission.asked"),
        description: "forwarded permission.asked card model",
      });
      const card: unknown = askedPosted.payload.payload;
      assert.ok(isRecord(card), "permission.asked payload must be an object");
      assert.equal(card.sessionID, session.id);
      assert.equal(card.permission, "bash");
      assert.equal(typeof card.id, "string");
      if (typeof card.id !== "string") assert.fail("permission id missing");
      const permissionID: string = card.id;

      // When the webview answers the card through the REAL messenger
      sendFromWebview(chatHooks, {
        messageId: "t24-perm-answer",
        type: "answerPermission",
        payload: { sessionId: session.id, permissionID, response: "once" },
      });

      // Then the host handler's SDK call hit the mock reply endpoint: the
      // terminal envelope closes success (a 404 would surface as status
      // "error") ...
      const reply = await waitForPosted(chatHooks, {
        from: baseline,
        matches: (message) => isTerminalChunkFor(message, "t24-perm-answer"),
        description: "terminal answerPermission envelope",
      });
      assert.equal(reply.payload.status, "success");

      // ... and the mock emits `permission.replied`, which it does ONLY after
      // its pending request settles — direct evidence the endpoint was called.
      const replied = await waitForPosted(chatHooks, {
        from: baseline,
        matches: (message): message is EventMessage => isEventOfType(message, "permission.replied"),
        description: "permission.replied after the settle",
      });
      const settled: unknown = replied.payload.payload;
      assert.ok(isRecord(settled), "permission.replied payload must be an object");
      assert.equal(settled.permissionID, permissionID);
      assert.equal(settled.response, "once");
    } finally {
      mock.setScenario("basic-chat");
    }
  }).timeout(30_000);
});

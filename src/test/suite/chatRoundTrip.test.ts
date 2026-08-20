/**
 * Todo-24 (b) chat round-trip: open the chat view via the real command
 * routing, run the `ready` → `init` handshake, then `sendPrompt` through the
 * REAL messenger and assert, at transport level: the terminal success
 * envelope, streamed `message.part.deltaBatch` events, and the final
 * completed assistant `message.updated` (the "final state") from the mock.
 */
import * as assert from "node:assert/strict";
import type { HostMessage } from "../../shared/protocol.js";
import {
  createMockSession,
  focusChatView,
  isEventOfType,
  isInitPosted,
  isTerminalChunkFor,
  mockBaseUrl,
  MODERN_VERSION,
  postedBaseline,
  sendFromWebview,
  startHarness,
  waitForPosted,
} from "./helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBatchWithText(message: HostMessage): boolean {
  if (!isEventOfType(message, "message.part.deltaBatch")) return false;
  const batch: unknown = message.payload.payload;
  if (!isRecord(batch) || !Array.isArray(batch.parts)) return false;
  return batch.parts.some(
    (part) => isRecord(part) && typeof part.delta === "string" && part.delta.length > 0,
  );
}

function isCompletedAssistantFor(message: HostMessage, sessionId: string): boolean {
  if (!isEventOfType(message, "message.updated")) return false;
  const properties: unknown = message.payload.payload;
  if (!isRecord(properties) || !isRecord(properties.info)) return false;
  const info = properties.info;
  return (
    info.sessionID === sessionId &&
    info.role === "assistant" &&
    info.finish === "stop" &&
    isRecord(info.time) &&
    typeof info.time.completed === "number"
  );
}

describe("todo-24 (b) chat round-trip", () => {
  it("ready → init, then sendPrompt streams deltas and lands in the final state", async () => {
    // Given the activated extension + mock, and a resolved chat view routed
    // through the REAL `opencodePanel.chatView.focus` command
    const harness = await startHarness();
    const { chatHooks, mock } = harness;
    assert.ok(mock !== undefined, "mock must be running for the round-trip");
    await focusChatView(chatHooks);

    // When the webview posts `ready`, the host answers with the init payload
    let baseline = postedBaseline(chatHooks);
    sendFromWebview(chatHooks, { messageId: "t24-ready", type: "ready", payload: {} });
    const initPosted = await waitForPosted(chatHooks, {
      from: baseline,
      matches: isInitPosted,
      description: "init payload answering ready",
    });
    const init = initPosted.payload;
    assert.equal(init.server.url, mockBaseUrl());
    assert.equal(init.server.version, MODERN_VERSION);
    assert.deepEqual(init.capabilities, { fork: true, question: true, todo: true });
    assert.ok(isRecord(init.settings), "init payload carries the settings slice");

    // And a fresh session exists on the mock (loopback, sanctioned seam)
    const session = await createMockSession(mock, "t24 chat round-trip");

    // When the webview posts `sendPrompt` through the REAL messenger dispatch
    baseline = postedBaseline(chatHooks);
    sendFromWebview(chatHooks, {
      messageId: "t24-prompt",
      type: "sendPrompt",
      payload: { text: "round-trip me", sessionId: session.id, attachments: [] },
    });

    // Then the host handler reached the SDK (prompt_async 204): the terminal
    // envelope for the correlator closes with success ...
    const terminal = await waitForPosted(chatHooks, {
      from: baseline,
      matches: (message) => isTerminalChunkFor(message, "t24-prompt"),
      description: "terminal sendPrompt envelope",
    });
    assert.equal(terminal.payload.status, "success");
    assert.equal(terminal.payload.done, true);

    // ... the mock's streamed reply arrives as bridge-batched delta events ...
    await waitForPosted(chatHooks, {
      from: baseline,
      matches: isBatchWithText,
      description: "streamed message.part.deltaBatch with text",
    });

    // ... and the conversation lands in its final state (completed assistant).
    await waitForPosted(chatHooks, {
      from: baseline,
      matches: (message) => isCompletedAssistantFor(message, session.id),
      description: "completed assistant message.updated (final state)",
    });
  }).timeout(30_000);
});

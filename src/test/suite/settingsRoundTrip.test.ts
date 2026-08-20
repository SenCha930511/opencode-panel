/**
 * Todo-24 (d) settings round-trip: the webview's `setSettings` message writes
 * the configuration through the todo-21 handlers; the reply envelope IS the
 * webview notification (post-write snapshot + /global/health of the applied
 * endpoint per the documented wire contract). The sandbox profile keeps the
 * developer's real settings untouched; the test still restores the key.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  focusChatView,
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

const SECTION = "opencodePanel";
const FIELD = "chatFontSize";

describe("todo-24 (d) settings round-trip", () => {
  it("setSettings writes config and the reply envelope notifies the webview", async () => {
    // Given a resolved chat view and the key's current value
    const harness = await startHarness();
    const { chatHooks } = harness;
    await focusChatView(chatHooks);
    const original = vscode.workspace.getConfiguration(SECTION).get<number>(FIELD) ?? 0;
    const replacement = original === 15 ? 16 : 15;

    try {
      // When the webview posts a settings patch through the REAL messenger
      // (todo-21 boundary contract: { values: { <shortKey>: value } })
      const baseline = postedBaseline(chatHooks);
      sendFromWebview(chatHooks, {
        messageId: "t24-settings",
        type: "setSettings",
        payload: { patch: { values: { [FIELD]: replacement } } },
      });

      // Then the envelope closes success, carrying the notification snapshot
      const reply = await waitForPosted(chatHooks, {
        from: baseline,
        matches: (message) => isTerminalChunkFor(message, "t24-settings"),
        description: "terminal setSettings envelope",
      });
      assert.equal(reply.payload.status, "success");
      const content: unknown = reply.payload.content;
      assert.ok(isRecord(content), "setSettings reply must be an object snapshot");
      assert.equal(content.ok, true);
      assert.ok(isRecord(content.values), "reply carries the post-write values");
      assert.equal(content.values[FIELD], replacement);
      // ... with a fresh probe of the applied endpoint riding the same reply
      assert.ok(isRecord(content.serverHealth), "reply carries the health probe");
      assert.equal(content.serverHealth.status, "ok");
      assert.equal(content.serverHealth.url, mockBaseUrl());
      assert.equal(content.serverHealth.version, MODERN_VERSION);
      // ... and the written configuration is readable through the host API
      assert.equal(
        vscode.workspace.getConfiguration(SECTION).get<number>(FIELD),
        replacement,
        "configuration write did not land",
      );
    } finally {
      // Restore the sandbox profile (disposable anyway — belt and braces).
      await vscode.workspace
        .getConfiguration(SECTION)
        .update(FIELD, original, vscode.ConfigurationTarget.Global);
    }
  }).timeout(30_000);
});

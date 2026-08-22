/**
 * Todo-24 (a) activation: the extension activates under the env seam, the
 * ServerManager ATTACHES to the suite's pre-started mock on the fixed port,
 * and the status-bar projection renders `attached`.
 *
 * QA failure mode: with OPENCODE_CHAT_SIDEBAR_TEST_SKIP_MOCK set (dead port),
 * startHarness/waitForAttached short-circuits on the manager's error state —
 * a clean, immediate attach failure, never a >30s hang.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  mockBaseUrl,
  startHarness,
  statusBarText,
  testPort,
  waitForAttached,
} from "./helpers.js";

describe("todo-24 (a) activation & attach", () => {
  it("activates, attaches the manager to the mock, and the status bar shows attached", async () => {
    // Given the pre-started mock on the fixed port (started by startHarness)
    // When the extension host activates the extension (env seam fires start())
    const harness = await startHarness();
    // Then the manager reaches `attached` at the mock base URL ...
    const state = await waitForAttached(harness.api.manager);
    if (state.kind !== "attached") {
      assert.fail(`expected attached state, got ${state.kind}`);
    }
    assert.equal(state.baseUrl, mockBaseUrl());
    // ... and the status bar projection is the attached rendering (`$(plug)`,
    // blue, foreign-server port suffix) — the exact string the item shows.
    assert.equal(statusBarText(state), `$(plug) OpenCode:${testPort()}`);
    // ... and the extension is live in the host with its commands routable.
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("opencodeChatSidebar.startServer"),
      "manifest command opencodeChatSidebar.startServer not registered",
    );
  }).timeout(30_000);
});

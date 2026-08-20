/**
 * Todo-24 (e) old-server guards: with the mock restarted on the same port
 * pinned at OLD_SERVER_VERSION, re-attaching posts an init refresh whose
 * capabilities alias the probed absence of fork/question/todo — the exact
 * bits the webview uses to hide the guarded controls. The same-port cold
 * restart (plus a detector invalidate) guarantees a FRESH capability probe
 * instead of the cached per-baseUrl result from the modern scenario.
 */
import * as assert from "node:assert/strict";
import {
  focusChatView,
  isInitPosted,
  mockBaseUrl,
  OLD_SERVER_VERSION,
  postedBaseline,
  restartMock,
  startHarness,
  waitForPosted,
} from "./helpers.js";

describe("todo-24 (e) old-server guarded controls", () => {
  it("posted init capabilities hide fork/question/todo on a pinned old server", async () => {
    // Given the modern attach (from startHarness) and a resolved chat view
    const harness = await startHarness();
    const { chatHooks, api } = harness;
    await focusChatView(chatHooks);
    const baseline = postedBaseline(chatHooks);

    // When the same port reopens as a pinned OLD server and the manager
    // re-attaches (detached foreign first — the mock is never killed)
    await restartMock(harness, "old-server");
    api.manager.detector.invalidate(mockBaseUrl());
    await api.manager.stop();
    const start = await api.manager.start();
    if (!start.ok) {
      assert.fail(`re-attach to the restarted old-server mock failed: ${start.error.message}`);
    }

    // Then the init refresh posted on the attached transition reflects the
    // OLD server: version pinned, and every guarded-control bit false.
    const initPosted = await waitForPosted(chatHooks, {
      from: baseline,
      matches: isInitPosted,
      description: "init refresh on the old-server attach",
    });
    const init = initPosted.payload;
    assert.equal(init.server.url, mockBaseUrl());
    assert.equal(init.server.version, OLD_SERVER_VERSION);
    assert.deepEqual(init.capabilities, { fork: false, question: false, todo: false });
  }).timeout(30_000);

  after(async () => {
    // Last suite file (execution order is pinned in ./index.ts): park the mock.
    const harness = await startHarness();
    if (harness.mock !== undefined) {
      await harness.mock.close();
      harness.mock = undefined;
    }
  });
});

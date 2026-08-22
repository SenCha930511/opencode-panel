/**
 * Plan W2 (T2b) config-file round trip: the webview's `configFileRead` /
 * `configFileWrite` messages drive the W1 host handlers through the REAL
 * per-view messenger (the same harness seam as the todo-24 (d) settings
 * round trip), end to end against real bytes on disk.
 *
 * Every file touch is confined to the sandboxed OPENCODE_CHAT_SIDEBAR_TEST_HOME
 * (created + exported by src/test/runTest.ts and honored by the W1
 * registration in src/extension.ts): fixtures seed
 * `<test-home>/.config/opencode/opencode.json` (with a comment + an unknown
 * key) and `<test-home>/.omo/omo.jsonc` (with a comment). The developer's
 * real config tree is never read or written — the `testHome()` guard fails
 * the suite loudly when the env seam is missing.
 */
import * as assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConfigFileReadPayload,
  ConfigFileWritePayload,
} from "../../shared/protocol.js";
import type { DevProviderTestHooks } from "../../providers/baseViewProvider.js";
import {
  focusChatView,
  isTerminalChunkFor,
  postedBaseline,
  sendFromWebview,
  startHarness,
  waitForPosted,
  type Harness,
  type StreamChunkMessage,
} from "./helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The suite runs INSIDE the extension host, so the env var runTest.ts
 * injected through `extensionTestsEnv` is directly visible here — and the
 * editable zone is asserted to live under `.vscode-test/` before any write.
 */
function testHome(): string {
  const home = process.env.OPENCODE_CHAT_SIDEBAR_TEST_HOME;
  assert.ok(
    home !== undefined && home.includes(".vscode-test"),
    "OPENCODE_CHAT_SIDEBAR_TEST_HOME must point under .vscode-test/sandbox " +
      "(src/test/runTest.ts exports it into the extension host)",
  );
  return home;
}

const OPENCODE_FIXTURE = [
  "{",
  '  "$schema": "https://opencode.ai/config.json",',
  "  // round-trip fixture comment — must survive every write",
  '  "model": "fixture-old-model",',
  '  "totallyUnknownFixtureKey": {',
  '    "nested": true',
  "  }",
  "}",
  "",
].join("\n");

const OMO_FIXTURE = [
  "{",
  "  // omo fixture comment — must survive the round trip",
  '  "opencode": {',
  '    "mode": "fixture-mode"',
  "  }",
  "}",
  "",
].join("\n");

type ConfigFileEnvelope = { readonly messageId: string } & (
  | { readonly type: "configFileRead"; readonly payload: ConfigFileReadPayload }
  | { readonly type: "configFileWrite"; readonly payload: ConfigFileWritePayload }
);

/** Post one config-file request and await its terminal messenger envelope. */
async function terminalReply(
  chatHooks: DevProviderTestHooks,
  envelope: ConfigFileEnvelope,
): Promise<StreamChunkMessage> {
  const baseline = postedBaseline(chatHooks);
  sendFromWebview(chatHooks, envelope);
  return waitForPosted(chatHooks, {
    from: baseline,
    matches: (message) => isTerminalChunkFor(message, envelope.messageId),
    description: `terminal ${envelope.type} reply for ${envelope.messageId}`,
  });
}

describe("plan W2 (T2b) config-file round-trip", () => {
  const opencodePath = (): string => join(testHome(), ".config", "opencode", "opencode.json");
  const omoPath = (): string => join(testHome(), ".omo", "omo.jsonc");

  before(async () => {
    // Given seeded fixture configs in the sandbox test-home, mode 0o600.
    const home = testHome();
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await writeFile(opencodePath(), OPENCODE_FIXTURE, "utf8");
    await chmod(opencodePath(), 0o600);
    await mkdir(join(home, ".omo"), { recursive: true });
    await writeFile(omoPath(), OMO_FIXTURE, "utf8");
    await chmod(omoPath(), 0o600);
  });

  after(async () => {
    // The sandbox is disposable; still leave the test-home pristine.
    const home = testHome();
    await rm(join(home, ".config"), { recursive: true, force: true });
    await rm(join(home, ".omo"), { recursive: true, force: true });
  });

  it("opencode.json: read → guarded write → stale-mtime rejection → force write", async () => {
    const harness = await startHarness();
    const { chatHooks } = harness;
    await focusChatView(chatHooks);
    const filePath = opencodePath();

    // When the webview reads the global opencode slot through the messenger
    const read = await terminalReply(chatHooks, {
      messageId: "t2b-read-opencode",
      type: "configFileRead",
      payload: { file: "opencode", scope: "global" },
    });

    // Then the envelope closes success with the seeded bytes and stat
    assert.equal(read.payload.status, "success");
    assert.ok(isRecord(read.payload.content), "read reply must be an object");
    assert.equal(read.payload.content.path, filePath);
    assert.equal(read.payload.content.exists, true);
    assert.equal(read.payload.content.rawText, OPENCODE_FIXTURE);
    assert.equal(read.payload.content.parseError, null);
    const readMtime = read.payload.content.mtimeMs;
    assert.ok(typeof readMtime === "number" && readMtime > 0, "read reply carries a real mtime");

    // When the webview writes an edited text guarded by that mtime
    const edited = OPENCODE_FIXTURE.replace(
      '"model": "fixture-old-model"',
      '"model": "fixture-new-model"',
    );
    assert.notEqual(edited, OPENCODE_FIXTURE, "fixture splice must change the text");
    const write = await terminalReply(chatHooks, {
      messageId: "t2b-write-opencode-1",
      type: "configFileWrite",
      payload: { file: "opencode", scope: "global", rawText: edited, expectedMtimeMs: readMtime },
    });

    // Then the write lands: ONLY the edited span changed (comment + unknown
    // key preserved by byte equality), .bak holds the previous bytes, and
    // the 0o600 mode survived.
    assert.equal(write.payload.status, "success");
    assert.ok(isRecord(write.payload.content), "write reply must be an object");
    assert.equal(write.payload.content.backupPath, `${filePath}.bak`);
    assert.ok(
      typeof write.payload.content.mtimeMs === "number" && write.payload.content.mtimeMs > 0,
      "write reply carries the fresh mtime",
    );
    assert.equal(await readFile(filePath, "utf8"), edited, "disk bytes match the edited text");
    assert.equal(await readFile(`${filePath}.bak`, "utf8"), OPENCODE_FIXTURE, ".bak holds previous bytes");
    assert.equal((await stat(filePath)).mode & 0o777, 0o600, "file mode 0o600 preserved");

    // When a second write arrives with the now-STALE read mtime
    const staleEdit = edited.replace("fixture-new-model", "fixture-stale-model");
    const stale = await terminalReply(chatHooks, {
      messageId: "t2b-write-opencode-stale",
      type: "configFileWrite",
      payload: { file: "opencode", scope: "global", rawText: staleEdit, expectedMtimeMs: readMtime },
    });

    // Then the host refuses with the mtime-mismatch code and the disk is untouched
    assert.equal(stale.payload.status, "error");
    assert.ok(typeof stale.payload.content === "string", "error reply content is a string");
    assert.ok(
      stale.payload.content.includes("mtime-mismatch"),
      `error reply must carry the mtime-mismatch code, got: ${stale.payload.content}`,
    );
    assert.equal(await readFile(filePath, "utf8"), edited, "rejected write left disk untouched");

    // When the webview retries WITHOUT expectedMtimeMs (force)
    const forcedEdit = edited.replace("fixture-new-model", "fixture-final-model");
    const forced = await terminalReply(chatHooks, {
      messageId: "t2b-write-opencode-force",
      type: "configFileWrite",
      payload: { file: "opencode", scope: "global", rawText: forcedEdit },
    });

    // Then the write lands and the backup rotates to the previous bytes
    assert.equal(forced.payload.status, "success");
    assert.equal(await readFile(filePath, "utf8"), forcedEdit, "forced write landed");
    assert.equal(await readFile(`${filePath}.bak`, "utf8"), edited, ".bak rotated to previous bytes");
  }).timeout(30_000);

  it("omo.jsonc: read → guarded write round-trip through the .omo candidate", async () => {
    const harness = await startHarness();
    const { chatHooks } = harness;
    await focusChatView(chatHooks);
    const filePath = omoPath();

    // When the webview reads the global omo slot
    const read = await terminalReply(chatHooks, {
      messageId: "t2b-read-omo",
      type: "configFileRead",
      payload: { file: "omo", scope: "global" },
    });

    // Then the .omo/omo.jsonc candidate resolves with the seeded bytes
    assert.equal(read.payload.status, "success");
    assert.ok(isRecord(read.payload.content), "read reply must be an object");
    assert.equal(read.payload.content.path, filePath);
    assert.equal(read.payload.content.exists, true);
    assert.equal(read.payload.content.rawText, OMO_FIXTURE);
    assert.equal(read.payload.content.parseError, null);
    const readMtime = read.payload.content.mtimeMs;
    assert.ok(typeof readMtime === "number" && readMtime > 0, "read reply carries a real mtime");

    // When the webview writes an edited text guarded by that mtime
    const edited = OMO_FIXTURE.replace('"mode": "fixture-mode"', '"mode": "fixture-mode-edited"');
    assert.notEqual(edited, OMO_FIXTURE, "fixture splice must change the text");
    const write = await terminalReply(chatHooks, {
      messageId: "t2b-write-omo-1",
      type: "configFileWrite",
      payload: { file: "omo", scope: "global", rawText: edited, expectedMtimeMs: readMtime },
    });

    // Then the write lands with the comment byte-preserved and backup rotated
    assert.equal(write.payload.status, "success");
    assert.ok(isRecord(write.payload.content), "write reply must be an object");
    assert.equal(write.payload.content.backupPath, `${filePath}.bak`);
    assert.equal(await readFile(filePath, "utf8"), edited, "disk bytes match the edited text");
    assert.equal(await readFile(`${filePath}.bak`, "utf8"), OMO_FIXTURE, ".bak holds previous bytes");
    assert.equal((await stat(filePath)).mode & 0o777, 0o600, "file mode 0o600 preserved");
  }).timeout(30_000);
});

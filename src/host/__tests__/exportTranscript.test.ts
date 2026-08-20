/**
 * Export-transcript acceptance suite (plan todo 19, host side): the flow runs
 * against the todo-5 mock server for data (title + messages from real
 * `client.session.*` calls — nothing fabricated) while ALL I/O rides the
 * injected seams: an in-memory {@link ExportFs}, a stub {@link SaveDialog},
 * and a fixed {@link Clock} so filenames are deterministic.
 *
 * Asserts: the write contains the role sections and part payloads; the
 * defaultUri points into `<workspace>/.opencode-exports/`; cancel and
 * no-session are distinct outcomes, never errors; a write failure is the
 * typed ExportTranscriptError; the command factory maps outcomes onto
 * info/error notifications without throwing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../logger.js";
import { PanelSecrets, type SecretStorage } from "../secrets.js";
import { createPanelClient } from "../../server/clientFactory.js";
import type { ServerConnection } from "../../server/ServerManager.js";
import type { Capabilities } from "../../server/capabilities.js";
import { startMockServer, type MockServer } from "../../test/mock-server/index.js";
import { staticSessionSource } from "../handlers/sessions.js";
import {
  createExportTranscriptCommand,
  exportFileName,
  exportTranscript,
  ExportTranscriptError,
  type ExportFs,
  type ExportTranscriptDeps,
  type ExportTranscriptOutcome,
} from "../exportTranscript.js";

// ---------------------------------------------------------------------------
// Test seams.

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
}

class EmptySecrets implements SecretStorage {
  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

const FAKE_CAPABILITIES: Capabilities = {
  version: "0.0.0-test",
  hasFork: true,
  hasQuestion: true,
  hasTodo: true,
  hasShell: true,
  agents: [],
  commands: [],
  mcpNative: [],
  omoDetected: false,
  omoMcpNote: false,
};

function connectionFor(url: string): ServerConnection {
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
  });
  return {
    baseUrl: panel.baseUrl,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: FAKE_CAPABILITIES,
  };
}

/** In-memory ExportFs: files map + recorded mkdirs; optional write failure. */
class MemFs implements ExportFs {
  readonly files = new Map<string, string>();
  readonly mkdirs: string[] = [];
  failWrites = false;

  mkdir(path: string): Promise<void> {
    this.mkdirs.push(path);
    return Promise.resolve();
  }
  writeFile(path: string, contents: string): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error("disk full"));
    this.files.set(path, contents);
    return Promise.resolve();
  }
}

class StubDialog {
  readonly seenDefaults: Array<string | undefined> = [];
  next: string | undefined = "/ws/.opencode-exports/out.md";
  show(defaultUri: string | undefined): Promise<string | undefined> {
    this.seenDefaults.push(defaultUri);
    return Promise.resolve(this.next);
  }
}

const FIXED_NOW = 1_788_052_400_000; // 2026-08-30T01:13:20.000Z

interface Rig {
  readonly deps: ExportTranscriptDeps;
  readonly fs: MemFs;
  readonly dialog: StubDialog;
  readonly client: ServerConnection["client"];
}

function rig(url: string): Rig {
  const connection = connectionFor(url);
  const fs = new MemFs();
  const dialog = new StubDialog();
  const logger = new PanelLogger(new CapturingChannel(), () => false);
  const deps: ExportTranscriptDeps = {
    source: staticSessionSource(connection),
    logger,
    fs,
    dialog,
    workspaceFolder: () => "/ws",
    clock: { now: () => FIXED_NOW },
  };
  return { deps, fs, dialog, client: connection.client };
}

/** Seed one session with real messages through the mock /command route. */
async function seedSession(client: ServerConnection["client"], title: string): Promise<string> {
  const created = await client.session.create({ body: { title } });
  if (created.error !== undefined || created.data === undefined) throw new Error("seed: create");
  const id = created.data.id;
  const ran = await client.session.command({
    path: { id },
    body: { command: "help", arguments: "" },
  });
  if (ran.error !== undefined) throw new Error("seed: command");
  return id;
}

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

describe("exportFileName", () => {
  it("sanitizes the id and stamps the injected clock", () => {
    expect(exportFileName("ses_01/ABC", FIXED_NOW)).toBe("session-ses_01-ABC-20260830-011320.md");
  });
});

describe("exportTranscript", () => {
  it("writes markdown built from real session.messages with role sections", async () => {
    mock = await startMockServer(0);
    const { deps, fs, dialog, client } = rig(mock.url);
    const id = await seedSession(client, "Export me");

    dialog.next = `/ws/.opencode-exports/${exportFileName(id, FIXED_NOW)}`;
    const outcome = await exportTranscript(deps, { sessionId: id });
    const path = dialog.next;
    if (path === undefined) throw new Error("dialog not consulted");

    expect(outcome).toEqual({ kind: "exported", path });
    const written = fs.files.get(path);
    expect(written).toBeDefined();
    if (written === undefined) throw new Error("no file written");
    expect(written).toContain("# Export me");
    expect(written).toContain(`- Session: \`${id}\``);
    expect(written).toContain("- Exported: 2026-08-30T01:13:20.000Z");
    expect(written).toContain("- Messages: 2");
    expect(written).toContain("## User");
    expect(written).toContain("## Assistant");
    expect(written).toContain("ran /help (mock)");
    expect(written.endsWith("\n")).toBe(true);
    expect(fs.mkdirs).toContain("/ws/.opencode-exports");
  });

  it("proposes a defaultUri inside <workspace>/.opencode-exports/", async () => {
    mock = await startMockServer(0);
    const { deps, dialog, client } = rig(mock.url);
    const id = await seedSession(client, "default location");

    const outcome = await exportTranscript(deps, { sessionId: id });
    expect(outcome.kind).toBe("exported");
    const proposed = dialog.seenDefaults[0];
    expect(proposed).toBe(`/ws/.opencode-exports/${exportFileName(id, FIXED_NOW)}`);
  });

  it("resolves the default target to the most recently-updated session", async () => {
    mock = await startMockServer(0);
    const { deps, fs, dialog, client } = rig(mock.url);
    await seedSession(client, "older");
    // The mock stamps time.updated with Date.now(); space the seeds so the
    // recency ordering the test asserts is unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = await seedSession(client, "latest");

    const outcome = await exportTranscript(deps, {});
    expect(outcome.kind).toBe("exported");
    const path = dialog.next;
    if (path === undefined) throw new Error("dialog not consulted");
    const written = fs.files.get(path);
    if (written === undefined) throw new Error("no file written");
    expect(written).toContain("# latest");
    expect(written).toContain(`- Session: \`${latest}\``);
  });

  it("cancel is its own outcome and writes nothing", async () => {
    mock = await startMockServer(0);
    const { deps, fs, dialog, client } = rig(mock.url);
    const id = await seedSession(client, "cancelled export");

    dialog.next = undefined;
    const outcome = await exportTranscript(deps, { sessionId: id });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(fs.files.size).toBe(0);
    expect(fs.mkdirs.length).toBe(0);
  });

  it("an empty server is the no-session outcome, not an error", async () => {
    mock = await startMockServer(0);
    const { deps, dialog } = rig(mock.url);
    const outcome: ExportTranscriptOutcome = await exportTranscript(deps, {});
    expect(outcome).toEqual({ kind: "no-session" });
    expect(dialog.seenDefaults.length).toBe(0);
  });

  it("a write failure is the typed ExportTranscriptError naming the step", async () => {
    mock = await startMockServer(0);
    const { deps, fs, client } = rig(mock.url);
    const id = await seedSession(client, "write failure");
    fs.failWrites = true;
    await expect(exportTranscript(deps, { sessionId: id })).rejects.toBeInstanceOf(
      ExportTranscriptError,
    );
    await expect(exportTranscript(deps, { sessionId: id })).rejects.toMatchObject({
      step: "write",
    });
  });
});

describe("createExportTranscriptCommand", () => {
  it("maps outcomes onto info/error notifications and parses raw args", async () => {
    const calls: Array<{ readonly level: "info" | "error"; readonly message: string }> = [];
    const seenArgs: unknown[] = [];
    const outcomes: ExportTranscriptOutcome[] = [
      { kind: "exported", path: "/ws/out.md" },
      { kind: "no-session" },
      { kind: "cancelled" },
    ];
    const command = createExportTranscriptCommand({
      run: (args) => {
        seenArgs.push(args);
        return Promise.resolve(outcomes[seenArgs.length - 1] ?? { kind: "cancelled" });
      },
      info: (message) => calls.push({ level: "info", message }),
      error: (message) => calls.push({ level: "error", message }),
    });

    await command({ sessionId: "ses_1" });
    expect(seenArgs[0]).toEqual({ sessionId: "ses_1" });
    expect(calls[0]).toEqual({
      level: "info",
      message: "OpenCode Panel: session transcript exported to /ws/out.md",
    });

    await command(); // no-session -> honest info
    expect(seenArgs[1]).toEqual({});
    expect(calls[1]?.message).toContain("no session");

    await command({ unrelated: true }); // cancelled -> silent
    expect(calls.length).toBe(2);
  });

  it("a thrown export becomes one error notification carrying the detail", async () => {
    const errors: string[] = [];
    const command = createExportTranscriptCommand({
      run: () => Promise.reject(new ExportTranscriptError("messages", "offline")),
      info: () => undefined,
      error: (message) => errors.push(message),
    });
    await command({ sessionId: "ses_1" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("export transcript failed at messages: offline");
  });
});

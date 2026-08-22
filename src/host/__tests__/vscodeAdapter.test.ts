/**
 * Wiring specs for ../vscode-adapter.ts against the in-test vscode stub
 * (vitest resolve.alias). Asserts what each factory DELEGATES and MAPS —
 * deep behavior of the wrapped pure modules lives in their own suites.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { ExtensionContext } from "vscode";
import {
  createNodeSpawner,
  createVscodeConfigAccessor,
  createVscodeDockSurface,
  createVscodeEditorAccess,
  createVscodeLogger,
  createVscodeSecrets,
  createVscodeServerManager,
  createVscodeSettingsSurface,
} from "../vscode-adapter.js";
import type { SecretStorage } from "../secrets.js";
import { DiffDocumentStore } from "../handlers/dock.js";
import { ServerManager } from "../../server/serverManager.js";
import {
  configFor,
  emitConfigChange,
  resetVscodeStub,
  seedConfig,
  setActiveTextEditor,
  vscodeStubRegistry,
  type FakeTextEditor,
} from "./vscodeStub";

class MapSecretStorage implements SecretStorage {
  readonly entries = new Map<string, string>();
  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.entries.get(key));
  }
  store(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

function fakeContext(): { context: ExtensionContext; storage: MapSecretStorage } {
  const storage = new MapSecretStorage();
  // Test seam: only `secrets` is ever read from the context by the factory.
  return { context: { secrets: storage } as unknown as ExtensionContext, storage };
}

function fileEditor(scheme = "file"): FakeTextEditor {
  return {
    selection: { start: { line: 3 }, end: { line: 5 } },
    document: {
      uri: { scheme, fsPath: "/repo/file.ts" },
      languageId: "typescript",
      getText: () => "selected text",
    },
  };
}

beforeEach(() => {
  resetVscodeStub();
});

describe("createVscodeConfigAccessor", () => {
  it("reads through workspace.getConfiguration of the opencodeChatSidebar section", () => {
    const accessor = createVscodeConfigAccessor();
    seedConfig("opencodeChatSidebar").values.set("port", 7777);
    expect(accessor.read().port).toBe(7777);
    expect(vscodeStubRegistry.configSections).toContain("opencodeChatSidebar");
  });

  it("waves workspace change events through the section filter", () => {
    const accessor = createVscodeConfigAccessor();
    const seen: number[] = [];
    accessor.onDidChange((next) => seen.push(next.port));
    seedConfig("opencodeChatSidebar").values.set("port", 5000);
    emitConfigChange({ affectsConfiguration: (section) => section === "opencodeChatSidebar" });
    emitConfigChange({ affectsConfiguration: () => false });
    expect(seen).toEqual([5000]);
  });
});

describe("createVscodeSecrets", () => {
  it("delegates to the context SecretStorage, keyed per server URL", async () => {
    const { context, storage } = fakeContext();
    const secrets = createVscodeSecrets(context);
    const url = "http://127.0.0.1:4096";
    await secrets.setPassword(url, "hunter2");
    await secrets.setUsername(url, "bob");
    expect(await secrets.getPassword(url)).toBe("hunter2");
    expect(await secrets.getUsername(url)).toBe("bob");
    const keys = [...storage.entries.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.startsWith("opencodeChatSidebar.auth."))).toBe(true);
    await secrets.deletePassword(url);
    expect(await secrets.getPassword(url)).toBeUndefined();
    expect([...storage.entries.keys()]).toHaveLength(1);
  });
});

describe("createVscodeSettingsSurface", () => {
  it("maps the user layer to ConfigurationTarget.Global", async () => {
    const surface = createVscodeSettingsSurface();
    await surface.update("port", 5000, "global");
    const updates = configFor("opencodeChatSidebar").updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ key: "port", value: 5000 });
    expect(updates[0]?.target).not.toBe(2);
  });

  it("maps the workspace layer to ConfigurationTarget.Workspace", async () => {
    const surface = createVscodeSettingsSurface();
    await surface.update("chatFontSize", 14, "workspace");
    expect(configFor("opencodeChatSidebar").updates[0]).toMatchObject({
      key: "chatFontSize",
      value: 14,
      target: 2,
    });
  });

  it("passes inspect through, reporting the recorded layers", () => {
    const surface = createVscodeSettingsSurface();
    seedConfig("opencodeChatSidebar").layers.set("hostname", { globalValue: "127.0.0.1", workspaceValue: "0.0.0.0" });
    expect(surface.inspect("hostname")).toEqual({ globalValue: "127.0.0.1", workspaceValue: "0.0.0.0" });
    expect(surface.inspect("unsetKey")).toBeUndefined();
  });
});

describe("createVscodeLogger", () => {
  it("writes redacted lines to the Chat Sidebar for OpenCode output channel", () => {
    const { logger, channel } = createVscodeLogger(() => false);
    logger.info("listening password=hunter2 on 4096");
    expect(channel.name).toBe("Chat Sidebar for OpenCode");
    expect(vscodeStubRegistry.outputChannels).toContain(channel);
    // The returned channel mirrors the recorded fake (typed as vscode.OutputChannel).
    const recorded = vscodeStubRegistry.outputChannels[0];
    expect(recorded?.lines).toHaveLength(1);
    expect(recorded?.lines[0]).toContain("password=<redacted>");
    expect(recorded?.lines[0]).not.toContain("hunter2");
  });
});

describe("createNodeSpawner (real node child processes)", () => {
  it("pipes stdout to listeners and resolves exited with code 0", async () => {
    const spawner = createNodeSpawner();
    const child = spawner(process.execPath, ["-e", "process.stdout.write('ok-out')"], {
      cwd: undefined,
      env: { ...process.env },
    });
    const stdout: string[] = [];
    child.onStdout((chunk) => stdout.push(chunk));
    const exit = await child.exited;
    expect(exit.code).toBe(0);
    expect(stdout.join("")).toContain("ok-out");
    expect(typeof child.pid).toBe("number");
  });

  it("resolves spawnFailed with code ENOENT for a missing binary", async () => {
    const spawner = createNodeSpawner();
    const child = spawner("definitely-not-a-real-binary-opencode-panel", ["serve"], {
      cwd: undefined,
      env: {},
    });
    const failure = await child.spawnFailed;
    expect(failure.code).toBe("ENOENT");
    expect(failure.message).toContain("definitely-not-a-real-binary-opencode-panel");
  });

  it("kill(SIGTERM) terminates the child and settles exited", async () => {
    const spawner = createNodeSpawner();
    const child = spawner(process.execPath, ["-e", "setInterval(() => {}, 50)"], {
      cwd: undefined,
      env: { ...process.env },
    });
    expect(child.kill("SIGTERM")).toBe(true);
    const exit = await child.exited;
    if (process.platform === "win32") {
      expect(exit.code !== null || exit.signal !== null).toBe(true);
    } else {
      expect(exit.signal).toBe("SIGTERM");
      expect(exit.code).toBeNull();
    }
  });
});

describe("createVscodeEditorAccess", () => {
  it("snapshots the active editor selection for file-scheme documents", () => {
    setActiveTextEditor(fileEditor());
    const snapshot = createVscodeEditorAccess().selection();
    expect(snapshot).toEqual({
      path: "/repo/file.ts",
      language: "typescript",
      startLine: 3,
      endLine: 5,
      text: "selected text",
    });
  });

  it("reports no selection for untitled/notebook editors and for no editor", () => {
    const access = createVscodeEditorAccess();
    expect(access.selection()).toBeUndefined();
    setActiveTextEditor(fileEditor("untitled"));
    expect(access.selection()).toBeUndefined();
  });

  it("resolves filePath from a Uri-shaped context arg, honoring scheme", () => {
    const access = createVscodeEditorAccess();
    expect(access.filePath({ scheme: "file", fsPath: "/picked/x.ts" })).toBe("/picked/x.ts");
    expect(access.filePath({ scheme: "untitled", fsPath: "/picked/x.ts" })).toBeUndefined();
  });

  it("falls back to the active file editor when no context arg is given", () => {
    const access = createVscodeEditorAccess();
    setActiveTextEditor(fileEditor());
    expect(access.filePath()).toBe("/repo/file.ts");
    setActiveTextEditor(fileEditor("untitled"));
    expect(access.filePath()).toBeUndefined();
  });

  it("escapes glob meta in workspaceFindFiles queries and maps fsPaths", async () => {
    vscodeStubRegistry.findFilesResult = [
      { scheme: "file", fsPath: "/repo/a.ts" },
      { scheme: "file", fsPath: "/repo/b.ts" },
    ];
    const access = createVscodeEditorAccess();
    const found = await access.workspaceFindFiles("a[b}*c");
    expect(found).toEqual(["/repo/a.ts", "/repo/b.ts"]);
    const call = vscodeStubRegistry.findFilesCalls[0];
    expect(call?.pattern).toBe("**/*a\\[b\\}c*");
  });

  it("never calls findFiles for an all-meta (empty-after-strip) query", async () => {
    const access = createVscodeEditorAccess();
    expect(await access.workspaceFindFiles("***")).toEqual([]);
    expect(vscodeStubRegistry.findFilesCalls).toHaveLength(0);
  });
});

describe("createVscodeServerManager", () => {
  it("composes a stopped ServerManager over the injected host deps", () => {
    const { context } = fakeContext();
    const manager = createVscodeServerManager({
      config: createVscodeConfigAccessor(),
      secrets: createVscodeSecrets(context),
      logger: createVscodeLogger(() => false).logger,
    });
    expect(manager).toBeInstanceOf(ServerManager);
    expect(manager.state.kind).toBe("stopped");
    expect(manager.baseUrl).toBeUndefined();
    expect(manager.detector).toBeDefined();
  });
});

describe("createVscodeDockSurface", () => {
  it("wires the store, content provider, renderer and opener together", () => {
    const surface = createVscodeDockSurface();
    expect(surface.store).toBeInstanceOf(DiffDocumentStore);
    expect(typeof surface.contentProvider.provideTextDocumentContent).toBe("function");
    expect(surface.renderer).toBeDefined();
    expect(surface.opener).toBeDefined();
  });
});

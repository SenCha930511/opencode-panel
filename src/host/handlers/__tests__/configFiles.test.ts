import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_ERROR_CODES,
  type FromWebviewProtocol,
} from "../../../shared/protocol.js";
import type { Handler } from "../../messenger.js";
import type { RegisterHandler } from "../sessions.js";
import { PanelLogger } from "../../logger.js";
import {
  ConfigFileError,
  createConfigFileHandlers,
  registerConfigFileHandlers,
  type ConfigFileHandlersDeps,
} from "../configFiles.js";
import type {
  ConfigFilesEnv,
  ConfigFilesFs,
  ConfigFileStat,
} from "../../configFiles.js";

/**
 * Config-file domain handlers (plan W1): hand-rolled payload validation
 * (mirroring ./settingsValidation.ts), the stable `[code]` error prefix
 * contract, success reply shapes, legacy-notice rules, no-workspace and IO
 * propagation. No vscode module anywhere; the fs seam is an in-memory fake.
 */

const HOME = "/home/test";
const WORKSPACE = "/work/test";

const GLOBAL_OPENCODE_PRIMARY = join(HOME, ".config", "opencode", "opencode.json");
const GLOBAL_OMO_PRIMARY = join(HOME, ".omo", "omo.jsonc");
const LEGACY_OMO = join(HOME, ".config", "opencode", "oh-my-openagent.json");

interface FakeEntry {
  content: string;
  mode: number;
  mtimeMs: number;
}

type FsMethod = "exists" | "stat" | "readFile" | "writeFile" | "rename" | "copyFile" | "mkdir" | "chmod" | "delete";

class FakeConfigFilesFs implements ConfigFilesFs {
  readonly files = new Map<string, FakeEntry>();
  readonly dirs = new Set<string>();
  /** When set, the named method rejects with this error (IO fault injection). */
  failOn: Partial<Record<FsMethod, Error>> = {};
  nowMs = 42_000;

  constructor(roots: readonly string[]) {
    for (const root of roots) this.dirs.add(root);
  }

  seed(path: string, content: string, options?: { readonly mode?: number; readonly mtimeMs?: number }): void {
    this.dirs.add(dirname(path));
    this.files.set(path, {
      content,
      mode: options?.mode ?? 0o644,
      mtimeMs: options?.mtimeMs ?? 1_000,
    });
  }

  private maybeFail(method: FsMethod): void {
    const failure = this.failOn[method];
    if (failure !== undefined) throw failure;
  }

  async exists(path: string): Promise<boolean> {
    this.maybeFail("exists");
    return this.files.has(path);
  }

  async stat(path: string): Promise<ConfigFileStat> {
    this.maybeFail("stat");
    const entry = this.files.get(path);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    return { mtimeMs: entry.mtimeMs, mode: entry.mode };
  }

  async readFile(path: string): Promise<string> {
    this.maybeFail("readFile");
    const entry = this.files.get(path);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return entry.content;
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.maybeFail("writeFile");
    const existing = this.files.get(path);
    this.files.set(path, {
      content: data,
      mode: existing?.mode ?? 0o666,
      mtimeMs: this.nowMs,
    });
  }

  async rename(from: string, to: string): Promise<void> {
    this.maybeFail("rename");
    const entry = this.files.get(from);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, rename '${from}'`);
    this.files.set(to, entry);
    this.files.delete(from);
  }

  async copyFile(from: string, to: string): Promise<void> {
    this.maybeFail("copyFile");
    const entry = this.files.get(from);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, copyfile '${from}'`);
    this.files.set(to, { ...entry });
  }

  async mkdir(path: string): Promise<void> {
    this.maybeFail("mkdir");
    this.dirs.add(path);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.maybeFail("chmod");
    const entry = this.files.get(path);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
    entry.mode = mode;
  }

  async delete(path: string): Promise<void> {
    this.maybeFail("delete");
    this.files.delete(path);
  }
}

const silentLogger = new PanelLogger({ appendLine: () => {} }, () => false);

function makeHarness(options?: { readonly workspace?: string | undefined }): {
  readonly fs: FakeConfigFilesFs;
  readonly deps: ConfigFileHandlersDeps;
  readonly handlers: ReturnType<typeof createConfigFileHandlers>;
} {
  const workspace = options !== undefined && "workspace" in options ? options.workspace : WORKSPACE;
  const fs = new FakeConfigFilesFs([HOME, WORKSPACE]);
  const env: ConfigFilesEnv = { homeDir: HOME, workspaceFolder: () => workspace };
  const deps: ConfigFileHandlersDeps = { env, fs, logger: silentLogger };
  return { fs, deps, handlers: createConfigFileHandlers(deps) };
}

describe("CONFIG_FILE_ERROR_CODES", () => {
  it("matches the pinned taxonomy order", () => {
    expect(CONFIG_FILE_ERROR_CODES).toEqual(["parse", "mtime-mismatch", "no-workspace", "io", "invalid-payload"]);
  });
});

describe("configFileRead payload validation", () => {
  const invalid: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined payload", undefined],
    ["non-object payload", "opencode"],
    ["missing file and scope", {}],
    ["unknown file", { file: "npm", scope: "global" }],
    ["unknown scope", { file: "omo", scope: "user" }],
  ];

  for (const [label, payload] of invalid) {
    it(`rejects ${label} with [invalid-payload]`, async () => {
      const { handlers } = makeHarness();
      await expect(handlers.configFileRead(payload)).rejects.toThrowError(/\[invalid-payload\]/);
    });
  }
});

describe("configFileRead", () => {
  it("answers the pinned missing-file reply shape", async () => {
    // Given nothing on disk
    const { handlers } = makeHarness();
    // When the global opencode slot is read
    const reply = await handlers.configFileRead({ file: "opencode", scope: "global" });
    // Then the reply carries the pinned fields verbatim
    expect(reply).toEqual({
      path: GLOBAL_OPENCODE_PRIMARY,
      exists: false,
      rawText: "",
      mtimeMs: 0,
      parseError: null,
      legacyNoticePath: null,
    });
  });

  it("answers the file bytes and mtime for an existing parseable file", async () => {
    // Given a parseable file at the primary candidate
    const { fs, handlers } = makeHarness();
    const rawText = '{\n  // note\n  "model": "m1"\n}\n';
    fs.seed(GLOBAL_OPENCODE_PRIMARY, rawText, { mtimeMs: 9_000 });
    // When it is read
    const reply = await handlers.configFileRead({ file: "opencode", scope: "global" });
    // Then bytes and mtime echo through with a null parse error
    expect(reply).toEqual({
      path: GLOBAL_OPENCODE_PRIMARY,
      exists: true,
      rawText,
      mtimeMs: 9_000,
      parseError: null,
      legacyNoticePath: null,
    });
  });

  it("answers with parseError set for unparseable content", async () => {
    // Given an unparseable file
    const { fs, handlers } = makeHarness();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, '{ "a": }');
    // When it is read
    const reply = await handlers.configFileRead({ file: "opencode", scope: "global" });
    // Then the read succeeds with a machine-stable parse code
    expect(reply.exists).toBe(true);
    expect(reply.parseError).toContain("ValueExpected");
  });

  it("carries legacyNoticePath only for omo global with both candidates missing and legacy present", async () => {
    // Given both omo global candidates missing and a legacy file present
    const { fs, handlers } = makeHarness();
    fs.seed(LEGACY_OMO, "{}");
    // When the omo global slot is read
    const reply = await handlers.configFileRead({ file: "omo", scope: "global" });
    // Then the legacy absolute path is attached for the migrated-notice UI
    expect(reply.exists).toBe(false);
    expect(reply.legacyNoticePath).toBe(LEGACY_OMO);
  });

  it("omits legacyNoticePath when no legacy file exists", async () => {
    const { handlers } = makeHarness();
    const reply = await handlers.configFileRead({ file: "omo", scope: "global" });
    expect(reply.legacyNoticePath).toBeNull();
  });

  it("omits legacyNoticePath when a real omo candidate exists even if legacy exists", async () => {
    // Given the primary omo file AND the legacy file both exist
    const { fs, handlers } = makeHarness();
    fs.seed(GLOBAL_OMO_PRIMARY, "{}");
    fs.seed(LEGACY_OMO, "{}");
    // When the omo global slot is read
    const reply = await handlers.configFileRead({ file: "omo", scope: "global" });
    // Then no notice is shown (the legacy file is display-only, never a target)
    expect(reply.exists).toBe(true);
    expect(reply.legacyNoticePath).toBeNull();
  });

  it("throws [no-workspace] for project scope without a workspace folder", async () => {
    const { handlers } = makeHarness({ workspace: undefined });
    await expect(handlers.configFileRead({ file: "opencode", scope: "project" })).rejects.toThrowError(
      /\[no-workspace\]/,
    );
  });

  it("converts fs failures to [io] without leaking file contents", async () => {
    // Given an existing file whose read fails at the IO layer
    const { fs, handlers } = makeHarness();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, '{"secret": "DO-NOT-LEAK"}');
    fs.failOn.readFile = new Error(`EACCES: permission denied, open '${GLOBAL_OPENCODE_PRIMARY}'`);
    // When the read is attempted
    const pending = handlers.configFileRead({ file: "opencode", scope: "global" });
    // Then the failure carries the io code and never the file bytes
    await expect(pending).rejects.toThrowError(/\[io\]/);
    await expect(pending).rejects.toThrowError(/EACCES/);
    try {
      await pending;
    } catch (error) {
      expect(String(error)).not.toContain("DO-NOT-LEAK");
    }
  });
});

describe("configFileWrite payload validation", () => {
  const invalid: ReadonlyArray<readonly [string, unknown]> = [
    ["missing rawText", { file: "opencode", scope: "global" }],
    ["non-string rawText", { file: "opencode", scope: "global", rawText: 42 }],
    ["non-number expectedMtimeMs", { file: "opencode", scope: "global", rawText: "{}", expectedMtimeMs: "5" }],
    ["NaN expectedMtimeMs", { file: "opencode", scope: "global", rawText: "{}", expectedMtimeMs: Number.NaN }],
    ["Infinity expectedMtimeMs", { file: "opencode", scope: "global", rawText: "{}", expectedMtimeMs: Number.POSITIVE_INFINITY }],
  ];

  for (const [label, payload] of invalid) {
    it(`rejects ${label} with [invalid-payload]`, async () => {
      const { handlers } = makeHarness();
      await expect(handlers.configFileWrite(payload)).rejects.toThrowError(/\[invalid-payload\]/);
    });
  }
});

describe("configFileWrite", () => {
  it("writes a new file and answers {mtimeMs, backupPath:null}", async () => {
    // Given nothing on disk
    const { fs, handlers } = makeHarness();
    // When a create-write lands
    const reply = await handlers.configFileWrite({ file: "opencode", scope: "global", rawText: "{}" });
    // Then the reply carries the fresh mtime and no backup, and the bytes hit the disk
    expect(reply).toEqual({ mtimeMs: fs.nowMs, backupPath: null });
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe("{}");
  });

  it("writes back to the candidate a previous read resolved to", async () => {
    // Given only the fallback candidate exists
    const { fs, handlers } = makeHarness();
    const fallback = join(HOME, ".config", "opencode", "config.json");
    fs.seed(fallback, "v1", { mtimeMs: 5_000 });
    // When a write lands with the fallback's mtime
    const reply = await handlers.configFileWrite({
      file: "opencode",
      scope: "global",
      rawText: "v2",
      expectedMtimeMs: 5_000,
    });
    // Then the write targeted the read path, not the primary
    expect(fs.files.get(fallback)?.content).toBe("v2");
    expect(fs.files.has(GLOBAL_OPENCODE_PRIMARY)).toBe(false);
    expect(reply.backupPath).toBe(`${fallback}.bak`);
  });

  it("rejects unparseable rawText with [parse] and writes nothing", async () => {
    const { fs, handlers } = makeHarness();
    await expect(
      handlers.configFileWrite({ file: "opencode", scope: "global", rawText: '{ "a": }' }),
    ).rejects.toThrowError(/\[parse\]/);
    expect(fs.files.size).toBe(0);
  });

  it("rejects a stale expectedMtimeMs with [mtime-mismatch]", async () => {
    // Given an existing file whose mtime moved past the client's expectation
    const { fs, handlers } = makeHarness();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 5_000 });
    // When a write with a stale expectation lands
    await expect(
      handlers.configFileWrite({
        file: "opencode",
        scope: "global",
        rawText: "v2",
        expectedMtimeMs: 4_000,
      }),
    ).rejects.toThrowError(/\[mtime-mismatch\]/);
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe("v1");
  });

  it("throws [no-workspace] for project scope without a workspace folder", async () => {
    const { handlers } = makeHarness({ workspace: undefined });
    await expect(
      handlers.configFileWrite({ file: "omo", scope: "project", rawText: "{}" }),
    ).rejects.toThrowError(/\[no-workspace\]/);
  });

  it("converts fs failures mid-write to [io]", async () => {
    // Given an existing file and an IO fault at backup time
    const { fs, handlers } = makeHarness();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 5_000 });
    fs.failOn.copyFile = new Error("EIO: i/o error");
    // When the write is attempted
    await expect(
      handlers.configFileWrite({
        file: "opencode",
        scope: "global",
        rawText: "v2",
        expectedMtimeMs: 5_000,
      }),
    ).rejects.toThrowError(/\[io\]/);
  });
});

describe("registerConfigFileHandlers", () => {
  it("registers exactly the two config-file message types", () => {
    const { deps } = makeHarness();
    const registered: string[] = [];
    const register: RegisterHandler = <K extends keyof FromWebviewProtocol>(
      type: K,
      _handler: Handler<K>,
    ): void => {
      registered.push(type);
    };
    registerConfigFileHandlers(register, deps);
    expect(registered).toEqual(["configFileRead", "configFileWrite"]);
  });
});

describe("ConfigFileError re-export", () => {
  it("is the host core class with the stable prefix contract", () => {
    const error = new ConfigFileError("io", "disk broke");
    expect(error.message).toBe("[io] disk broke");
    expect(error.name).toBe("ConfigFileError");
  });
});

import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigFileError,
  createNodeConfigFilesFs,
  detectLegacyOmo,
  firstExistingPath,
  readConfigFile,
  resolveReadCandidates,
  resolveWriteTarget,
  writeConfigFile,
  type ConfigFilesEnv,
  type ConfigFilesFs,
  type ConfigFileStat,
  type ConfigPathList,
} from "../configFiles.js";

/**
 * Host config-file IO core (plan W1): pinned read-candidate order, write-target
 * rules, parse rejection, the ±1ms mtime guard, .bak rotation, mode
 * preserve/0o600, tmp+rename atomicity, mkdir -p, and legacy omo detection —
 * all over an in-memory {@link ConfigFilesFs} (no disk, no vscode).
 */

const HOME = "/home/test";
const WORKSPACE = "/work/test";

interface MemoryEntry {
  content: string;
  mode: number;
  mtimeMs: number;
}

class MemoryConfigFilesFs implements ConfigFilesFs {
  readonly files = new Map<string, MemoryEntry>();
  readonly dirs = new Set<string>();
  readonly mkdirCalls: string[] = [];
  readonly copyCalls: Array<{ readonly from: string; readonly to: string }> = [];
  readonly renameCalls: Array<{ readonly from: string; readonly to: string }> = [];
  readonly chmodCalls: Array<{ readonly path: string; readonly mode: number }> = [];
  /** mtime every write gets; tests set it so expectations come from the input. */
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

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<ConfigFileStat> {
    const entry = this.mustGet(path);
    return { mtimeMs: entry.mtimeMs, mode: entry.mode };
  }

  async readFile(path: string): Promise<string> {
    return this.mustGet(path).content;
  }

  async writeFile(path: string, data: string): Promise<void> {
    if (!this.dirs.has(dirname(path))) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    const existing = this.files.get(path);
    this.files.set(path, {
      content: data,
      mode: existing?.mode ?? 0o666,
      mtimeMs: this.nowMs,
    });
  }

  async rename(from: string, to: string): Promise<void> {
    const entry = this.files.get(from);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, rename '${from}'`);
    this.renameCalls.push({ from, to });
    this.files.set(to, entry);
    this.files.delete(from);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const entry = this.files.get(from);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, copyfile '${from}'`);
    this.copyCalls.push({ from, to });
    this.files.set(to, { ...entry });
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    this.dirs.add(path);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const entry = this.mustGet(path);
    this.chmodCalls.push({ path, mode });
    entry.mode = mode;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  private mustGet(path: string): MemoryEntry {
    const entry = this.files.get(path);
    if (entry === undefined) throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    return entry;
  }
}

const env = (workspaceFolder: () => string | undefined = () => WORKSPACE): ConfigFilesEnv => ({
  homeDir: HOME,
  workspaceFolder,
});

const GLOBAL_OPENCODE_PRIMARY = join(HOME, ".config", "opencode", "opencode.json");
const GLOBAL_OMO_PRIMARY = join(HOME, ".omo", "omo.jsonc");

function makeFs(): MemoryConfigFilesFs {
  return new MemoryConfigFilesFs([HOME, WORKSPACE]);
}

describe("resolveReadCandidates", () => {
  it("lists the three global opencode fallbacks in pinned order", () => {
    const candidates = resolveReadCandidates("opencode", "global", env());
    expect(candidates).toEqual([
      join(HOME, ".config", "opencode", "opencode.json"),
      join(HOME, ".config", "opencode", "config.json"),
      join(HOME, ".opencode", "config.json"),
    ]);
  });

  it("lists the two global omo fallbacks in pinned order", () => {
    const candidates = resolveReadCandidates("omo", "global", env());
    expect(candidates).toEqual([join(HOME, ".omo", "omo.jsonc"), join(HOME, ".omo", "omo.json")]);
  });

  it("targets the workspace file for project scope", () => {
    expect(resolveReadCandidates("opencode", "project", env())).toEqual([join(WORKSPACE, "opencode.json")]);
    expect(resolveReadCandidates("omo", "project", env())).toEqual([join(WORKSPACE, ".omo", "omo.jsonc")]);
  });

  it("throws [no-workspace] for project scope without a workspace folder", () => {
    expect(() => resolveReadCandidates("opencode", "project", env(() => undefined))).toThrowError(
      /\[no-workspace\]/,
    );
    expect(() => resolveReadCandidates("omo", "project", env(() => undefined))).toThrowError(/\[no-workspace\]/);
  });
});

describe("resolveWriteTarget", () => {
  it("writes back to the path a read came from", () => {
    const readPath = join(HOME, ".config", "opencode", "config.json");
    expect(resolveWriteTarget("opencode", "global", env(), readPath)).toBe(readPath);
  });

  it("falls back to the first read candidate when nothing was read", () => {
    expect(resolveWriteTarget("opencode", "global", env(), null)).toBe(GLOBAL_OPENCODE_PRIMARY);
    expect(resolveWriteTarget("omo", "global", env(), null)).toBe(GLOBAL_OMO_PRIMARY);
    expect(resolveWriteTarget("opencode", "project", env(), null)).toBe(join(WORKSPACE, "opencode.json"));
    expect(resolveWriteTarget("omo", "project", env(), null)).toBe(join(WORKSPACE, ".omo", "omo.jsonc"));
  });
});

describe("readConfigFile", () => {
  it("reports a pinned missing-file reply aimed at the default create target", async () => {
    // Given no candidate exists on disk
    const fs = makeFs();
    const candidates = resolveReadCandidates("opencode", "global", env());
    // When the file is read
    const result = await readConfigFile(candidates, fs);
    // Then the reply aims at the default create target with zeroed metadata
    expect(result).toEqual({
      path: GLOBAL_OPENCODE_PRIMARY,
      exists: false,
      rawText: "",
      mtimeMs: 0,
      parseError: null,
    });
    // And the default path matches the write-target rule
    expect(result.path).toBe(resolveWriteTarget("opencode", "global", env(), null));
  });

  it("reads the first existing candidate when several exist", async () => {
    // Given two candidates exist with different content
    const fs = makeFs();
    const candidates = resolveReadCandidates("opencode", "global", env());
    fs.seed(GLOBAL_OPENCODE_PRIMARY, '{"source": "primary"}', { mtimeMs: 7_500 });
    fs.seed(join(HOME, ".config", "opencode", "config.json"), '{"source": "fallback"}');
    // When the file is read
    const result = await readConfigFile(candidates, fs);
    // Then the primary wins with its bytes and mtime
    expect(result.path).toBe(GLOBAL_OPENCODE_PRIMARY);
    expect(result.exists).toBe(true);
    expect(result.rawText).toBe('{"source": "primary"}');
    expect(result.mtimeMs).toBe(7_500);
    expect(result.parseError).toBeNull();
  });

  it("falls back to a later candidate when the earlier ones are missing", async () => {
    // Given only the third candidate exists
    const fs = makeFs();
    const legacyPath = join(HOME, ".opencode", "config.json");
    fs.seed(legacyPath, '{"source": "legacy"}');
    // When the file is read
    const candidates = resolveReadCandidates("opencode", "global", env());
    const result = await readConfigFile(candidates, fs);
    // Then the fallback is the read path
    expect(result.path).toBe(legacyPath);
    expect(result.exists).toBe(true);
    expect(result.rawText).toBe('{"source": "legacy"}');
  });

  it("succeeds with parseError set for unparseable content", async () => {
    // Given an existing but unparseable file
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, '{ "a": }');
    // When the file is read
    const result = await readConfigFile(resolveReadCandidates("opencode", "global", env()), fs);
    // Then the read succeeds and carries a machine-stable parse code
    expect(result.exists).toBe(true);
    expect(result.parseError).toContain("ValueExpected");
  });
});

describe("firstExistingPath", () => {
  it("returns null when nothing exists and the hit path otherwise", async () => {
    const fs = makeFs();
    const candidates = resolveReadCandidates("omo", "global", env());
    expect(await firstExistingPath(candidates, fs)).toBeNull();
    const fallback = join(HOME, ".omo", "omo.json");
    fs.seed(fallback, "{}");
    expect(await firstExistingPath(candidates, fs)).toBe(fallback);
  });
});

describe("writeConfigFile", () => {
  it("rejects unparseable text with [parse] before touching the disk", async () => {
    // Given unparseable text
    const fs = makeFs();
    // When a write is attempted
    const pending = writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{ "a": }', undefined, fs);
    // Then it rejects with the parse code and nothing was written or created
    await expect(pending).rejects.toThrowError(/\[parse\]/);
    expect(fs.files.size).toBe(0);
    expect(fs.mkdirCalls).toEqual([]);
  });

  it("creates a new file with mkdir -p, exact bytes, 0o600, and no backup", async () => {
    // Given a missing target under a missing parent directory
    const fs = makeFs();
    const rawText = '{\n  // stays verbatim\n  "model": "m1"\n}\n';
    // When the file is written
    const result = await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, rawText, undefined, fs);
    // Then the parent was created, the bytes are exact, and the mode is 0o600
    expect(fs.mkdirCalls).toEqual([dirname(GLOBAL_OPENCODE_PRIMARY)]);
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe(rawText);
    expect(fs.chmodCalls).toEqual([{ path: GLOBAL_OPENCODE_PRIMARY, mode: 0o600 }]);
    expect(result.backupPath).toBeNull();
    expect(result.mtimeMs).toBe(fs.nowMs);
  });

  it("creates missing nested parents for a project omo write", async () => {
    // Given a project omo target whose .omo directory does not exist
    const fs = makeFs();
    const target = join(WORKSPACE, ".omo", "omo.jsonc");
    // When the file is written
    await writeConfigFile(target, "{}", undefined, fs);
    // Then mkdir -p created the directory and the file landed
    expect(fs.mkdirCalls).toEqual([join(WORKSPACE, ".omo")]);
    expect(fs.files.get(target)?.content).toBe("{}");
  });

  it("writes through a tmp file renamed over the target (atomic write)", async () => {
    // Given any write
    const fs = makeFs();
    // When it completes
    await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, "{}", undefined, fs);
    // Then exactly one rename happened, from a unique tmp sibling to the target
    expect(fs.renameCalls).toHaveLength(1);
    const rename = fs.renameCalls[0];
    expect(rename?.to).toBe(GLOBAL_OPENCODE_PRIMARY);
    expect(rename?.from).toMatch(
      /^\/home\/test\/\.config\/opencode\/opencode\.json\.opencode-panel-\d+-[a-z0-9]+\.tmp$/,
    );
    // And no tmp file is left behind
    const leftovers = [...fs.files.keys()].filter((path) => path.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("rotates the previous content to <path>.bak and preserves the old mode", async () => {
    // Given an existing file with a distinctive mode
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, '{"old": true}', { mode: 0o640, mtimeMs: 5_000 });
    // When it is rewritten with the matching mtime
    const result = await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"new": true}', 5_000, fs);
    // Then the backup holds the previous bytes and the old mode was restored
    expect(result.backupPath).toBe(`${GLOBAL_OPENCODE_PRIMARY}.bak`);
    expect(fs.files.get(`${GLOBAL_OPENCODE_PRIMARY}.bak`)?.content).toBe('{"old": true}');
    expect(fs.chmodCalls).toEqual([{ path: GLOBAL_OPENCODE_PRIMARY, mode: 0o640 }]);
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe('{"new": true}');
    expect(result.mtimeMs).toBe(fs.nowMs);
  });

  it("overwrites an existing .bak on the next rotation", async () => {
    // Given a file that has already been written once (bak holds v1)
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 5_000 });
    await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"v": 2}', 5_000, fs);
    // When it is written again with the fresh mtime
    const stat = await fs.stat(GLOBAL_OPENCODE_PRIMARY);
    await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"v": 3}', stat.mtimeMs, fs);
    // Then the backup now holds v2
    expect(fs.files.get(`${GLOBAL_OPENCODE_PRIMARY}.bak`)?.content).toBe('{"v": 2}');
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe('{"v": 3}');
  });

  it("accepts an mtime within the 1ms guard epsilon", async () => {
    // Given an existing file whose mtime is 1ms off the expectation
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 5_000 });
    // When a write arrives within the epsilon
    const result = await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"v": 2}', 5_001, fs);
    // Then it goes through
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe('{"v": 2}');
    expect(result.backupPath).toBe(`${GLOBAL_OPENCODE_PRIMARY}.bak`);
  });

  it("rejects a stale mtime beyond the epsilon without writing or rotating", async () => {
    // Given an existing file whose mtime drifted 2ms past the expectation
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 5_000 });
    // When a write arrives with the stale expectation
    const pending = writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"v": 2}', 5_002, fs);
    // Then it rejects with the conflict code and nothing changed on disk
    await expect(pending).rejects.toThrowError(/\[mtime-mismatch\]/);
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe("v1");
    expect(fs.copyCalls).toEqual([]);
    expect(fs.renameCalls).toEqual([]);
    expect(fs.files.has(`${GLOBAL_OPENCODE_PRIMARY}.bak`)).toBe(false);
  });

  it("skips the mtime guard when no expectation is given (force)", async () => {
    // Given an existing file with an arbitrary mtime
    const fs = makeFs();
    fs.seed(GLOBAL_OPENCODE_PRIMARY, "v1", { mtimeMs: 999_999 });
    // When a force write arrives
    await writeConfigFile(GLOBAL_OPENCODE_PRIMARY, '{"v": 2}', undefined, fs);
    // Then it goes through and still rotates the backup
    expect(fs.files.get(GLOBAL_OPENCODE_PRIMARY)?.content).toBe('{"v": 2}');
    expect(fs.files.get(`${GLOBAL_OPENCODE_PRIMARY}.bak`)?.content).toBe("v1");
  });
});

describe("detectLegacyOmo", () => {
  const LEGACY = join(HOME, ".config", "opencode", "oh-my-openagent.json");

  it("returns the absolute legacy path when the legacy file exists", async () => {
    const fs = makeFs();
    fs.seed(LEGACY, "{}");
    expect(await detectLegacyOmo(env(), fs)).toBe(LEGACY);
  });

  it("returns null when no legacy file exists", async () => {
    const fs = makeFs();
    expect(await detectLegacyOmo(env(), fs)).toBeNull();
  });
});

describe("createNodeConfigFilesFs", () => {
  it("exposes the full seam", () => {
    const fs = createNodeConfigFilesFs();
    for (const method of [
      "exists",
      "stat",
      "readFile",
      "writeFile",
      "rename",
      "copyFile",
      "mkdir",
      "chmod",
      "delete",
    ] as const) {
      expect(typeof fs[method]).toBe("function");
    }
  });
});

describe("ConfigFileError", () => {
  it("formats the message with a stable [code] prefix", () => {
    const error = new ConfigFileError("parse", "cannot parse");
    expect(error.message).toBe("[parse] cannot parse");
    expect(error.name).toBe("ConfigFileError");
    expect(error.code).toBe("parse");
  });
});

// Type-level pin: the exported candidates list is a non-empty tuple so
// `candidates[0]` is always a string.
const _pinnedTuple: ConfigPathList = resolveReadCandidates("omo", "global", env());
void _pinnedTuple;

/**
 * Host config-file IO core (plan W1): an in-memory-testable {@link ConfigFilesFs}
 * seam over `node:fs/promises`, plus the pure rules the handlers compose:
 *
 * - {@link resolveReadCandidates}: pinned per-slot read order (global opencode
 *   3-way fallback, global omo 2-way fallback, single project paths).
 * - {@link resolveWriteTarget}: write back where a read came from, else the
 *   first read candidate (the default create target).
 * - {@link readConfigFile}: first existing candidate wins; missing files get
 *   a zeroed reply aimed at the default create target; unparseable content
 *   still reads successfully with `parseError` set (never a thrown request).
 * - {@link writeConfigFile}: parse-reject first, `mkdir -p`, mtime guard with
 *   1ms epsilon, `<path>.bak` rotation, fsync'd tmp + rename atomic write,
 *   mode preserved on rewrite / 0o600 on create.
 * - {@link detectLegacyOmo}: legacy `oh-my-openagent.json` notice path —
 *   display-only, NEVER a read or write target.
 *
 * Coded failures throw {@link ConfigFileError} whose message starts with a
 * stable `[<code>]` prefix (the webview pattern-matches the prefix). IO
 * failures from the seam propagate raw; the handler boundary converts them
 * to `[io]`. Nothing in this module ever logs or surfaces file CONTENTS —
 * error details carry codes, paths, and mtimes only.
 */

import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ConfigFileErrorCode,
  ConfigFileId,
  ConfigFileWriteReply,
  ConfigScope,
} from "../shared/protocol.js";
import { parseJsonc } from "../shared/configJsonc.js";

export class ConfigFileError extends Error {
  readonly code: ConfigFileErrorCode;

  constructor(code: ConfigFileErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = "ConfigFileError";
    this.code = code;
  }
}

export interface ConfigFilesEnv {
  readonly homeDir: string;
  readonly workspaceFolder: () => string | undefined;
}

export interface ConfigFileStat {
  readonly mtimeMs: number;
  /** Permission bits only (node impl masks to 0o777). */
  readonly mode: number;
}

/** Disk primitive seam; production = {@link createNodeConfigFilesFs}. */
export interface ConfigFilesFs {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<ConfigFileStat>;
  readFile(path: string): Promise<string>;
  /** Writes utf8 bytes durably (fsync before close in the node impl). */
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Recursive (`mkdir -p` semantics). */
  mkdir(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Missing paths are not an error (rm --force semantics). */
  delete(path: string): Promise<void>;
}

/** Non-empty candidate list; `[0]` is the default create target. */
export type ConfigPathList = readonly [string, ...string[]];

export interface ConfigFileReadResult {
  readonly path: string;
  readonly exists: boolean;
  readonly rawText: string;
  readonly mtimeMs: number;
  readonly parseError: string | null;
}

function requireWorkspace(env: ConfigFilesEnv): string {
  const folder = env.workspaceFolder();
  if (folder === undefined) {
    throw new ConfigFileError("no-workspace", "project scope requires an open workspace folder");
  }
  return folder;
}

const READ_RESOLVERS: Readonly<Record<`${ConfigFileId}:${ConfigScope}`, (env: ConfigFilesEnv) => ConfigPathList>> = {
  "opencode:global": (env) => [
    join(env.homeDir, ".config", "opencode", "opencode.json"),
    join(env.homeDir, ".config", "opencode", "config.json"),
    join(env.homeDir, ".opencode", "config.json"),
  ],
  "opencode:project": (env) => [join(requireWorkspace(env), "opencode.json")],
  "omo:global": (env) => [
    join(env.homeDir, ".omo", "omo.jsonc"),
    join(env.homeDir, ".omo", "omo.json"),
  ],
  "omo:project": (env) => [join(requireWorkspace(env), ".omo", "omo.jsonc")],
};

export function resolveReadCandidates(
  file: ConfigFileId,
  scope: ConfigScope,
  env: ConfigFilesEnv,
): ConfigPathList {
  return READ_RESOLVERS[`${file}:${scope}`](env);
}

export function resolveWriteTarget(
  file: ConfigFileId,
  scope: ConfigScope,
  env: ConfigFilesEnv,
  readPath: string | null,
): string {
  if (readPath !== null) return readPath;
  return resolveReadCandidates(file, scope, env)[0];
}

export async function firstExistingPath(
  candidates: readonly string[],
  fs: ConfigFilesFs,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fs.exists(candidate)) return candidate;
  }
  return null;
}

function parseErrorSummary(rawText: string): string | null {
  const { errors } = parseJsonc(rawText);
  return errors.length > 0 ? errors.join("; ") : null;
}

export async function readConfigFile(
  candidates: ConfigPathList,
  fs: ConfigFilesFs,
): Promise<ConfigFileReadResult> {
  const found = await firstExistingPath(candidates, fs);
  if (found === null) {
    return { path: candidates[0], exists: false, rawText: "", mtimeMs: 0, parseError: null };
  }
  const [rawText, stat] = await Promise.all([fs.readFile(found), fs.stat(found)]);
  return { path: found, exists: true, rawText, mtimeMs: stat.mtimeMs, parseError: parseErrorSummary(rawText) };
}

export async function detectLegacyOmo(env: ConfigFilesEnv, fs: ConfigFilesFs): Promise<string | null> {
  const legacy = join(env.homeDir, ".config", "opencode", "oh-my-openagent.json");
  return (await fs.exists(legacy)) ? legacy : null;
}

function tempWritePath(target: string): string {
  return `${target}.opencode-panel-${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;
}

/** Absolute mtime drift tolerated by the concurrency guard (ms). */
const MTIME_GUARD_EPSILON_MS = 1;

export async function writeConfigFile(
  target: string,
  rawText: string,
  expectedMtimeMs: number | undefined,
  fs: ConfigFilesFs,
): Promise<ConfigFileWriteReply> {
  const parseError = parseErrorSummary(rawText);
  if (parseError !== null) {
    throw new ConfigFileError("parse", `refusing to write unparseable config: ${parseError}`);
  }
  await fs.mkdir(dirname(target));
  let mode = 0o600;
  let backupPath: string | null = null;
  if (await fs.exists(target)) {
    const current = await fs.stat(target);
    if (expectedMtimeMs !== undefined && Math.abs(current.mtimeMs - expectedMtimeMs) > MTIME_GUARD_EPSILON_MS) {
      throw new ConfigFileError(
        "mtime-mismatch",
        `${target} changed on disk (expected mtimeMs ${expectedMtimeMs}, found ${current.mtimeMs})`,
      );
    }
    mode = current.mode;
    backupPath = `${target}.bak`;
    await fs.copyFile(target, backupPath);
  }
  const tmpPath = tempWritePath(target);
  await fs.writeFile(tmpPath, rawText);
  await fs.rename(tmpPath, target);
  await fs.chmod(target, mode);
  const written = await fs.stat(target);
  return { mtimeMs: written.mtimeMs, backupPath };
}

/** Production seam over `node:fs/promises`. */
export function createNodeConfigFilesFs(): ConfigFilesFs {
  return {
    exists: async (path) => {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (path) => {
      const info = await stat(path);
      return { mtimeMs: info.mtimeMs, mode: info.mode & 0o777 };
    },
    readFile: (path) => readFile(path, "utf8"),
    writeFile: async (path, data) => {
      // fsync before close so the tmp bytes are durable before the rename.
      const handle = await open(path, "w");
      try {
        await handle.writeFile(data, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename: (from, to) => rename(from, to),
    copyFile: (from, to) => copyFile(from, to),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    chmod: (path, mode) => chmod(path, mode),
    delete: async (path) => {
      await rm(path, { force: true });
    },
  };
}

/**
 * Config-file domain handlers (plan W1): `configFileRead` / `configFileWrite`
 * over the host IO core in ../configFiles.ts.
 *
 * WIRE CONTRACT (pinned): both replies are messenger envelopes whose content
 * matches `FromWebviewResponse.configFileRead/Write`. Failures throw
 * {@link ConfigFileError} whose message starts with a stable `[<code>]`
 * prefix (plan taxonomy: parse, mtime-mismatch, no-workspace, io,
 * invalid-payload) — the host messenger flattens it to
 * `ConfigFileError: [<code>] ...` and the webview pattern-matches the
 * prefix to distinguish mtime conflicts (Reload/Force) from other banners.
 *
 * Payload validation is hand-rolled at the boundary (mirroring
 * ./settingsValidation.ts): the wire payload is `unknown` until parsed.
 * Validation failures throw `[invalid-payload]` BEFORE any disk touch.
 *
 * The legacy `oh-my-openagent.json` path crosses the wire as display-only
 * metadata (`legacyNoticePath`) and is never read-from or written-to here.
 * File CONTENTS never reach the logger — debug lines carry paths only.
 */

import type {
  ConfigFileId,
  ConfigFileReadReply,
  ConfigFileWriteReply,
  ConfigScope,
} from "../../shared/protocol.js";
import {
  ConfigFileError,
  detectLegacyOmo,
  firstExistingPath,
  readConfigFile,
  resolveReadCandidates,
  resolveWriteTarget,
  writeConfigFile,
  type ConfigFilesEnv,
  type ConfigFilesFs,
} from "../configFiles.js";
import type { PanelLogger } from "../logger.js";
import type { RegisterHandler } from "./sessions.js";

export { ConfigFileError } from "../configFiles.js";

export interface ConfigFileHandlersDeps {
  readonly env: ConfigFilesEnv;
  readonly fs: ConfigFilesFs;
  readonly logger: PanelLogger;
}

export interface ConfigFileHandlers {
  configFileRead(payload: unknown): Promise<ConfigFileReadReply>;
  configFileWrite(payload: unknown): Promise<ConfigFileWriteReply>;
}

interface ConfigFileSelector {
  readonly file: ConfigFileId;
  readonly scope: ConfigScope;
}

interface ValidatedWritePayload extends ConfigFileSelector {
  readonly rawText: string;
  readonly expectedMtimeMs: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelector(raw: unknown): ConfigFileSelector {
  if (!isRecord(raw)) {
    throw new ConfigFileError("invalid-payload", "payload must be an object");
  }
  const failures: string[] = [];
  const rawFile = raw.file;
  const rawScope = raw.scope;
  const file: ConfigFileId | null = rawFile === "opencode" || rawFile === "omo" ? rawFile : null;
  if (file === null) failures.push('file must be "opencode" or "omo"');
  const scope: ConfigScope | null = rawScope === "global" || rawScope === "project" ? rawScope : null;
  if (scope === null) failures.push('scope must be "global" or "project"');
  if (file === null || scope === null) {
    throw new ConfigFileError("invalid-payload", failures.join("; "));
  }
  return { file, scope };
}

function parseWritePayload(raw: unknown): ValidatedWritePayload {
  if (!isRecord(raw)) {
    throw new ConfigFileError("invalid-payload", "payload must be an object");
  }
  const selector = parseSelector(raw);
  const failures: string[] = [];
  const rawText = raw.rawText;
  const validRawText = typeof rawText === "string" ? rawText : null;
  if (validRawText === null) failures.push("rawText must be a string");
  let expectedMtimeMs: number | undefined;
  const rawMtime = raw.expectedMtimeMs;
  if (rawMtime !== undefined) {
    if (typeof rawMtime === "number" && Number.isFinite(rawMtime)) {
      expectedMtimeMs = rawMtime;
    } else {
      failures.push("expectedMtimeMs must be a finite number when given");
    }
  }
  if (failures.length > 0 || validRawText === null) {
    throw new ConfigFileError("invalid-payload", failures.join("; "));
  }
  return { ...selector, rawText: validRawText, expectedMtimeMs };
}

function asWireError(error: unknown): ConfigFileError {
  if (error instanceof ConfigFileError) return error;
  return new ConfigFileError("io", error instanceof Error ? error.message : String(error));
}

export function createConfigFileHandlers(deps: ConfigFileHandlersDeps): ConfigFileHandlers {
  return {
    async configFileRead(payload: unknown): Promise<ConfigFileReadReply> {
      const selector = parseSelector(payload);
      try {
        const candidates = resolveReadCandidates(selector.file, selector.scope, deps.env);
        const read = await readConfigFile(candidates, deps.fs);
        const legacyNoticePath =
          selector.file === "omo" && selector.scope === "global" && !read.exists
            ? await detectLegacyOmo(deps.env, deps.fs)
            : null;
        deps.logger.debug(
          `configFiles: read ${selector.file}:${selector.scope} -> ${read.path} exists=${read.exists}`,
        );
        return { ...read, legacyNoticePath };
      } catch (error) {
        throw asWireError(error);
      }
    },

    async configFileWrite(payload: unknown): Promise<ConfigFileWriteReply> {
      const parsed = parseWritePayload(payload);
      try {
        const candidates = resolveReadCandidates(parsed.file, parsed.scope, deps.env);
        const readPath = await firstExistingPath(candidates, deps.fs);
        const target = resolveWriteTarget(parsed.file, parsed.scope, deps.env, readPath);
        const reply = await writeConfigFile(target, parsed.rawText, parsed.expectedMtimeMs, deps.fs);
        deps.logger.debug(
          `configFiles: wrote ${parsed.file}:${parsed.scope} -> ${target} backup=${reply.backupPath ?? "none"}`,
        );
        return reply;
      } catch (error) {
        throw asWireError(error);
      }
    },
  };
}

/** Register the two config-file message handlers (plan W1 protocol keys). */
export function registerConfigFileHandlers(register: RegisterHandler, deps: ConfigFileHandlersDeps): void {
  const handlers = createConfigFileHandlers(deps);
  register("configFileRead", (payload): Promise<ConfigFileReadReply> => handlers.configFileRead(payload));
  register("configFileWrite", (payload): Promise<ConfigFileWriteReply> => handlers.configFileWrite(payload));
}

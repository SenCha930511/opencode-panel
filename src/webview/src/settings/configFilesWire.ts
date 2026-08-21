// i18n-allow-literal — no display copy in this module: wire codes, error
// text, and create-templates are machine data that surfaces through t()
// banners elsewhere.
/**
 * Config-file slot value layer (plan T3): the slot state shape the store
 * keeps per `"file:scope"` lane, the derived-flags materializer, the
 * create-templates for missing files, and the boundary parsers for the
 * `configFileRead` / `configFileWrite` wire replies (parse-don't-validate:
 * the reply is `unknown` until checked here).
 */

import { parseJsonc } from "../../../shared/configJsonc.js";
import { isRecord, type ConfigFileId, type ConfigFileReadReply, type ConfigFileWriteReply } from "../../../shared/protocol.js";

export interface SlotState {
  readonly path: string;
  readonly exists: boolean;
  readonly baseText: string;
  readonly draftText: string;
  readonly mtimeMs: number;
  readonly parseError: string | null;
  readonly legacyNoticePath: string | null;
  readonly saving: boolean;
  readonly conflict: boolean;
  readonly loaded: boolean;
  readonly saveError: string | null;
}

/** Slot state plus the derived flags tabs read (pinned slot() view). */
export interface ConfigSlot extends SlotState {
  readonly dirty: boolean;
  readonly readOnly: boolean;
}

/**
 * Create templates per file kind. The omo template nests under the literal
 * "[opencode]" SECTION key — the real ~/.omo/omo.jsonc schema shape
 * (verified read-only; the plain "opencode" key in the W2 round-trip
 * fixture is byte-preservation data, not the schema).
 */
export const CREATE_TEMPLATES: Readonly<Record<ConfigFileId, string>> = {
  opencode: "{\n}\n",
  omo: '{\n  "[opencode]": {\n  }\n}\n',
};

export function emptySlot(): SlotState {
  return {
    path: "",
    exists: false,
    baseText: "",
    draftText: "",
    mtimeMs: 0,
    parseError: null,
    legacyNoticePath: null,
    saving: false,
    conflict: false,
    loaded: false,
    saveError: null,
  };
}

export function materialize(state: SlotState): ConfigSlot {
  return {
    ...state,
    dirty: state.draftText !== state.baseText,
    readOnly: state.parseError !== null,
  };
}

export function parseErrorOf(text: string): string | null {
  const { errors } = parseJsonc(text);
  return errors.length === 0 ? null : errors.join("; ");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseReadReply(raw: unknown): ConfigFileReadReply | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.path !== "string" || typeof raw.exists !== "boolean") return undefined;
  if (typeof raw.rawText !== "string" || typeof raw.mtimeMs !== "number") return undefined;
  if (raw.parseError !== null && typeof raw.parseError !== "string") return undefined;
  if (raw.legacyNoticePath !== undefined && raw.legacyNoticePath !== null && typeof raw.legacyNoticePath !== "string") {
    return undefined;
  }
  return {
    path: raw.path,
    exists: raw.exists,
    rawText: raw.rawText,
    mtimeMs: raw.mtimeMs,
    parseError: raw.parseError,
    legacyNoticePath: raw.legacyNoticePath ?? null,
  };
}

export function parseWriteReply(raw: unknown): ConfigFileWriteReply | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.mtimeMs !== "number") return undefined;
  if (raw.backupPath !== null && typeof raw.backupPath !== "string") return undefined;
  return { mtimeMs: raw.mtimeMs, backupPath: raw.backupPath };
}

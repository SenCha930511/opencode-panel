/**
 * Boundary parse + validation for `setSettings` patches (plan todo 21).
 *
 * The wire `SettingsPatch` is a free record; the contract accepted here is
 * `{ values: { <shortKey>: value }, scope?: { <shortKey>: "global" | "workspace" } }`.
 * An empty patch is VALID (the webview's Test Connection trigger — the
 * handler answers the same reply plus a fresh health probe, with no writes).
 * Every failure class is collected into one {@link SettingsValidationError}:
 * unknown keys, mistyped values, per-field semantic rule hits (the generated
 * {@link validateFieldValue} rule source), and scope entries without a
 * matching value. The handler NEVER crashes and NEVER partially writes an
 * invalid patch: parsing completes before any write happens.
 */

import {
  SETTING_FIELDS,
  fieldByShortKey,
  validateFieldValue,
  type SettingField,
  type SettingScopeChoice,
  type SettingValue,
} from "../../shared/settingsSchema.js";

export interface SettingsPatchFailure {
  readonly key: string;
  readonly reason: string;
}

/**
 * Aggregate patch-validation failure. The todo-3 messenger flattens it to
 * `SettingsValidationError: <message>`; the reasons stay readable because
 * the webview is expected to catch the same classes client-side first (the
 * generated schema is shared), so this string is a backstop, not the primary
 * UX surface.
 */
export class SettingsValidationError extends Error {
  readonly failures: readonly SettingsPatchFailure[];

  constructor(failures: readonly SettingsPatchFailure[]) {
    super(`invalid settings patch: ${failures.map((failure) => failure.reason).join("; ")}`);
    this.name = "SettingsValidationError";
    this.failures = failures;
  }
}

export interface ValidatedSettingEntry {
  readonly field: SettingField;
  readonly value: SettingValue;
  readonly scope: SettingScopeChoice;
}

export interface ValidatedSettingsPatch {
  /** Entries in manifest order (deterministic write order). */
  readonly entries: readonly ValidatedSettingEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSettingValue(value: unknown): SettingValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }
  return undefined;
}

export function parseSettingsPatch(raw: unknown): ValidatedSettingsPatch {
  if (!isRecord(raw)) {
    throw new SettingsValidationError([{ key: "patch", reason: "patch must be an object" }]);
  }
  const failures: SettingsPatchFailure[] = [];
  const rawValues = raw.values === undefined ? {} : raw.values;
  const rawScope = raw.scope === undefined ? {} : raw.scope;
  if (!isRecord(rawValues)) {
    throw new SettingsValidationError([{ key: "values", reason: "patch.values must be an object" }]);
  }
  if (!isRecord(rawScope)) {
    throw new SettingsValidationError([{ key: "scope", reason: "patch.scope must be an object" }]);
  }

  const scopes = new Map<string, SettingScopeChoice>();
  for (const [key, scopeValue] of Object.entries(rawScope)) {
    if (fieldByShortKey(key) === undefined) {
      failures.push({ key, reason: `unknown setting key in scope: ${key}` });
    } else if (scopeValue !== "global" && scopeValue !== "workspace") {
      failures.push({ key, reason: `scope for ${key} must be "global" or "workspace"` });
    } else if (!(key in rawValues)) {
      failures.push({ key, reason: `scope given for ${key} but the patch carries no value for it` });
    } else {
      scopes.set(key, scopeValue);
    }
  }

  const values = new Map<string, SettingValue>();
  for (const [key, value] of Object.entries(rawValues)) {
    const field = fieldByShortKey(key);
    if (field === undefined) {
      failures.push({ key, reason: `unknown setting key: ${key}` });
      continue;
    }
    const typed = asSettingValue(value);
    if (typed === undefined) {
      failures.push({ key, reason: `${key}: value must be of type ${field.type}` });
      continue;
    }
    const reason = validateFieldValue(field, typed);
    if (reason !== null) failures.push({ key, reason });
    values.set(key, typed);
  }
  if (failures.length > 0) throw new SettingsValidationError(failures);

  const entries: ValidatedSettingEntry[] = [];
  for (const field of SETTING_FIELDS) {
    const value = values.get(field.shortKey);
    if (value === undefined) continue;
    // Default write target is GLOBAL (documented rule: the page only emits
    // workspace scope when the field's chip says the layer matters here).
    entries.push({ field, value, scope: scopes.get(field.shortKey) ?? "global" });
  }
  return { entries };
}

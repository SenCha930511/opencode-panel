/**
 * Webview mirror of the todo-21 settings reply contract (see
 * src/host/handlers/settings.ts for the host authority and the documented
 * wire deviation). The host and webview bundles never import each other, so
 * this module re-declares the reply shapes and boundary-parses every reply
 * ONCE (parse, don't validate): a drifted or missing field degrades to
 * undefined and the page keeps its previous state. Pinned by tests on both
 * sides against the same fixture payload.
 */

import {
  SETTING_FIELDS,
  coerceSettingsValues,
  type SettingScopeChoice,
  type SettingsValues,
} from "../../../shared/settingsSchema.js";

export interface SecretStatusWire {
  readonly isSet: boolean;
}

export interface SettingsSecretsWire {
  readonly password: SecretStatusWire;
  readonly username: SecretStatusWire;
}

export type ServerHealthStatusWire = "ok" | "unreachable" | "error";

export interface ServerHealthWire {
  readonly status: ServerHealthStatusWire;
  readonly url: string;
  readonly version: string | null;
  readonly checkedAt: string;
  readonly detail?: string;
}

/** getSettings reply (host authority: SettingsSnapshotReply). */
export interface SettingsSnapshotWire {
  readonly values: SettingsValues;
  readonly scope: Readonly<Record<string, SettingScopeChoice>>;
  readonly secrets: SettingsSecretsWire;
}

/** setSettings reply (host authority: SetSettingsReply). */
export interface SetSettingsWireReply extends SettingsSnapshotWire {
  readonly ok: true;
  readonly serverHealth: ServerHealthWire;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSecretStatusWire(value: unknown): SecretStatusWire | undefined {
  return isRecord(value) && typeof value.isSet === "boolean" ? { isSet: value.isSet } : undefined;
}

function parseSecretsWire(value: unknown): SettingsSecretsWire | undefined {
  if (!isRecord(value)) return undefined;
  const password = parseSecretStatusWire(value.password);
  const username = parseSecretStatusWire(value.username);
  if (password === undefined || username === undefined) return undefined;
  return { password, username };
}

function parseScopeWire(value: unknown): Readonly<Record<string, SettingScopeChoice>> {
  if (!isRecord(value)) return {};
  const scope: Record<string, SettingScopeChoice> = {};
  for (const field of SETTING_FIELDS) {
    const entry = value[field.shortKey];
    if (entry === "global" || entry === "workspace") scope[field.shortKey] = entry;
  }
  return scope;
}

export function parseSettingsSnapshotWire(raw: unknown): SettingsSnapshotWire | undefined {
  if (!isRecord(raw)) return undefined;
  const secrets = parseSecretsWire(raw.secrets);
  if (secrets === undefined) return undefined;
  return {
    values: coerceSettingsValues(raw.values),
    scope: parseScopeWire(raw.scope),
    secrets,
  };
}

export function parseServerHealthWire(raw: unknown): ServerHealthWire | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.status !== "ok" && raw.status !== "unreachable" && raw.status !== "error") return undefined;
  if (typeof raw.url !== "string" || typeof raw.checkedAt !== "string") return undefined;
  if (raw.version !== null && typeof raw.version !== "string") return undefined;
  return {
    status: raw.status,
    url: raw.url,
    version: raw.version,
    checkedAt: raw.checkedAt,
    ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
  };
}

export function parseSetSettingsReplyWire(raw: unknown): SetSettingsWireReply | undefined {
  if (!isRecord(raw) || raw.ok !== true) return undefined;
  const snapshot = parseSettingsSnapshotWire(raw);
  const serverHealth = parseServerHealthWire(raw.serverHealth);
  if (snapshot === undefined || serverHealth === undefined) return undefined;
  return { ...snapshot, ok: true, serverHealth };
}

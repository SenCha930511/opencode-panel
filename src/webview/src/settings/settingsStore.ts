// i18n-allow-literal — no display copy in this module; validation reasons
// are technical data rendered behind settings.validationFailed via t().
/**
 * Settings form-state store (plan todo 21, webview side): DOM-free draft
 * tracking over the generated schema. Owns base/draft values, per-field
 * scope chips, dirty detection, patch assembly, apply/revert semantics, the
 * secrets panel state flags, and the last health probe. Components bind it
 * through useSyncExternalStore; tests drive it against a loopback host.
 *
 * SEND SEAM: every wire call goes through the injected sender (the
 * AppContext `send`) so host failures arrive as null (the context already
 * toasted the technical message) and the store keeps the draft intact —
 * never silently discards the user's edits.
 *
 * TEST CONNECTION semantics (documented): the probe answers for the LAST
 * APPLIED configuration, not the draft — the host probes its own current
 * config for an empty patch (see settings.ts). The page therefore pairs the
 * button with the Apply flow instead of pretending draft-aware probing.
 */

import type { FromWebviewProtocol, FromWebviewResponse } from "../../../shared/protocol.js";
import {
  SETTING_FIELDS,
  coerceSettingsValues,
  fieldByShortKey,
  settingFieldValue,
  validateFieldValue,
  type SettingField,
  type SettingScopeChoice,
  type SettingValue,
  type SettingsValues,
} from "../../../shared/settingsSchema.js";
import {
  parseServerHealthWire,
  parseSetSettingsReplyWire,
  parseSettingsSnapshotWire,
  type ServerHealthWire,
  type SettingsSecretsWire,
  type SettingsSnapshotWire,
} from "./settingsWire.js";

export type AppSend = <K extends keyof FromWebviewProtocol>(
  type: K,
  payload: FromWebviewProtocol[K],
) => Promise<FromWebviewResponse[K] | null>;

export interface SettingsFormView {
  readonly base: SettingsValues;
  readonly draft: SettingsValues;
  readonly scope: Readonly<Record<string, SettingScopeChoice>>;
  readonly secrets: SettingsSecretsWire;
  readonly serverHealth: ServerHealthWire | null;
  readonly applying: boolean;
  readonly saveFailed: boolean;
}

type Listener = () => void;

/** Missing scope entries mean the documented default: global writes. */
function normalizeScope(
  scope: Readonly<Record<string, SettingScopeChoice>>,
): Record<string, SettingScopeChoice> {
  const normalized: Record<string, SettingScopeChoice> = {};
  for (const field of SETTING_FIELDS) {
    normalized[field.shortKey] = scope[field.shortKey] ?? "global";
  }
  return normalized;
}

function sameValue(left: SettingValue, right: SettingValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

export class SettingsFormStore {
  private base: SettingsValues;
  private draft: SettingsValues;
  private baseScope: Readonly<Record<string, SettingScopeChoice>>;
  private scope: Record<string, SettingScopeChoice>;
  private secrets: SettingsSecretsWire;
  private serverHealth: ServerHealthWire | null = null;
  private applying = false;
  private saveFailed = false;
  private readonly listeners = new Set<Listener>();
  private view: SettingsFormView;

  constructor(snapshot: SettingsSnapshotWire) {
    this.base = snapshot.values;
    this.draft = snapshot.values;
    this.baseScope = normalizeScope(snapshot.scope);
    this.scope = normalizeScope(snapshot.scope);
    this.secrets = snapshot.secrets;
    this.view = this.buildView();
  }

  getSnapshot = (): SettingsFormView => this.view;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Dirty = value changed, or the unchanged value's layer chip moved. */
  isDirty(shortKey: string): boolean {
    const field = fieldByShortKey(shortKey);
    if (field === undefined) return false;
    return (
      !sameValue(settingFieldValue(this.draft, field), settingFieldValue(this.base, field)) ||
      this.scope[shortKey] !== this.baseScope[shortKey]
    );
  }

  dirtyKeys(): readonly string[] {
    return SETTING_FIELDS.filter((field) => this.isDirty(field.shortKey)).map(
      (field) => field.shortKey,
    );
  }

  fieldError(shortKey: string): string | null {
    const field = fieldByShortKey(shortKey);
    if (field === undefined || !this.isDirty(shortKey)) return null;
    return validateFieldValue(field, settingFieldValue(this.draft, field));
  }

  hasErrors(): boolean {
    return SETTING_FIELDS.some((field) => this.fieldError(field.shortKey) !== null);
  }

  setValue(shortKey: string, value: SettingValue): void {
    const field = fieldByShortKey(shortKey);
    if (field === undefined || sameValue(settingFieldValue(this.draft, field), value)) return;
    this.draft = coerceSettingsValues({ ...this.draft, [shortKey]: value });
    this.emit();
  }

  setScopeChoice(shortKey: string, choice: SettingScopeChoice): void {
    if (fieldByShortKey(shortKey) === undefined || this.scope[shortKey] === choice) return;
    this.scope = { ...this.scope, [shortKey]: choice };
    this.emit();
  }

  revert(): void {
    this.draft = this.base;
    this.scope = { ...this.baseScope };
    this.saveFailed = false;
    this.emit();
  }

  /** The setSettings patch; empty for the no-op Test Connection round-trip. */
  buildPatch(): { readonly values: Record<string, unknown>; readonly scope: Record<string, SettingScopeChoice> } {
    const values: Record<string, unknown> = {};
    const scope: Record<string, SettingScopeChoice> = {};
    for (const shortKey of this.dirtyKeys()) {
      values[shortKey] = settingFieldValue(this.draft, fieldOrThrow(shortKey));
      // Explicit-global is the host default; only Workspace rides the wire.
      if (this.scope[shortKey] === "workspace") scope[shortKey] = "workspace";
    }
    return { values, scope };
  }

  /** Apply the patch; on success the reply becomes the new clean base. */
  async apply(send: AppSend): Promise<boolean> {
    if (this.applying || this.hasErrors()) return false;
    this.applying = true;
    this.saveFailed = false;
    this.emit();
    const raw: unknown = await send("setSettings", { patch: this.buildPatch() });
    const reply = parseSetSettingsReplyWire(raw);
    if (reply === undefined) {
      this.applying = false;
      this.saveFailed = true;
      this.emit();
      return false;
    }
    this.absorb(reply, reply.serverHealth);
    return true;
  }

  /** Empty-patch trip: refreshes the health of the applied configuration. */
  async testConnection(send: AppSend): Promise<ServerHealthWire | null> {
    const raw: unknown = await send("setSettings", { patch: { values: {}, scope: {} } });
    const reply = parseSetSettingsReplyWire(raw);
    if (reply === undefined) return null;
    this.serverHealth = reply.serverHealth;
    this.secrets = reply.secrets;
    this.emit();
    return reply.serverHealth;
  }

  /** Refresh the secrets flags only (after a setSecret round-trip). */
  async refreshSecrets(send: AppSend): Promise<void> {
    const raw: unknown = await send("getSettings", {});
    const snapshot = parseSettingsSnapshotWire(raw);
    if (snapshot === undefined) return;
    this.secrets = snapshot.secrets;
    this.emit();
  }

  markSecret(kind: "password" | "username", isSet: boolean): void {
    this.secrets = { ...this.secrets, [kind]: { isSet } };
    this.emit();
  }

  private absorb(snapshot: SettingsSnapshotWire, health: ServerHealthWire | null): void {
    this.base = snapshot.values;
    this.draft = snapshot.values;
    this.baseScope = normalizeScope(snapshot.scope);
    this.scope = normalizeScope(snapshot.scope);
    this.secrets = snapshot.secrets;
    this.serverHealth = health;
    this.applying = false;
    this.saveFailed = false;
    this.emit();
  }

  private buildView(): SettingsFormView {
    return {
      base: this.base,
      draft: this.draft,
      scope: this.scope,
      secrets: this.secrets,
      serverHealth: this.serverHealth,
      applying: this.applying,
      saveFailed: this.saveFailed,
    };
  }

  private emit(): void {
    this.view = this.buildView();
    for (const listener of this.listeners) listener();
  }
}

function fieldOrThrow(shortKey: string): SettingField {
  const field = fieldByShortKey(shortKey);
  if (field === undefined) throw new Error(`unknown setting key: ${shortKey}`);
  return field;
}

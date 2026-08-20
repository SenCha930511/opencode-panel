/**
 * Settings domain handlers (plan todo 21): getSettings / setSettings /
 * getSecret / setSecret over the todo-6 config + secrets seams, the todo-7
 * auth-aware health probe, and the generated todo-21 schema
 * (src/shared/settingsSchema.ts — single source of truth, manifest-driven).
 *
 * WIRE CONTRACT (documented deviation, binding for consumers): todo-3 types
 * `FromWebviewResponse.getSettings` as the free `Settings` record and
 * `setSettings` as `null`. Both replies are messenger envelopes whose
 * `content` is boundary-parsed webview-side (never blind-cast), so the host
 * honestly answers with the shapes below — the same deviation pattern todos
 * 12/15 already use for their event payloads. The webview mirror lives in
 * src/webview/src/settings/settingsWire.ts and is pinned by tests on both
 * sides:
 *  - getSettings → {@link SettingsSnapshotReply} `{ values, scope, secrets }`.
 *  - setSettings → {@link SetSettingsReply}: the post-write snapshot PLUS
 *    `ok` and a fresh {@link ServerHealth} of the CURRENT config. The
 *    settings page's Test Connection therefore needs no new wire type: it
 *    posts an EMPTY patch (valid per ./settingsValidation.ts — no writes)
 *    and reads `serverHealth` off the reply.
 *  - getSecret → todo-3 {@link SecretStatus} `{ isSet }` — nothing else,
 *    ever. The secret VALUE never crosses to the webview.
 *  - setSecret → null. `key` names the credential kind, `value` the secret;
 *    an empty value DELETES the stored secret (the only clearing path).
 *
 * SCOPE RULE (documented): every field writes to ConfigurationTarget.Global
 * by default ({@link parseSettingsPatch} fills `global`); the webview's
 * per-field chip may select Workspace, and the chip defaults to Workspace
 * only when the current effective value already comes from a workspace
 * layer (inspect() reports a workspaceFolder/workspace value) — i.e. the
 * workspace chip is offered only where the workspace already differs
 * meaningfully from the user default.
 *
 * SECRET KEYS: "password" | "username", keyed by the CURRENT effective
 * server URL via todo-6 PanelSecrets (per-server credentials coexist).
 */
import {
  SETTING_FIELDS,
  type SettingScopeChoice,
  type SettingValue,
  type SettingsValues,
} from "../../shared/settingsSchema.js";
import type { SecretStatus } from "../../shared/protocol.js";
import { serverBaseUrl, type PanelConfigAccessor } from "../config.js";
import type { PanelLogger } from "../logger.js";
import type { PanelSecrets } from "../secrets.js";
import type { RegisterHandler } from "./sessions.js";
import { SettingsValidationError, parseSettingsPatch } from "./settingsValidation.js";
import type { HealthProbe, ServerHealth } from "./settingsProbe.js";
export type { ServerHealth } from "./settingsProbe.js";
export { SettingsValidationError } from "./settingsValidation.js";

/** Minimal read/write configuration seam (production: workspace.getConfiguration). */
export interface SettingsConfigSurface {
  inspect(shortKey: string): SettingsConfigInspection | undefined;
  update(shortKey: string, value: SettingValue, target: SettingScopeChoice): PromiseLike<void>;
}

/** Structural mirror of the value layers of vscode's ConfigurationInspect. */
export interface SettingsConfigInspection {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

export type SecretFieldKey = "password" | "username";
const SECRET_FIELD_KEYS: readonly SecretFieldKey[] = ["password", "username"];

function isSecretFieldKey(key: string): key is SecretFieldKey {
  return (SECRET_FIELD_KEYS as readonly string[]).includes(key);
}

export interface SettingsSecretsStatus {
  readonly password: SecretStatus;
  readonly username: SecretStatus;
}

/** getSettings reply (see the wire contract above). */
export interface SettingsSnapshotReply {
  readonly values: SettingsValues;
  readonly scope: Readonly<Record<string, SettingScopeChoice>>;
  readonly secrets: SettingsSecretsStatus;
}

/** setSettings reply (see the wire contract above). */
export interface SetSettingsReply extends SettingsSnapshotReply {
  readonly ok: true;
  readonly serverHealth: ServerHealth;
}

export interface SettingsHandlersDeps {
  readonly config: PanelConfigAccessor;
  readonly surface: SettingsConfigSurface;
  readonly secrets: PanelSecrets;
  readonly probe: HealthProbe;
  readonly logger: PanelLogger;
}

export interface SettingsHandlers {
  getSettings(): Promise<SettingsSnapshotReply>;
  setSettings(patch: unknown): Promise<SetSettingsReply>;
  getSecret(key: string): Promise<SecretStatus>;
  setSecret(key: string, value: string): Promise<null>;
}

export function createSettingsHandlers(deps: SettingsHandlersDeps): SettingsHandlers {
  const currentBaseUrl = (): string => serverBaseUrl(deps.config.read());

  async function secretsStatus(): Promise<SettingsSecretsStatus> {
    const baseUrl = currentBaseUrl();
    const [password, username] = await Promise.all([
      deps.secrets.getPassword(baseUrl),
      deps.secrets.getUsername(baseUrl),
    ]);
    return {
      password: { isSet: password !== undefined },
      username: { isSet: username !== undefined },
    };
  }

  function writeScope(shortKey: string): SettingScopeChoice {
    const inspected = deps.surface.inspect(shortKey);
    if (inspected === undefined) return "global";
    return inspected.workspaceFolderValue !== undefined || inspected.workspaceValue !== undefined
      ? "workspace"
      : "global";
  }

  async function snapshot(): Promise<SettingsSnapshotReply> {
    const scope: Record<string, SettingScopeChoice> = {};
    for (const field of SETTING_FIELDS) {
      scope[field.shortKey] = writeScope(field.shortKey);
    }
    return { values: deps.config.read(), scope, secrets: await secretsStatus() };
  }

  function parseSecretKey(key: string): SecretFieldKey {
    if (!isSecretFieldKey(key)) {
      throw new SettingsValidationError([{ key: "key", reason: `unknown secret key: ${key}` }]);
    }
    return key;
  }

  return {
    async getSettings(): Promise<SettingsSnapshotReply> {
      return snapshot();
    },

    async setSettings(patch: unknown): Promise<SetSettingsReply> {
      const parsed = parseSettingsPatch(patch);
      for (const entry of parsed.entries) {
        await deps.surface.update(entry.field.shortKey, entry.value, entry.scope);
        deps.logger.debug(`settings: wrote ${entry.field.key} scope=${entry.scope}`);
      }
      const next = await snapshot();
      // Post-write probe of the CURRENT config — also the Test Connection
      // carrier for an empty patch (documented in the module header).
      const serverHealth = await deps.probe(currentBaseUrl());
      return { ...next, ok: true, serverHealth };
    },

    async getSecret(key: string): Promise<SecretStatus> {
      const kind = parseSecretKey(key);
      const value =
        kind === "password"
          ? await deps.secrets.getPassword(currentBaseUrl())
          : await deps.secrets.getUsername(currentBaseUrl());
      return { isSet: value !== undefined };
    },

    async setSecret(key: string, value: string): Promise<null> {
      const kind = parseSecretKey(key);
      const baseUrl = currentBaseUrl();
      if (value.length === 0) {
        if (kind === "password") await deps.secrets.deletePassword(baseUrl);
        else await deps.secrets.deleteUsername(baseUrl);
        deps.logger.debug(`settings: cleared server ${kind} credential`);
      } else {
        if (kind === "password") await deps.secrets.setPassword(baseUrl, value);
        else await deps.secrets.setUsername(baseUrl, value);
        deps.logger.debug(`settings: stored server ${kind} credential`);
      }
      return null;
    },
  };
}

/** Register the four settings-domain handlers (todo-3 protocol keys). */
export function registerSettingsHandlers(register: RegisterHandler, deps: SettingsHandlersDeps): void {
  const handlers = createSettingsHandlers(deps);
  register("getSettings", (): Promise<SettingsSnapshotReply> => handlers.getSettings());
  register("setSettings", (payload): Promise<SetSettingsReply> => handlers.setSettings(payload.patch));
  register("getSecret", (payload): Promise<SecretStatus> => handlers.getSecret(payload.key));
  register("setSecret", (payload): Promise<null> => handlers.setSecret(payload.key, payload.value));
}

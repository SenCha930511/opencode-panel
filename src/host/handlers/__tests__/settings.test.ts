import { describe, expect, it } from "vitest";
import {
  createConfigAccessor,
  DEFAULT_PANEL_CONFIG,
  type ConfigAdapter,
  type ConfigChangeEvent,
  type ConfigChangeSource,
  type Disposable,
  type Listener,
  type PanelConfigAccessor,
} from "../../config.js";
import { PanelLogger } from "../../logger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import {
  createSettingsHandlers,
  SettingsValidationError,
  type SettingsConfigSurface,
  type SettingsHandlersDeps,
} from "../settings.js";
import type { ServerHealth } from "../settingsProbe.js";
import { SETTING_FIELDS } from "../../../shared/settingsSchema.js";

const DEFAULT_SETTINGS_SERVER_HEALTH: ServerHealth = {
  status: "ok",
  url: "http://127.0.0.1:4096",
  version: "9.9.9-test",
  checkedAt: "2026-08-20T04:00:00.000Z",
};

/**
 * Settings domain handlers (plan todo 21): round-trips through a layered
 * config surface (global < workspace), the validation matrix, scope-write
 * targets, the empty-patch Test Connection carrier, and the secret
 * isSet-only contract. No vscode module anywhere.
 */

class FakeSecretStorage implements SecretStorage {
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

class MergeAdapter implements ConfigAdapter {
  constructor(
    private readonly global: Map<string, unknown>,
    private readonly workspace: Map<string, unknown>,
  ) {}
  get<T>(key: string): T | undefined {
    return (this.workspace.has(key) ? this.workspace.get(key) : this.global.get(key)) as T | undefined;
  }
}

class SilentChangeSource implements ConfigChangeSource {
  onChange(_listener: Listener<ConfigChangeEvent>): Disposable {
    return { dispose: () => {} };
  }
}

interface RecordedUpdate {
  readonly shortKey: string;
  readonly value: unknown;
  readonly target: string;
}

function makeHarness(overrides?: {
  readonly global?: Readonly<Record<string, unknown>>;
  readonly workspace?: Readonly<Record<string, unknown>>;
  readonly probeReply?: ServerHealth;
}) {
  const global = new Map<string, unknown>(Object.entries(overrides?.global ?? {}));
  const workspace = new Map<string, unknown>(Object.entries(overrides?.workspace ?? {}));
  const updates: RecordedUpdate[] = [];
  const surface: SettingsConfigSurface = {
    inspect(shortKey) {
      if (workspace.has(shortKey)) {
        return { globalValue: global.get(shortKey), workspaceValue: workspace.get(shortKey) };
      }
      return { globalValue: global.get(shortKey) };
    },
    update(shortKey, value, target) {
      updates.push({ shortKey, value, target });
      if (target === "workspace") workspace.set(shortKey, value);
      else global.set(shortKey, value);
      return Promise.resolve();
    },
  };
  const config: PanelConfigAccessor = createConfigAccessor(
    new MergeAdapter(global, workspace),
    new SilentChangeSource(),
  );
  const secrets = new PanelSecrets(new FakeSecretStorage());
  const probeCalls: string[] = [];
  const probeReply = overrides?.probeReply ?? DEFAULT_SETTINGS_SERVER_HEALTH;
  const lines: string[] = [];
  const deps: SettingsHandlersDeps = {
    config,
    surface,
    secrets,
    probe: (baseUrl) => {
      probeCalls.push(baseUrl);
      return Promise.resolve(probeReply);
    },
    logger: new PanelLogger({ appendLine: (line) => lines.push(line) }, () => true),
  };
  return { deps, handlers: createSettingsHandlers(deps), updates, probeCalls, secrets, lines };
}

describe("getSettings", () => {
  it("returns the typed snapshot with global scope and unset secrets by default", async () => {
    // Given: an untouched config surface
    const { handlers } = makeHarness();
    // When
    const reply = await handlers.getSettings();
    // Then: manifest defaults, every field global, secrets unset
    expect(reply.values).toEqual(DEFAULT_PANEL_CONFIG);
    expect(Object.keys(reply.scope)).toEqual(SETTING_FIELDS.map((field) => field.shortKey));
    expect(Object.values(reply.scope).every((scope) => scope === "global")).toBe(true);
    expect(reply.secrets).toEqual({ password: { isSet: false }, username: { isSet: false } });
  });

  it("marks fields whose effective value comes from the workspace layer", async () => {
    // Given: port overridden at the workspace layer only
    const { handlers } = makeHarness({ workspace: { port: 5000 }, global: { port: 4096, debugLogs: true } });
    // When
    const reply = await handlers.getSettings();
    // Then: merged read (workspace wins) + per-field origin
    expect(reply.values.port).toBe(5000);
    expect(reply.values.debugLogs).toBe(true);
    expect(reply.scope["port"]).toBe("workspace");
    expect(reply.scope["debugLogs"]).toBe("global");
  });

  it("reports secret isSet flags for the current derived server URL", async () => {
    // Given: a password stored for http://127.0.0.1:4096
    const { handlers, secrets } = makeHarness();
    await secrets.setPassword("http://127.0.0.1:4096", "pw");
    // When/Then
    const reply = await handlers.getSettings();
    expect(reply.secrets.password).toEqual({ isSet: true });
    expect(reply.secrets.username).toEqual({ isSet: false });
  });
});

describe("setSettings", () => {
  it("an empty patch writes nothing and answers with a fresh probe (Test Connection)", async () => {
    // Given
    const { handlers, updates, probeCalls } = makeHarness();
    // When
    const reply = await handlers.setSettings({ values: {}, scope: {} });
    // Then: no writes, one probe of the derived URL, ok reply
    expect(updates).toEqual([]);
    expect(probeCalls).toEqual(["http://127.0.0.1:4096"]);
    expect(reply.ok).toBe(true);
    expect(reply.serverHealth).toEqual(DEFAULT_SETTINGS_SERVER_HEALTH);
    expect(reply.values).toEqual(DEFAULT_PANEL_CONFIG);
  });

  it("writes entries in manifest order with the default global target", async () => {
    // Given: a patch whose object order differs from manifest order
    const { handlers, updates } = makeHarness();
    // When
    const reply = await handlers.setSettings({
      values: { chatFontSize: 14, port: 5001, autoStartServer: false },
    });
    // Then: writes follow SETTING_FIELDS order, targets default to global
    expect(updates.map((update) => update.shortKey)).toEqual(["port", "autoStartServer", "chatFontSize"]);
    expect(updates.every((update) => update.target === "global")).toBe(true);
    expect(reply.values.port).toBe(5001);
    expect(reply.values.autoStartServer).toBe(false);
    expect(reply.values.chatFontSize).toBe(14);
  });

  it("honors the workspace chip per field", async () => {
    // Given
    const { handlers, updates } = makeHarness();
    // When
    await handlers.setSettings({ values: { port: 6000 }, scope: { port: "workspace" } });
    // Then: the write targeted the workspace layer
    expect(updates).toEqual([{ shortKey: "port", value: 6000, target: "workspace" }]);
    const reply = await handlers.getSettings();
    expect(reply.scope["port"]).toBe("workspace");
  });

  it("probes the NEW config after a port change", async () => {
    // Given
    const { handlers, probeCalls } = makeHarness();
    // When
    await handlers.setSettings({ values: { port: 7000 } });
    // Then: the post-write probe aimed at the updated endpoint
    expect(probeCalls).toEqual(["http://127.0.0.1:7000"]);
  });

  it("accepts the port floor and ceiling", async () => {
    // Given/When/Then: 1 and 65535 are the inclusive bounds
    await expect(makeHarness().handlers.setSettings({ values: { port: 1 } })).resolves.toMatchObject({ ok: true });
    await expect(makeHarness().handlers.setSettings({ values: { port: 65535 } })).resolves.toMatchObject({ ok: true });
  });

  it("rejects a non-object patch without crashing", async () => {
    // Given/When/Then: a wire-drifted payload becomes a typed error
    await expect(makeHarness().handlers.setSettings("nope")).rejects.toThrowError(SettingsValidationError);
    await expect(makeHarness().handlers.setSettings({ values: "nope" })).rejects.toThrowError(/patch\.values/);
  });

  it("rejects the whole invalid matrix without writing or probing", async () => {
    // Given: one harness observing side effects across the matrix
    const { handlers, updates, probeCalls } = makeHarness();
    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      ["port", 0],
      ["port", 65536],
      ["port", 1.5],
      ["port", "4096"],
      ["serverUrl", "has space"],
      ["hostname", ""],
      ["hostname", "bad host"],
      ["binaryPath", "  "],
      ["minimumServerVersion", "abc"],
      ["minimumServerVersion", "1.2"],
      ["chatFontSize", -1],
      ["chatFontSize", 73],
      ["chatFontSize", 1.5],
      ["autoStartServer", 1],
      ["debugLogs", "yes"],
      ["serverArgs", ["--a", 3]],
      ["bogusKey", 1],
    ];
    // When/Then: every entry raises the aggregate typed error
    for (const [key, value] of invalid) {
      await expect(handlers.setSettings({ values: { [key]: value } })).rejects.toThrowError(
        SettingsValidationError,
      );
    }
    expect(updates).toEqual([]);
    expect(probeCalls).toEqual([]);
  });

  it("rejects orphan and malformed scope entries", async () => {
    // Given/When/Then
    const { handlers } = makeHarness();
    await expect(
      handlers.setSettings({ values: { port: 1 }, scope: { port: "elsewhere" } }),
    ).rejects.toThrowError(/scope for port/);
    await expect(
      handlers.setSettings({ values: { port: 1 }, scope: { hostname: "global" } }),
    ).rejects.toThrowError(/scope given for hostname but the patch carries no value/);
  });

  it("collects several field failures into one error", async () => {
    // Given/When: one patch with two bad fields
    const error = await makeHarness()
      .handlers.setSettings({ values: { port: 0, chatFontSize: -3 } })
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught,
      );
    // Then: both reasons ride the same typed error
    expect(error).toBeInstanceOf(SettingsValidationError);
    if (!(error instanceof SettingsValidationError)) {
      throw new Error("expected SettingsValidationError");
    }
    expect(error.failures.map((failure) => failure.key).sort()).toEqual([
      "chatFontSize",
      "port",
    ]);
  });
});

describe("getSecret / setSecret", () => {
  it("replies with exactly { isSet } — never the value", async () => {
    // Given: no stored password
    const { handlers } = makeHarness();
    // When/Then: unset, one single key on the wire reply
    const unset = await handlers.getSecret("password");
    expect(Object.keys(unset)).toEqual(["isSet"]);
    expect(unset.isSet).toBe(false);
    // And after storing one
    expect(await handlers.setSecret("password", "super-secret")).toBeNull();
    const set = await handlers.getSecret("password");
    expect(set).toEqual({ isSet: true });
    expect(JSON.stringify(set)).not.toContain("super-secret");
  });

  it("stores username and password per the derived server URL", async () => {
    // Given
    const { handlers, secrets } = makeHarness({ global: { port: 5001 } });
    // When
    await handlers.setSecret("username", "alice");
    // Then: the credential landed under the updated endpoint's key slot
    await expect(secrets.getUsername("http://127.0.0.1:5001")).resolves.toBe("alice");
    await expect(handlers.getSecret("username")).resolves.toEqual({ isSet: true });
  });

  it("an empty value clears the stored secret", async () => {
    // Given
    const { handlers } = makeHarness();
    await handlers.setSecret("password", "pw");
    // When
    await handlers.setSecret("password", "");
    // Then
    await expect(handlers.getSecret("password")).resolves.toEqual({ isSet: false });
  });

  it("rejects unknown secret keys with a typed error", async () => {
    // Given/When/Then
    await expect(makeHarness().handlers.getSecret("apiKey")).rejects.toThrowError(/unknown secret key/);
    await expect(makeHarness().handlers.setSecret("apiKey", "x")).rejects.toThrowError(SettingsValidationError);
  });
});

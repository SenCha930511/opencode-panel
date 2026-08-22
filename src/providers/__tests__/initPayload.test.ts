/**
 * Init-payload assembly (todo 10): pure builder tests against a stopped
 * manager fake plus the REAL todo-8 manager + todo-5 mock server chain, so
 * the connected case exercises the exact detect→onboard path production
 * takes.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONFIG,
  type PanelConfig,
  type PanelConfigAccessor,
} from "../../host/config.js";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import { PanelSecrets, type SecretStorage } from "../../host/secrets.js";
import { en, zhTW } from "../../shared/strings";
import { ServerManager, type ChildSpawner } from "../../server/serverManager.js";
import {
  MODERN_VERSION,
  startMockServer,
  type MockServer,
} from "../../test/mock-server/index.js";
import { createInitPayloadBuilder, type InitManagerSurface } from "../initPayload";

class NullChannel implements OutputChannelLike {
  appendLine(_line: string): void {}
}

class EmptySecretStorage implements SecretStorage {
  get(_key: string): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  store(_key: string, _value: string): Promise<void> {
    return Promise.resolve();
  }
  delete(_key: string): Promise<void> {
    return Promise.resolve();
  }
}

/** Never-invoked spawner: the managed-attached path attaches, it never spawns. */
const NOOP_SPAWNER: ChildSpawner = () => {
  throw new Error("spawner must not be invoked in these scenarios");
};

function realConfigAccessor(config: PanelConfig): PanelConfigAccessor {
  return {
    read: () => config,
    onDidChange: () => ({ dispose() {} }),
    dispose() {},
  };
}

function stoppedManager(): InitManagerSurface {
  return {
    state: { kind: "stopped" },
    onboardClient: () => Promise.reject(new Error("must not onboard a stopped manager")),
  };
}

describe("createInitPayloadBuilder — disconnected manager", () => {
  it("assembles an honest disconnected snapshot without touching onboardClient", async () => {
    const build = createInitPayloadBuilder({
      envLanguage: "en-US",
      config: realConfigAccessor(DEFAULT_PANEL_CONFIG),
      manager: stoppedManager(),
    });
    const payload = await build();
    expect(payload.locale).toBe("en");
    expect(payload.strings).toBe(en);
    expect(payload.server).toEqual({ url: "", version: null });
    expect(payload.capabilities).toEqual({ fork: false, question: false, todo: false });
    expect(payload.settings).toMatchObject({ port: 4096, hostname: "127.0.0.1" });
  });

  it("resolves zh-TW strings for any Chinese display language", async () => {
    const build = createInitPayloadBuilder({
      envLanguage: "zh-Hant-TW",
      config: realConfigAccessor(DEFAULT_PANEL_CONFIG),
      manager: stoppedManager(),
    });
    const payload = await build();
    expect(payload.locale).toBe("zh-TW");
    expect(payload.strings).toBe(zhTW);
  });

  it("honors the opencodeChatSidebar.language override over the display language", async () => {
    const pinned = await createInitPayloadBuilder({
      envLanguage: "en-US",
      config: realConfigAccessor({ ...DEFAULT_PANEL_CONFIG, language: "zh-TW" }),
      manager: stoppedManager(),
    })();
    expect(pinned.locale).toBe("zh-TW");
    expect(pinned.strings).toBe(zhTW);

    const unpinned = await createInitPayloadBuilder({
      envLanguage: "zh-tw",
      config: realConfigAccessor({ ...DEFAULT_PANEL_CONFIG, language: "en" }),
      manager: stoppedManager(),
    })();
    expect(unpinned.locale).toBe("en");
    expect(unpinned.strings).toBe(en);
  });

  it("degrades a hand-edited language value to auto semantics", async () => {
    const payload = await createInitPayloadBuilder({
      envLanguage: "zh-tw",
      config: realConfigAccessor({ ...DEFAULT_PANEL_CONFIG, language: "klingon" }),
      manager: stoppedManager(),
    })();
    expect(payload.locale).toBe("zh-TW");
    expect(payload.strings).toBe(zhTW);
  });

  it("carries no credentials in the serialized payload", async () => {
    const build = createInitPayloadBuilder({
      envLanguage: "en",
      config: realConfigAccessor(DEFAULT_PANEL_CONFIG),
      manager: stoppedManager(),
    });
    // The strings table is static UI copy that ships inside the webview
    // bundle (its `settings.field.serverpassword` entry is a FIELD LABEL, not
    // a credential); the credential scan guards the dynamic host data —
    // config snapshot, server state, capabilities.
    const { strings: _strings, ...dynamicSlices } = await build();
    expect(JSON.stringify(dynamicSlices).toLowerCase()).not.toContain("password");
  });
});

describe("createInitPayloadBuilder — attached to the real mock server", () => {
  let mock: MockServer | undefined;
  let manager: ServerManager | undefined;

  afterEach(async () => {
    manager?.dispose();
    await mock?.close();
    mock = undefined;
    manager = undefined;
  });

  it("maps the live connection + detected capabilities into the payload", async () => {
    // Given a real manager attached to the todo-5 mock (basic-chat scenario)
    mock = await startMockServer(0, { scenario: "basic-chat" });
    const config = realConfigAccessor({ ...DEFAULT_PANEL_CONFIG, serverUrl: mock.url });
    manager = new ServerManager({
      config,
      secrets: new PanelSecrets(new EmptySecretStorage()),
      logger: new PanelLogger(new NullChannel(), () => false),
      spawner: NOOP_SPAWNER,
      workspaceFolder: () => "/fake/workspace",
    });
    // When the manager has attached (init assembly never starts the server —
    // it only snapshots, so the live state comes from a start first)
    const started = await manager.start();
    expect(started.ok).toBe(true);
    const build = createInitPayloadBuilder({ envLanguage: "en", config, manager });
    const payload = await build();
    // Then: the server slice mirrors the attached connection
    expect(manager.state).toEqual({ kind: "attached", baseUrl: mock.url });
    expect(payload.server).toEqual({ url: mock.url, version: MODERN_VERSION });
    // And capability bits are the live todo-7 probe, not defaults
    expect(payload.capabilities.fork).toBe(true);
    expect(payload.capabilities.todo).toBe(true);
    expect(typeof payload.capabilities.question).toBe("boolean");
  });
});

import { describe, expect, it } from "vitest";
import {
  createConfigAccessor,
  DEFAULT_PANEL_CONFIG,
  readPanelConfig,
  serverBaseUrl,
  type ConfigAdapter,
  type ConfigChangeEvent,
  type ConfigChangeSource,
  type Disposable,
  type Listener,
  type PanelConfig,
} from "../config.js";

class FakeAdapter implements ConfigAdapter {
  constructor(public values: Record<string, unknown> = {}) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

class FakeChangeSource implements ConfigChangeSource {
  private readonly listeners = new Set<Listener<ConfigChangeEvent>>();
  disposed = false;

  onChange(listener: Listener<ConfigChangeEvent>): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.disposed = true;
        this.listeners.delete(listener);
      },
    };
  }

  emit(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function sectionEvent(section: string): ConfigChangeEvent {
  return { affectsConfiguration: (s) => s === section || section.startsWith(`${s}.`) };
}

describe("readPanelConfig", () => {
  it("returns manifest defaults when the adapter has no values", () => {
    // Given: an empty adapter
    const adapter = new FakeAdapter();
    // When: the config is snapshotted
    const config = readPanelConfig(adapter);
    // Then: every key matches the contributed defaults
    expect(config).toEqual(DEFAULT_PANEL_CONFIG);
    expect(config.port).toBe(4096);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.binaryPath).toBe("opencode");
    expect(config.serverArgs).toEqual([]);
    expect(config.autoStartServer).toBe(true);
    expect(config.minimumServerVersion).toBe("0.0.0");
    expect(config.debugLogs).toBe(false);
    expect(config.serverUrl).toBe("");
    expect(config.chatFontFamily).toBe("");
    expect(config.chatFontSize).toBe(0);
  });

  it("maps every contributed key to its typed accessor value", () => {
    // Given: all ten keys overridden — every value differs from its fallback
    const adapter = new FakeAdapter({
      serverUrl: "https://opencode.internal:8443",
      port: 8443,
      hostname: "0.0.0.0",
      binaryPath: "/usr/local/bin/opencode",
      serverArgs: ["--verbose", "--print-logs"],
      autoStartServer: false,
      minimumServerVersion: "1.2.3",
      debugLogs: true,
      chatFontFamily: "JetBrains Mono",
      chatFontSize: 15,
    });
    // When
    const config = readPanelConfig(adapter);
    // Then
    expect(config).toEqual<PanelConfig>({
      serverUrl: "https://opencode.internal:8443",
      port: 8443,
      hostname: "0.0.0.0",
      binaryPath: "/usr/local/bin/opencode",
      serverArgs: ["--verbose", "--print-logs"],
      autoStartServer: false,
      minimumServerVersion: "1.2.3",
      debugLogs: true,
      chatFontFamily: "JetBrains Mono",
      chatFontSize: 15,
    });
  });

  it("falls back per key on wrong-typed values and filters non-string args", () => {
    // Given: a hand-edited settings blob with wrong types
    const adapter = new FakeAdapter({
      port: "4096",
      autoStartServer: "yes",
      serverArgs: ["--ok", 42, { nested: true }, "--also-ok"],
    });
    // When
    const config = readPanelConfig(adapter);
    // Then: parsed values are kept, junk is dropped, wrong types fall back
    expect(config.port).toBe(4096);
    expect(config.autoStartServer).toBe(true);
    expect(config.serverArgs).toEqual(["--ok", "--also-ok"]);
  });

  it("returns a fresh snapshot on every read", () => {
    // Given
    const adapter = new FakeAdapter({ port: 1 });
    // When
    const first = readPanelConfig(adapter);
    const second = readPanelConfig(adapter);
    // Then
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("serverBaseUrl", () => {
  it("joins hostname and port when serverUrl is unset", () => {
    // Given: default-config serverUrl ("")
    // When/Then
    expect(serverBaseUrl({ ...DEFAULT_PANEL_CONFIG, port: 4096, hostname: "127.0.0.1" })).toBe(
      "http://127.0.0.1:4096",
    );
  });

  it("uses an explicit serverUrl verbatim, minus trailing slashes", () => {
    // Given/When/Then
    const config = { ...DEFAULT_PANEL_CONFIG, serverUrl: "https://opencode.internal:8443/" };
    expect(serverBaseUrl(config)).toBe("https://opencode.internal:8443");
  });

  it("prepends http:// when the explicit serverUrl has no scheme", () => {
    // Given/When/Then
    const config = { ...DEFAULT_PANEL_CONFIG, serverUrl: "127.0.0.1:5000" };
    expect(serverBaseUrl(config)).toBe("http://127.0.0.1:5000");
  });
});

describe("createConfigAccessor", () => {
  it("reads through the injected adapter", () => {
    // Given
    const adapter = new FakeAdapter({ port: 9999 });
    const accessor = createConfigAccessor(adapter, new FakeChangeSource());
    // When/Then
    expect(accessor.read().port).toBe(9999);
  });

  it("fires with a fresh snapshot when an opencodePanel key changes", () => {
    // Given: a registered listener and an initial port
    const adapter = new FakeAdapter({ port: 4096 });
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    accessor.onDidChange((next) => seen.push(next));
    // When: the port changes and the section event fires
    adapter.values["port"] = 5000;
    source.emit(sectionEvent("opencodePanel.port"));
    // Then: the listener got the fresh typed snapshot
    expect(seen).toHaveLength(1);
    expect(seen[0]?.port).toBe(5000);
  });

  it("ignores changes outside the opencodePanel section", () => {
    // Given
    const adapter = new FakeAdapter();
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    accessor.onDidChange((next) => seen.push(next));
    // When: an unrelated section reports a change
    source.emit(sectionEvent("editor.fontSize"));
    // Then
    expect(seen).toHaveLength(0);
  });

  it("stops delivering to disposed listeners", () => {
    // Given
    const adapter = new FakeAdapter();
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    const subscription = accessor.onDidChange((next) => seen.push(next));
    subscription.dispose();
    // When
    source.emit(sectionEvent("opencodePanel.port"));
    // Then
    expect(seen).toHaveLength(0);
  });

  it("detaches from the change source on dispose", () => {
    // Given
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(new FakeAdapter(), source);
    // When
    accessor.dispose();
    // Then
    expect(source.disposed).toBe(true);
  });

  it("delivers every write individually — the emitter does not debounce or coalesce", () => {
    // Given: two rapid writes before their section events land
    const adapter = new FakeAdapter({ port: 4096 });
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    accessor.onDidChange((next) => seen.push(next));
    // When
    adapter.values["port"] = 5000;
    source.emit(sectionEvent("opencodePanel.port"));
    adapter.values["port"] = 6000;
    source.emit(sectionEvent("opencodePanel.port"));
    // Then: two events, one per source emission, in order
    expect(seen).toHaveLength(2);
    expect(seen[0]?.port).toBe(5000);
    expect(seen[1]?.port).toBe(6000);
  });

  it("each emission snapshots the values at emission time (no cached snapshot)", () => {
    // Given
    const adapter = new FakeAdapter({ port: 4096, debugLogs: false });
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    accessor.onDidChange((next) => seen.push(next));
    // When: one key changes, then another
    adapter.values["port"] = 1111;
    source.emit(sectionEvent("opencodePanel.port"));
    adapter.values["debugLogs"] = true;
    source.emit(sectionEvent("opencodePanel.debugLogs"));
    // Then: each snapshot carries the full state at its own emission
    expect(seen[0]).toMatchObject({ port: 1111, debugLogs: false });
    expect(seen[1]).toMatchObject({ port: 1111, debugLogs: true });
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("fans a single emission out to every registered listener", () => {
    // Given
    const adapter = new FakeAdapter({ port: 7777 });
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const first: PanelConfig[] = [];
    const second: PanelConfig[] = [];
    accessor.onDidChange((next) => first.push(next));
    accessor.onDidChange((next) => second.push(next));
    // When
    source.emit(sectionEvent("opencodePanel.port"));
    // Then
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.port).toBe(7777);
    expect(second[0]?.port).toBe(7777);
  });

  it("fires on the whole-section event but filters a near-name section prefix", () => {
    // Given
    const adapter = new FakeAdapter({ port: 4096 });
    const source = new FakeChangeSource();
    const accessor = createConfigAccessor(adapter, source);
    const seen: PanelConfig[] = [];
    accessor.onDidChange((next) => seen.push(next));
    // When: a bulk section event, then a lookalike section
    source.emit(sectionEvent("opencodePanel"));
    source.emit(sectionEvent("opencodePanelExtras"));
    // Then: only the real section landed
    expect(seen).toHaveLength(1);
  });
});

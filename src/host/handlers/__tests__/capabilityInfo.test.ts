// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (agent/command/provider names mirrored from the mock server), not display
// copy routed through t().
/**
 * Capability-info push host suite (plan todo 15):
 * - refresh posts `capabilities.refresh` with detector-verbatim agents and
 *   commands (custom OMO names unchanged), defensive provider groups, and the
 *   /config default model — against the todo-5 mock server.
 * - Defensive degrade: dead config routes -> payload still posts with empty
 *   providers/defaults (never an invented provider, never a throw).
 * - QA FAILURE (todo-15 acceptance): empty agent list -> payload carries
 *   agents [] AND the host logs the "no agents" fact (webview hides the
 *   dropdown and omits `agent` from prompts — the webview halves are asserted
 *   in src/webview/src/chat/pickers/__tests__).
 * - wireCapabilityInfo: managed|attached transitions re-push with detector
 *   invalidation (the documented resync-equivalent subscription).
 * - splitModelId (todo-14 parseModelString re-export): FIRST-"/" matrix.
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import {
  createCapabilityDetector,
  type CapabilityDetector,
} from "../../../server/capabilityDetector.js";
import type { Capabilities } from "../../../server/capabilities.js";
import { createPanelClient } from "../../../server/clientFactory.js";
import type {
  ServerConnection,
  ServerManagerState,
} from "../../../server/serverManager.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource, type SessionClientSource } from "../sessions.js";
import {
  CAPABILITIES_REFRESH_EVENT,
  CapabilityInfoSync,
  splitModelId,
  wireCapabilityInfo,
  type CapabilitiesRefreshPayload,
  type CapabilityInfoSyncDeps,
} from "../capabilityInfo.js";
import type { ViewEventSink } from "../sync.js";

// ---------------------------------------------------------------------------
// Test seams.

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
  }
}

/** SecretStorage fake: never holds credentials (mock server needs none). */
class EmptySecrets implements SecretStorage {
  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingEventSink implements ViewEventSink {
  readonly events: Array<{ readonly type: string; readonly payload: unknown }> = [];
  postEvent(type: string, payload: unknown): void {
    this.events.push({ type, payload });
  }
  refreshes(): CapabilitiesRefreshPayload[] {
    return this.events
      .filter((event) => event.type === CAPABILITIES_REFRESH_EVENT)
      .map((event) => event.payload as CapabilitiesRefreshPayload);
  }
  lastRefresh(): CapabilitiesRefreshPayload {
    const list = this.refreshes();
    const last = list[list.length - 1];
    if (last === undefined) throw new Error("no capabilities.refresh broadcast recorded");
    return last;
  }
}

const BASE_CAPABILITIES: Capabilities = {
  version: "0.0.0-test",
  hasFork: true,
  hasQuestion: true,
  hasTodo: true,
  hasShell: true,
  agents: [],
  commands: [],
  mcpNative: [],
  omoDetected: false,
  omoMcpNote: false,
};

function silentLogger(): PanelLogger {
  return new PanelLogger(new CapturingChannel(), () => false);
}

function panelFor(url: string) {
  return createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: silentLogger(),
  });
}

/** Connection whose capabilities come from the REAL todo-7 detector. */
async function detectedConnection(url: string): Promise<ServerConnection> {
  const panel = panelFor(url);
  const detector = createCapabilityDetector({
    logger: silentLogger(),
    minimumServerVersion: "0.0.0",
    probeFetch: panel.probeFetch,
    docQuery: "raw=1",
  });
  const capabilities = await detector.detect(panel.client, url);
  return {
    baseUrl: url,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities,
  };
}

/** Connection with hand-set capability lists and a live mock client. */
function craftedConnection(url: string, capabilities: Capabilities): ServerConnection {
  const panel = panelFor(url);
  return {
    baseUrl: url,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities,
  };
}

function syncHarness(source: SessionClientSource): {
  readonly sink: RecordingEventSink;
  readonly channel: CapturingChannel;
  readonly sync: CapabilityInfoSync;
  readonly deps: CapabilityInfoSyncDeps;
} {
  const sink = new RecordingEventSink();
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const deps: CapabilityInfoSyncDeps = { source, sink, logger };
  return { sink, channel, sync: new CapabilityInfoSync(deps), deps };
}

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

// ---------------------------------------------------------------------------
// The push contract.

describe("capability-info refresh push", () => {
  it("pins the event literal both bundles mirror", () => {
    expect(CAPABILITIES_REFRESH_EVENT).toBe("capabilities.refresh");
  });

  it("posts agents/commands/providers/default model verbatim (basic scenario)", async () => {
    mock = await startMockServer(0);
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastRefresh();

    expect(payload.agents.map((agent) => agent.name)).toEqual(["build", "plan", "general", "explore"]);
    expect(payload.agents.every((agent) => agent.builtIn)).toBe(true);
    expect(payload.commands.map((command) => command.name)).toEqual(["help", "init", "compact"]);
    expect(payload.providers).toEqual([
      {
        id: "mock-provider",
        name: "Mock Provider",
        models: [
          { id: "mock-large", name: "Mock Large", contextWindow: 200_000 },
          { id: "mock-small", name: "Mock Small", contextWindow: 200_000 },
        ],
      },
    ]);
    expect(payload.defaultModels).toEqual({ "mock-provider": "mock-large" });
    expect(payload.defaultModel).toBe("mock-provider/mock-large");
  });

  it("carries custom OMO agent/command names unchanged (omo-agents scenario)", async () => {
    mock = await startMockServer(0);
    mock.setScenario("omo-agents");
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastRefresh();

    const names = payload.agents.map((agent) => agent.name);
    expect(names).toContain("sisyphus");
    expect(names).toContain("librarian");
    const sisyphus = payload.agents.find((agent) => agent.name === "sisyphus");
    expect(sisyphus?.builtIn).toBe(false);
    expect(
      payload.commands.some(
        (command) =>
          command.name === "ulw-research" && command.description === "OMO research pipeline",
      ),
    ).toBe(true);
  });

  it("prefers the live detect seam over the connect-time snapshot (mid-session additions)", async () => {
    mock = await startMockServer(0);
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));
    // The baked snapshot predates a custom command; the live probe sees it.
    const sync = new CapabilityInfoSync({
      ...harness.deps,
      detect: () =>
        Promise.resolve({
          ...BASE_CAPABILITIES,
          agents: connection.capabilities.agents,
          commands: [...connection.capabilities.commands, { name: "btw", description: "by the way" }],
        }),
      baseUrl: () => connection.baseUrl,
    });

    const payload = await sync.fetchPayload();

    expect(payload?.commands.some((command) => command.name === "btw")).toBe(true);
  });

  it("a failing live probe falls back to the baked snapshot (never blanks the pickers)", async () => {
    mock = await startMockServer(0);
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));
    const sync = new CapabilityInfoSync({
      ...harness.deps,
      detect: () => Promise.reject(new Error("probe blown")),
      baseUrl: () => connection.baseUrl,
    });

    const payload = await sync.fetchPayload();

    expect(payload?.commands.map((command) => command.name)).toEqual(["help", "init", "compact"]);
  });

  it("degrades to empty providers/defaults when config routes are dead (never invents)", async () => {
    mock = await startMockServer(0);
    const capabilities: Capabilities = {
      ...BASE_CAPABILITIES,
      agents: [{ name: "build", mode: "primary", builtIn: true }],
      commands: [{ name: "help", description: "Show help" }],
    };
    const live = craftedConnection(mock.url, capabilities);
    // Point the client at a closed port: both config probes reject.
    const dead = { ...live, client: panelFor("http://127.0.0.1:1").client };
    const harness = syncHarness(staticSessionSource(dead));

    await harness.sync.refresh();
    const payload = harness.sink.lastRefresh();

    expect(payload.providers).toEqual([]);
    expect(payload.defaultModels).toEqual({});
    expect(payload.defaultModel).toBeUndefined();
    expect(payload.agents.map((agent) => agent.name)).toEqual(["build"]);
    expect(payload.commands.map((command) => command.name)).toEqual(["help"]);
  });

  it("QA failure: empty agent list posts agents:[] and logs the hiding fact", async () => {
    mock = await startMockServer(0);
    const connection = craftedConnection(mock.url, { ...BASE_CAPABILITIES, agents: [] });
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastRefresh();

    expect(payload.agents).toEqual([]);
    expect(harness.channel.joined()).toContain("server advertised no agents");
  });

  it("never posts and never rejects when the server is gone", async () => {
    const failing: SessionClientSource = {
      connect: () => Promise.reject(new Error("server down")),
    };
    const harness = syncHarness(failing);

    await harness.sync.refresh();
    expect(harness.sink.refreshes()).toEqual([]);
    expect(harness.channel.joined()).toContain("capability-info refresh skipped");
  });
});

// ---------------------------------------------------------------------------
// wireCapabilityInfo: resync-equivalent subscription.

class FakeManagerSignals {
  state: ServerManagerState = { kind: "stopped" };
  readonly invalidated: string[] = [];
  private readonly listeners = new Set<(state: ServerManagerState) => void>();

  readonly detector: CapabilityDetector = {
    detect: () => Promise.reject(new Error("wire test must not detect through the fake")),
    invalidate: (baseUrl: string) => {
      this.invalidated.push(baseUrl);
    },
  };

  readonly getState = (): ServerManagerState => this.state;

  readonly onDidChangeState = (listener: (state: ServerManagerState) => void) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  transition(next: ServerManagerState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

describe("wireCapabilityInfo", () => {
  it("entering managed invalidates the detector cache and re-pushes", async () => {
    mock = await startMockServer(0);
    const connection = craftedConnection(mock.url, BASE_CAPABILITIES);
    const harness = syncHarness(staticSessionSource(connection));
    const signals = new FakeManagerSignals();
    const wiring = wireCapabilityInfo({
      source: staticSessionSource(connection),
      detector: signals.detector,
      getState: signals.getState,
      onDidChangeState: signals.onDidChangeState,
      logger: new PanelLogger(harness.channel, () => true),
      events: harness.sink,
    });
    try {
      expect(harness.sink.refreshes()).toEqual([]);
      signals.transition({ kind: "managed", baseUrl: mock.url });
      expect(signals.invalidated).toEqual([mock.url]);
      await wiring.sync.refresh(); // dedupes into the transition's run
      expect(harness.sink.refreshes().length).toBe(1);

      signals.transition({ kind: "stopped" });
      expect(harness.sink.refreshes().length).toBe(1);

      signals.transition({ kind: "attached", baseUrl: mock.url });
      await wiring.sync.refresh();
      expect(harness.sink.refreshes().length).toBe(2);
      expect(signals.invalidated).toEqual([mock.url, mock.url]);
    } finally {
      wiring.dispose();
    }
  });

  it("wired while already live fires one immediate refresh", async () => {
    mock = await startMockServer(0);
    const connection = craftedConnection(mock.url, BASE_CAPABILITIES);
    const harness = syncHarness(staticSessionSource(connection));
    const signals = new FakeManagerSignals();
    signals.state = { kind: "attached", baseUrl: mock.url };
    const wiring = wireCapabilityInfo({
      source: staticSessionSource(connection),
      detector: signals.detector,
      getState: signals.getState,
      onDidChangeState: signals.onDidChangeState,
      logger: new PanelLogger(harness.channel, () => true),
      events: harness.sink,
    });
    try {
      await wiring.sync.refresh(); // dedupes into the immediate run
      expect(harness.sink.refreshes().length).toBe(1);
    } finally {
      wiring.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// splitModelId (the todo-14 parseModelString re-export this contract pins).

describe("splitModelId", () => {
  it("splits on the FIRST slash (provider never carries the tail)", () => {
    expect(splitModelId("mock-provider/mock-large")).toEqual({
      providerID: "mock-provider",
      modelID: "mock-large",
    });
    expect(splitModelId("a/b/c")).toEqual({ providerID: "a", modelID: "b/c" });
  });

  it("rejects strings with no slash or an empty half", () => {
    expect(splitModelId("noslash")).toBeUndefined();
    expect(splitModelId("/model")).toBeUndefined();
    expect(splitModelId("provider/")).toBeUndefined();
    expect(splitModelId("")).toBeUndefined();
  });
});

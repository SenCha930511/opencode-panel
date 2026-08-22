// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (MCP names/statuses mirrored from the mock server), not display copy
// routed through t().
/**
 * MCP-status push host suite (plan todo 20):
 * - refresh posts `mcp.status` with the mock's /mcp map boundary-parsed
 *   (connected + failed-with-error entries verbatim) and the todo-7 guards
 *   projected from the REAL detector — against the todo-5 mock server.
 * - OMO scenario: the omoDetected/omoMcpNote guard bits flip true.
 * - QA FAILURE (todo-20 acceptance): a 500 /mcp (sabotage fetch) yields the
 *   typed McpStatusFetchError, the posted error payload (servers [] +
 *   error text + guards present) AND the warn log; the sync NEVER rejects.
 * - readMcpStatus fetch-path matrix: SDK mcp.status() when present, raw
 *   probeFetch GET otherwise; typed HTTP/transport/parse failures.
 * - wireMcpInfo: managed|attached transitions re-push with detector
 *   invalidation (the todo-15 resync-equivalent subscription shape).
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import {
  createCapabilityDetector,
  type CapabilityDetector,
} from "../../../server/capabilityDetector.js";
import type { Capabilities } from "../../../server/capabilities.js";
import { createPanelClient, type ProbeFetch } from "../../../server/clientFactory.js";
import type {
  ServerConnection,
  ServerManagerState,
} from "../../../server/serverManager.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource, type SessionClientSource } from "../sessions.js";
import {
  guardsFromCapabilities,
  MCP_STATUS_EVENT,
  McpInfoSync,
  McpStatusFetchError,
  readMcpStatus,
  toMcpServerEntries,
  wireMcpInfo,
  type McpInfoSyncDeps,
  type McpStatusPayload,
} from "../mcpInfo.js";
import type { ViewEventSink } from "../sync.js";

// ---------------------------------------------------------------------------
// Test seams (mirror capabilityInfo.test.ts).

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
  statuses(): McpStatusPayload[] {
    return this.events
      .filter((event) => event.type === MCP_STATUS_EVENT)
      .map((event) => event.payload as McpStatusPayload);
  }
  lastStatus(): McpStatusPayload {
    const list = this.statuses();
    const last = list[list.length - 1];
    if (last === undefined) throw new Error("no mcp.status broadcast recorded");
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

function panelFor(url: string, fetchImpl?: ProbeFetch) {
  return createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: silentLogger(),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
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
  readonly sync: McpInfoSync;
  readonly deps: McpInfoSyncDeps;
} {
  const sink = new RecordingEventSink();
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const deps: McpInfoSyncDeps = { source, sink, logger };
  return { sink, channel, sync: new McpInfoSync(deps), deps };
}

/** Sabotage fetch: every request answers a JSON 500 (todo-20 QA failure). */
const sabotage500: ProbeFetch = () =>
  Promise.resolve(
    new Response(JSON.stringify({ name: "InternalError", data: { message: "boom" } }), {
      status: 500,
    }),
  );

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

// ---------------------------------------------------------------------------
// The push contract.

describe("mcp-info refresh push", () => {
  it("pins the event literal both bundles mirror", () => {
    expect(MCP_STATUS_EVENT).toBe("mcp.status");
  });

  it("posts the /mcp entries verbatim plus detector guards (basic scenario)", async () => {
    mock = await startMockServer(0);
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastStatus();

    expect(payload.servers).toEqual([
      { name: "context7", status: "connected" },
      { name: "playwright", status: "failed", error: "mock spawn failure" },
    ]);
    expect(payload.error).toBeUndefined();
    expect(payload.guards).toEqual({
      fork: true,
      question: true,
      todo: true,
      shell: true,
      omoDetected: false,
      omoMcpNote: false,
      oldServer: false,
    });
  });

  it("flips the OMO guard bits on the omo-agents scenario", async () => {
    mock = await startMockServer(0);
    mock.setScenario("omo-agents");
    const connection = await detectedConnection(mock.url);
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastStatus();

    expect(payload.guards.omoDetected).toBe(true);
    expect(payload.guards.omoMcpNote).toBe(true);
    // The inventory stays honest: still exactly the natively-configured map.
    expect(payload.servers.map((server) => server.name)).toEqual(["context7", "playwright"]);
  });

  it("QA failure: /mcp 500 posts the error payload, logs a warn, never rejects", async () => {
    mock = await startMockServer(0);
    const panel = panelFor(mock.url, sabotage500);
    const connection: ServerConnection = {
      baseUrl: mock.url,
      ownership: "attached",
      client: panel.client,
      probeFetch: panel.probeFetch,
      capabilities: BASE_CAPABILITIES,
    };
    const harness = syncHarness(staticSessionSource(connection));

    await harness.sync.refresh();
    const payload = harness.sink.lastStatus();

    expect(payload.servers).toEqual([]);
    expect(typeof payload.error).toBe("string");
    expect(payload.error).toContain("McpStatusFetchError");
    // The flag carrier must not blank on an /mcp failure (guards still push).
    expect(payload.guards).toEqual(guardsFromCapabilities(BASE_CAPABILITIES));
    expect(harness.channel.joined()).toContain("/mcp probe failed");
  });

  it("never posts and never rejects when the server is gone", async () => {
    const failing: SessionClientSource = {
      connect: () => Promise.reject(new Error("server down")),
    };
    const harness = syncHarness(failing);

    await harness.sync.refresh();
    expect(harness.sink.statuses()).toEqual([]);
    expect(harness.channel.joined()).toContain("mcp-info refresh skipped");
  });
});

// ---------------------------------------------------------------------------
// readMcpStatus: the SDK-first / probeFetch-fallback fetch path.

describe("readMcpStatus", () => {
  it("reads the inventory through the probeFetch fallback against the mock", async () => {
    mock = await startMockServer(0);
    const panel = panelFor(mock.url);

    // `{}` is a valid McpClientLike with no SDK method: forces the raw GET.
    const entries = await readMcpStatus({}, panel.probeFetch, mock.url);

    expect(entries).toEqual([
      { name: "context7", status: "connected" },
      { name: "playwright", status: "failed", error: "mock spawn failure" },
    ]);
  });

  it("throws the typed error carrying the HTTP status on a 500", async () => {
    const failure = await readMcpStatus({}, sabotage500, "http://127.0.0.1:9").then(
      () => "resolved" as const,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(McpStatusFetchError);
    const typed = failure as McpStatusFetchError;
    expect(typed.status).toBe(500);
    expect(typed.message).toContain("HTTP 500");
    expect(typed.baseUrl).toBe("http://127.0.0.1:9");
  });

  it("wraps transport failures in the typed error (no status)", async () => {
    const refusing: ProbeFetch = () => Promise.reject(new Error("connect ECONNREFUSED"));
    const failure = await readMcpStatus({}, refusing, "http://127.0.0.1:9").then(
      () => "resolved" as const,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(McpStatusFetchError);
    expect((failure as McpStatusFetchError).status).toBeUndefined();
    expect((failure as McpStatusFetchError).message).toContain("ECONNREFUSED");
  });

  it("surfaces an SDK-level error body as the typed error", async () => {
    const errorClient = {
      mcp: {
        status: () =>
          Promise.resolve({ data: undefined, error: { name: "InternalError" } }),
      },
    };
    const failure = await readMcpStatus(errorClient, sabotage500, "http://127.0.0.1:9").then(
      () => "resolved" as const,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(McpStatusFetchError);
    expect((failure as McpStatusFetchError).message).toContain("server answered an error");
  });
});

// ---------------------------------------------------------------------------
// toMcpServerEntries: the boundary parse in isolation.

describe("toMcpServerEntries", () => {
  it("keeps unknown names and future status strings as data", () => {
    const entries = toMcpServerEntries({
      "x-custom-plugin": { status: "needs_auth" },
      legacy: { status: "disabled" },
    });

    expect(entries).toEqual([
      { name: "x-custom-plugin", status: "needs_auth" },
      { name: "legacy", status: "disabled" },
    ]);
  });

  it("degrades a missing status entry-locally to 'unknown' (never drops a server)", () => {
    expect(toMcpServerEntries({ halfthere: {} })).toEqual([{ name: "halfthere", status: "unknown" }]);
  });

  it("returns [] for non-record payloads (drift never invents servers)", () => {
    expect(toMcpServerEntries(undefined)).toEqual([]);
    expect(toMcpServerEntries(null)).toEqual([]);
    expect(toMcpServerEntries([{ name: "context7" }])).toEqual([]);
    expect(toMcpServerEntries("mcp")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// guardsFromCapabilities: the todo-7 projection host-side.

describe("guardsFromCapabilities", () => {
  it("projects the guard() map plus OMO/version bits", () => {
    expect(
      guardsFromCapabilities({
        ...BASE_CAPABILITIES,
        hasShell: false,
        omoDetected: true,
        omoMcpNote: true,
        oldServer: true,
      }),
    ).toEqual({
      fork: true,
      question: true,
      todo: true,
      shell: false,
      omoDetected: true,
      omoMcpNote: true,
      oldServer: true,
    });
  });

  it("defaults oldServer to false when the detector omits it", () => {
    expect(guardsFromCapabilities(BASE_CAPABILITIES).oldServer).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// wireMcpInfo: resync-equivalent subscription (todo-15 shape).

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

describe("wireMcpInfo", () => {
  it("entering managed invalidates the detector cache and re-pushes", async () => {
    mock = await startMockServer(0);
    const connection = craftedConnection(mock.url, BASE_CAPABILITIES);
    const harness = syncHarness(staticSessionSource(connection));
    const signals = new FakeManagerSignals();
    const wiring = wireMcpInfo({
      source: staticSessionSource(connection),
      detector: signals.detector,
      getState: signals.getState,
      onDidChangeState: signals.onDidChangeState,
      logger: new PanelLogger(harness.channel, () => true),
      events: harness.sink,
    });
    try {
      expect(harness.sink.statuses()).toEqual([]);
      signals.transition({ kind: "managed", baseUrl: mock.url });
      expect(signals.invalidated).toEqual([mock.url]);
      await wiring.sync.refresh(); // dedupes into the transition's run
      expect(harness.sink.statuses().length).toBe(1);

      signals.transition({ kind: "stopped" });
      expect(harness.sink.statuses().length).toBe(1);

      signals.transition({ kind: "attached", baseUrl: mock.url });
      await wiring.sync.refresh();
      expect(harness.sink.statuses().length).toBe(2);
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
    const wiring = wireMcpInfo({
      source: staticSessionSource(connection),
      detector: signals.detector,
      getState: signals.getState,
      onDidChangeState: signals.onDidChangeState,
      logger: new PanelLogger(harness.channel, () => true),
      events: harness.sink,
    });
    try {
      await wiring.sync.refresh(); // dedupes into the immediate run
      expect(harness.sink.statuses().length).toBe(1);
    } finally {
      wiring.dispose();
    }
  });
});

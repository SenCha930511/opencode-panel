/**
 * Capability detection against the todo-5 mock server (plan todo 7
 * acceptance): scenario matrix + version floor matrix + doc probe modes +
 * OMO signal priority + fallback probes + cache semantics.
 */
import http from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import {
  createPanelClient,
  type PanelServerClient,
} from "../clientFactory.js";
import {
  createCapabilityDetector,
  extractSpecPaths,
  isBelowMinimumVersion,
  isCoreAgentName,
  resolveOmoSignal,
  type CapabilityDetector,
  type CapabilityDetectorOptions,
  type DetectorFs,
} from "../CapabilityDetector.js";
import { guard, toWire, CORE_AGENT_NAMES } from "../capabilities.js";
import { PanelSecrets, type SecretStorage } from "../../host/secrets.js";
import {
  startMockServer,
  MODERN_VERSION,
  OLD_SERVER_VERSION,
  type MockServer,
  type ScenarioName,
} from "../../test/mock-server/index.js";

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
}

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

const emptyFs: DetectorFs = { exists: () => false };

function makeLogger(): { logger: PanelLogger; channel: CapturingChannel } {
  const channel = new CapturingChannel();
  return { logger: new PanelLogger(channel, () => true), channel };
}

function makeDetector(
  logger: PanelLogger,
  overrides: Partial<CapabilityDetectorOptions> = {},
): CapabilityDetector {
  return createCapabilityDetector({
    logger,
    minimumServerVersion: "0.0.0",
    fs: emptyFs,
    homeDir: "/nonexistent/omo-test-home",
    ...overrides,
  });
}

describe("capability detection against the mock server", () => {
  let server: MockServer | undefined;
  let panel: PanelServerClient | undefined;

  async function boot(scenario: ScenarioName, version?: string): Promise<{
    server: MockServer;
    panel: PanelServerClient;
    logger: PanelLogger;
    channel: CapturingChannel;
  }> {
    const started = await startMockServer(0, { scenario, ...(version === undefined ? {} : { version }) });
    const { logger, channel } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const made = createPanelClient(started.url, { secrets, logger });
    server = started;
    panel = made;
    return { server: started, panel: made, logger, channel };
  }

  afterEach(async () => {
    await server?.close();
    server = undefined;
    panel = undefined;
  });

  it("basic-chat: healthy, spec-embedded doc, all four routes, no OMO", async () => {
    // Given a modern plain-opencode server (no OMO files/routes/custom agents)
    const env = await boot("basic-chat");
    const detector = makeDetector(env.logger);
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then
    expect(caps.version).toBe(MODERN_VERSION);
    expect(caps.hasFork).toBe(true);
    expect(caps.hasQuestion).toBe(true);
    expect(caps.hasTodo).toBe(true);
    expect(caps.hasShell).toBe(true);
    expect(caps.oldServer).toBeUndefined();
    expect(caps.omoDetected).toBe(false);
    expect(caps.omoMcpNote).toBe(false);
    expect(caps.agents.map((a) => a.name)).toEqual(["build", "plan", "general", "explore"]);
    expect(caps.commands.length).toBeGreaterThan(0);
    expect(caps.mcpNative.map((m) => m.name).sort()).toEqual(["context7", "playwright"]);
    // And the summary line records the embedded-doc branch + no OMO signal
    const summary = env.channel.lines.find((line) => line.includes("capabilities for"));
    expect(summary).toBeDefined();
    expect(summary).toContain("signal=none");
    expect(summary).toContain("doc=spec-embedded");
    // And guard() exposes every feature bit
    expect(guard(caps)).toEqual({
      fork: true,
      question: true,
      todo: true,
      shell: true,
      omoMcpNote: false,
    });
  });

  it("omo-agents: agents signal fires deterministically and data stays populated", async () => {
    // Given an OMO-flavoured server but NO OMO config files and NO /plugin routes
    const env = await boot("omo-agents");
    const detector = makeDetector(env.logger);
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then: signal 3 (custom agents) — signals 1 and 2 provably absent
    expect(caps.omoDetected).toBe(true);
    expect(caps.omoMcpNote).toBe(true);
    const summary = env.channel.lines.find((line) => line.includes("capabilities for"));
    expect(summary).toContain("signal=custom-agents");
    // And agents/commands are non-empty with the OMO names present
    const names = caps.agents.map((a) => a.name);
    expect(names).toContain("sisyphus");
    expect(names).toContain("oracle");
    expect(caps.commands.map((c) => c.name)).toContain("ulw-research");
    // And guard() still exposes every feature
    const visibility = guard(caps);
    expect(visibility).toEqual({
      fork: true,
      question: true,
      todo: true,
      shell: true,
      omoMcpNote: true,
    });
  });

  it("old-server: every modern route hidden; floor 0.0.0 warns nothing", async () => {
    // Given an old server (404s + /doc omits fork/todo/question/prompt_async).
    // The version is PINNED to OLD_SERVER_VERSION because the todo-5 mock's
    // createMockState only applies the scenario version on setScenario, not
    // on the initial scenario (constructor starts at MODERN_VERSION); the
    // floor matrix needs a deterministic input version.
    const env = await boot("old-server", OLD_SERVER_VERSION);
    const detector = makeDetector(env.logger, { minimumServerVersion: "0.0.0" });
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then
    expect(caps.version).toBe(OLD_SERVER_VERSION);
    expect(caps.hasFork).toBe(false);
    expect(caps.hasQuestion).toBe(false);
    expect(caps.hasTodo).toBe(false);
    // Shell STAYS true: todo-5 deliberately omits only fork/todo/question/
    // prompt_async from old-server /doc (plan todo 5 + task-5 evidence DECISION
    // 5 — a real 0.2.9 server has the shell route), so honest detection keeps
    // the feature visible. The task prompt's "hasShell false" assumption
    // conflicted with every authoritative source; evidence log records this.
    expect(caps.hasShell).toBe(true);
    expect(caps.oldServer).toBeUndefined();
    expect(caps.agents.length).toBeGreaterThan(0);
    expect(env.channel.lines.some((line) => line.includes("[warn]"))).toBe(false);
    // And guard() hides the three modern features the server truly lacks
    expect(guard(caps)).toEqual({
      fork: false,
      question: false,
      todo: false,
      shell: true,
      omoMcpNote: false,
    });
    // And the wire mapping carries the same bits as a flat boolean record
    expect(toWire(caps)).toEqual({
      fork: false,
      question: false,
      todo: false,
      shell: true,
      omo: false,
      omoMcpNote: false,
      oldServer: false,
    });
  });

  it("old-server: floor 9.9.9 flags the below-floor signal (one warn)", async () => {
    // Given the same old server but a floor above its version
    const env = await boot("old-server", OLD_SERVER_VERSION);
    const detector = makeDetector(env.logger, { minimumServerVersion: "9.9.9" });
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then
    expect(caps.oldServer).toBe(true);
    expect(toWire(caps).oldServer).toBe(true);
    const warn = env.channel.lines.find((line) => line.includes("[warn]"));
    expect(warn).toContain(OLD_SERVER_VERSION);
    expect(warn).toContain("9.9.9");
  });

  it("failure QA: floor 9.9.9 vs version 0.0.1 → below-floor, features still probed", async () => {
    // Given a modern-routes server whose health version is far below the floor
    const env = await boot("basic-chat", "0.0.1");
    const detector = makeDetector(env.logger, { minimumServerVersion: "9.9.9" });
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then: oldServer signal AND best-effort routes still detected
    expect(caps.oldServer).toBe(true);
    expect(caps.hasFork).toBe(true);
    expect(caps.hasTodo).toBe(true);
    expect(env.channel.lines.some((line) => line.includes("[warn]"))).toBe(true);
  });

  it("doc JSON mode (?raw=1): same route inventory via the content-type branch", async () => {
    // Given the mock serving the pure JSON spec
    const env = await boot("basic-chat");
    const detector = makeDetector(env.logger, { docQuery: "raw=1" });
    // When
    const caps = await detector.detect(env.panel.client, env.server.url);
    // Then
    expect(caps.hasFork).toBe(true);
    expect(caps.hasQuestion).toBe(true);
    expect(caps.hasTodo).toBe(true);
    expect(caps.hasShell).toBe(true);
    const summary = env.channel.lines.find((line) => line.includes("capabilities for"));
    expect(summary).toContain("doc=spec-json");
  });

  it("caches per baseUrl and re-detects after invalidate()", async () => {
    // Given one detected server
    const env = await boot("basic-chat");
    const detector = makeDetector(env.logger);
    const first = await detector.detect(env.panel.client, env.server.url);
    // When: repeated detect returns the cached promise result (same object)
    const second = await detector.detect(env.panel.client, env.server.url);
    expect(second).toBe(first);
    // And invalidate forces a fresh detection
    detector.invalidate(env.server.url);
    const third = await detector.detect(env.panel.client, env.server.url);
    expect(third).not.toBe(first);
    expect(third.version).toBe(first.version);
  });

  it("never crashes on a dead server: empty capabilities, no throw", async () => {
    // Given a port nobody listens on
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const dead = createPanelClient("http://127.0.0.1:9", { secrets, logger });
    const detector = makeDetector(logger);
    // When/Then
    const caps = await detector.detect(dead.client, dead.baseUrl);
    expect(caps.version).toBe("");
    expect(caps.hasFork).toBe(false);
    expect(caps.hasTodo).toBe(false);
    expect(caps.agents).toEqual([]);
    expect(caps.commands).toEqual([]);
    expect(caps.mcpNative).toEqual([]);
  });
});

describe("version floor matrix", () => {
  it.each([
    ["0.2.9", "0.0.0", false],
    ["0.2.9", "9.9.9", true],
    ["0.0.1", "9.9.9", true],
    ["1.0.42-mock", "9.9.9", true],
    [MODERN_VERSION, "0.0.0", false],
    ["9.9.9", "9.9.9", false],
    ["1.0.0", "0.99.0", false],
    ["garbage", "1.0.0", false],
    ["1.2.3", "garbage", false],
    ["1.2", "1.2.0", false],
    ["10.0.0", "2.0.0", false],
    ["2.0.0", "10.0.0", true],
    ["1.0.42-mock", "1.0.42", false],
    ["0.3", "0.3.1", true],
    [" 1.2.3 ", "1.2.4", true],
  ])("isBelowMinimumVersion(%s, %s) === %s", (version, floor, expected) => {
    expect(isBelowMinimumVersion(version, floor)).toBe(expected);
  });
});

describe("extractSpecPaths (doc parse seam)", () => {
  let server: MockServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("extracts from the mock's Scalar-style HTML wrapper", async () => {
    // Given the live /doc HTML bytes from the mock
    server = await startMockServer(0, { scenario: "basic-chat" });
    const response = await fetch(`${server.url}/doc`);
    const body = await response.text();
    // When/Then: HTML branch finds the api-reference script
    const paths = extractSpecPaths(response.headers.get("content-type"), body);
    expect(paths).toBeDefined();
    expect(paths).toContain("/session/{id}/fork");
    expect(paths).toContain("/session/{id}/todo");
  });

  it("parses the raw JSON form directly", async () => {
    // Given the ?raw=1 JSON spec
    server = await startMockServer(0, { scenario: "basic-chat" });
    const response = await fetch(`${server.url}/doc?raw=1`);
    const body = await response.text();
    // When/Then
    expect(response.headers.get("content-type")).toContain("application/json");
    const paths = extractSpecPaths(response.headers.get("content-type"), body);
    expect(paths).toContain("/session/{id}/shell");
  });

  it("returns undefined for HTML without any usable spec script", () => {
    expect(extractSpecPaths("text/html", "<html><body>nope</body></html>")).toBeUndefined();
  });

  it("returns undefined for malformed JSON with a JSON content-type", () => {
    expect(extractSpecPaths("application/json", "{not json")).toBeUndefined();
  });

  it("falls back to any application/json script when api-reference is absent", () => {
    const html =
      '<script type="application/json">{"openapi":"3.1.0","paths":{"/agent":{}}}</script>';
    expect(extractSpecPaths("text/html", html)).toEqual(["/agent"]);
  });

  it("prefers the api-reference script over other json scripts", () => {
    const html =
      '<script type="application/json">{"paths":{"/other":{}}}</script>' +
      '<script id="api-reference" type="application/json">{"paths":{"/wanted":{}}}</script>';
    expect(extractSpecPaths("text/html", html)).toEqual(["/wanted"]);
  });
});

describe("resolveOmoSignal priority", () => {
  const home = "/home/tester";
  const workspace = "/work/repo";

  it("detects nothing for a pure core install", () => {
    expect(
      resolveOmoSignal({
        fs: emptyFs,
        workspaceDir: workspace,
        homeDir: home,
        specPaths: ["/agent", "/session/{id}/fork"],
        agentNames: [...CORE_AGENT_NAMES],
      }),
    ).toBe("none");
  });

  it("signal 1: workspace OMO config file wins over every other signal", () => {
    const fs: DetectorFs = { exists: (path) => path === `${workspace}/oh-my-opencode.jsonc` };
    expect(
      resolveOmoSignal({
        fs,
        workspaceDir: workspace,
        homeDir: home,
        specPaths: ["/plugin/foo"],
        agentNames: ["build", "sisyphus"],
      }),
    ).toBe("config-file");
  });

  it("signal 1: user-level ~/.config/opencode/omo.jsonc also fires", () => {
    const fs: DetectorFs = { exists: (path) => path === `${home}/.config/opencode/omo.jsonc` };
    expect(
      resolveOmoSignal({
        fs,
        workspaceDir: workspace,
        homeDir: home,
        specPaths: [],
        agentNames: ["build"],
      }),
    ).toBe("config-file");
  });

  it("signal 2: /plugin first-segment wins over custom agents", () => {
    expect(
      resolveOmoSignal({
        fs: emptyFs,
        workspaceDir: workspace,
        homeDir: home,
        specPaths: ["/plugin/omo/tools"],
        agentNames: ["build", "sisyphus"],
      }),
    ).toBe("plugin-routes");
  });

  it("signal 3: any agent outside the core set fires last", () => {
    expect(
      resolveOmoSignal({
        fs: emptyFs,
        workspaceDir: workspace,
        homeDir: home,
        specPaths: ["/agent"],
        agentNames: ["build", "sisyphus-junior"],
      }),
    ).toBe("custom-agents");
  });
});

describe("fallback probes when /doc is unusable", () => {
  const servers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of servers.splice(0)) await close();
  });

  /**
   * Minimal in-test server WITHOUT /doc (and without the SDK surface beyond
   * what the detector touches). `todoAnswer` controls the ambiguous 404 body.
   */
  async function startDocless(todoAnswer: "session" | "route"): Promise<{
    url: string;
    close: () => Promise<void>;
  }> {
    const sockets = new Set<Socket>();
    const app = http.createServer((req, res) => {
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/global/health") json(200, { healthy: true, version: "0.9.0" });
      else if (path.startsWith("/session/") && path.endsWith("/todo")) {
        if (todoAnswer === "session") {
          json(404, { name: "NotFoundError", data: { message: "session not found: __capability_probe__" } });
        } else {
          json(404, { name: "NotFoundError", data: { message: "route not found: GET /session/__capability_probe__/todo" } });
        }
      } else if (path === "/agent") json(200, []);
      else if (path === "/command") json(200, []);
      else if (path === "/config") json(200, {});
      else if (path === "/mcp") json(200, {});
      else json(404, { name: "NotFoundError", data: { message: `route not found: GET ${path}` } });
    });
    app.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address();
    if (address === null || typeof address === "string") {
      throw new Error("docless helper server has no port");
    }
    const { port } = address;
    const close = (): Promise<void> =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        app.close((error) => (error ? reject(error) : resolve()));
      });
    servers.push(close);
    return { url: `http://127.0.0.1:${port}`, close };
  }

  it("404 'session not found' proves the todo route exists; POST-only bits stay hidden", async () => {
    // Given
    const docless = await startDocless("session");
    const { logger, channel } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(docless.url, { secrets, logger });
    const detector = makeDetector(logger);
    // When
    const caps = await detector.detect(panel.client, docless.url);
    // Then
    expect(caps.hasTodo).toBe(true);
    expect(caps.hasFork).toBe(false);
    expect(caps.hasQuestion).toBe(false);
    expect(caps.hasShell).toBe(false);
    const summary = channel.lines.find((line) => line.includes("capabilities for"));
    expect(summary).toContain("doc=fallback");
  });

  it("404 'route not found' is ambiguous → todo hidden too", async () => {
    // Given
    const docless = await startDocless("route");
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(docless.url, { secrets, logger });
    const detector = makeDetector(logger);
    // When
    const caps = await detector.detect(panel.client, docless.url);
    // Then
    expect(caps.hasTodo).toBe(false);
    expect(guard(caps).todo).toBe(false);
  });
});

describe("malformed-doc probe outcomes (200 + unusable body)", () => {
  const servers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of servers.splice(0)) await close();
  });

  async function startMalformedDoc(
    doc: { readonly contentType: string; readonly body: string },
    todoAnswer: "session" | "route",
  ): Promise<{ url: string; close: () => Promise<void> }> {
    const sockets = new Set<Socket>();
    const app = http.createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/doc") {
        res.writeHead(200, { "content-type": doc.contentType });
        res.end(doc.body);
        return;
      }
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (path === "/global/health") json(200, { healthy: true, version: "1.2.3" });
      else if (path.startsWith("/session/") && path.endsWith("/todo")) {
        if (todoAnswer === "session") {
          json(404, { name: "NotFoundError", data: { message: "session not found: __capability_probe__" } });
        } else {
          json(404, { name: "NotFoundError", data: { message: `route not found: GET ${path}` } });
        }
      } else if (path === "/agent") json(200, []);
      else if (path === "/command") json(200, []);
      else if (path === "/config") json(200, {});
      else if (path === "/mcp") json(200, {});
      else json(404, { name: "NotFoundError", data: { message: `route not found: GET ${path}` } });
    });
    app.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address();
    if (address === null || typeof address === "string") {
      throw new Error("malformed-doc helper server has no port");
    }
    const { port } = address;
    const close = (): Promise<void> =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        app.close((error) => (error ? reject(error) : resolve()));
      });
    servers.push(close);
    return { url: `http://127.0.0.1:${port}`, close };
  }

  it("200 JSON-typed garbage body drops to fallback; proven todo route still surfaces", async () => {
    // Given: /doc answers 200 application/json but the body is not JSON
    const malformed = await startMalformedDoc(
      { contentType: "application/json", body: "{not json" },
      "session",
    );
    const { logger, channel } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(malformed.url, { secrets, logger });
    const detector = makeDetector(logger);
    // When
    const caps = await detector.detect(panel.client, malformed.url);
    // Then: fallback branch — only the distinguishable todo bit may surface
    expect(caps.version).toBe("1.2.3");
    expect(caps.hasTodo).toBe(true);
    expect(caps.hasFork).toBe(false);
    expect(caps.hasQuestion).toBe(false);
    expect(caps.hasShell).toBe(false);
    const summary = channel.lines.find((line) => line.includes("capabilities for"));
    expect(summary).toContain("doc=fallback");
  });

  it("200 HTML without a spec script drops to fallback; ambiguous todo stays hidden", async () => {
    // Given: /doc answers 200 text/html with no usable spec script
    const malformed = await startMalformedDoc(
      { contentType: "text/html", body: "<html><body>nope</body></html>" },
      "route",
    );
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(malformed.url, { secrets, logger });
    const detector = makeDetector(logger);
    // When
    const caps = await detector.detect(panel.client, malformed.url);
    // Then: every route bit hidden under ambiguity, no crash
    expect(caps.hasFork).toBe(false);
    expect(caps.hasQuestion).toBe(false);
    expect(caps.hasTodo).toBe(false);
    expect(caps.hasShell).toBe(false);
    expect(guard(caps)).toEqual({
      fork: false,
      question: false,
      todo: false,
      shell: false,
      omoMcpNote: false,
    });
  });
});

describe("isCoreAgentName", () => {
  it("accepts every name in CORE_AGENT_NAMES, including scout", () => {
    for (const name of CORE_AGENT_NAMES) {
      expect(isCoreAgentName(name)).toBe(true);
    }
    expect(CORE_AGENT_NAMES).toContain("scout");
  });

  it("rejects custom agent names and case variants", () => {
    expect(isCoreAgentName("sisyphus")).toBe(false);
    expect(isCoreAgentName("Build")).toBe(false);
    expect(isCoreAgentName("")).toBe(false);
  });
});

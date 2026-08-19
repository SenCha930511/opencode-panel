/**
 * ServerManager lifecycle state machine (plan todo 8 acceptance): fake spawn
 * + fake fetch over an instant clock. Covers attach-when-healthy (1 and 2
 * probes), spawn-when-down (healthy after N polls), ENOENT mentioning
 * `opencodePanel.binaryPath`, EADDRINUSE-then-healthy ⇒ attach (no error),
 * EADDRINUSE-then-unhealthy ⇒ error, only-owned-killed (attached disposal
 * sends no signals; managed SIGTERM then SIGKILL after grace), restart
 * round-trip, env passthrough of OPENCODE_SERVER_PASSWORD, stderr redaction,
 * autostart-disabled, and the real onboardClient chain against the todo-5
 * mock server.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONFIG,
  type PanelConfig,
  type PanelConfigAccessor,
} from "../../host/config.js";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import { PanelSecrets, type SecretStorage } from "../../host/secrets.js";
import type { ProbeFetch } from "../clientFactory.js";
import {
  ServerManager,
  type ChildExit,
  type ChildSpawner,
  type Clock,
  type ServerStartError,
  type SpawnError,
  type SpawnOptions,
  type SpawnedProcess,
} from "../ServerManager.js";
import {
  startMockServer,
  MODERN_VERSION,
  type MockServer,
} from "../../test/mock-server/index.js";

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
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

class InstantClock implements Clock {
  readonly delays: number[] = [];
  delay(ms: number): Promise<void> {
    this.delays.push(ms);
    return Promise.resolve();
  }
}

interface FakeCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

class FakeChild implements SpawnedProcess {
  readonly pid = 43001;
  readonly kills: string[] = [];
  onKill: ((signal: "SIGTERM" | "SIGKILL") => void) | undefined;
  private readonly stdoutListeners = new Set<(chunk: string) => void>();
  private readonly stderrListeners = new Set<(chunk: string) => void>();
  private readonly exitWaiters: Array<(exit: ChildExit) => void> = [];
  private readonly spawnWaiters: Array<(error: SpawnError) => void> = [];
  private exitResult: ChildExit | undefined;
  private spawnFailure: SpawnError | undefined;

  readonly exited: Promise<ChildExit> = new Promise<ChildExit>((resolve) => {
    this.exitWaiters.push(resolve);
  });
  readonly spawnFailed: Promise<SpawnError> = new Promise<SpawnError>((resolve) => {
    this.spawnWaiters.push(resolve);
  });

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.kills.push(signal);
    this.onKill?.(signal);
    return true;
  }
  onStdout(listener: (chunk: string) => void): void {
    this.stdoutListeners.add(listener);
  }
  onStderr(listener: (chunk: string) => void): void {
    this.stderrListeners.add(listener);
  }
  emitStdout(chunk: string): void {
    for (const listener of this.stdoutListeners) listener(chunk);
  }
  emitStderr(chunk: string): void {
    for (const listener of this.stderrListeners) listener(chunk);
  }
  exit(code: number | null, signal: string | null = null): void {
    if (this.exitResult !== undefined) return;
    this.exitResult = { code, signal };
    for (const waiter of this.exitWaiters) waiter(this.exitResult);
  }
  failSpawn(error: SpawnError): void {
    if (this.spawnFailure !== undefined) return;
    this.spawnFailure = error;
    for (const waiter of this.spawnWaiters) waiter(this.spawnFailure);
  }
}

interface SpawnBehavior {
  (child: FakeChild): void;
}

class FakeSpawnFactory {
  readonly calls: FakeCall[] = [];
  readonly children: FakeChild[] = [];
  private readonly behavior: SpawnBehavior | undefined;

  constructor(behavior?: SpawnBehavior) {
    this.behavior = behavior;
  }

  readonly spawner: ChildSpawner = (command, args, options) => {
    const call: FakeCall = { command, args, options };
    this.calls.push(call);
    const child = new FakeChild();
    this.children.push(child);
    this.behavior?.(child);
    return child;
  };
}

type HealthReply = "up" | "down";

/**
 * Scripted fetch: `/global/health` answers `fallback` after the first
 * `downCount` calls answer "down" (503). Every other route answers 404 — the
 * pure-lifecycle tests never touch capability endpoints (the onboardClient
 * chain test uses the real todo-5 mock instead).
 */
class FakeFetch {
  readonly calls: string[] = [];
  readonly fetch: ProbeFetch;
  private readonly downCount: number;

  constructor(downCount: number, fallback: HealthReply) {
    this.downCount = downCount;
    this.fetch = (request: Request) => {
      const pathname = new URL(request.url).pathname;
      const index = this.calls.length;
      this.calls.push(pathname);
      if (pathname === "/global/health") {
        const healthy = index >= this.downCount ? fallback === "up" : false;
        if (healthy) return Promise.resolve(Response.json({ version: "9.9.9" }));
      }
      return Promise.resolve(new Response("unreachable", { status: 503 }));
    };
  }
}

interface Harness {
  readonly manager: ServerManager;
  readonly spawn: FakeSpawnFactory;
  readonly fetchCalls: FakeFetch;
  readonly clock: InstantClock;
  readonly channel: CapturingChannel;
  readonly states: string[];
}

interface HarnessOverrides {
  readonly config?: Partial<PanelConfig>;
  readonly downCount?: number;
  readonly fallback?: HealthReply;
  readonly spawnBehavior?: SpawnBehavior;
  readonly env?: Record<string, string | undefined>;
  readonly folder?: string;
}

const BASE_CONFIG: PanelConfig = {
  ...DEFAULT_PANEL_CONFIG,
  port: 4096,
  hostname: "127.0.0.1",
  binaryPath: "opencode",
  autoStartServer: true,
};

function makeConfigAccessor(config: PanelConfig): PanelConfigAccessor {
  return {
    read: () => config,
    onDidChange: () => ({ dispose() {} }),
    dispose() {},
  };
}

function makeHarness(overrides: HarnessOverrides = {}): Harness {
  const config = { ...BASE_CONFIG, ...overrides.config };
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const spawn = new FakeSpawnFactory(overrides.spawnBehavior);
  const fetchCalls = new FakeFetch(overrides.downCount ?? 0, overrides.fallback ?? "up");
  const clock = new InstantClock();
  const manager = new ServerManager({
    config: makeConfigAccessor(config),
    secrets: new PanelSecrets(new FakeSecretStorage()),
    logger,
    spawner: spawn.spawner,
    workspaceFolder: () => overrides.folder ?? "/fake/workspace",
    ...(overrides.env === undefined ? {} : { env: () => overrides.env ?? {} }),
    fetchImpl: fetchCalls.fetch,
    clock,
  });
  const states: string[] = [];
  manager.onDidChangeState((state) => states.push(state.kind));
  return { manager, spawn, fetchCalls, clock, channel, states };
}

async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("ServerManager lifecycle", () => {
  it("attaches when the first detect probe is healthy", async () => {
    // Given a healthy server answers immediately
    const h = makeHarness({ downCount: 0, fallback: "up" });
    // When
    const result = await h.manager.start();
    // Then
    expect(result).toEqual({ ok: true, state: "attached", baseUrl: "http://127.0.0.1:4096" });
    expect(h.manager.state).toEqual({ kind: "attached", baseUrl: "http://127.0.0.1:4096" });
    expect(h.fetchCalls.calls).toEqual(["/global/health"]);
    expect(h.spawn.calls).toHaveLength(0);
    expect(h.states).toEqual(["probing", "attached"]);
    expect(h.manager.baseUrl).toBe("http://127.0.0.1:4096");
  });

  it("attaches when only the second of the two detect probes succeeds", async () => {
    // Given the first probe fails and the second succeeds
    const h = makeHarness({ downCount: 1, fallback: "up" });
    // When
    const result = await h.manager.start();
    // Then: exactly TWO detect probes before concluding (plan rule)
    expect(result).toEqual({ ok: true, state: "attached", baseUrl: "http://127.0.0.1:4096" });
    expect(h.fetchCalls.calls).toEqual(["/global/health", "/global/health"]);
    expect(h.spawn.calls).toHaveLength(0);
    expect(h.states).toEqual(["probing", "attached"]);
  });

  it("spawns when down and marks managed once the wait-for-healthy poll succeeds", async () => {
    // Given two failed detect probes, then a spawn whose server turns healthy at poll 3
    const h = makeHarness({ downCount: 4, fallback: "up", config: { serverArgs: ["--verbose"] } });
    // When
    const result = await h.manager.start();
    // Then
    expect(result).toEqual({ ok: true, state: "managed", baseUrl: "http://127.0.0.1:4096" });
    expect(h.manager.state).toEqual({ kind: "managed", baseUrl: "http://127.0.0.1:4096" });
    expect(h.fetchCalls.calls.filter((call) => call === "/global/health")).toHaveLength(5);
    expect(h.spawn.calls).toHaveLength(1);
    const call = h.spawn.calls[0];
    if (call === undefined) throw new Error("expected one spawn call");
    expect(call.command).toBe("opencode");
    expect(call.args).toEqual(["serve", "--port", "4096", "--hostname", "127.0.0.1", "--verbose"]);
    expect(call.options.cwd).toBe("/fake/workspace");
    expect(h.clock.delays.filter((ms) => ms === 250).length).toBeGreaterThanOrEqual(2);
    expect(h.states).toEqual(["probing", "managed"]);
  });

  it("ENOENT spawn failure surfaces an error naming opencodePanel.binaryPath", async () => {
    // Given the binary cannot be spawned
    const h = makeHarness({
      downCount: Number.MAX_SAFE_INTEGER,
      fallback: "down",
      spawnBehavior: (child) => {
        queueMicrotask(() => child.failSpawn({ message: "spawn opencode ENOENT", code: "ENOENT" }));
      },
    });
    // When
    const result = await h.manager.start();
    // Then: error state + result carry the actionable message (plan QA)
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed start");
    expect(result.error.name).toBe("ServerStartError");
    expect(result.error.failure.kind).toBe("binary-not-found");
    expect(result.error.message).toContain("opencodePanel.binaryPath");
    const state = h.manager.state;
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.error.message).toContain("opencodePanel.binaryPath");
    }
    // And the failure is surfaced on the log channel as an error line too
    const errorLines = h.channel.lines.filter((line) => line.includes("opencodePanel.binaryPath"));
    expect(errorLines.some((line) => line.includes("[error]"))).toBe(true);
    expect(h.states).toEqual(["probing", "error"]);
  });

  it("EADDRINUSE then healthy attaches without owning the server (first-window-owns)", async () => {
    // Given our spawn loses the port and the winner answers healthy on the re-probe
    const h = makeHarness({
      downCount: 2,
      fallback: "up",
      spawnBehavior: (child) => {
        // Exit settles synchronously (the promise needs no listener); stderr
        // emits on a microtask so the manager's wiring sees the EADDRINUSE
        // tail before the exit branch classifies it.
        child.exit(1);
        queueMicrotask(() => {
          child.emitStderr("Error: listen EADDRINUSE: address already in use 127.0.0.1:4096\n");
        });
      },
    });
    // When
    const result = await h.manager.start();
    // Then: attached, no error, no kill signals sent to the loser process
    expect(result).toEqual({ ok: true, state: "attached", baseUrl: "http://127.0.0.1:4096" });
    expect(h.manager.state.kind).toBe("attached");
    expect(h.clock.delays).toContain(2000);
    // 2 detect probes + 1 poll issued before the child-exit event won the
    // race (its result is ignored) + 1 re-probe that found the winner healthy.
    expect(h.fetchCalls.calls).toEqual([
      "/global/health",
      "/global/health",
      "/global/health",
      "/global/health",
    ]);
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    expect(child.kills).toEqual([]);
    expect(h.states).toEqual(["probing", "attached"]);
  });

  it("EADDRINUSE then still unhealthy surfaces a port-in-use error", async () => {
    // Given the port stays squatted with no healthy owner
    const h = makeHarness({
      downCount: Number.MAX_SAFE_INTEGER,
      fallback: "down",
      spawnBehavior: (child) => {
        child.exit(1);
        queueMicrotask(() => {
          child.emitStderr("listen EADDRINUSE: address already in use 127.0.0.1:4096\n");
        });
      },
    });
    // When
    const result = await h.manager.start();
    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed start");
    expect(result.error.failure.kind).toBe("port-in-use");
    expect(result.error.message).toContain("4096");
    expect(h.manager.state.kind).toBe("error");
    expect(h.states).toEqual(["probing", "error"]);
  });

  it("attached stop sends no signals and leaves the foreign server running", async () => {
    // Given an attached session
    const h = makeHarness({ downCount: 0, fallback: "up" });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("attached");
    // When
    await h.manager.stop();
    // Then
    expect(h.manager.state.kind).toBe("stopped");
    expect(h.spawn.calls).toHaveLength(0);
    expect(h.states).toEqual(["probing", "attached", "stopping", "stopped"]);
    expect(h.manager.baseUrl).toBeUndefined();
  });

  it("managed dispose sends SIGTERM only when the child exits cleanly", async () => {
    // Given a managed server whose child honors SIGTERM
    const h = makeHarness({
      downCount: 2,
      fallback: "up",
      spawnBehavior: (child) => {
        child.onKill = (signal) => {
          if (signal === "SIGTERM") child.exit(0);
        };
      },
    });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("managed");
    // When
    await h.manager.stop();
    // Then: exactly one signal, state machine ran through stopping
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    expect(child.kills).toEqual(["SIGTERM"]);
    expect(h.manager.state.kind).toBe("stopped");
    expect(h.states).toEqual(["probing", "managed", "stopping", "stopped"]);
  });

  it("managed dispose escalates SIGTERM then SIGKILL after the 3s grace when the child ignores TERM", async () => {
    // Given a managed server whose child never exits on its own
    const h = makeHarness({ downCount: 2, fallback: "up" });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("managed");
    // When
    await h.manager.stop();
    // Then: TERM, 3000ms grace, KILL (plan dispose rule)
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(h.clock.delays).toContain(3000);
    expect(h.manager.state.kind).toBe("stopped");
    expect(h.states).toEqual(["probing", "managed", "stopping", "stopped"]);
  });

  it("dispose() kills only the owned child (managed, SIGTERM→SIGKILL)", async () => {
    // Given a managed server
    const h = makeHarness({ downCount: 2, fallback: "up" });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("managed");
    // When
    h.manager.dispose();
    await flushMicrotasks();
    // Then
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(h.manager.state.kind).toBe("stopped");
  });

  it("restart round-trip: stops the owned child, re-detects, and attaches to the winner", async () => {
    // Given a managed server from the first start
    const h = makeHarness({
      downCount: 2,
      fallback: "up",
      spawnBehavior: (child) => {
        child.onKill = (signal) => {
          if (signal === "SIGTERM") child.exit(0);
        };
      },
    });
    const first = await h.manager.start();
    expect(first).toEqual({ ok: true, state: "managed", baseUrl: "http://127.0.0.1:4096" });
    // When
    const restarted = await h.manager.restart();
    // Then: owned child SIGTERM'd exactly once, then the healthy server is attached
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    expect(child.kills).toEqual(["SIGTERM"]);
    expect(h.spawn.calls).toHaveLength(1);
    expect(restarted).toEqual({ ok: true, state: "attached", baseUrl: "http://127.0.0.1:4096" });
    expect(h.manager.state.kind).toBe("attached");
    expect(h.states).toEqual([
      "probing",
      "managed",
      "stopping",
      "stopped",
      "probing",
      "attached",
    ]);
  });

  it("spawn env passes OPENCODE_SERVER_PASSWORD/USERNAME through from the injected env", async () => {
    // Given user-environment credentials (NEVER settings)
    const h = makeHarness({
      downCount: 4,
      fallback: "up",
      env: {
        PATH: "/usr/bin:/bin",
        OPENCODE_SERVER_PASSWORD: "s3cr3t",
        OPENCODE_SERVER_USERNAME: "bob",
      },
    });
    // When
    const result = await h.manager.start();
    // Then
    expect(result.ok).toBe(true);
    const call = h.spawn.calls[0];
    if (call === undefined) throw new Error("expected one spawn call");
    expect(call.options.env.OPENCODE_SERVER_PASSWORD).toBe("s3cr3t");
    expect(call.options.env.OPENCODE_SERVER_USERNAME).toBe("bob");
    expect(call.options.env.PATH).toBe("/usr/bin:/bin");
  });

  it("child stdout/stderr route through the redacted logger (no password leakage)", async () => {
    // Given a managed server that logs an env-style password to stderr
    const h = makeHarness({ downCount: 2, fallback: "up" });
    await h.manager.start();
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    // When
    child.emitStderr("listen failed: OPENCODE_SERVER_PASSWORD=hunter2 retrying\n");
    child.emitStdout("server ready AUTH=Basic dG9rZW4\n");
    // Then: lines are process-routed AND scrubbed
    const log = h.channel.joined();
    expect(log).toContain("[proc:err]");
    expect(log).toContain("[proc:out]");
    expect(log).not.toContain("hunter2");
    expect(log).toContain("OPENCODE_SERVER_PASSWORD=<redacted>");
    // And the spawned args line never carries the password either
    expect(log).not.toContain("s3cr3t");
  });

  it("down + autoStartServer off fails without spawning and names the setting", async () => {
    // Given a down server and autoStart disabled
    const h = makeHarness({
      downCount: Number.MAX_SAFE_INTEGER,
      fallback: "down",
      config: { autoStartServer: false },
    });
    // When
    const result = await h.manager.start();
    // Then
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed start");
    expect(result.error.failure.kind).toBe("autostart-disabled");
    expect(result.error.message).toContain("opencodePanel.autoStartServer");
    expect(h.spawn.calls).toHaveLength(0);
    expect(h.fetchCalls.calls).toEqual(["/global/health", "/global/health"]);
    expect(h.states).toEqual(["probing", "error"]);
  });

  it("stop() clears the error state", async () => {
    // Given a failed start left the manager in error
    const h = makeHarness({
      downCount: Number.MAX_SAFE_INTEGER,
      fallback: "down",
      config: { autoStartServer: false },
    });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("error");
    // When
    await h.manager.stop();
    // Then
    expect(h.manager.state.kind).toBe("stopped");
  });

  it("a managed child dying unexpectedly flips the state to error (server lost)", async () => {
    // Given a managed server
    const h = makeHarness({ downCount: 2, fallback: "up" });
    await h.manager.start();
    expect(h.manager.state.kind).toBe("managed");
    // When the owned child crashes on its own
    const child = h.spawn.children[0];
    if (child === undefined) throw new Error("expected one spawned child");
    child.exit(1);
    await flushMicrotasks();
    // Then
    const state = h.manager.state;
    expect(state.kind).toBe("error");
    if (state.kind === "error") {
      expect(state.error.failure.kind).toBe("process-exited");
    }
  });
});

describe("ServerManager onboardClient chain", () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it("returns the todo-7 client, probeFetch and running capabilities against the mock server", async () => {
    // Given a real running mock opencode server (basic-chat scenario)
    mock = await startMockServer(0, { scenario: "basic-chat" });
    const channel = new CapturingChannel();
    const logger = new PanelLogger(channel, () => true);
    const spawn = new FakeSpawnFactory();
    const manager = new ServerManager({
      config: makeConfigAccessor({ ...BASE_CONFIG, serverUrl: mock.url }),
      secrets: new PanelSecrets(new FakeSecretStorage()),
      logger,
      spawner: spawn.spawner,
      workspaceFolder: () => "/fake/workspace",
      clock: new InstantClock(),
    });
    // When: detect → connect → capability detection chain
    const onboard = await manager.onboardClient();
    // Then
    expect(onboard.ok).toBe(true);
    if (!onboard.ok) throw new Error(onboard.error.message);
    expect(onboard.connection.baseUrl).toBe(mock.url);
    expect(onboard.connection.ownership).toBe("attached");
    expect(typeof onboard.connection.probeFetch).toBe("function");
    expect(onboard.connection.client).toBeDefined();
    expect(onboard.connection.capabilities.version).toBe(MODERN_VERSION);
    expect(onboard.connection.capabilities.hasFork).toBe(true);
    expect(onboard.connection.capabilities.hasTodo).toBe(true);
    expect(onboard.connection.capabilities.agents.length).toBeGreaterThan(0);
    expect(spawn.calls).toHaveLength(0);
    // And stopping detaches without touching the foreign server
    await manager.stop();
    expect(manager.state.kind).toBe("stopped");
    manager.dispose();
  });

  it("onboardClient surfaces the start error unchanged when the server is unreachable", async () => {
    // Given nothing to attach to and autostart disabled
    const channel = new CapturingChannel();
    const logger = new PanelLogger(channel, () => true);
    const spawn = new FakeSpawnFactory();
    const fetchCalls = new FakeFetch(Number.MAX_SAFE_INTEGER, "down");
    const manager = new ServerManager({
      config: makeConfigAccessor({ ...BASE_CONFIG, autoStartServer: false }),
      secrets: new PanelSecrets(new FakeSecretStorage()),
      logger,
      spawner: spawn.spawner,
      workspaceFolder: () => "/fake/workspace",
      fetchImpl: fetchCalls.fetch,
      clock: new InstantClock(),
    });
    // When
    const onboard = await manager.onboardClient();
    // Then
    expect(onboard.ok).toBe(false);
    if (onboard.ok) throw new Error("expected onboard failure");
    const failure: ServerStartError = onboard.error;
    expect(failure.failure.kind).toBe("autostart-disabled");
    manager.dispose();
  });
});

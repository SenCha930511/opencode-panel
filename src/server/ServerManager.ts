/**
 * Server lifecycle manager (plan todo 8): detect / spawn / attach / stop / restart.
 *
 * allow: SIZE_OK — indivisible lifecycle state machine: every transition and
 * the plan's failure-recovery flows (ENOENT, EADDRINUSE×2, health timeout,
 * unexpected exit) mutually own the run bookkeeping; the pure contracts are
 * split into ./serverLifecycle.ts (re-exported below as the public path).
 *
 * PUBLIC SURFACE (consumed by todos 9, 10, 16, 22):
 * - {@link ServerManager.state} / {@link ServerManager.onDidChangeState}: the
 *   lifecycle discriminated union
 *     stopped → probing → managed|attached → stopping → stopped
 *   plus "error" (actionable failure; cleared by start()/stop()). Every
 *   transition is emitted to subscribers (T6 {@link Event} pattern).
 * - {@link ServerManager.baseUrl}: defined while managed/attached.
 * - {@link ServerManager.onboardClient}: starts if needed, then resolves the
 *   detect→connect→capability chain todos 9/10 need — the todo-7 panel client
 *   `{ client, probeFetch }` (auth-injecting, per T7 contract) plus running
 *   `Capabilities` from the todo-7 detector. Result shape:
 *   `{ ok: true, connection: ServerConnection } | { ok: false, error: ServerStartError }`.
 * - {@link ServerManager.detector}: the shared todo-7 CapabilityDetector; todo 9
 *   calls `detector.invalidate(baseUrl)` on `server.connected`, then re-detects.
 * - Errors: start()/onboardClient() never throw for lifecycle failures — they
 *   return `{ ok: false, error: ServerStartError }` whose `failure` union names
 *   the cause: `binary-not-found` (message names the `opencodePanel.binaryPath`
 *   setting), `port-in-use` (port + baseUrl), `autostart-disabled` (names
 *   `opencodePanel.autoStartServer`), `health-timeout`, `process-exited`,
 *   `spawn-failed`, `cancelled`.
 *
 * OWNERSHIP RULES (plan §Adopted Defaults, first-window-owns):
 * - A foreign (already-running) healthy server is ATTACHED and NEVER killed on
 *   stop()/dispose() — a secondary window attaches automatically.
 * - Only a child spawned by THIS manager is killed (SIGTERM, 3s grace, SIGKILL).
 * - EADDRINUSE after a spawn means another window won the race: re-probe
 *   /global/health after 2s and attach when healthy; error only when still
 *   unhealthy.
 *
 * SPAWN CONTRACT: `binaryPath serve --port <port> --hostname <hostname> ...serverArgs`,
 * cwd = the first workspace folder (injected), env = full passthrough of the
 * injected process env (default `process.env`) — including
 * OPENCODE_SERVER_PASSWORD/OPENCODE_SERVER_USERNAME, which come from the USER'S
 * ENVIRONMENT ONLY and are never read from settings or written to logs
 * (stdout/stderr route through the todo-6 redacted logger). One manager per
 * extension host (never one per webview); hunting a free port for user TUIs is
 * a documented non-goal — the configured port is authoritative.
 *
 * SEAMS (unit tests never touch node:child_process or the network): spawn
 * function ({@link ChildSpawner}), {@link ProbeFetch}, workspace-folder provider,
 * env provider, {@link Clock} (injected delays make tests instant and
 * deterministic) and {@link ServerTiming}. The 1.5s detect timeout rides the
 * request's AbortSignal (transport), never the injected clock. The
 * vscode/node-backed factory lives in `src/host/vscode-adapter.ts`; this
 * module imports NO `vscode`.
 */

import {
  serverBaseUrl,
  type Event,
  type Listener,
  type PanelConfig,
} from "../host/config.js";
import type { PanelLogger } from "../host/logger.js";
import {
  createPanelClient,
  type PanelServerClient,
  type ProbeFetch,
} from "./clientFactory.js";
import {
  createCapabilityDetector,
  type CapabilityDetector,
} from "./capabilityDetector.js";
import {
  createSystemClock,
  DEFAULT_SERVER_TIMING,
  ServerStartError,
  type Clock,
  type ServerManagerDeps,
  type ServerManagerState,
  type ServerStartFailure,
  type ServerTiming,
  type SpawnError,
  type SpawnedProcess,
  type StartResult,
  type OnboardResult,
} from "./serverLifecycle.js";

export { DEFAULT_SERVER_TIMING, ServerStartError } from "./serverLifecycle.js";
export type {
  ChildExit,
  ChildSpawner,
  Clock,
  KillSignal,
  OnboardResult,
  ServerConnection,
  ServerManagerDeps,
  ServerManagerState,
  ServerStartFailure,
  ServerTiming,
  SpawnError,
  SpawnOptions,
  SpawnedProcess,
  StartResult,
} from "./serverLifecycle.js";

// ---------------------------------------------------------------------------
// Internals.

interface StartRun {
  stopRequested: boolean;
  child: SpawnedProcess | undefined;
  readonly promise: Promise<StartResult>;
}

interface SpawnedServer {
  readonly child: SpawnedProcess;
  sawAddrInUse(): boolean;
}

type SpawnOutcome =
  | { readonly kind: "healthy" }
  | { readonly kind: "spawn-error"; readonly error: SpawnError }
  | { readonly kind: "process-exited"; readonly exitCode: number | null }
  | { readonly kind: "health-timeout" }
  | { readonly kind: "cancelled" };

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      const fn = resolveFn;
      if (fn !== undefined) fn(value);
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}

const STDERR_TAIL_LIMIT = 4096;
const EADDRINUSE_MARKER = "EADDRINUSE";

export class ServerManager {
  private readonly deps: ServerManagerDeps;
  private readonly timing: ServerTiming;
  private readonly clock: Clock;
  private readonly fetchImpl: ProbeFetch;
  private readonly logger: PanelLogger;
  private readonly listeners = new Set<Listener<ServerManagerState>>();

  /** Shared todo-7 detector; todo 9 invalidates on `server.connected`. */
  readonly detector: CapabilityDetector;
  readonly onDidChangeState: Event<ServerManagerState>;

  private current: ServerManagerState = { kind: "stopped" };
  private activeRun: StartRun | undefined;
  private ownedChild: SpawnedProcess | undefined;
  private panel: PanelServerClient | undefined;
  private stopInFlight: Promise<void> | undefined;

  constructor(deps: ServerManagerDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.clock = deps.clock ?? createSystemClock();
    this.timing = { ...DEFAULT_SERVER_TIMING, ...deps.timing };
    this.fetchImpl = deps.fetchImpl ?? ((request: Request) => globalThis.fetch(request));
    this.onDidChangeState = (listener) => {
      this.listeners.add(listener);
      return {
        dispose: () => {
          this.listeners.delete(listener);
        },
      };
    };
    const folder = deps.workspaceFolder();
    this.detector = createCapabilityDetector({
      logger: deps.logger,
      minimumServerVersion: deps.config.read().minimumServerVersion,
      // Raw probes ride the CURRENT panel client's auth-injecting fetch so
      // authed servers probe correctly (todo-7 wiring contract).
      probeFetch: (request) => (this.panel?.probeFetch ?? this.fetchImpl)(request),
      ...(folder === undefined ? {} : { workspaceDir: folder }),
    });
  }

  get state(): ServerManagerState {
    return this.current;
  }

  get baseUrl(): string | undefined {
    const state = this.current;
    return state.kind === "managed" || state.kind === "attached" ? state.baseUrl : undefined;
  }

  // -- public commands ------------------------------------------------------

  start(): Promise<StartResult> {
    const state = this.current;
    switch (state.kind) {
      case "managed":
      case "attached":
        return Promise.resolve({ ok: true, state: state.kind, baseUrl: state.baseUrl });
      case "probing": {
        const run = this.activeRun;
        if (run === undefined) throw new Error("invariant violated: probing without an active run");
        return run.promise;
      }
      case "stopping": {
        const stopping = this.stopInFlight;
        if (stopping === undefined) throw new Error("invariant violated: stopping without an in-flight stop");
        return stopping.then(() => this.start());
      }
      case "stopped":
      case "error":
        return this.launch();
      default:
        return assertNever(state);
    }
  }

  async stop(): Promise<void> {
    const state = this.current;
    switch (state.kind) {
      case "stopped":
      case "stopping":
        return;
      case "error":
        this.transition({ kind: "stopped" });
        return;
      case "probing": {
        const run = this.activeRun;
        if (run === undefined) return;
        this.transition({ kind: "stopping" });
        this.stopInFlight = this.finishStopFromProbing(run);
        await this.stopInFlight;
        this.stopInFlight = undefined;
        return;
      }
      case "managed": {
        this.transition({ kind: "stopping" });
        this.stopInFlight = this.finishStopOwned();
        await this.stopInFlight;
        this.stopInFlight = undefined;
        return;
      }
      case "attached":
        // NEVER signal a foreign server; ownership stays with the spawning window/user.
        this.transition({ kind: "stopping" });
        this.logger.info(`detached from opencode server at ${state.baseUrl} (server left running)`);
        this.transition({ kind: "stopped" });
        return;
      default:
        return assertNever(state);
    }
  }

  async restart(): Promise<StartResult> {
    await this.stop();
    return this.start();
  }

  /**
   * Detect→connect→capability chain (todos 9/10): ensures the server is
   * running, then returns the todo-7 client + running capabilities. The
   * client is recreated per start run, resetting the cached auth header.
   */
  async onboardClient(): Promise<OnboardResult> {
    const started = await this.start();
    if (!started.ok) return { ok: false, error: started.error };
    const panel = this.panel;
    if (panel === undefined) throw new Error("invariant violated: running without a panel client");
    const capabilities = await this.detector.detect(panel.client, started.baseUrl);
    return {
      ok: true,
      connection: {
        baseUrl: started.baseUrl,
        ownership: started.state,
        client: panel.client,
        probeFetch: panel.probeFetch,
        capabilities,
      },
    };
  }

  dispose(): void {
    void this.stop().then(
      () => this.listeners.clear(),
      (error: unknown) => {
        this.logger.warn(`ServerManager dispose: stop failed: ${String(error)}`);
        this.listeners.clear();
      },
    );
  }

  // -- start pipeline ---------------------------------------------------------

  private launch(): Promise<StartResult> {
    const deferredStart = deferred<StartResult>();
    const run: StartRun = { stopRequested: false, child: undefined, promise: deferredStart.promise };
    this.activeRun = run;
    const config = this.deps.config.read();
    const baseUrl = serverBaseUrl(config);
    this.transition({ kind: "probing", baseUrl });
    void this.runStart(run, config, baseUrl)
      .catch((error: unknown): StartResult => {
        // Pipeline never throws by construction; safety net only.
        const wrapped = new ServerStartError({ kind: "spawn-failed", detail: String(error) });
        this.logger.error(wrapped.message);
        this.transition({ kind: "error", error: wrapped });
        return { ok: false, error: wrapped };
      })
      .then((result) => {
        this.activeRun = undefined;
        deferredStart.resolve(result);
      });
    return deferredStart.promise;
  }

  private async runStart(
    run: StartRun,
    config: PanelConfig,
    baseUrl: string,
  ): Promise<StartResult> {
    // Client is created BEFORE probing so every raw probe rides the
    // auth-injecting probeFetch (todo-7 wiring contract; cheap, no I/O).
    const panel = createPanelClient(baseUrl, {
      secrets: this.deps.secrets,
      logger: this.logger,
      fetchImpl: this.fetchImpl,
    });
    this.panel = panel;

    // Detect: TWO probes, 1.5s timeout each, before concluding "down".
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (run.stopRequested) return this.cancelStart();
      if (await this.probeOnce(panel.probeFetch, baseUrl)) {
        this.logger.info(`attached to existing opencode server at ${baseUrl} (detect probe ${attempt})`);
        this.transition({ kind: "attached", baseUrl });
        return { ok: true, state: "attached", baseUrl };
      }
    }
    if (run.stopRequested) return this.cancelStart();

    if (!config.autoStartServer) {
      return this.fail({ kind: "autostart-disabled", baseUrl });
    }

    const spawned = this.spawnServer(config);
    run.child = spawned.child;
    const outcome = await this.waitForHealthy(run, spawned, panel.probeFetch, baseUrl);
    run.child = undefined;
    switch (outcome.kind) {
      case "healthy":
        this.ownedChild = spawned.child;
        this.watchOwnedChild(spawned.child, baseUrl);
        this.logger.info(`managed opencode server at ${baseUrl} (pid ${spawned.child.pid ?? "?"})`);
        this.transition({ kind: "managed", baseUrl });
        return { ok: true, state: "managed", baseUrl };
      case "cancelled":
        return this.cancelStart();
      case "spawn-error":
        if (outcome.error.code === "ENOENT") {
          return this.fail({ kind: "binary-not-found", binaryPath: config.binaryPath });
        }
        if (outcome.error.code === EADDRINUSE_MARKER) {
          return this.attachAfterPortInUse(run, panel.probeFetch, baseUrl, config);
        }
        return this.fail({ kind: "spawn-failed", detail: outcome.error.message });
      case "process-exited":
        if (spawned.sawAddrInUse()) {
          return this.attachAfterPortInUse(run, panel.probeFetch, baseUrl, config);
        }
        return this.fail({ kind: "process-exited", exitCode: outcome.exitCode });
      case "health-timeout":
        await this.terminate(spawned.child);
        return this.fail({ kind: "health-timeout", timeoutMs: this.timing.healthWaitTimeoutMs });
      default:
        return assertNever(outcome);
    }
  }

  /**
   * First-window-owns rule: our spawn lost the port to another window's
   * server. Re-probe /global/health after 2s and attach when the winner is
   * healthy; error only when still unhealthy.
   */
  private async attachAfterPortInUse(
    run: StartRun,
    probeFetch: ProbeFetch,
    baseUrl: string,
    config: PanelConfig,
  ): Promise<StartResult> {
    this.logger.warn(
      `port ${config.port} is already in use; re-probing ${baseUrl}/global/health ` +
        `after ${this.timing.eaddrinuseRetryDelayMs}ms (another window may own the server)`,
    );
    await this.clock.delay(this.timing.eaddrinuseRetryDelayMs);
    if (run.stopRequested) return this.cancelStart();
    if (await this.probeOnce(probeFetch, baseUrl)) {
      this.logger.info(`attached to existing opencode server at ${baseUrl} (first-window-owns)`);
      this.transition({ kind: "attached", baseUrl });
      return { ok: true, state: "attached", baseUrl };
    }
    return this.fail({ kind: "port-in-use", port: config.port, baseUrl });
  }

  private spawnServer(config: PanelConfig): SpawnedServer {
    const args = [
      "serve",
      "--port",
      String(config.port),
      "--hostname",
      config.hostname,
      ...config.serverArgs,
    ];
    const cwd = this.deps.workspaceFolder();
    const env = { ...(this.deps.env?.() ?? process.env) };
    const child = this.deps.spawner(config.binaryPath, args, { cwd, env });
    child.onStdout((chunk) => this.logger.processStdout(chunk));
    let stderrTail = "";
    child.onStderr((chunk) => {
      this.logger.processStderr(chunk);
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
    });
    this.logger.info(
      `spawning opencode server: ${config.binaryPath} ${args.join(" ")} (cwd: ${cwd ?? "inherited"})`,
    );
    return { child, sawAddrInUse: () => stderrTail.includes(EADDRINUSE_MARKER) };
  }

  /**
   * One /global/health probe with the plan's 1.5s timeout enforced at the
   * TRANSPORT (AbortSignal on the request) so an injected instant clock can
   * never out-race a fast answer. Any failure (refused, timeout, !2xx,
   * auth-required surfaced by the panel fetch) means "not healthy".
   */
  private async probeOnce(probeFetch: ProbeFetch, baseUrl: string): Promise<boolean> {
    const request = new Request(`${baseUrl}/global/health`, {
      signal: AbortSignal.timeout(this.timing.detectProbeTimeoutMs),
    });
    try {
      const response = await probeFetch(request);
      return response.ok;
    } catch (error) {
      this.logger.debug(
        `health probe for ${baseUrl} failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Poll /global/health every {@link ServerTiming.healthPollIntervalMs} until
   * healthy, the child reports a spawn outcome, the budget runs out, or a stop
   * request lands (termination belongs to stop(), not this loop).
   */
  private async waitForHealthy(
    run: StartRun,
    spawned: SpawnedServer,
    probeFetch: ProbeFetch,
    baseUrl: string,
  ): Promise<SpawnOutcome> {
    const child = spawned.child;
    const childEvent: Promise<SpawnOutcome> = Promise.race([
      child.spawnFailed.then((error): SpawnOutcome => ({ kind: "spawn-error", error })),
      child.exited.then(
        (exit): SpawnOutcome => ({ kind: "process-exited", exitCode: exit.code }),
      ),
    ]);
    let remaining = this.timing.healthWaitTimeoutMs;
    while (run.child === child) {
      if (run.stopRequested) return { kind: "cancelled" };
      const winner = await Promise.race([
        this.probeOnce(probeFetch, baseUrl).then((ok) => ({ tag: "poll" as const, ok })),
        childEvent.then((outcome) => ({ tag: "child" as const, outcome })),
      ]);
      if (winner.tag === "child") return winner.outcome;
      if (winner.ok) return { kind: "healthy" };
      if (remaining <= this.timing.healthPollIntervalMs) return { kind: "health-timeout" };
      await this.clock.delay(this.timing.healthPollIntervalMs);
      remaining -= this.timing.healthPollIntervalMs;
    }
    return { kind: "cancelled" };
  }

  /** SIGTERM, 3s grace, SIGKILL — only ever invoked on a self-spawned child. */
  private async terminate(child: SpawnedProcess): Promise<void> {
    child.kill("SIGTERM");
    // Race arms AFTER kill: a child already exited (or exiting synchronously
    // on TERM) then deterministically wins over the grace timer.
    const graceful = await Promise.race([
      child.exited.then(() => true as const),
      this.clock.delay(this.timing.sigkillGraceMs).then(() => false as const),
    ]);
    if (!graceful) {
      this.logger.warn("opencode server ignored SIGTERM; sending SIGKILL");
      child.kill("SIGKILL");
    }
  }

  private cancelStart(): StartResult {
    const error = new ServerStartError({ kind: "cancelled" });
    this.transition({ kind: "stopped" });
    return { ok: false, error };
  }

  private fail(failure: ServerStartFailure): { readonly ok: false; readonly error: ServerStartError } {
    const error = new ServerStartError(failure);
    this.logger.error(error.message);
    this.transition({ kind: "error", error });
    return { ok: false, error };
  }

  private async finishStopFromProbing(run: StartRun): Promise<void> {
    run.stopRequested = true;
    if (run.child !== undefined) await this.terminate(run.child);
    // The run observes stopRequested at its next boundary, transitions to
    // stopped, and resolves; awaiting serializes the state machine for start().
    await run.promise.catch((error: unknown) => {
      this.logger.warn(`stop during probing: start pipeline rejected: ${String(error)}`);
    });
  }

  private async finishStopOwned(): Promise<void> {
    const child = this.ownedChild;
    this.ownedChild = undefined;
    if (child !== undefined) {
      await this.terminate(child);
      this.logger.info("stopped managed opencode server");
    }
    this.transition({ kind: "stopped" });
  }

  /** A managed child dying while we own it flips the state to error (server lost). */
  private watchOwnedChild(child: SpawnedProcess, baseUrl: string): void {
    void child.exited.then((exit) => {
      if (this.ownedChild !== child || this.current.kind !== "managed") return;
      this.ownedChild = undefined;
      this.logger.warn(
        `managed opencode server at ${baseUrl} exited unexpectedly (code ${exit.code ?? "null"})`,
      );
      this.transition({
        kind: "error",
        error: new ServerStartError({ kind: "process-exited", exitCode: exit.code }),
      });
    });
  }

  private transition(next: ServerManagerState): void {
    this.current = next;
    for (const listener of [...this.listeners]) {
      listener(next);
    }
  }
}

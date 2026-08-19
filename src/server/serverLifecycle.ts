/**
 * Pure contracts for the todo-8 server lifecycle manager: the state machine
 * union, typed start failures, start/onboard results, the injectable seams
 * (spawner / clock / timing / deps) and their production defaults.
 *
 * Behavior (the state machine itself) lives in `ServerManager.ts`, which
 * re-exports everything here so consumers have one public import path.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelConfigAccessor } from "../host/config.js";
import type { PanelLogger } from "../host/logger.js";
import type { PanelSecrets } from "../host/secrets.js";
import type { ProbeFetch } from "./clientFactory.js";
import type { Capabilities } from "./capabilities.js";

// ---------------------------------------------------------------------------
// State machine: stopped → probing → managed|attached → stopping → stopped,
// plus "error" (actionable failure; cleared by start()/stop()).

export type ServerManagerState =
  | { readonly kind: "stopped" }
  | { readonly kind: "probing"; readonly baseUrl: string }
  | { readonly kind: "managed"; readonly baseUrl: string }
  | { readonly kind: "attached"; readonly baseUrl: string }
  | { readonly kind: "stopping" }
  | { readonly kind: "error"; readonly error: ServerStartError };

// ---------------------------------------------------------------------------
// Failures + results.

export type ServerStartFailure =
  | { readonly kind: "binary-not-found"; readonly binaryPath: string }
  | { readonly kind: "spawn-failed"; readonly detail: string }
  | { readonly kind: "process-exited"; readonly exitCode: number | null }
  | { readonly kind: "port-in-use"; readonly port: number; readonly baseUrl: string }
  | { readonly kind: "health-timeout"; readonly timeoutMs: number }
  | { readonly kind: "autostart-disabled"; readonly baseUrl: string }
  | { readonly kind: "cancelled" };

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}

/** Actionable, loggable text for a start failure. NEVER carries credential material. */
function describeFailure(failure: ServerStartFailure): string {
  switch (failure.kind) {
    case "binary-not-found":
      return (
        `opencode binary '${failure.binaryPath}' could not be started (ENOENT); ` +
        `install opencode or fix the opencodePanel.binaryPath setting`
      );
    case "spawn-failed":
      return `failed to spawn the opencode server: ${failure.detail}`;
    case "process-exited":
      return `opencode server process exited with code ${failure.exitCode ?? "null"} before becoming healthy`;
    case "port-in-use":
      return (
        `port ${failure.port} is already in use and no healthy opencode server answered ` +
        `at ${failure.baseUrl}/global/health after re-probing; check the opencodePanel.port setting`
      );
    case "health-timeout":
      return `opencode server did not become healthy within ${failure.timeoutMs}ms`;
    case "autostart-disabled":
      return (
        `no opencode server answered at ${failure.baseUrl}/global/health and ` +
        `opencodePanel.autoStartServer is off; start a server manually or enable the setting`
      );
    case "cancelled":
      return `start cancelled (manager is stopping)`;
    default:
      return assertNever(failure);
  }
}

/** Lifecycle failure surfaced via StartResult/OnboardResult and the "error" state. */
export class ServerStartError extends Error {
  readonly failure: ServerStartFailure;

  constructor(failure: ServerStartFailure) {
    super(describeFailure(failure));
    this.name = "ServerStartError";
    this.failure = failure;
  }
}

export type StartResult =
  | { readonly ok: true; readonly state: "managed" | "attached"; readonly baseUrl: string }
  | { readonly ok: false; readonly error: ServerStartError };

/** The detect→connect→capability chain: ready client + running capabilities. */
export interface ServerConnection {
  readonly baseUrl: string;
  readonly ownership: "managed" | "attached";
  readonly client: OpencodeClient;
  /** Auth-injecting fetch backing `client` — hand to the SSE bridge (todo 9). */
  readonly probeFetch: ProbeFetch;
  readonly capabilities: Capabilities;
}

export type OnboardResult =
  | { readonly ok: true; readonly connection: ServerConnection }
  | { readonly ok: false; readonly error: ServerStartError };

// ---------------------------------------------------------------------------
// Injectable seams.

export type KillSignal = "SIGTERM" | "SIGKILL";

export interface SpawnOptions {
  /** Spawn cwd (first workspace folder); explicit undefined = inherit. */
  readonly cwd: string | undefined;
  /** Full env passthrough; includes OPENCODE_SERVER_PASSWORD/USERNAME from the user env. */
  readonly env: Record<string, string | undefined>;
}

export interface ChildExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface SpawnError {
  readonly message: string;
  /** ErrnoException code when present (`ENOENT`, `EADDRINUSE`, ...). */
  readonly code?: string;
}

/**
 * Minimal child-process seam mirrored from `node:child_process`. `exited`
 * resolves exactly once when the process ends; `spawnFailed` resolves only
 * when spawning itself failed (stays pending on success).
 */
export interface SpawnedProcess {
  readonly pid: number | undefined;
  kill(signal: KillSignal): boolean;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  readonly exited: Promise<ChildExit>;
  readonly spawnFailed: Promise<SpawnError>;
}

export type ChildSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess;

/** Injected delay source; tests use an instant clock so timings never sleep. */
export interface Clock {
  delay(ms: number): Promise<void>;
}

export interface ServerTiming {
  /** Per-probe timeout for the initial /global/health detection (plan: 1500ms ×2). */
  readonly detectProbeTimeoutMs: number;
  /** Poll interval while waiting for a spawned server (plan: 250ms). */
  readonly healthPollIntervalMs: number;
  /** Give-up budget for a spawned server to become healthy (plan: 20000ms). */
  readonly healthWaitTimeoutMs: number;
  /** EADDRINUSE re-probe delay (plan: 2000ms; first-window-owns rule). */
  readonly eaddrinuseRetryDelayMs: number;
  /** SIGTERM grace before SIGKILL (plan: 3000ms). */
  readonly sigkillGraceMs: number;
}

export const DEFAULT_SERVER_TIMING: ServerTiming = {
  detectProbeTimeoutMs: 1500,
  healthPollIntervalMs: 250,
  healthWaitTimeoutMs: 20000,
  eaddrinuseRetryDelayMs: 2000,
  sigkillGraceMs: 3000,
};

/** Production clock backed by real timers (the default when none is injected). */
export function createSystemClock(): Clock {
  return {
    delay: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

export interface ServerManagerDeps {
  readonly config: PanelConfigAccessor;
  readonly secrets: PanelSecrets;
  readonly logger: PanelLogger;
  readonly spawner: ChildSpawner;
  /** First workspace folder for the spawned server cwd; undefined = inherit. */
  readonly workspaceFolder: () => string | undefined;
  /** Process env passthrough for spawn; default `process.env`. NEVER settings. */
  readonly env?: () => Record<string, string | undefined>;
  /** Underlying fetch for probes and the panel client; default `globalThis.fetch`. */
  readonly fetchImpl?: ProbeFetch;
  readonly clock?: Clock;
  readonly timing?: Partial<ServerTiming>;
}

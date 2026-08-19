/**
 * Thin seam between the pure host modules (config / secrets / logger) and
 * the real `vscode` API surface. This is the ONLY file under `src/host/`
 * that resolves the extension-host `vscode` module at runtime, so unit
 * tests (which run under node + vitest) never touch it.
 *
 * The factories below are wired by `extension.ts` at activation time.
 */
import { spawn } from "node:child_process";
import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  createConfigAccessor,
  type PanelConfigAccessor,
} from "./config.js";
import { PanelLogger } from "./logger.js";
import { PanelSecrets } from "./secrets.js";
import {
  ServerManager,
  type ChildExit,
  type ChildSpawner,
  type SpawnError,
} from "../server/ServerManager.js";

/**
 * Typed config accessor backed by `workspace.getConfiguration("opencodePanel")`
 * and `workspace.onDidChangeConfiguration` (pre-filtered to our section).
 */
export function createVscodeConfigAccessor(): PanelConfigAccessor {
  return createConfigAccessor(
    {
      get: <T>(key: string): T | undefined =>
        vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key),
    },
    {
      onChange: (listener) =>
        vscode.workspace.onDidChangeConfiguration((event) => listener(event)),
    },
  );
}

/** Credential store backed by the extension context's SecretStorage. */
export function createVscodeSecrets(context: vscode.ExtensionContext): PanelSecrets {
  return new PanelSecrets(context.secrets);
}

/**
 * Logger writing to the "OpenCode Panel" output channel. The returned
 * channel must be pushed onto `context.subscriptions` by the caller so it
 * is disposed with the extension.
 */
export function createVscodeLogger(debugEnabled: () => boolean): {
  readonly logger: PanelLogger;
  readonly channel: vscode.OutputChannel;
} {
  const channel = vscode.window.createOutputChannel("OpenCode Panel");
  return { logger: new PanelLogger(channel, debugEnabled), channel };
}

/**
 * Spawner backed by `node:child_process.spawn` for the todo-8 ServerManager.
 * stdio is piped so stdout/stderr route through the redacted logger; the one
 * shot exit/spawn-failure promises are registered at spawn time so no event
 * can fire before the manager wires its listeners.
 */
export function createNodeSpawner(): ChildSpawner {
  return (command, args, options) => {
    const child = spawn(command, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutListeners = new Set<(chunk: string) => void>();
    const stderrListeners = new Set<(chunk: string) => void>();
    if (child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        for (const listener of stdoutListeners) listener(chunk);
      });
    }
    if (child.stderr !== null) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        for (const listener of stderrListeners) listener(chunk);
      });
    }
    const exited = new Promise<ChildExit>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const spawnFailed = new Promise<SpawnError>((resolve) => {
      child.once("error", (error: Error & { code?: string }) =>
        resolve({
          message: error.message,
          ...(error.code === undefined ? {} : { code: error.code }),
        }),
      );
    });
    return {
      pid: child.pid,
      kill: (signal) => child.kill(signal),
      onStdout: (listener) => stdoutListeners.add(listener),
      onStderr: (listener) => stderrListeners.add(listener),
      exited,
      spawnFailed,
    };
  };
}

/**
 * Production ServerManager: node spawner + first-workspace-folder cwd + the
 * user's process env (carrying OPENCODE_SERVER_PASSWORD/USERNAME). The
 * manager owns the lifecycle; push it onto `context.subscriptions` at
 * activation so dispose() kills only a self-spawned child.
 */
export function createVscodeServerManager(deps: {
  readonly config: PanelConfigAccessor;
  readonly secrets: PanelSecrets;
  readonly logger: PanelLogger;
}): ServerManager {
  return new ServerManager({
    ...deps,
    spawner: createNodeSpawner(),
    workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    env: () => process.env,
  });
}

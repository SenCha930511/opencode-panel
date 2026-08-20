/**
 * TUI escape hatch (plan todo 22): one integrated terminal per workspace
 * named "OpenCode TUI", launching the real opencode client so users always
 * have the native TUI one click away. Reuses that terminal across
 * invocations — a command NEVER spawns a second terminal.
 *
 * Launch plan from the ServerManager state:
 * - managed | attached: `<binaryPath> attach <baseUrl>` — the running
 *   server is there, so attach to it. Basic-auth credentials stored in
 *   SecretStorage (todo 3 creds flow) are injected into the terminal
 *   environment as OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME at
 *   creation time, so attaching to a password-secured server works without
 *   manual re-auth. Secrets ride the env only: they NEVER appear on the
 *   command line (shell history) or in logs (todo-6 redaction).
 * - anything else: plain `<binaryPath>` (the TUI starts/stops its own
 *   server from inside).
 *
 * Fallback hedge (older CLI without `attach`): the attach attempt runs
 * through shell integration when its exit code is observable; a non-zero
 * exit (incl. command-not-found) re-runs the plain binary IN THE SAME
 * terminal and surfaces one info toast. When the exit code is not
 * observable the attempt stands as-is — detection only "when readable".
 *
 * This module is vscode-free: terminals arrive through the
 * {@link TuiTerminalFactory} seam; the vscode-backed factory lives in
 * `./vscode-adapter-ide.ts`.
 */

import type { Disposable, Event, PanelConfig } from "./config.js";
import type { PanelLogger } from "./logger.js";
import type { PanelSecrets } from "./secrets.js";
import type { ServerManagerState } from "../server/serverLifecycle.js";

/** Terminal name; one per workspace, reused across invocations. */
export const TUI_TERMINAL_NAME = "OpenCode TUI";

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------
// Seams mirrored from the vscode terminal surface.

export interface TuiTerminalOptions {
  readonly name: string;
  /**
   * Extra env merged into the terminal process at creation time. Carries
   * the injected server credentials; production side must keep it out of
   * every log line.
   */
  readonly env: Record<string, string>;
}

export interface TuiTerminalHandle {
  show(): void;
  /**
   * Runs `line` in the terminal. Resolves the exit code when the host can
   * observe it (shell integration); resolves `undefined` when it cannot —
   * the fallback decision then cannot be made and the attempt stands.
   */
  run(line: string): Promise<number | undefined>;
  /** Fires once when the user closes the terminal. */
  readonly onDidClose: Event<void>;
  /** Kills the terminal (used only to replace an idle wrong-env terminal). */
  dispose(): void;
}

export interface TuiTerminalFactory {
  create(options: TuiTerminalOptions): TuiTerminalHandle;
}

export interface TuiLauncherDeps {
  readonly getState: () => ServerManagerState;
  /** Fresh config snapshot; `binaryPath` is read per launch. */
  readonly config: () => PanelConfig;
  readonly secrets: PanelSecrets;
  readonly factory: TuiTerminalFactory;
  readonly logger: PanelLogger;
  /** Info toast surface (fallback notice only). */
  readonly info: (message: string) => void;
  /** Host runtime string lookup (vscode.l10n.t on the vscode side). */
  readonly t: (text: string) => string;
}

// ---------------------------------------------------------------------------
// Pure plan resolution.

export type TuiPlan =
  | { readonly kind: "attach"; readonly baseUrl: string }
  | { readonly kind: "plain" };

/** Connection resolution: a live server (managed or attached) is attachable. */
export function resolveTuiPlan(state: ServerManagerState): TuiPlan {
  switch (state.kind) {
    case "managed":
    case "attached":
      return { kind: "attach", baseUrl: state.baseUrl };
    case "stopped":
    case "probing":
    case "stopping":
    case "error":
      return { kind: "plain" };
    default:
      return assertNever(state);
  }
}

/** Single-quote a shell word (`'` → `'\''`), unconditionally: config-sourced values are workspace-controlled, so shell metacharacters must never reach the shell bare. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The exact command line executed in the terminal for a plan. */
export function planCommandLine(plan: TuiPlan, binaryPath: string): string {
  const binary = shellQuote(binaryPath);
  switch (plan.kind) {
    case "attach":
      return `${binary} attach ${shellQuote(plan.baseUrl)}`;
    case "plain":
      return binary;
    default:
      return assertNever(plan);
  }
}

/**
 * Credentials for an attach launch, read from SecretStorage (todo-6 flow).
 * Only present keys are injected; an unset username stays absent so the
 * server default ("opencode") applies.
 */
export async function credentialEnv(
  secrets: PanelSecrets,
  baseUrl: string,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const password = await secrets.getPassword(baseUrl);
  if (password !== undefined) env["OPENCODE_SERVER_PASSWORD"] = password;
  const username = await secrets.getUsername(baseUrl);
  if (username !== undefined) env["OPENCODE_SERVER_USERNAME"] = username;
  return env;
}

function sameEnv(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------------

/**
 * Owns the reused terminal. `open()` is the command body; it resolves the
 * plan, creates the terminal on first use (or replaces an IDLE one whose
 * injected env no longer matches), reveals it, and supervises the launch in
 * the background — a TUI runs until the user quits, so awaiting the exit
 * code must never block the command.
 */
export class TuiLauncher {
  private readonly deps: TuiLauncherDeps;
  private terminal: TuiTerminalHandle | undefined;
  private createdEnv: Record<string, string> = {};
  private closeSubscription: Disposable | undefined;
  /** A launch is believed to occupy the terminal (exit not yet observed). */
  private tuiRunning = false;

  constructor(deps: TuiLauncherDeps) {
    this.deps = deps;
  }

  async open(): Promise<void> {
    const plan = resolveTuiPlan(this.deps.getState());
    const env =
      plan.kind === "attach" ? await credentialEnv(this.deps.secrets, plan.baseUrl) : {};
    if (this.terminal !== undefined && !this.tuiRunning && !sameEnv(env, this.createdEnv)) {
      // Idle terminal built with different credentials would attach without
      // them — vscode applies env at creation time. Replace it (safe: it
      // is a plain shell, not a running TUI).
      this.disposeTerminal();
      this.deps.logger.debug("tui: recycled idle terminal to refresh injected environment");
    }
    if (this.terminal === undefined) {
      this.createdEnv = env;
      const terminal = this.deps.factory.create({ name: TUI_TERMINAL_NAME, env });
      this.terminal = terminal;
      this.closeSubscription = terminal.onDidClose(() => this.handleClosed(terminal));
      this.deps.logger.debug(`tui: terminal created (${plan.kind === "attach" ? "attach" : "plain"})`);
    }
    this.terminal.show();
    if (this.tuiRunning) return;
    this.tuiRunning = true;
    void this.supervise(this.terminal, plan);
  }

  /**
   * Detaches listeners. The terminal itself is NEVER disposed here — it is
   * the user's session and may outlive the extension host.
   */
  dispose(): void {
    this.closeSubscription?.dispose();
  }

  private async supervise(terminal: TuiTerminalHandle, plan: TuiPlan): Promise<void> {
    const binaryPath = this.deps.config().binaryPath;
    const exitCode = await terminal.run(planCommandLine(plan, binaryPath));
    if (plan.kind === "attach" && exitCode !== undefined && exitCode !== 0) {
      // Older CLI without `attach` (or any non-zero exit): same terminal,
      // plain binary, one toast — never a second terminal.
      this.deps.logger.warn(`tui: 'attach' exited with code ${exitCode}; falling back to plain`);
      this.deps.info(
        this.deps.t("'opencode attach' is unavailable; opened the plain opencode TUI instead."),
      );
      await terminal.run(shellQuote(binaryPath));
    }
    this.tuiRunning = false;
  }

  private handleClosed(terminal: TuiTerminalHandle): void {
    if (this.terminal !== terminal) return;
    this.terminal = undefined;
    this.createdEnv = {};
    this.tuiRunning = false;
    this.closeSubscription?.dispose();
    this.closeSubscription = undefined;
  }

  private disposeTerminal(): void {
    this.closeSubscription?.dispose();
    this.closeSubscription = undefined;
    this.terminal?.dispose();
    this.terminal = undefined;
    this.createdEnv = {};
  }
}

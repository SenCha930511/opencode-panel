import { describe, expect, it } from "vitest";
import {
  credentialEnv,
  planCommandLine,
  resolveTuiPlan,
  shellQuote,
  TUI_TERMINAL_NAME,
  TuiLauncher,
  type TuiTerminalFactory,
  type TuiTerminalHandle,
  type TuiTerminalOptions,
} from "../tui.js";
import { DEFAULT_PANEL_CONFIG, type Listener, type PanelConfig } from "../config.js";
import { PanelLogger } from "../logger.js";
import { PanelSecrets, type SecretStorage } from "../secrets.js";
import {
  ServerStartError,
  type ServerManagerState,
} from "../../server/serverLifecycle.js";

const MANAGED_URL = "http://127.0.0.1:4096";
const PASSWORD = "s3cret-pw";
const USERNAME = "tui-user";

class MemorySecrets implements SecretStorage {
  private readonly values = new Map<string, string>();

  get(key: string): PromiseLike<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): PromiseLike<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): PromiseLike<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

class FakeTerminal implements TuiTerminalHandle {
  shows = 0;
  disposed = false;
  readonly runs: string[] = [];
  private readonly closeListeners = new Set<Listener<void>>();

  constructor(
    private readonly exitQueue: Array<number | undefined>,
    private readonly hangRuns: { count: number },
  ) {}

  readonly onDidClose = (listener: Listener<void>): { dispose(): void } => {
    this.closeListeners.add(listener);
    return {
      dispose: () => {
        this.closeListeners.delete(listener);
      },
    };
  };

  show(): void {
    this.shows += 1;
  }

  run(line: string): Promise<number | undefined> {
    this.runs.push(line);
    if (this.hangRuns.count > 0) {
      this.hangRuns.count -= 1;
      // A TUI occupying the terminal: the exit is never observed.
      return new Promise(() => {});
    }
    return Promise.resolve(this.exitQueue.shift());
  }

  dispose(): void {
    this.disposed = true;
  }

  fireClose(): void {
    for (const listener of [...this.closeListeners]) listener();
  }

  get closeListenerCount(): number {
    return this.closeListeners.size;
  }
}

class FakeFactory implements TuiTerminalFactory {
  readonly options: TuiTerminalOptions[] = [];
  readonly terminals: FakeTerminal[] = [];
  /** Test script: run() calls shift exit codes from here (undefined = unreadable). */
  readonly exitQueue: Array<number | undefined> = [];
  /** Number of upcoming run() calls that never resolve. */
  readonly hangRuns = { count: 0 };

  create(options: TuiTerminalOptions): TuiTerminalHandle {
    this.options.push(options);
    const terminal = new FakeTerminal(this.exitQueue, this.hangRuns);
    this.terminals.push(terminal);
    return terminal;
  }
}

function makeLauncher(state: ServerManagerState, binaryPath = "opencode") {
  const source = { state };
  const config: PanelConfig = { ...DEFAULT_PANEL_CONFIG, binaryPath };
  const factory = new FakeFactory();
  const secrets = new PanelSecrets(new MemorySecrets());
  const logs: string[] = [];
  const logger = new PanelLogger({ appendLine: (line) => logs.push(line) }, () => true);
  const infos: string[] = [];
  const launcher = new TuiLauncher({
    getState: () => source.state,
    config: () => config,
    secrets,
    factory,
    logger,
    info: (message) => infos.push(message),
    t: (text) => text,
  });
  return { source, factory, secrets, logs, infos, launcher };
}

/** Drain the microtask chain behind the launcher's background supervision. */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("resolveTuiPlan", () => {
  it("attaches to the baseUrl when managed or attached", () => {
    // Given/When/Then
    expect(resolveTuiPlan({ kind: "managed", baseUrl: MANAGED_URL })).toEqual({
      kind: "attach",
      baseUrl: MANAGED_URL,
    });
    expect(resolveTuiPlan({ kind: "attached", baseUrl: MANAGED_URL })).toEqual({
      kind: "attach",
      baseUrl: MANAGED_URL,
    });
  });

  it("falls back to the plain binary when stopped, probing, stopping, or error", () => {
    // Given/When/Then: no live connection to attach to
    expect(resolveTuiPlan({ kind: "stopped" })).toEqual({ kind: "plain" });
    expect(resolveTuiPlan({ kind: "probing", baseUrl: MANAGED_URL })).toEqual({ kind: "plain" });
    expect(resolveTuiPlan({ kind: "stopping" })).toEqual({ kind: "plain" });
    expect(
      resolveTuiPlan({ kind: "error", error: new ServerStartError({ kind: "cancelled" }) }),
    ).toEqual({ kind: "plain" });
  });
});

describe("planCommandLine / shellQuote", () => {
  it("builds the attach argv for a connected plan", () => {
    // Given/When/Then
    expect(planCommandLine({ kind: "attach", baseUrl: MANAGED_URL }, "opencode")).toBe(
      `opencode attach ${MANAGED_URL}`,
    );
  });

  it("builds the bare binary line for a plain plan", () => {
    // Given/When/Then
    expect(planCommandLine({ kind: "plain" }, "opencode")).toBe("opencode");
  });

  it("quotes binary paths containing spaces", () => {
    // Given/When/Then
    expect(shellQuote("/opt/my tools/opencode")).toBe('"/opt/my tools/opencode"');
    expect(planCommandLine({ kind: "plain" }, "/opt/my tools/opencode")).toBe(
      '"/opt/my tools/opencode"',
    );
  });
});

describe("credentialEnv", () => {
  it("injects password and username from SecretStorage", async () => {
    // Given: stored credentials for the server
    const secrets = new PanelSecrets(new MemorySecrets());
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    await secrets.setUsername(MANAGED_URL, USERNAME);
    // When/Then
    await expect(credentialEnv(secrets, MANAGED_URL)).resolves.toEqual({
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      OPENCODE_SERVER_USERNAME: USERNAME,
    });
  });

  it("injects only the keys that are stored", async () => {
    // Given: password only
    const secrets = new PanelSecrets(new MemorySecrets());
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    // When
    const env = await credentialEnv(secrets, MANAGED_URL);
    // Then
    expect(env).toEqual({ OPENCODE_SERVER_PASSWORD: PASSWORD });
    expect("OPENCODE_SERVER_USERNAME" in env).toBe(false);
  });
});

describe("TuiLauncher", () => {
  it("runs attach with injected credentials when managed", async () => {
    // Given: a managed server with stored credentials
    const { factory, secrets, launcher } = makeLauncher({ kind: "managed", baseUrl: MANAGED_URL });
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    await secrets.setUsername(MANAGED_URL, USERNAME);
    // When
    await launcher.open();
    // Then: one terminal, exact argv, credentials riding the terminal env
    expect(factory.options).toEqual([
      {
        name: TUI_TERMINAL_NAME,
        env: {
          OPENCODE_SERVER_PASSWORD: PASSWORD,
          OPENCODE_SERVER_USERNAME: USERNAME,
        },
      },
    ]);
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`]);
    expect(factory.terminals[0]?.shows).toBe(1);
  });

  it("runs attach with injected credentials when attached", async () => {
    // Given: an attached (foreign) server with a stored password
    const { factory, secrets, launcher } = makeLauncher({ kind: "attached", baseUrl: MANAGED_URL });
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    // When
    await launcher.open();
    // Then
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`]);
    expect(factory.options[0]?.env).toEqual({ OPENCODE_SERVER_PASSWORD: PASSWORD });
  });

  it("runs the plain binary without credentials when stopped", async () => {
    // Given: no live server
    const { factory, launcher } = makeLauncher({ kind: "stopped" });
    // When
    await launcher.open();
    // Then
    expect(factory.terminals[0]?.runs).toEqual(["opencode"]);
    expect(factory.options[0]?.env).toEqual({});
  });

  it("reuses the terminal across invocations (created once)", async () => {
    // Given
    const { factory, launcher } = makeLauncher({ kind: "stopped" });
    // When: two invocations; the first launch exited (code 0) in between
    factory.exitQueue.push(0, 0);
    await launcher.open();
    await flush();
    await launcher.open();
    // Then: one terminal created, shown twice, one launch per invocation
    expect(factory.options).toHaveLength(1);
    expect(factory.terminals[0]?.shows).toBe(2);
    expect(factory.terminals[0]?.runs).toEqual(["opencode", "opencode"]);
  });

  it("does not relaunch while a TUI occupies the terminal", async () => {
    // Given: a launch whose exit is never observed (user still inside)
    const { factory, launcher } = makeLauncher({ kind: "stopped" });
    factory.hangRuns.count = 1;
    // When: two invocations
    await launcher.open();
    await launcher.open();
    // Then: one terminal, one command line, revealed both times
    expect(factory.options).toHaveLength(1);
    expect(factory.terminals[0]?.runs).toEqual(["opencode"]);
    expect(factory.terminals[0]?.shows).toBe(2);
  });

  it("falls back to the plain binary in the same terminal when attach exits non-zero", async () => {
    // QA failure scenario: older CLI without `attach` (exit 1)
    const { factory, logs, infos, launcher } = makeLauncher({
      kind: "managed",
      baseUrl: MANAGED_URL,
    });
    factory.exitQueue.push(1, 0);
    // When
    await launcher.open();
    await flush();
    // Then: plain binary re-run in the SAME terminal (no new creation), one toast
    expect(factory.options).toHaveLength(1);
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`, "opencode"]);
    expect(infos).toHaveLength(1);
    expect(logs.join("\n")).toContain("falling back");
  });

  it("treats a command-not-found exit (127) as attach-unavailable", async () => {
    // Given: the shell reports the verb missing
    const { factory, infos, launcher } = makeLauncher({ kind: "managed", baseUrl: MANAGED_URL });
    factory.exitQueue.push(127, 0);
    // When
    await launcher.open();
    await flush();
    // Then
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`, "opencode"]);
    expect(infos).toHaveLength(1);
  });

  it("starts no fallback when attach exits zero", async () => {
    // Given/When
    const { factory, infos, launcher } = makeLauncher({ kind: "managed", baseUrl: MANAGED_URL });
    factory.exitQueue.push(0);
    await launcher.open();
    await flush();
    // Then
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`]);
    expect(infos).toHaveLength(0);
  });

  it("keeps the attempt as-is when the exit code is not observable", async () => {
    // Given: run() resolves undefined (no shell integration); the attempt stands
    const { factory, infos, launcher } = makeLauncher({ kind: "managed", baseUrl: MANAGED_URL });
    await launcher.open();
    await flush();
    // Then: no fallback, no toast, and the launcher stays usable afterwards
    expect(factory.terminals[0]?.runs).toEqual([`opencode attach ${MANAGED_URL}`]);
    expect(infos).toHaveLength(0);
    await launcher.open();
    expect(factory.terminals[0]?.runs).toHaveLength(2);
  });

  it("never logs the injected credentials, even on the fallback path", async () => {
    // Advisory (binding): OPENCODE_SERVER_PASSWORD/USERNAME ride the terminal
    // env only; every log line passes the todo-6 redaction.
    const { factory, logs, secrets, launcher } = makeLauncher({
      kind: "managed",
      baseUrl: MANAGED_URL,
    });
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    await secrets.setUsername(MANAGED_URL, USERNAME);
    factory.exitQueue.push(1, 0);
    // When: full attach → fallback cycle with credentials in play
    await launcher.open();
    await flush();
    // Then: the cycle ran (assertion non-vacuous) and no credential leaked
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(PASSWORD);
    expect(logs.join("\n")).not.toContain(USERNAME);
  });

  it("creates a fresh terminal after the user closed it", async () => {
    // Given: a terminal that the user closes after the launch exits
    const { factory, launcher } = makeLauncher({ kind: "stopped" });
    factory.exitQueue.push(0, 0);
    await launcher.open();
    await flush();
    factory.terminals[0]?.fireClose();
    // When
    await launcher.open();
    // Then
    expect(factory.options).toHaveLength(2);
    expect(factory.terminals[0]?.disposed).toBe(false);
  });

  it("replaces an idle terminal whose injected env no longer matches", async () => {
    // Given: a plain launch (no credentials) that completed
    const { factory, secrets, source, launcher } = makeLauncher({ kind: "stopped" });
    factory.exitQueue.push(0, 0);
    await launcher.open();
    await flush();
    // Given: the server came up and credentials were stored meanwhile
    source.state = { kind: "managed", baseUrl: MANAGED_URL };
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    // When
    await launcher.open();
    // Then: the stale terminal was replaced; the new one carries the env
    expect(factory.terminals[0]?.disposed).toBe(true);
    expect(factory.options).toHaveLength(2);
    expect(factory.options[1]?.env).toEqual({ OPENCODE_SERVER_PASSWORD: PASSWORD });
    expect(factory.terminals[1]?.runs).toEqual([`opencode attach ${MANAGED_URL}`]);
  });

  it("keeps a running terminal even when the plan env would differ", async () => {
    // Given: a plain TUI still occupying the terminal
    const { factory, secrets, source, launcher } = makeLauncher({ kind: "stopped" });
    factory.hangRuns.count = 1;
    await launcher.open();
    source.state = { kind: "managed", baseUrl: MANAGED_URL };
    await secrets.setPassword(MANAGED_URL, PASSWORD);
    // When
    await launcher.open();
    // Then: the user's session is NOT killed to refresh credentials
    expect(factory.options).toHaveLength(1);
    expect(factory.terminals[0]?.disposed).toBe(false);
    expect(factory.terminals[0]?.runs).toEqual(["opencode"]);
  });

  it("detaches listeners on dispose but never disposes the terminal", async () => {
    // Given: a live terminal wired to the launcher
    const { factory, launcher } = makeLauncher({ kind: "stopped" });
    await launcher.open();
    const terminal = factory.terminals[0];
    // When
    launcher.dispose();
    // Then: close listener detached; the user's terminal survives
    expect(terminal?.closeListenerCount).toBe(0);
    expect(terminal?.disposed).toBe(false);
  });
});

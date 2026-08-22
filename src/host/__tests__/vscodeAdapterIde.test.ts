/**
 * Wiring specs for ../vscode-adapter-ide.ts against the in-test vscode stub:
 * status bar creation/registration details and the TUI terminal factory's
 * shell-integration flow (including the no-integration fallback via fake
 * timers — never a wall-clock wait).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVscodeStatusBarController,
  createVscodeTuiTerminalFactory,
} from "../vscode-adapter-ide.js";
import { STATUS_BAR_MENU_COMMAND_ID } from "../statusBar.js";
import { ServerStartError } from "../../server/serverManager.js";
import type { ServerManagerState } from "../../server/serverManager.js";
import type { Event, Listener } from "../config.js";
import {
  FakeShellIntegration,
  FakeTerminal,
  ThemeColor,
  emitShellExecutionEnd,
  emitTerminalClose,
  resetVscodeStub,
  vscodeStubRegistry,
} from "./vscodeStub";

const STOPPED: ServerManagerState = { kind: "stopped" };

interface StateBus {
  readonly getState: () => ServerManagerState;
  readonly onDidChangeState: Event<ServerManagerState>;
  readonly emit: (next: ServerManagerState) => void;
}

function stateBus(initial: ServerManagerState): StateBus {
  let current = initial;
  const listeners = new Set<Listener<ServerManagerState>>();
  return {
    getState: () => current,
    onDidChangeState: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    emit: (next) => {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

beforeEach(() => {
  resetVscodeStub();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createVscodeStatusBarController", () => {
  it("creates a left-aligned item with the menu command id and renders the initial state", () => {
    const bus = stateBus(STOPPED);
    const controller = createVscodeStatusBarController({
      getState: bus.getState,
      onDidChangeState: bus.onDidChangeState,
      t: (text) => text,
    });
    const item = vscodeStubRegistry.statusBarItems[0];
    expect(item?.creation).toEqual({
      id: "opencodePanel.status",
      alignment: 1,
      priority: 10,
    });
    expect(item?.name).toBe("OpenCode Chat Sidebar");
    expect(item?.command).toBe(STATUS_BAR_MENU_COMMAND_ID);
    expect(item?.shown).toBe(true);
    expect(typeof item?.text).toBe("string");
    expect(item?.text.length).toBeGreaterThan(0);
    // The stopped model's color token is mapped to a real ThemeColor here.
    expect(item?.color).toBeInstanceOf(ThemeColor);
    expect((item?.color as ThemeColor).id).toBe("descriptionForeground");
    controller.dispose();
  });

  it("re-renders on manager transitions and disposes the underlying item", () => {
    const bus = stateBus(STOPPED);
    const controller = createVscodeStatusBarController({
      getState: bus.getState,
      onDidChangeState: bus.onDidChangeState,
      t: (text) => text,
    });
    const item = vscodeStubRegistry.statusBarItems[0];
    const initialText = item?.text;
    bus.emit({ kind: "error", error: new ServerStartError({ kind: "cancelled" }) });
    expect(item?.text).not.toBe(initialText);
    expect((item?.color as ThemeColor).id).toBe("errorForeground");
    controller.dispose();
    expect(item?.disposed).toBe(true);
  });
});

describe("createVscodeTuiTerminalFactory", () => {
  it("creates a terminal with the requested name and merged env", () => {
    const factory = createVscodeTuiTerminalFactory();
    const handle = factory.create({
      name: "opencode TUI",
      env: { OPENCODE_SERVER_PASSWORD: "s3cr3t" },
    });
    const terminal = vscodeStubRegistry.terminals[0];
    expect(terminal?.name).toBe("opencode TUI");
    expect(terminal?.env).toEqual({ OPENCODE_SERVER_PASSWORD: "s3cr3t" });
    handle.show();
    expect(terminal?.shown).toBe(true);
  });

  it("runs through shell integration and resolves the observed exit code", async () => {
    const factory = createVscodeTuiTerminalFactory();
    const handle = factory.create({ name: "opencode TUI", env: {} });
    const terminal = vscodeStubRegistry.terminals[0];
    if (terminal === undefined) throw new Error("expected one terminal");
    const integration = new FakeShellIntegration();
    terminal.shellIntegration = integration;

    const ran = handle.run("opencode --version");
    // executeCommand fires one microtask after run() (integration promise).
    await vi.waitFor(() => {
      expect(integration.executions[0]?.commandLine).toBe("opencode --version");
    });
    const execution = integration.executions[0];
    emitShellExecutionEnd({ execution, terminal, exitCode: 7 });
    await expect(ran).resolves.toBe(7);
    expect(terminal.sentText).toEqual([]);
  });

  it("resolves undefined (not a throw) when the terminal closes mid-execution", async () => {
    const factory = createVscodeTuiTerminalFactory();
    const handle = factory.create({ name: "opencode TUI", env: {} });
    const terminal = vscodeStubRegistry.terminals[0];
    if (terminal === undefined) throw new Error("expected one terminal");
    terminal.shellIntegration = new FakeShellIntegration();

    const ran = handle.run("opencode");
    // The close listener is registered once the integration promise resolves.
    await vi.waitFor(() => {
      expect(terminal.shellIntegration?.executions).toHaveLength(1);
    });
    emitTerminalClose(terminal);
    await expect(ran).resolves.toBeUndefined();
  });

  it("falls back to sendText when shell integration never arrives (fake timers)", async () => {
    vi.useFakeTimers();
    const factory = createVscodeTuiTerminalFactory();
    const handle = factory.create({ name: "opencode TUI", env: {} });
    const terminal = vscodeStubRegistry.terminals[0];
    if (terminal === undefined) throw new Error("expected one terminal");

    let settled: number | undefined | "pending" = "pending";
    void handle.run("opencode").then((code) => {
      settled = code;
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(terminal.sentText).toEqual(["opencode"]);
    expect(settled).toBeUndefined();
  });

  it("routes onDidClose only for its own terminal and disposes correctly", () => {
    const factory = createVscodeTuiTerminalFactory();
    const handle = factory.create({ name: "opencode TUI", env: {} });
    const terminal = vscodeStubRegistry.terminals[0];
    if (terminal === undefined) throw new Error("expected one terminal");
    let closes = 0;
    handle.onDidClose(() => {
      closes += 1;
    });
    emitTerminalClose(new FakeTerminal("other", undefined));
    expect(closes).toBe(0);
    emitTerminalClose(terminal);
    expect(closes).toBe(1);
    handle.dispose();
    expect(terminal.disposed).toBe(true);
  });
});

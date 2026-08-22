/**
 * Vscode-backed IDE surfaces for todo 22 (status bar + TUI terminal).
 * Sibling of `./vscode-adapter.ts` — same rule applies: resolves the
 * extension-host `vscode` module, so unit tests never import it.
 */
import * as vscode from "vscode";
import type { Event } from "./config.js";
import {
  STATUS_BAR_MENU_COMMAND_ID,
  StatusBarController,
  type StatusBarItemLike,
  type StatusBarMenu,
} from "./statusBar.js";
import type { TuiTerminalFactory } from "./tui.js";
import type { ServerManagerState } from "../server/serverManager.js";

/**
 * Status bar surface: a left-aligned item whose `command` is the
 * controller's internal quickpick command (the caller registers
 * `STATUS_BAR_MENU_COMMAND_ID` at activation), a `showQuickPick` menu, and
 * the command executor. Theme color tokens map to `vscode.ThemeColor`s
 * here and only here.
 */
export function createVscodeStatusBarController(deps: {
  readonly getState: () => ServerManagerState;
  readonly onDidChangeState: Event<ServerManagerState>;
  readonly t: (text: string) => string;
}): StatusBarController {
  const item = vscode.window.createStatusBarItem(
    "opencodeChatSidebar.status",
    vscode.StatusBarAlignment.Left,
    10,
  );
  item.name = "Chat Sidebar for OpenCode";
  item.command = STATUS_BAR_MENU_COMMAND_ID;
  const itemLike: StatusBarItemLike = {
    apply: (model) => {
      item.text = model.text;
      item.color =
        model.colorToken === undefined ? undefined : new vscode.ThemeColor(model.colorToken);
      item.tooltip = model.tooltip;
    },
    show: () => {
      item.show();
    },
    dispose: () => {
      item.dispose();
    },
  };
  const menu: StatusBarMenu = {
    pick: async (items) => {
      const picked = await vscode.window.showQuickPick(
        items.map((entry) => ({ label: entry.label, entry })),
        { title: "Chat Sidebar for OpenCode" },
      );
      return picked?.entry;
    },
  };
  return new StatusBarController({
    ...deps,
    item: itemLike,
    menu,
    commands: {
      execute: (command) => vscode.commands.executeCommand(command),
    },
  });
}

/**
 * TUI terminal factory: `run()` drives a command line through shell
 * integration when it is available (waiting briefly for the shell to
 * initialize in a fresh terminal) so the exit code is observable and the
 * launcher can decide the plain-binary fallback; when integration never
 * arrives the line is sent via `sendText` and the exit code is not
 * observable ("when readable" hedge). `env` is merged into the terminal
 * process — it carries the injected server credentials, so it NEVER goes
 * near a log line.
 */
const SHELL_INTEGRATION_WAIT_MS = 3000;

async function shellIntegrationWhenReady(
  terminal: vscode.Terminal,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration !== undefined) return terminal.shellIntegration;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(undefined);
    }, SHELL_INTEGRATION_WAIT_MS);
    const subscription = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal !== terminal) return;
      clearTimeout(timer);
      subscription.dispose();
      resolve(event.shellIntegration);
    });
  });
}

function runInTerminal(terminal: vscode.Terminal, line: string): Promise<number | undefined> {
  return shellIntegrationWhenReady(terminal).then((integration) => {
    if (integration === undefined) {
      terminal.sendText(line);
      return undefined;
    }
    const execution = integration.executeCommand(line);
    return new Promise<number | undefined>((resolve) => {
      const detach = () => {
        ended.dispose();
        closed.dispose();
      };
      const ended = vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.execution !== execution) return;
        detach();
        resolve(event.exitCode);
      });
      const closed = vscode.window.onDidCloseTerminal((closedTerminal) => {
        if (closedTerminal !== terminal) return;
        detach();
        resolve(undefined);
      });
    });
  });
}

export function createVscodeTuiTerminalFactory(): TuiTerminalFactory {
  return {
    create: (options) => {
      const terminal = vscode.window.createTerminal({
        name: options.name,
        env: options.env,
      });
      return {
        show: () => {
          terminal.show();
        },
        run: (line) => runInTerminal(terminal, line),
        onDidClose: (listener) =>
          vscode.window.onDidCloseTerminal((closed) => {
            if (closed === terminal) listener();
          }),
        dispose: () => {
          terminal.dispose();
        },
      };
    },
  };
}

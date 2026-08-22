/**
 * Status bar surface (plan todo 22): one status bar item mirroring the
 * ServerManager lifecycle, with a quickpick menu on click routing to the
 * manifest commands.
 *
 * This module is vscode-free: the item, the quickpick, and the command
 * executor are injected seams ({@link StatusBarItemLike},
 * {@link StatusBarMenu}, {@link StatusBarCommandExecutor}). The
 * vscode-backed factory lives in `./vscode-adapter-ide.ts`
 * (createVscodeStatusBarController) — runtime strings (labels, tooltips)
 * resolve through the injected `t` (l10n.t).
 *
 * Rendering contract (state → icon/color):
 * - stopped:             `$(circle-slash) OpenCode`, gray.
 * - probing / stopping:  `$(sync~spin) OpenCode`, yellow.
 * - managed <url>:       `$(server-environment) OpenCode :<port>`, green.
 * - attached <url>:      `$(plug) OpenCode :<port>`, blue (foreign server).
 * - error:               `$(error) OpenCode`, red, tooltip = failure text
 *   (ServerStartError messages carry no credential material by contract).
 *
 * Colors are emitted as semantic THEME tokens (e.g. "charts.green"); the
 * vscode side wraps them in `new vscode.ThemeColor(token)`.
 */

import type { Disposable, Event } from "./config.js";
import type { ServerManagerState } from "../server/serverLifecycle.js";

/**
 * Programmatic-only command the status bar item invokes on click. Underscore
 * prefix keeps it out of the command palette by convention; the adapter
 * registers the handler that opens this controller's quickpick.
 */
export const STATUS_BAR_MENU_COMMAND_ID = "_opencodeChatSidebar.statusBarMenu";

/** Theme color identifiers, resolved to `vscode.ThemeColor` by the adapter. */
export type StatusColorToken =
  | "descriptionForeground"
  | "charts.yellow"
  | "charts.green"
  | "charts.blue"
  | "errorForeground";

export interface StatusBarRenderModel {
  readonly text: string;
  readonly colorToken: StatusColorToken | undefined;
  readonly tooltip: string | undefined;
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}

/** `:4096` for `http://127.0.0.1:4096`, empty for default/unknown ports. */
function portSuffix(baseUrl: string): string {
  try {
    const port = new URL(baseUrl).port;
    return port === "" ? "" : `:${port}`;
  } catch {
    // baseUrl strings come from serverBaseUrl() and are well-formed; a
    // malformed one degrades to no suffix rather than breaking rendering.
    return "";
  }
}

/** State → icon/text/color mapping; the exact contract tested by task 22. */
export function renderServerState(state: ServerManagerState): StatusBarRenderModel {
  switch (state.kind) {
    case "stopped":
      return {
        text: "$(circle-slash) OpenCode",
        colorToken: "descriptionForeground",
        tooltip: undefined,
      };
    case "probing":
    case "stopping":
      return {
        text: "$(sync~spin) OpenCode",
        colorToken: "charts.yellow",
        tooltip: undefined,
      };
    case "managed":
      return {
        text: `$(server-environment) OpenCode${portSuffix(state.baseUrl)}`,
        colorToken: "charts.green",
        tooltip: undefined,
      };
    case "attached":
      return {
        text: `$(plug) OpenCode${portSuffix(state.baseUrl)}`,
        colorToken: "charts.blue",
        tooltip: undefined,
      };
    case "error":
      return {
        text: "$(error) OpenCode",
        colorToken: "errorForeground",
        tooltip: state.error.message,
      };
    default:
      return assertNever(state);
  }
}

// ---------------------------------------------------------------------------
// Quickpick menu.

export interface StatusBarMenuItem {
  /** The manifest command executed when the item is picked. */
  readonly command: string;
  readonly label: string;
}

/** The six menu entries; labels route through host l10n (`t`). */
export function statusBarMenuItems(
  t: (text: string) => string,
): readonly StatusBarMenuItem[] {
  return [
    { command: "opencodeChatSidebar.startServer", label: t("Start Server") },
    { command: "opencodeChatSidebar.stopServer", label: t("Stop Server") },
    { command: "opencodeChatSidebar.restartServer", label: t("Restart Server") },
    { command: "opencodeChatSidebar.openSettings", label: t("Open Settings") },
    { command: "opencodeChatSidebar.openTui", label: t("Open opencode TUI") },
    { command: "opencodeChatSidebar.openLogs", label: t("Open Logs") },
  ];
}

export interface StatusBarMenu {
  /** Resolves undefined when the user dismisses the quickpick. */
  pick(items: readonly StatusBarMenuItem[]): Promise<StatusBarMenuItem | undefined>;
}

export interface StatusBarCommandExecutor {
  execute(command: string): unknown;
}

/** Minimal write surface the controller needs from a status bar item. */
export interface StatusBarItemLike {
  apply(model: StatusBarRenderModel): void;
  show(): void;
  dispose(): void;
}

export interface StatusBarControllerDeps {
  readonly getState: () => ServerManagerState;
  readonly onDidChangeState: Event<ServerManagerState>;
  readonly item: StatusBarItemLike;
  readonly menu: StatusBarMenu;
  readonly commands: StatusBarCommandExecutor;
  /** Host runtime string lookup (vscode.l10n.t on the vscode side). */
  readonly t: (text: string) => string;
}

/**
 * Re-renders the item on every manager transition and routes quickpick
 * selections to their commands. `dispose()` detaches the state subscription
 * and disposes the item; it does NOT execute any command.
 */
export class StatusBarController {
  private readonly deps: StatusBarControllerDeps;
  private readonly subscription: Disposable;

  constructor(deps: StatusBarControllerDeps) {
    this.deps = deps;
    this.subscription = deps.onDidChangeState((state) => this.render(state));
    this.render(deps.getState());
  }

  async showMenu(): Promise<void> {
    const picked = await this.deps.menu.pick(statusBarMenuItems(this.deps.t));
    if (picked === undefined) return;
    await this.deps.commands.execute(picked.command);
  }

  dispose(): void {
    this.subscription.dispose();
    this.deps.item.dispose();
  }

  private render(state: ServerManagerState): void {
    this.deps.item.apply(renderServerState(state));
    this.deps.item.show();
  }
}

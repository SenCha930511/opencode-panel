import * as vscode from "vscode";
import {
  createVscodeConfigAccessor,
  createVscodeLogger,
  createVscodeSecrets,
  createVscodeServerManager,
} from "./host/vscode-adapter.js";
import type { ServerStartError } from "./server/ServerManager.js";
import { registerPanelViews } from "./providers/registration.js";

/**
 * Activation (todo 10): vscode-backed ServerManager + both webview view
 * providers + the eight manifest commands. Commands route honestly:
 * start/stop/restart drive the manager (failures surface as localized error
 * toasts), newSession forwards an event into the chat webview, and the
 * features owned by later todos get an info toast — never fake behavior.
 */

function showServerError(title: string, error: ServerStartError): void {
  void vscode.window.showErrorMessage(vscode.l10n.t("{0}: {1}", title, error.message));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Later-milestone features: visible info toast, nothing faked. */
function comingLater(): void {
  void vscode.window.showInformationMessage(
    vscode.l10n.t("OpenCode Panel: this feature is coming in a later milestone."),
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const config = createVscodeConfigAccessor();
  const { logger, channel } = createVscodeLogger(() => config.read().debugLogs);
  const secrets = createVscodeSecrets(context);
  const manager = createVscodeServerManager({ config, secrets, logger });
  const panel = registerPanelViews(context, {
    config,
    logger,
    manager,
    envLanguage: vscode.env.language,
  });

  context.subscriptions.push(
    channel,
    { dispose: () => config.dispose() },
    { dispose: () => manager.dispose() },
    vscode.commands.registerCommand("opencodePanel.newSession", () => {
      panel.chat.postEvent("command.newSession", null);
    }),
    vscode.commands.registerCommand("opencodePanel.openSettings", comingLater),
    vscode.commands.registerCommand("opencodePanel.startServer", async () => {
      const result = await manager.start();
      if (!result.ok) {
        showServerError(vscode.l10n.t("Failed to start the opencode server"), result.error);
      }
    }),
    vscode.commands.registerCommand("opencodePanel.stopServer", async () => {
      try {
        await manager.stop();
      } catch (error) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t("Failed to stop the opencode server: {0}", errorText(error)),
        );
      }
    }),
    vscode.commands.registerCommand("opencodePanel.restartServer", async () => {
      const result = await manager.restart();
      if (!result.ok) {
        showServerError(vscode.l10n.t("Failed to restart the opencode server"), result.error);
      }
    }),
    vscode.commands.registerCommand("opencodePanel.openTui", comingLater),
    vscode.commands.registerCommand("opencodePanel.attachSelection", comingLater),
    vscode.commands.registerCommand("opencodePanel.attachFile", comingLater),
  );
  logger.info("opencode-panel activated");
}

export function deactivate(): void {}

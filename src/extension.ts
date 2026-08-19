import * as vscode from "vscode";
import {
  createVscodeConfigAccessor,
  createVscodeEditorAccess,
  createVscodeLogger,
  createVscodeSecrets,
  createVscodeServerManager,
} from "./host/vscode-adapter.js";
import type { ServerStartError } from "./server/ServerManager.js";
import { registerPanelViews } from "./providers/registration.js";
import {
  ATTACHMENTS_ADD_EVENT,
  buildFilePush,
  buildSelectionPush,
  registerAttachmentHandlers,
} from "./host/handlers/attachments.js";
import { wireCapabilityInfo } from "./host/handlers/capabilityInfo.js";
import { registerCommandHandlers } from "./host/handlers/commands.js";
import { wireMcpInfo } from "./host/handlers/mcpInfo.js";
import { registerSessionHandlers } from "./host/handlers/sessions.js";
import { managerSessionSource, wireSessionsDomain } from "./host/handlers/sync.js";

/**
 * Activation (todo 10): vscode-backed ServerManager + both webview view
 * providers + the eight manifest commands. Commands route honestly:
 * start/stop/restart drive the manager (failures surface as localized error
 * toasts), newSession forwards an event into the chat webview, and the
 * features owned by later todos get an info toast — never fake behavior.
 *
 * Todo-12 composition (owned by src/host/handlers/sync.ts): the SSE event
 * bridge starts here; its debounced `sessions` invalidation and the domain
 * handlers' post-mutation refresh both broadcast the session list to the
 * chat view (see sync.ts for the event-channel carrier contract).
 *
 * Todo-15 composition (owned by src/host/handlers/capabilityInfo.ts): the
 * `capabilities.refresh` push seeds the webview pickers on every
 * managed|attached transition (its header documents the resync-equivalent
 * subscription), and `runCommand` executes slash commands from the palette.
 *
 * Todo-20 composition (owned by src/host/handlers/mcpInfo.ts): the
 * `mcp.status` push seeds the webview MCP panel and the capability-flag
 * overlay on the same transitions, riding the todo-15 wiring shape.
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
  const sessionsDomain = wireSessionsDomain({ manager, logger, events: panel.chat });
  registerSessionHandlers(panel.registerHandler, sessionsDomain.deps);
  const capabilityInfo = wireCapabilityInfo({
    source: managerSessionSource(manager),
    detector: manager.detector,
    getState: () => manager.state,
    onDidChangeState: (listener) => manager.onDidChangeState(listener),
    logger,
    events: panel.chat,
  });
  registerCommandHandlers(panel.registerHandler, capabilityInfo.deps);
  // Todo-17: attachments domain (searchFiles handler) + editor context seam.
  // Composed chips ride the `event` channel as ATTACHMENTS_ADD_EVENT — the
  // sessions.list push pattern; the host holds no pending-attachment state.
  const editorAccess = createVscodeEditorAccess();
  registerAttachmentHandlers(panel.registerHandler, {
    source: managerSessionSource(manager),
    logger,
    workspaceFindFiles: editorAccess.workspaceFindFiles,
  });
  const mcpInfo = wireMcpInfo({
    source: managerSessionSource(manager),
    detector: manager.detector,
    getState: () => manager.state,
    onDidChangeState: (listener) => manager.onDidChangeState(listener),
    logger,
    events: panel.chat,
  });

  context.subscriptions.push(
    channel,
    {
      dispose: () => {
        sessionsDomain.dispose();
        capabilityInfo.dispose();
        mcpInfo.dispose();
      },
    },
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
    vscode.commands.registerCommand("opencodePanel.attachSelection", () => {
      const result = buildSelectionPush(editorAccess.selection());
      if (!result.ok) {
        void vscode.window.showInformationMessage(`OpenCode Panel: ${result.message}`);
        return;
      }
      panel.chat.postEvent(ATTACHMENTS_ADD_EVENT, result.payload);
    }),
    vscode.commands.registerCommand("opencodePanel.attachFile", (contextArg?: unknown) => {
      const result = buildFilePush(editorAccess.filePath(contextArg));
      if (!result.ok) {
        void vscode.window.showInformationMessage(`OpenCode Panel: ${result.message}`);
        return;
      }
      panel.chat.postEvent(ATTACHMENTS_ADD_EVENT, result.payload);
    }),
  );
  logger.info("opencode-panel activated");
}

export function deactivate(): void {}

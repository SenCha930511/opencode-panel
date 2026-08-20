import * as vscode from "vscode";
import { mkdir, writeFile } from "node:fs/promises";
import {
  createVscodeConfigAccessor,
  createVscodeDockSurface,
  createVscodeEditorAccess,
  createVscodeLogger,
  createVscodeSecrets,
  createVscodeServerManager,
  createVscodeSettingsSurface,
} from "./host/vscode-adapter.js";
import {
  createVscodeStatusBarController,
  createVscodeTuiTerminalFactory,
} from "./host/vscode-adapter-ide.js";
import { STATUS_BAR_MENU_COMMAND_ID } from "./host/statusBar.js";
import { TuiLauncher } from "./host/tui.js";
import type { ServerStartError } from "./server/ServerManager.js";
import { registerPanelViews } from "./providers/registration.js";
import {
  applyTestServerOverride,
  exposeTestAttach,
  type PanelActivationTestApi,
} from "./host/testSeam.js";
import {
  registerAnswerHandlers,
  createAnswerService,
} from "./host/handlers/answers.js";
import {
  ATTACHMENTS_ADD_EVENT,
  buildFilePush,
  buildSelectionPush,
  registerAttachmentHandlers,
} from "./host/handlers/attachments.js";
import { wireCapabilityInfo } from "./host/handlers/capabilityInfo.js";
import { registerCommandHandlers } from "./host/handlers/commands.js";
import {
  createDockService,
  DOCK_DIFF_SCHEME,
  DockSync,
  registerDockHandlers,
} from "./host/handlers/dock.js";
import { wireMcpInfo } from "./host/handlers/mcpInfo.js";
import {
  createMessageOpsService,
  registerMessageOpsHandlers,
} from "./host/handlers/messageOps.js";
import {
  MessageSync,
  createSdkMessagesFetcher,
  registerMessageSyncHandlers,
} from "./host/handlers/messages.js";
import { registerPromptHandlers } from "./host/handlers/prompt.js";
import { registerSessionHandlers } from "./host/handlers/sessions.js";
import { registerSettingsHandlers } from "./host/handlers/settings.js";
import { createHealthProbe } from "./host/handlers/settingsProbe.js";
import { managerSessionSource, wireSessionsDomain } from "./host/handlers/sync.js";
import { createPanelClient } from "./server/clientFactory.js";
import {
  createExportTranscriptCommand,
  exportTranscript,
  type ExportFs,
  type SaveDialog,
} from "./host/exportTranscript.js";

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
 *
 * allow: SIZE_OK — composition root wiring every todo's domain seams; no
 * domain logic lives here (each domain owns its own module per the plan).
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

// Todo-24 env-test seam (additive; spec in ./host/testSeam.ts): the harness
// pins OPENCODE_PANEL_TEST_PORT, activation attaches to the pre-started mock,
// and the test-API surface returns; production activation is unchanged.
export function activate(
  context: vscode.ExtensionContext,
): PanelActivationTestApi | undefined {
  const config = applyTestServerOverride(
    createVscodeConfigAccessor(),
    process.env.OPENCODE_PANEL_TEST_PORT ?? "",
  );
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
  // Todo-24 activation gap fix: the todo-14 prompt handlers (sendPrompt /
  // abort) and todo-16 answer handlers (answerPermission / answerQuestion)
  // shipped with unit tests but were never composed here — sendPrompt from a
  // real webview hit UnknownMessageTypeError. Register both on the same
  // manager-backed source the sessions domain uses.
  registerPromptHandlers(panel.registerHandler, {
    source: managerSessionSource(manager),
    logger,
  });
  registerAnswerHandlers(panel.registerHandler, {
    service: createAnswerService({ source: managerSessionSource(manager), logger }),
  });
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
  // Todo-21: settings domain (getSettings/setSettings/getSecret/setSecret).
  // Values ride the todo-6 config accessor, writes go through the vscode
  // SettingsConfigSurface (per-field Global/Workspace target), secrets stay
  // in SecretStorage (isSet-only on the wire), and setSettings additionally
  // probes /global/health of the applied config — the settings page's Test
  // Connection is an empty-patch setSettings (see handlers/settings.ts).
  registerSettingsHandlers(panel.registerHandler, {
    config,
    surface: createVscodeSettingsSurface(),
    secrets,
    probe: createHealthProbe({
      // A fresh auth-injecting client per probe base URL: a port/hostname
      // edit probes the NEW endpoint with its own stored credentials.
      probeFetchFor: (baseUrl) => createPanelClient(baseUrl, { secrets, logger }).probeFetch,
    }),
    logger,
  });
  // Todo-18: todos/diffs dock — openDiff/openFile handlers, poll-sync riding
  // the todo-12 InvalidationHub (todos+sessions kinds), one-shot capability
  // guards, and the read-only opencode-panel-diff:// document provider that
  // backs native vscode.diff previews.
  const dockSurface = createVscodeDockSurface();
  const dockService = createDockService({
    source: managerSessionSource(manager),
    renderer: dockSurface.renderer,
    opener: dockSurface.opener,
    logger,
  });
  registerDockHandlers(panel.registerHandler, { service: dockService });
  const dockSync = new DockSync({
    source: managerSessionSource(manager),
    sink: panel.chat,
    logger,
  });
  const messageSync = new MessageSync({
    fetchMessages: async (sessionId) => {
      const onboard = await manager.onboardClient();
      if (!onboard.ok) return { ok: false, error: onboard.error };
      return createSdkMessagesFetcher(onboard.connection.client)(sessionId);
    },
    postEvent: (type, payload) => panel.chat.postEvent(type, payload),
    logger,
  });
  const dockInvalidation = sessionsDomain.hub.add(dockSync.invalidate);
  const messageInvalidation = sessionsDomain.hub.add(messageSync.invalidate);
  registerMessageSyncHandlers(panel.registerHandler, messageSync, dockSync, capabilityInfo.sync);
  const dockCapabilityReset = manager.onDidChangeState((state) => {
    if (state.kind === "managed" || state.kind === "attached") dockSync.reset();
  });
  const mcpInfo = wireMcpInfo({
    source: managerSessionSource(manager),
    detector: manager.detector,
    getState: () => manager.state,
    onDidChangeState: (listener) => manager.onDidChangeState(listener),
    logger,
    events: panel.chat,
  });
  // Todo-19: message ops (revert/unrevert via the webview confirm-gated menu,
  // summarize with the config default model, shell with the first advertised
  // primary agent) + the additive export-transcript command (no todo-3 wire
  // type fits; the palette/view-menu route is the invocation path).
  const messageOpsSource = managerSessionSource(manager);
  registerMessageOpsHandlers(panel.registerHandler, {
    service: createMessageOpsService({ source: messageOpsSource, logger }),
    sync: sessionsDomain.deps.sync,
  });
  const exportFs: ExportFs = {
    mkdir: (path, options) => mkdir(path, options),
    writeFile: (path, contents) => writeFile(path, contents, "utf8"),
  };
  const exportDialog: SaveDialog = {
    show: async (defaultUri) => {
      const uri = await vscode.window.showSaveDialog(
        defaultUri === undefined ? {} : { defaultUri: vscode.Uri.file(defaultUri) },
      );
      return uri?.fsPath;
    },
  };
  const exportCommand = createExportTranscriptCommand({
    run: (args) =>
      exportTranscript(
        {
          source: messageOpsSource,
          logger,
          fs: exportFs,
          dialog: exportDialog,
          workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          clock: { now: () => Date.now() },
        },
        args,
      ),
    info: (message) => {
      void vscode.window.showInformationMessage(message);
    },
    error: (message) => {
      void vscode.window.showErrorMessage(message);
    },
  });

  // Todo-22: status bar item mirroring the manager lifecycle (+ quickpick
  // menu routing to the manifest commands) and the TUI escape hatch — one
  // reused "OpenCode TUI" terminal per workspace, `binaryPath attach <url>`
  // with SecretStorage credentials injected into the terminal env, and a
  // one-step fallback to the plain binary when `attach` exits non-zero.
  const tui = new TuiLauncher({
    getState: () => manager.state,
    config: () => config.read(),
    secrets,
    factory: createVscodeTuiTerminalFactory(),
    logger,
    info: (message) => {
      void vscode.window.showInformationMessage(message);
    },
    t: (text) => vscode.l10n.t(text),
  });
  const statusBar = createVscodeStatusBarController({
    getState: () => manager.state,
    onDidChangeState: (listener) => manager.onDidChangeState(listener),
    t: (text) => vscode.l10n.t(text),
  });

  context.subscriptions.push(
    channel,
    statusBar,
    tui,
    vscode.commands.registerCommand(STATUS_BAR_MENU_COMMAND_ID, () => statusBar.showMenu()),
    vscode.commands.registerCommand("opencodePanel.openLogs", () => {
      channel.show();
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      DOCK_DIFF_SCHEME,
      dockSurface.contentProvider,
    ),
    {
      dispose: () => {
        sessionsDomain.dispose();
        capabilityInfo.dispose();
        mcpInfo.dispose();
      },
    },
    {
      dispose: () => {
        messageInvalidation.dispose();
        dockInvalidation.dispose();
        dockCapabilityReset.dispose();
      },
    },
    { dispose: () => config.dispose() },
    { dispose: () => manager.dispose() },
    vscode.commands.registerCommand("opencodePanel.toggleHistory", () => {
      panel.chat.postEvent("command.toggleHistory", null);
    }),
    vscode.commands.registerCommand("opencodePanel.newSession", () => {
      panel.chat.postEvent("command.newSession", null);
    }),
    vscode.commands.registerCommand("opencodePanel.openSettings", () => {
      panel.chat.postEvent("command.openSettings", null);
    }),
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
    vscode.commands.registerCommand("opencodePanel.openTui", () => tui.open()),
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
    vscode.commands.registerCommand("opencodePanel.exportTranscript", (args?: unknown) =>
      exportCommand(args),
    ),
  );
  logger.info("opencode-panel activated");

  if (config.read().autoStartServer) {
    void manager.start().then((result) => {
      if (result.ok) {
        logger.info(`auto-connected server: ${result.baseUrl} (${result.state})`);
      } else {
        logger.warn(`auto-start server on activation: ${result.error.message}`);
      }
    });
  }

  return exposeTestAttach(process.env.OPENCODE_PANEL_TEST_PORT ?? "", manager, panel);
}

export function deactivate(): void {}

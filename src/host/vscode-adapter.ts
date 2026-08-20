/**
 * Thin seam between the pure host modules (config / secrets / logger) and
 * the real `vscode` API surface. Together with `./vscode-adapter-ide.ts`
 * (todo-22 IDE surfaces) it resolves the extension-host `vscode` module
 * at runtime, so unit tests (which run under node + vitest) never touch
 * either file.
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
import { SEARCH_RESULT_LIMIT, type EditorSelectionSnapshot } from "./handlers/attachments.js";
import type { SettingsConfigSurface } from "./handlers/settings.js";
import {
  createDiffContentProvider,
  createDiffRenderer,
  createFileOpener,
  DiffDocumentStore,
  type DiffContentProviderLike,
  type DockDiffRenderer,
  type DockFileOpener,
} from "./handlers/dock.js";
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
 * Read/write settings surface backed by `workspace.getConfiguration` for the
 * todo-21 settings handlers: `inspect` reports the layer a field's value
 * comes from (the page's User/Workspace chip default), `update` writes one
 * field to the requested target (Global default; Workspace only when the
 * chip says so). SecretStorage is NEVER reachable through this surface.
 */
export function createVscodeSettingsSurface(): SettingsConfigSurface {
  const configuration = (): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    inspect: (shortKey) => configuration().inspect(shortKey),
    update: (shortKey, value, target) =>
      configuration().update(
        shortKey,
        value,
        target === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global,
      ),
  };
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
 * Todo-17 editor seam for the attachments domain. `selection()` snapshots
 * the active editor's selection; `filePath()` resolves an attachable file
 * from an explorer/editor context arg (a `vscode.Uri`-shaped value) or the
 * active editor; `workspaceFindFiles()` is the plan-mandated last-resort
 * fallback for `searchFiles` when the server exposes no find route. Only
 * `file:`-scheme documents are ever reported — untitled/notebook editors
 * have no server-readable path and yield undefined.
 */
export interface EditorAccess {
  readonly selection: () => EditorSelectionSnapshot | undefined;
  readonly filePath: { (contextArg?: unknown): string | undefined };
  readonly workspaceFindFiles: { (query: string): Promise<readonly string[]> };
}

export function createVscodeEditorAccess(): EditorAccess {
  return {
    selection: () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.document.uri.scheme !== "file") return undefined;
      const selection = editor.selection;
      return {
        path: editor.document.uri.fsPath,
        language: editor.document.languageId,
        startLine: selection.start.line,
        endLine: selection.end.line,
        text: editor.document.getText(selection),
      };
    },
    filePath: (contextArg) => {
      if (
        typeof contextArg === "object" &&
        contextArg !== null &&
        "fsPath" in contextArg &&
        typeof (contextArg as { fsPath?: unknown }).fsPath === "string"
      ) {
        const uri = contextArg as vscode.Uri;
        return uri.scheme === "file" ? uri.fsPath : undefined;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.document.uri.scheme !== "file") return undefined;
      return editor.document.uri.fsPath;
    },
    workspaceFindFiles: async (query) => {
      // Glob meta in the query must not become a pattern operator — it would
      // both break the search and widen it beyond the user's intent.
      if (query === "***") return [];
      const escaped = (query ?? "").replace(/[{}\[\]\\]/g, "\\$&").replace(/\*/g, "");
      const pattern = escaped.length === 0 ? "**/*" : `**/*${escaped}*`;
      const uris = await vscode.workspace.findFiles(pattern, undefined, SEARCH_RESULT_LIMIT, undefined);
      return uris.map((uri) => uri.fsPath);
    },
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

/**
 * Todo-18 dock surface (todos + session diffs): the vscode-backed halves of
 * `./handlers/dock.ts` — the read-only `opencode-panel-diff://` in-memory
 * document store/provider, the native `vscode.diff` renderer, and the
 * workspace file opener. The caller registers the provider at activation:
 *
 *   vscode.workspace.registerTextDocumentContentProvider(
 *     DOCK_DIFF_SCHEME, surface.contentProvider)
 *
 * Diff snapshots never touch the disk; the store's cap bounds memory.
 */
export interface VscodeDockSurface {
  readonly store: DiffDocumentStore;
  readonly contentProvider: DiffContentProviderLike;
  readonly renderer: DockDiffRenderer;
  readonly opener: DockFileOpener;
}

export function createVscodeDockSurface(): VscodeDockSurface {
  const store = new DiffDocumentStore();
  return {
    store,
    contentProvider: createDiffContentProvider(store),
    renderer: createDiffRenderer<vscode.Uri>({
      store,
      parseUri: (value) => vscode.Uri.parse(value),
      executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    }),
    opener: createFileOpener<vscode.Uri, vscode.TextDocument>({
      workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      fileUri: (fsPath) => vscode.Uri.file(fsPath),
      openDocument: (uri) => vscode.workspace.openTextDocument(uri),
      showDocument: (document) => vscode.window.showTextDocument(document),
    }),
  };
}

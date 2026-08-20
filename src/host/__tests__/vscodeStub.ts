/**
 * Minimal in-test runtime for the `vscode` module, wired into vitest via
 * resolve.alias in vitest.config.mts. Mirrors ONLY the surface
 * ../vscode-adapter.ts and ../vscode-adapter-ide.ts touch, with recording
 * fakes so the adapter specs can assert what the wiring did. Not a general
 * vscode emulation — extend deliberately when a new adapter factory grows.
 */

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export class ThemeColor {
  constructor(readonly id: string) {}
}

export interface FakeDisposable {
  dispose(): void;
}

function disposable(unregister: () => void): FakeDisposable {
  return { dispose: unregister };
}

// ---------------------------------------------------------------------------
// Configuration.

export interface FakeInspection {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

export interface RecordedUpdate {
  readonly key: string;
  readonly value: unknown;
  readonly target: number | undefined;
}

export class FakeWorkspaceConfiguration {
  readonly values = new Map<string, unknown>();
  readonly layers = new Map<string, FakeInspection>();
  readonly updates: RecordedUpdate[] = [];

  get<T>(key: string): T | undefined {
    // Same boundary cast the suites' FakeAdapter already uses for this seam.
    return this.values.get(key) as T | undefined;
  }

  inspect(key: string): FakeInspection | undefined {
    return this.layers.get(key);
  }

  update(key: string, value: unknown, target?: number): Promise<void> {
    this.updates.push({ key, value, target });
    this.values.set(key, value);
    return Promise.resolve();
  }
}

export interface FakeConfigChangeEvent {
  affectsConfiguration(section: string): boolean;
}

type ConfigListener = (event: FakeConfigChangeEvent) => void;

// ---------------------------------------------------------------------------
// Window fakes.

export class FakeOutputChannel {
  readonly lines: string[] = [];
  disposed = false;

  constructor(readonly name: string) {}

  appendLine(line: string): void {
    this.lines.push(line);
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeUriShape {
  readonly scheme: string;
  readonly fsPath: string;
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
    readonly raw: string,
  ) {}

  static file(fsPath: string): Uri {
    return new Uri("file", fsPath, `file://${fsPath}`);
  }

  static parse(value: string): Uri {
    const sep = value.indexOf("://");
    const scheme = sep < 0 ? "file" : value.slice(0, sep);
    const rest = sep < 0 ? value : value.slice(sep + 3);
    return new Uri(scheme, rest, value);
  }

  toString(): string {
    return this.raw;
  }
}

export interface FakeSelectionRange {
  readonly start: { readonly line: number };
  readonly end: { readonly line: number };
}

export interface FakeTextDocument {
  readonly uri: FakeUriShape;
  readonly languageId: string;
  getText(selection: unknown): string;
}

export interface FakeTextEditor {
  readonly selection: FakeSelectionRange;
  readonly document: FakeTextDocument;
}

export interface StatusBarItemCreation {
  readonly id: string;
  readonly alignment: number;
  readonly priority: number;
}

export class FakeStatusBarItem {
  name = "";
  command = "";
  text = "";
  color: unknown;
  tooltip: unknown;
  shown = false;
  disposed = false;

  constructor(readonly creation: StatusBarItemCreation) {}

  show(): void {
    this.shown = true;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeShellExecution {
  readonly commandLine: string;
}

export class FakeShellIntegration {
  readonly executions: FakeShellExecution[] = [];

  executeCommand(line: string): FakeShellExecution {
    const execution: FakeShellExecution = { commandLine: line };
    this.executions.push(execution);
    return execution;
  }
}

export class FakeTerminal {
  shown = false;
  readonly sentText: string[] = [];
  disposed = false;
  shellIntegration: FakeShellIntegration | undefined;

  constructor(
    readonly name: string,
    readonly env: Record<string, string> | undefined,
  ) {}

  show(): void {
    this.shown = true;
  }

  sendText(line: string): void {
    this.sentText.push(line);
  }

  dispose(): void {
    this.disposed = true;
  }
}

export interface ShellExecutionEndEvent {
  readonly execution: unknown;
  readonly terminal: FakeTerminal;
  readonly exitCode: number | undefined;
}

export interface ShellIntegrationChangeEvent {
  readonly terminal: FakeTerminal;
  readonly shellIntegration: FakeShellIntegration;
}

type ShellEndListener = (event: ShellExecutionEndEvent) => void;
type CloseListener = (closed: FakeTerminal) => void;
type IntegrationListener = (event: ShellIntegrationChangeEvent) => void;

// ---------------------------------------------------------------------------
// Recording registries (reset per test).

interface QuickPickEntry {
  readonly label: string;
  readonly entry?: unknown;
}

interface StubState {
  readonly configSections: string[];
  readonly configs: Map<string, FakeWorkspaceConfiguration>;
  readonly configListeners: Set<ConfigListener>;
  activeEditor: FakeTextEditor | undefined;
  workspaceFoldersValue: readonly { uri: FakeUriShape }[] | undefined;
  readonly outputChannels: FakeOutputChannel[];
  readonly statusBarItems: FakeStatusBarItem[];
  readonly terminals: FakeTerminal[];
  readonly shellEndListeners: Set<ShellEndListener>;
  readonly closeListeners: Set<CloseListener>;
  readonly integrationListeners: Set<IntegrationListener>;
  readonly executedCommands: string[];
  readonly findFilesCalls: { pattern: string; limit: number | undefined }[];
  findFilesResult: FakeUriShape[];
  readonly openedDocuments: unknown[];
  readonly shownDocuments: unknown[];
  quickPickResult: QuickPickEntry | undefined;
}

const state: StubState = {
  configSections: [],
  configs: new Map(),
  configListeners: new Set(),
  activeEditor: undefined,
  workspaceFoldersValue: undefined,
  outputChannels: [],
  statusBarItems: [],
  terminals: [],
  shellEndListeners: new Set(),
  closeListeners: new Set(),
  integrationListeners: new Set(),
  executedCommands: [],
  findFilesCalls: [],
  findFilesResult: [],
  openedDocuments: [],
  shownDocuments: [],
  quickPickResult: undefined,
};

export function resetVscodeStub(): void {
  state.configSections.length = 0;
  state.configs.clear();
  state.configListeners.clear();
  state.activeEditor = undefined;
  state.workspaceFoldersValue = undefined;
  state.outputChannels.length = 0;
  state.statusBarItems.length = 0;
  state.terminals.length = 0;
  state.shellEndListeners.clear();
  state.closeListeners.clear();
  state.integrationListeners.clear();
  state.executedCommands.length = 0;
  state.findFilesCalls.length = 0;
  state.findFilesResult = [];
  state.openedDocuments.length = 0;
  state.shownDocuments.length = 0;
  state.quickPickResult = undefined;
}

export function configFor(section: string): FakeWorkspaceConfiguration {
  const existing = state.configs.get(section);
  if (existing !== undefined) return existing;
  throw new Error(`getConfiguration not called yet for section: ${section}`);
}

/** Pre-populate a section's configuration WITHOUT recording a getConfiguration call. */
export function seedConfig(section: string): FakeWorkspaceConfiguration {
  const existing = state.configs.get(section);
  if (existing !== undefined) return existing;
  const config = new FakeWorkspaceConfiguration();
  state.configs.set(section, config);
  return config;
}

export function emitConfigChange(event: FakeConfigChangeEvent): void {
  for (const listener of [...state.configListeners]) listener(event);
}

export function setActiveTextEditor(editor: FakeTextEditor | undefined): void {
  state.activeEditor = editor;
}

export function emitShellExecutionEnd(event: ShellExecutionEndEvent): void {
  for (const listener of [...state.shellEndListeners]) listener(event);
}

export function emitTerminalClose(closed: FakeTerminal): void {
  for (const listener of [...state.closeListeners]) listener(closed);
}

export function stubQuickPickResult(entry: QuickPickEntry): void {
  state.quickPickResult = entry;
}

// ---------------------------------------------------------------------------
// The `vscode` module surface itself.

export const workspace = {
  getConfiguration(section: string): FakeWorkspaceConfiguration {
    state.configSections.push(section);
    let config = state.configs.get(section);
    if (config === undefined) {
      config = new FakeWorkspaceConfiguration();
      state.configs.set(section, config);
    }
    return config;
  },

  onDidChangeConfiguration(listener: ConfigListener): FakeDisposable {
    state.configListeners.add(listener);
    return disposable(() => {
      state.configListeners.delete(listener);
    });
  },

  get workspaceFolders(): readonly { uri: FakeUriShape }[] | undefined {
    return state.workspaceFoldersValue;
  },

  set workspaceFolders(value: readonly { uri: FakeUriShape }[] | undefined) {
    state.workspaceFoldersValue = value;
  },

  findFiles(pattern: string, _exclude: unknown, limit?: number): Promise<FakeUriShape[]> {
    state.findFilesCalls.push({ pattern, limit });
    return Promise.resolve(state.findFilesResult);
  },

  openTextDocument(uri: unknown): Promise<{ uri: unknown }> {
    state.openedDocuments.push(uri);
    return Promise.resolve({ uri });
  },
};

export const window = {
  get activeTextEditor(): FakeTextEditor | undefined {
    return state.activeEditor;
  },

  createOutputChannel(name: string): FakeOutputChannel {
    const channel = new FakeOutputChannel(name);
    state.outputChannels.push(channel);
    return channel;
  },

  createStatusBarItem(id: string, alignment: number, priority: number): FakeStatusBarItem {
    const item = new FakeStatusBarItem({ id, alignment, priority });
    state.statusBarItems.push(item);
    return item;
  },

  showQuickPick(items: readonly QuickPickEntry[]): Promise<QuickPickEntry | undefined> {
    void items;
    return Promise.resolve(state.quickPickResult);
  },

  showTextDocument(document: unknown): Promise<void> {
    state.shownDocuments.push(document);
    return Promise.resolve();
  },

  createTerminal(options: { name: string; env?: Record<string, string> }): FakeTerminal {
    const terminal = new FakeTerminal(options.name, options.env);
    state.terminals.push(terminal);
    return terminal;
  },

  onDidChangeTerminalShellIntegration(listener: IntegrationListener): FakeDisposable {
    state.integrationListeners.add(listener);
    return disposable(() => {
      state.integrationListeners.delete(listener);
    });
  },

  onDidEndTerminalShellExecution(listener: ShellEndListener): FakeDisposable {
    state.shellEndListeners.add(listener);
    return disposable(() => {
      state.shellEndListeners.delete(listener);
    });
  },

  onDidCloseTerminal(listener: CloseListener): FakeDisposable {
    state.closeListeners.add(listener);
    return disposable(() => {
      state.closeListeners.delete(listener);
    });
  },
};

export const commands = {
  executeCommand(command: string): Promise<unknown> {
    state.executedCommands.push(command);
    return Promise.resolve(undefined);
  },
};

export { state as vscodeStubRegistry };

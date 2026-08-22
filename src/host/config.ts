/**
 * Typed accessors over the "opencodeChatSidebar" configuration section.
 *
 * Pure of the `vscode` module: a small {@link ConfigAdapter} +
 * {@link ConfigChangeSource} seam (mirroring `WorkspaceConfiguration` and
 * `workspace.onDidChangeConfiguration`) keeps the typed mapping unit-testable
 * without the extension host. The real vscode-backed wiring lives in
 * `vscode-adapter.ts`.
 */

export interface Disposable {
  dispose(): void;
}

export type Listener<T> = (event: T) => void;
export type Event<T> = (listener: Listener<T>) => Disposable;

/** Minimal read surface mirrored from `vscode.WorkspaceConfiguration`. */
export interface ConfigAdapter {
  get<T>(key: string): T | undefined;
}

/** Shape mirrored from `vscode.ConfigurationChangeEvent`. */
export interface ConfigChangeEvent {
  affectsConfiguration(section: string): boolean;
}

/** Minimal change surface mirrored from `vscode.workspace.onDidChangeConfiguration`. */
export interface ConfigChangeSource {
  onChange(listener: Listener<ConfigChangeEvent>): Disposable;
}

export const CONFIG_SECTION = "opencodeChatSidebar";

/**
 * Typed view of every key contributed under
 * `contributes.configuration` in package.json.
 *
 * `serverUrl` "", `chatFontFamily` "" and `chatFontSize` 0 mean "unset":
 * the server URL is then derived from hostname/port and the chat webview
 * inherits the editor font.
 */
export interface PanelConfig {
  readonly serverUrl: string;
  readonly port: number;
  readonly hostname: string;
  readonly binaryPath: string;
  readonly serverArgs: readonly string[];
  readonly autoStartServer: boolean;
  readonly minimumServerVersion: string;
  readonly debugLogs: boolean;
  /**
   * Panel interface language override: `"auto"` follows
   * `vscode.env.language`; `"en"` / `"zh-TW"` pin a locale. Any other value
   * (hand-edited config) degrades to `"auto"` semantics at the locale
   * boundary (see host/locale.ts).
   */
  readonly language: string;
  readonly chatFontFamily: string;
  readonly chatFontSize: number;
}

/**
 * Fallbacks applied when the adapter has no value for a key. Mirrors the
 * defaults in `contributes.configuration` in package.json — keep both in
 * sync when adding a setting (todo 21 derives its schema from the manifest).
 */
export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  serverUrl: "",
  port: 4096,
  hostname: "127.0.0.1",
  binaryPath: "opencode",
  serverArgs: [],
  autoStartServer: true,
  minimumServerVersion: "0.0.0",
  debugLogs: false,
  language: "auto",
  chatFontFamily: "",
  chatFontSize: 0,
};

function readString(adapter: ConfigAdapter, key: string, fallback: string): string {
  const value = adapter.get<unknown>(key);
  return typeof value === "string" ? value : fallback;
}

function readNumber(adapter: ConfigAdapter, key: string, fallback: number): number {
  const value = adapter.get<unknown>(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(adapter: ConfigAdapter, key: string, fallback: boolean): boolean {
  const value = adapter.get<unknown>(key);
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(
  adapter: ConfigAdapter,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = adapter.get<unknown>(key);
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/** Snapshot the current configuration as a typed {@link PanelConfig}. */
export function readPanelConfig(adapter: ConfigAdapter): PanelConfig {
  return {
    serverUrl: readString(adapter, "serverUrl", DEFAULT_PANEL_CONFIG.serverUrl),
    port: readNumber(adapter, "port", DEFAULT_PANEL_CONFIG.port),
    hostname: readString(adapter, "hostname", DEFAULT_PANEL_CONFIG.hostname),
    binaryPath: readString(adapter, "binaryPath", DEFAULT_PANEL_CONFIG.binaryPath),
    serverArgs: readStringArray(adapter, "serverArgs", DEFAULT_PANEL_CONFIG.serverArgs),
    autoStartServer: readBoolean(
      adapter,
      "autoStartServer",
      DEFAULT_PANEL_CONFIG.autoStartServer,
    ),
    minimumServerVersion: readString(
      adapter,
      "minimumServerVersion",
      DEFAULT_PANEL_CONFIG.minimumServerVersion,
    ),
    debugLogs: readBoolean(adapter, "debugLogs", DEFAULT_PANEL_CONFIG.debugLogs),
    language: readString(adapter, "language", DEFAULT_PANEL_CONFIG.language),
    chatFontFamily: readString(
      adapter,
      "chatFontFamily",
      DEFAULT_PANEL_CONFIG.chatFontFamily,
    ),
    chatFontSize: readNumber(adapter, "chatFontSize", DEFAULT_PANEL_CONFIG.chatFontSize),
  };
}

/**
 * Effective server base URL: the explicit `serverUrl` when set (scheme
 * defaulted to http, trailing slashes stripped), otherwise
 * `http://<hostname>:<port>`.
 */
export function serverBaseUrl(config: PanelConfig): string {
  const trimmed = config.serverUrl.trim();
  if (trimmed.length > 0) {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  }
  return `http://${config.hostname}:${config.port}`;
}

export interface PanelConfigAccessor {
  /** Read a fresh typed snapshot. */
  read(): PanelConfig;
  /**
   * Fires with a fresh snapshot when any `opencodeChatSidebar.*` key changes.
   * Waves the raw workspace event through the section filter so consumers
   * never see unrelated edits.
   */
  readonly onDidChange: Event<PanelConfig>;
  dispose(): void;
}

/**
 * Build a typed accessor over the injected adapter, re-emitting change
 * events filtered to the {@link CONFIG_SECTION} section.
 */
export function createConfigAccessor(
  adapter: ConfigAdapter,
  changeSource: ConfigChangeSource,
): PanelConfigAccessor {
  const listeners = new Set<Listener<PanelConfig>>();
  const subscription = changeSource.onChange((event) => {
    if (!event.affectsConfiguration(CONFIG_SECTION)) return;
    const next = readPanelConfig(adapter);
    for (const listener of listeners) {
      listener(next);
    }
  });
  return {
    read: () => readPanelConfig(adapter),
    onDidChange: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    dispose: () => {
      listeners.clear();
      subscription.dispose();
    },
  };
}

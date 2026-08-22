/**
 * GENERATED FILE — do not edit by hand (plan todo 21). Source of truth:
 * package.json `contributes.configuration.properties` (+ l10n bundles for
 * descriptions). Regenerate with `node scripts/gen-settings-schema.mjs`;
 * `--check` exits 1 when this file drifts from the manifest.
 */
// allow: SIZE_OK — generated data artifact; review the generator, not this file.
import type { StringId } from "./strings.js";

export const SETTING_SECTIONS = ["server","diagnostics","appearance"] as const;
export type SettingSectionId = (typeof SETTING_SECTIONS)[number];

export type SettingValueType = "string" | "number" | "boolean" | "string-array";
export type SettingValue = string | number | boolean | readonly string[];
export type SettingTextFormat = "text" | "non-blank" | "endpoint" | "hostname" | "semver";
export type SettingScopeChoice = "global" | "workspace";

export interface SettingField {
  readonly key: string;
  readonly shortKey: string;
  readonly type: SettingValueType;
  readonly defaultValue: SettingValue;
  readonly section: SettingSectionId;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly enum?: readonly string[];
  readonly format?: SettingTextFormat;
  readonly description: { readonly en: string; readonly zhTW: string };
}

/** One row per manifest key, in manifest order (single source of truth). */
export const SETTING_FIELDS: readonly SettingField[] = [
  {
    key: "opencodeChatSidebar.serverUrl",
    shortKey: "serverUrl",
    type: "string",
    defaultValue: "",
    section: "server",
    format: "endpoint",
    description: {
      en: "Full URL of an already-running opencode server (e.g. `http://127.0.0.1:4096`). When empty, the extension derives the endpoint from `opencodeChatSidebar.hostname` and `opencodeChatSidebar.port` and may spawn its own managed server.",
      zhTW: "已在執行中的 opencode 伺服器完整網址（例如 `http://127.0.0.1:4096`）。留空時，擴充套件會以 `opencodeChatSidebar.hostname` 與 `opencodeChatSidebar.port` 組成端點，並可視需要自行啟動受管理的伺服器。",
    },
  },
  {
    key: "opencodeChatSidebar.port",
    shortKey: "port",
    type: "number",
    defaultValue: 4096,
    section: "server",
    min: 1,
    max: 65535,
    integer: true,
    description: {
      en: "Port for the opencode server the extension connects to (and spawns, when `opencodeChatSidebar.autoStartServer` is enabled). Ignored when `opencodeChatSidebar.serverUrl` is set.",
      zhTW: "擴充套件連線（以及啟動時，`opencodeChatSidebar.autoStartServer` 開啟時）opencode 伺服器使用的連接埠。設定 `opencodeChatSidebar.serverUrl` 時忽略此項。",
    },
  },
  {
    key: "opencodeChatSidebar.hostname",
    shortKey: "hostname",
    type: "string",
    defaultValue: "127.0.0.1",
    section: "server",
    format: "hostname",
    description: {
      en: "Hostname for the opencode server the extension connects to (and spawns). Keep `127.0.0.1` unless you know the server binds elsewhere. Ignored when `opencodeChatSidebar.serverUrl` is set.",
      zhTW: "擴充套件連線（以及啟動）opencode 伺服器使用的主機名稱。除非確定伺服器綁定在其他位址，否則請保留 `127.0.0.1`。設定 `opencodeChatSidebar.serverUrl` 時忽略此項。",
    },
  },
  {
    key: "opencodeChatSidebar.binaryPath",
    shortKey: "binaryPath",
    type: "string",
    defaultValue: "opencode",
    section: "server",
    format: "non-blank",
    description: {
      en: "Path (or name on `PATH`) of the `opencode` binary used to spawn a managed server.",
      zhTW: "用來啟動受管理伺服器的 `opencode` 執行檔路徑（或 `PATH` 上的名稱）。",
    },
  },
  {
    key: "opencodeChatSidebar.serverArgs",
    shortKey: "serverArgs",
    type: "string-array",
    defaultValue: [],
    section: "server",
    description: {
      en: "Extra arguments appended to `opencode serve --port <port> --hostname <hostname>` when the extension spawns a managed server.",
      zhTW: "擴充套件啟動受管理伺服器時，附加在 `opencode serve --port <port> --hostname <hostname>` 之後的額外參數。",
    },
  },
  {
    key: "opencodeChatSidebar.autoStartServer",
    shortKey: "autoStartServer",
    type: "boolean",
    defaultValue: true,
    section: "server",
    description: {
      en: "When enabled, the extension spawns a managed `opencode serve` process if no healthy server is found on the configured endpoint. Foreign (user-started) servers are only ever attached to, never killed.",
      zhTW: "啟用後，當設定的端點上找不到健康的伺服器時，擴充套件會啟動受管理的 `opencode serve` 行程。外部（使用者自行啟動）的伺服器只會被連接，絕不會被終止。",
    },
  },
  {
    key: "opencodeChatSidebar.minimumServerVersion",
    shortKey: "minimumServerVersion",
    type: "string",
    defaultValue: "0.0.0",
    section: "server",
    format: "semver",
    description: {
      en: "Minimum accepted opencode server version. Servers below this version still run, but the extension shows a warning and hides features the server does not expose. `0.0.0` disables the floor (warn-only).",
      zhTW: "可接受的最低 opencode 伺服器版本。低於此版本的伺服器仍可執行，但擴充套件會顯示警告，並隱藏伺服器未提供的功能。設為 `0.0.0` 表示停用下限（僅警告）。",
    },
  },
  {
    key: "opencodeChatSidebar.debugLogs",
    shortKey: "debugLogs",
    type: "boolean",
    defaultValue: false,
    section: "diagnostics",
    description: {
      en: "Write verbose debug output (with secret redaction) to the \"OpenCode Chat Sidebar\" output channel.",
      zhTW: "將詳細除錯輸出（含密鑰遮蔽）寫入「OpenCode Chat Sidebar」輸出頻道。",
    },
  },
  {
    key: "opencodeChatSidebar.chatFontFamily",
    shortKey: "chatFontFamily",
    type: "string",
    defaultValue: "",
    section: "appearance",
    description: {
      en: "Font family for chat message rendering in the panel. Empty inherits the VS Code editor font.",
      zhTW: "面板中聊天訊息顯示的字型。留空則沿用 VS Code 編輯器字型。",
    },
  },
  {
    key: "opencodeChatSidebar.chatFontSize",
    shortKey: "chatFontSize",
    type: "number",
    defaultValue: 0,
    section: "appearance",
    min: 0,
    max: 72,
    integer: true,
    description: {
      en: "Font size (px) for chat message rendering in the panel. `0` inherits the VS Code default.",
      zhTW: "面板中聊天訊息顯示的字體大小（px）。`0` 表示沿用 VS Code 預設值。",
    },
  },
  {
    key: "opencodeChatSidebar.language",
    shortKey: "language",
    type: "string",
    defaultValue: "auto",
    section: "appearance",
    enum: ["auto","en","zh-TW"],
    description: {
      en: "Interface language of the panel: `auto` follows VS Code's display language, or pin a locale explicitly. Applies instantly to every open panel.",
      zhTW: "面板的介面語言：`auto` 跟隨 VS Code 顯示語言，或明確指定語系。變更即時套用到所有已開啟的面板。",
    },
  },
];

/** Typed settings values; keys mirror the manifest short keys 1:1. */
export interface SettingsValues {
  readonly serverUrl: string;
  readonly port: number;
  readonly hostname: string;
  readonly binaryPath: string;
  readonly serverArgs: readonly string[];
  readonly autoStartServer: boolean;
  readonly minimumServerVersion: string;
  readonly debugLogs: boolean;
  readonly chatFontFamily: string;
  readonly chatFontSize: number;
  readonly language: string;
}

export function defaultSettingsValues(): SettingsValues {
  return {
    serverUrl: "",
    port: 4096,
    hostname: "127.0.0.1",
    binaryPath: "opencode",
    serverArgs: [],
    autoStartServer: true,
    minimumServerVersion: "0.0.0",
    debugLogs: false,
    chatFontFamily: "",
    chatFontSize: 0,
    language: "auto",
  };
}

export function settingFieldsForSection(section: SettingSectionId): readonly SettingField[] {
  return SETTING_FIELDS.filter((field) => field.section === section);
}

const FIELD_BY_SHORT_KEY: ReadonlyMap<string, SettingField> = new Map(
  SETTING_FIELDS.map((field) => [field.shortKey, field]),
);

export function fieldByShortKey(shortKey: string): SettingField | undefined {
  return FIELD_BY_SHORT_KEY.get(shortKey);
}

const VALUE_ACCESSORS: ReadonlyMap<string, (values: SettingsValues) => SettingValue> = new Map([
  ["serverUrl", (values: SettingsValues): SettingValue => values.serverUrl],
  ["port", (values: SettingsValues): SettingValue => values.port],
  ["hostname", (values: SettingsValues): SettingValue => values.hostname],
  ["binaryPath", (values: SettingsValues): SettingValue => values.binaryPath],
  ["serverArgs", (values: SettingsValues): SettingValue => values.serverArgs],
  ["autoStartServer", (values: SettingsValues): SettingValue => values.autoStartServer],
  ["minimumServerVersion", (values: SettingsValues): SettingValue => values.minimumServerVersion],
  ["debugLogs", (values: SettingsValues): SettingValue => values.debugLogs],
  ["chatFontFamily", (values: SettingsValues): SettingValue => values.chatFontFamily],
  ["chatFontSize", (values: SettingsValues): SettingValue => values.chatFontSize],
  ["language", (values: SettingsValues): SettingValue => values.language],
]);

/** Typed per-field read over a SettingsValues record (generated accessors). */
export function settingFieldValue(values: SettingsValues, field: SettingField): SettingValue {
  const accessor = VALUE_ACCESSORS.get(field.shortKey);
  return accessor === undefined ? field.defaultValue : accessor(values);
}

/** Label id for a field (settings.field.<shortKey>, provisioned in strings.ts). */
export function fieldLabelId(field: SettingField): StringId {
  return `settings.field.${field.shortKey}` as StringId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(record: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function coerceNumber(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(record: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function coerceStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Boundary parse for the plain-record settings slices crossing the wire
 * (init.settings / getSettings.values): per manifest type, fallback to the
 * manifest default. Mirrors the todo-6 readPanelConfig semantics.
 */
export function coerceSettingsValues(raw: unknown): SettingsValues {
  const record: Readonly<Record<string, unknown>> = isRecord(raw) ? raw : {};
  const defaults = defaultSettingsValues();
  return {
    serverUrl: coerceString(record, "serverUrl", defaults.serverUrl),
    port: coerceNumber(record, "port", defaults.port),
    hostname: coerceString(record, "hostname", defaults.hostname),
    binaryPath: coerceString(record, "binaryPath", defaults.binaryPath),
    serverArgs: coerceStringArray(record, "serverArgs", defaults.serverArgs),
    autoStartServer: coerceBoolean(record, "autoStartServer", defaults.autoStartServer),
    minimumServerVersion: coerceString(record, "minimumServerVersion", defaults.minimumServerVersion),
    debugLogs: coerceBoolean(record, "debugLogs", defaults.debugLogs),
    chatFontFamily: coerceString(record, "chatFontFamily", defaults.chatFontFamily),
    chatFontSize: coerceNumber(record, "chatFontSize", defaults.chatFontSize),
    language: coerceString(record, "language", defaults.language),
  };
}

/**
 * Semantic validation for an already-typed value (both the host patch
 * validator and the webview draft store run this one rule source). Returns a
 * technical reason string, or null when the value is acceptable.
 */
export function validateFieldValue(field: SettingField, value: SettingValue): string | null {
  switch (field.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field.shortKey}: must be a number`;
      if (field.integer === true && !Number.isInteger(value)) return `${field.shortKey}: must be an integer`;
      if (field.min !== undefined && value < field.min) return `${field.shortKey}: must be an integer between ${field.min} and ${field.max}`;
      if (field.max !== undefined && value > field.max) return `${field.shortKey}: must be an integer between ${field.min} and ${field.max}`;
      return null;
    }
    case "string": {
      if (typeof value !== "string") return `${field.shortKey}: must be a string`;
      if (field.enum !== undefined && !field.enum.includes(value))
        return `${field.shortKey}: must be one of ${field.enum.join(", ")}`;
      switch (field.format ?? "text") {
        case "text":
          return null;
        case "non-blank":
          return value.trim().length > 0 ? null : `${field.shortKey}: must not be blank`;
        case "endpoint":
          return value.trim().length === 0 || !/\s/.test(value)
            ? null
            : `${field.shortKey}: must be a URL without whitespace (credentials go to the password field)`;
        case "hostname":
          return value.trim().length > 0 && !/[\s/]/.test(value)
            ? null
            : `${field.shortKey}: must be a host name without whitespace or slashes`;
        case "semver":
          return /^\d+\.\d+\.\d+$/.test(value)
            ? null
            : `${field.shortKey}: must look like MAJOR.MINOR.PATCH (e.g. 1.2.3)`;
      }
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${field.shortKey}: must be a boolean`;
    case "string-array":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? null
        : `${field.shortKey}: must be an array of strings`;
  }
}

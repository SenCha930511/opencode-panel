/**
 * Shared typed messenger protocol between the VSCode host extension and the
 * sidebar webview. Both directions are expressed as string -> payload maps;
 * every webview request carries a uuid `messageId` correlator.
 *
 * Reply lifecycle (Continue-pattern, binding):
 *  - handler returns a value  -> single `{messageId, status, done:true, content}`
 *  - handler returns an AsyncGenerator -> one `{messageId, status, done:false, content}`
 *    per yielded chunk, then a terminal `{messageId, status:"success", done:true}`.
 */

// ---------------------------------------------------------------------------
// Domain value types carried over the wire (JSON-serializable only — never
// send functions or class instances).
// ---------------------------------------------------------------------------

export interface Attachment {
  readonly name: string;
  readonly mimeType: string;
  /** data: URL or absolute file path the server can read. */
  readonly url: string;
}

export type PermissionResponse = "once" | "always" | "reject";

export type Settings = Readonly<Record<string, unknown>>;
export type SettingsPatch = Readonly<Record<string, unknown>>;

/**
 * Result of `getSecret`. REVIEW ADVISORY (binding): only whether the secret is
 * set may cross to the webview — the secret value itself NEVER does.
 */
export interface SecretStatus {
  readonly isSet: boolean;
}

export interface ServerInfo {
  readonly url: string;
  /** null until the health probe has answered. */
  readonly version: string | null;
}

/** Capability matrix for the connected server (semver floors x probe outcome). */
export interface ServerCapabilities {
  readonly fork: boolean;
  readonly question: boolean;
  readonly todo: boolean;
  readonly omo?: boolean;
  readonly omoMcpNote?: boolean;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  /** ISO-8601 timestamp of the last update. */
  readonly updatedAt: string;
}

export type ToastLevel = "info" | "warning" | "error";

// ---------------------------------------------------------------------------
// Config-file editor (opencode.json / omo.jsonc) wire surface.
// ---------------------------------------------------------------------------

export type ConfigFileId = "opencode" | "omo";

export type ConfigScope = "global" | "project";

export interface ConfigFileReadPayload {
  readonly file: ConfigFileId;
  readonly scope: ConfigScope;
}

export interface ConfigFileWritePayload extends ConfigFileReadPayload {
  /** Full replacement text (JSONC, comments preserved webview-side). */
  readonly rawText: string;
  /** mtime the webview last read; omit to force past the host mtime guard. */
  readonly expectedMtimeMs?: number;
}

export interface ConfigFileReadReply {
  /** Path a read resolved to, or the default create target when missing. */
  readonly path: string;
  readonly exists: boolean;
  readonly rawText: string;
  readonly mtimeMs: number;
  /** Machine-stable parse code (jsonc-parser printParseErrorCode), or null. */
  readonly parseError: string | null;
  /**
   * Absolute path of the legacy `~/.config/opencode/oh-my-openagent.json`,
   * set only for file:"omo", scope:"global" when both read candidates are
   * missing AND the legacy file exists. Display-only — never a write target.
   */
  readonly legacyNoticePath?: string | null;
}

export interface ConfigFileWriteReply {
  readonly mtimeMs: number;
  readonly backupPath: string | null;
}

/** Host write/read failure taxonomy; messages carry a stable `[<code>]` prefix. */
export const CONFIG_FILE_ERROR_CODES = [
  "parse",
  "mtime-mismatch",
  "no-workspace",
  "io",
  "invalid-payload",
] as const;

export type ConfigFileErrorCode = (typeof CONFIG_FILE_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Webview -> Host: string -> payload map (one entry per request type).
// ---------------------------------------------------------------------------

export interface FromWebviewProtocol {
  readonly ready: Record<string, never>;
  readonly sendPrompt: {
    readonly text: string;
    readonly sessionId: string;
    readonly agent?: string;
    readonly model?: string;
    readonly variant?: string;
    readonly attachments: readonly Attachment[];
  };
  readonly abort: { readonly sessionId: string };
  readonly createSession: { readonly title?: string };
  readonly deleteSession: { readonly id: string };
  readonly renameSession: { readonly id: string; readonly title: string };
  readonly share: { readonly id: string };
  readonly unshare: { readonly id: string };
  readonly fork: { readonly id: string; readonly messageID?: string };
  readonly revert: { readonly id: string; readonly messageID: string };
  readonly unrevert: { readonly id: string };
  readonly summarize: { readonly id: string };
  readonly runCommand: {
    readonly sessionId: string;
    readonly command: string;
    readonly args: readonly string[];
  };
  readonly runShell: { readonly sessionId: string; readonly input: string };
  readonly answerPermission: {
    readonly sessionId: string;
    readonly permissionID: string;
    readonly response: PermissionResponse;
  };
  readonly answerQuestion: {
    readonly sessionId: string;
    readonly questionID: string;
    readonly answers: readonly string[];
  };
  readonly openDiff: { readonly sessionId: string; readonly messageID?: string; readonly file?: string };
  readonly openFile: { readonly path: string };
  readonly getSettings: Record<string, never>;
  readonly setSettings: { readonly patch: SettingsPatch };
  readonly getSecret: { readonly key: string };
  readonly setSecret: { readonly key: string; readonly value: string };
  readonly searchFiles: { readonly query: string };
  readonly selectSession: { readonly sessionId: string };
  readonly listSessions: Record<string, never>;
  readonly getCapabilities: Record<string, never>;
  readonly setSessionAuto: { readonly sessionId: string; readonly enabled: boolean };
  readonly getSessionAuto: { readonly sessionId: string };
  readonly getSubagentLogs: {
    readonly sessionId: string;
    readonly taskId?: string;
    readonly hint?: string;
  };
  readonly openSettingsTab: Record<string, never>;
  readonly closeSettingsTab: Record<string, never>;
  readonly configFileRead: ConfigFileReadPayload;
  readonly configFileWrite: ConfigFileWritePayload;
}

/** The value each request resolves to in its terminal `done:true` envelope. */
export interface FromWebviewResponse {
  readonly ready: null;
  /** Streamed prompt chunks appear as `done:false` envelopes; final is null. */
  readonly sendPrompt: null;
  readonly abort: null;
  readonly createSession: { readonly id: string };
  readonly deleteSession: null;
  readonly renameSession: null;
  readonly share: { readonly url: string };
  readonly unshare: null;
  readonly fork: { readonly id: string };
  readonly revert: null;
  readonly unrevert: null;
  readonly summarize: null;
  readonly runCommand: null;
  readonly runShell: null;
  readonly answerPermission: null;
  readonly answerQuestion: null;
  readonly openDiff: null;
  readonly openFile: null;
  readonly getSettings: Settings;
  readonly setSettings: null;
  readonly getSecret: SecretStatus;
  readonly setSecret: null;
  readonly searchFiles: readonly string[];
  readonly selectSession: null;
  readonly listSessions: SessionListPayload;
  /** The capabilities.refresh payload, or null when nothing is connected/readable. */
  readonly getCapabilities: CapabilitiesRefreshPayload | null;
  readonly setSessionAuto: null;
  readonly getSessionAuto: { readonly auto: boolean };
  readonly getSubagentLogs: {
    readonly steps: readonly string[];
    readonly isRunning: boolean;
    /**
     * Live snapshot of what the subagent is doing right now (absent when the
     * host could not locate a child session). `thinking` carries the latest
     * reasoning text (tail-capped), `toolName`/`toolSummary` describe the
     * tool currently in flight when `phase === "tool"`.
     */
    readonly progress?: SubagentProgress;
  };
  readonly openSettingsTab: null;
  readonly closeSettingsTab: null;
  readonly configFileRead: ConfigFileReadReply;
  readonly configFileWrite: ConfigFileWriteReply;
}

// ---------------------------------------------------------------------------
// Host -> Webview: string -> payload map.
// ---------------------------------------------------------------------------

export type ResponseStatus = "success" | "error";

/** What the subagent did most recently, derived from its child session parts. */
export type SubagentProgressPhase = "thinking" | "tool" | "writing" | "idle";

/** Live subagent progress snapshot embedded in the getSubagentLogs reply. */
export interface SubagentProgress {
  readonly phase: SubagentProgressPhase;
  /** Latest reasoning text, trimmed and tail-capped (empty when none seen). */
  readonly thinking: string;
  /** True when `thinking` was tail-capped to fit the wire. */
  readonly thinkingTruncated: boolean;
  readonly toolName?: string;
  readonly toolSummary?: string;
}

/** Reply envelope payload; also covers the single-reply case (`done:true`). */
export interface StreamChunkPayload {
  readonly messageId: string;
  readonly status: ResponseStatus;
  readonly done: boolean;
  readonly content: unknown;
}

export interface InitPayload {
  readonly locale: string;
  readonly strings: Readonly<Record<string, string>>;
  readonly server: ServerInfo;
  readonly capabilities: ServerCapabilities;
  readonly settings: Settings;
}

export interface EventPayload {
  readonly type: string;
  readonly payload: unknown;
}

export interface SessionListPayload {
  readonly sessions: readonly SessionSummary[];
}

/** One agent the server advertises via GET /agent (subset of the SDK Agent type). */
export interface AgentSummary {
  readonly name: string;
  /** Agent mode as reported (`primary` | `subagent` | `all`); absent when the server omits it. */
  readonly mode?: string;
  readonly model?: string;
  readonly builtIn: boolean;
}

/** One slash command the server advertises via GET /command. */
export interface CommandSummary {
  readonly name: string;
  readonly description?: string;
}

/** One model inside a provider group (defensive parse of /config/providers). */
export interface CapabilityModelEntry {
  readonly id: string;
  readonly name: string;
  /** Model's context-window size in tokens (`limit.context`) when the server reports it. */
  readonly contextWindow?: number;
  readonly reasoning?: boolean;
  readonly variants?: readonly string[];
  readonly options?: Record<string, unknown>;
}

/** One provider group; `models` may be empty (the webview hides the group). */
export interface CapabilityProviderEntry {
  readonly id: string;
  readonly name: string;
  readonly models: readonly CapabilityModelEntry[];
}

/** The `capabilities.refresh` payload (host/handlers/capabilityWire.ts documents the push contract). */
export interface CapabilitiesRefreshPayload {
  readonly agents: readonly AgentSummary[];
  readonly commands: readonly CommandSummary[];
  readonly providers: readonly CapabilityProviderEntry[];
  readonly defaultModels: Readonly<Record<string, string>>;
  readonly defaultModel?: string;
}

export interface ToastPayload {
  readonly level: ToastLevel;
  readonly text: string;
}

export interface ToWebviewProtocol {
  readonly init: InitPayload;
  readonly streamChunk: StreamChunkPayload;
  readonly event: EventPayload;
  readonly sessionList: SessionListPayload;
  readonly toast: ToastPayload;
}

// ---------------------------------------------------------------------------
// Wire envelopes (discriminated unions over the maps).
// ---------------------------------------------------------------------------

export type RequestEnvelope = {
  readonly [K in keyof FromWebviewProtocol]: {
    readonly messageId: string;
    readonly type: K;
    readonly payload: FromWebviewProtocol[K];
  };
}[keyof FromWebviewProtocol];

export type HostMessage = {
  readonly [K in keyof ToWebviewProtocol]: {
    readonly type: K;
    readonly payload: ToWebviewProtocol[K];
  };
}[keyof ToWebviewProtocol];

// ---------------------------------------------------------------------------
// Message-type tuples + runtime guards, with compile-time exhaustiveness
// assertions so adding a key to a map without adding it to the tuple (or vice
// versa) fails the build.
// ---------------------------------------------------------------------------

export const FROM_WEBVIEW_MESSAGE_TYPES = [
  "ready",
  "sendPrompt",
  "abort",
  "createSession",
  "deleteSession",
  "renameSession",
  "share",
  "unshare",
  "fork",
  "revert",
  "unrevert",
  "summarize",
  "runCommand",
  "runShell",
  "answerPermission",
  "answerQuestion",
  "openDiff",
  "openFile",
  "getSettings",
  "setSettings",
  "getSecret",
  "setSecret",
  "searchFiles",
  "selectSession",
  "listSessions",
  "getCapabilities",
  "setSessionAuto",
  "getSessionAuto",
  "openSettingsTab",
  "closeSettingsTab",
  "configFileRead",
  "configFileWrite",
] as const;

export type FromWebviewMessageType = (typeof FROM_WEBVIEW_MESSAGE_TYPES)[number];

export const TO_WEBVIEW_MESSAGE_TYPES = [
  "init",
  "streamChunk",
  "event",
  "sessionList",
  "toast",
] as const;

export type ToWebviewMessageType = (typeof TO_WEBVIEW_MESSAGE_TYPES)[number];

type AssertTrue<T extends true> = T;
type SameKeys<A extends string, B extends string> = [Exclude<A, B>] extends [never]
  ? [Exclude<B, A>] extends [never]
    ? true
    : never
  : never;

type CheckFromKeys = AssertTrue<SameKeys<keyof FromWebviewProtocol, FromWebviewMessageType>>;
type CheckToKeys = AssertTrue<SameKeys<keyof ToWebviewProtocol, ToWebviewMessageType>>;
export type ExhaustivenessCheck = readonly [CheckFromKeys, CheckToKeys];

const FROM_WEBVIEW_TYPE_SET: ReadonlySet<string> = new Set(FROM_WEBVIEW_MESSAGE_TYPES);
const TO_WEBVIEW_TYPE_SET: ReadonlySet<string> = new Set(TO_WEBVIEW_MESSAGE_TYPES);

export function isFromWebviewMessageType(value: string): value is FromWebviewMessageType {
  return FROM_WEBVIEW_TYPE_SET.has(value);
}

export function isToWebviewMessageType(value: string): value is ToWebviewMessageType {
  return TO_WEBVIEW_TYPE_SET.has(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Error types live in ./errors and are re-exported so consumers keep a single
// import path for the whole protocol surface.
export {
  MalformedMessageError,
  MessengerError,
  RemoteError,
  UnknownMessageIdError,
  UnknownMessageTypeError,
} from "./errors";
import { MalformedMessageError, UnknownMessageTypeError } from "./errors";

/**
 * Boundary parse of an inbound webview request envelope. Payload shape beyond
 * "is an object" is trusted to the protocol contract — this is the single
 * trust boundary, there is no per-field revalidation inside the dispatcher.
 */
export function parseRequestEnvelope(raw: unknown): {
  readonly messageId: string;
  readonly type: FromWebviewMessageType;
  readonly payload: unknown;
} {
  if (!isRecord(raw)) {
    throw new MalformedMessageError("envelope is not an object");
  }
  const { messageId, type, payload } = raw;
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new MalformedMessageError("messageId must be a non-empty string");
  }
  if (typeof type !== "string") {
    throw new MalformedMessageError("type must be a string");
  }
  if (!isFromWebviewMessageType(type)) {
    throw new UnknownMessageTypeError(type);
  }
  if (payload !== undefined && !isRecord(payload)) {
    throw new MalformedMessageError("payload must be an object");
  }
  return { messageId, type, payload: payload ?? {} };
}

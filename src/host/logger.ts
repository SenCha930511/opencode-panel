/**
 * Redacted extension logging for the "Chat Sidebar for OpenCode" output channel.
 *
 * Every line passes through {@link redact} before it is written, so spawned
 * `opencode serve` stdout/stderr and HTTP traces can never leak
 * `Authorization: Basic` headers, `password=` assignments, or env-style
 * values whose name contains KEY, TOKEN, or PASSWORD.
 *
 * `debug`-class output (which is where bulk server chatter, HTTP traces,
 * and — at most — prompt/file content may go) is written only when the
 * `opencodeChatSidebar.debugLogs` setting is enabled. Prompt text and file
 * contents must NEVER be logged at info level or above.
 */

export const REDACTED = "<redacted>";

/**
 * `Authorization: Basic <token>` (any case). The scheme word is kept so
 * traces stay readable; only the credential material is scrubbed.
 */
const AUTHORIZATION_BASIC = /(Authorization:\s*Basic\s+)(\S+)/gi;

/**
 * Env-style `NAME=VALUE` assignments where NAME contains KEY, TOKEN, or
 * PASSWORD (case-insensitive). Values may be double- or single-quoted (so
 * quoted spaces are scrubbed whole) or bare up to whitespace/`&`/`;`/`,` —
 * the last shape also covers `password=<...>` inside URL query strings.
 */
const SENSITIVE_ENV_VALUE =
  /([A-Za-z0-9_]*(?:KEY|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s&;,]+)/gi;

/**
 * Scrub credential material from a log line. Over-redaction (e.g. a
 * `KEYBOARD_LAYOUT=us` assignment) is deliberate and spec'd: names matching
 * the env globs are scrubbed wholesale.
 */
export function redact(text: string): string {
  return text
    .replace(AUTHORIZATION_BASIC, `$1${REDACTED}`)
    .replace(SENSITIVE_ENV_VALUE, `$1${REDACTED}`);
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Minimal structural mirror of the `appendLine` half of `vscode.OutputChannel`. */
export interface OutputChannelLike {
  appendLine(line: string): void;
}

/**
 * Logger writing to the extension's output channel. Levels are chosen by
 * consumer:
 * - `debug`: dev chatter — spawned-process streams, HTTP traces, and the
 *   ONLY level allowed to carry prompt text or file contents. Gated on the
 *   debugLogs setting.
 * - `info`: lifecycle facts a user or bug report needs (server started,
 *   attached, capability summary). NEVER prompt text or file contents.
 * - `warn`/`error`: actionable failures.
 */
export class PanelLogger {
  constructor(
    private readonly channel: OutputChannelLike,
    private readonly debugEnabled: () => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Debug-class message; dropped entirely when `debugLogs` is off. */
  debug(message: string): void {
    if (this.debugEnabled()) this.write("debug", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  error(message: string): void {
    this.write("error", message);
  }

  /** Spawned `opencode serve` stdout — server chatter is debug class. */
  processStdout(chunk: string): void {
    this.debug(`[proc:out] ${chunk}`);
  }

  /** Spawned `opencode serve` stderr. */
  processStderr(chunk: string): void {
    this.debug(`[proc:err] ${chunk}`);
  }

  /** HTTP request/response trace line (never bodies at info level). */
  httpTrace(trace: string): void {
    this.debug(`[http] ${trace}`);
  }

  private write(level: LogLevel, message: string): void {
    this.channel.appendLine(`[${this.now().toISOString()}] [${level}] ${redact(message)}`);
  }
}

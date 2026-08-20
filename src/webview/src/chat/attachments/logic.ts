// i18n-allow-literal — no display copy; sensitive reasons are mirrored host
// wire data (pinned identical by both test suites).
/**
 * Attachments pure logic (plan todo 17, webview side): DOM-free decisions.
 *
 * - {@link SENSITIVE_PATH_RULES} / {@link sensitivePathReason}: the EXACT
 *   mirror of the host authority in src/host/handlers/attachments.ts. The
 *   mirror exists because @-mention picks never cross the host until send —
 *   the warn-before-send banner must flag them client-side. Host and
 *   webview suites pin the same matrix. Path-based ONLY; no content reads.
 * - {@link extractMentionQuery}: the `@query` token under the caret, with
 *   the full token range so a palette pick can strip it from the textarea.
 * - {@link chipFromPath} / {@link urlFromServerPath}: chip factories for
 *   server-reported paths. Server find routes return SERVER-RELATIVE paths;
 *   absolute paths become `file://` URLs (host-compose parity) while
 *   relative paths ride VERBATIM — the server resolves them against its own
 *   project root, the root that produced them. Inventing a root host-side
 *   would fabricate data; the todo-5 mock accepts the verbatim shape.
 */

import type { StagedAttachment } from "./constants.js";

// ---------------------------------------------------------------------------
// Sensitive-path rules (MIRROR of src/host/handlers/attachments.ts — keep in
// lockstep; both suites pin the identical matrix).
// ---------------------------------------------------------------------------

export type SensitivePathRule =
  | { readonly kind: "basename"; readonly value: string; readonly reason: string }
  | { readonly kind: "suffix"; readonly value: string; readonly reason: string }
  | { readonly kind: "prefix"; readonly value: string; readonly reason: string };

export const SENSITIVE_PATH_RULES: readonly SensitivePathRule[] = [
  { kind: "basename", value: ".env", reason: "dotenv secrets file" },
  { kind: "prefix", value: ".env.", reason: "dotenv secrets file" },
  { kind: "basename", value: "id_rsa", reason: "SSH private key" },
  { kind: "basename", value: "id_dsa", reason: "SSH private key" },
  { kind: "basename", value: "id_ecdsa", reason: "SSH private key" },
  { kind: "basename", value: "id_ed25519", reason: "SSH private key" },
  { kind: "suffix", value: ".pem", reason: "private key / certificate material" },
  { kind: "suffix", value: ".key", reason: "private key material" },
  { kind: "suffix", value: ".keystore", reason: "certificate keystore" },
  { kind: "suffix", value: ".jks", reason: "certificate keystore" },
  { kind: "suffix", value: ".p12", reason: "certificate bundle" },
  { kind: "suffix", value: ".pfx", reason: "certificate bundle" },
  { kind: "basename", value: "credentials.json", reason: "cloud credentials" },
  { kind: "basename", value: "service-account.json", reason: "cloud credentials" },
  { kind: "basename", value: "service_account.json", reason: "cloud credentials" },
  { kind: "basename", value: ".npmrc", reason: "registry auth tokens" },
  { kind: "basename", value: ".netrc", reason: "stored login credentials" },
  { kind: "basename", value: ".pypirc", reason: "registry auth tokens" },
  { kind: "basename", value: ".htpasswd", reason: "password file" },
];

export function baseNameOfPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

export function sensitivePathReason(path: string): string | undefined {
  const name = baseNameOfPath(path).toLowerCase();
  for (const rule of SENSITIVE_PATH_RULES) {
    const hit =
      (rule.kind === "basename" && name === rule.value) ||
      (rule.kind === "suffix" && name.endsWith(rule.value)) ||
      (rule.kind === "prefix" && name.startsWith(rule.value));
    if (hit) return rule.reason;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// @-mention extraction.
// ---------------------------------------------------------------------------

/** The `@query` token under the caret: query text + full token range. */
export interface MentionQuery {
  readonly query: string;
  /** Index of the `@`. */
  readonly start: number;
  /** Index one past the token's last character. */
  readonly end: number;
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * A mention is a whitespace-delimited token that STARTS with `@` and reaches
 * the caret. `email@host` is not one (the `@` is mid-token); neither is a
 * token the caret has already left. A bare `@` yields query "".
 */
export function extractMentionQuery(text: string, caretIndex: number): MentionQuery | undefined {
  if (caretIndex < 0 || caretIndex > text.length) return undefined;
  let start = caretIndex;
  while (start > 0 && !isSpace(text[start - 1])) start -= 1;
  if (text[start] !== "@") return undefined;
  let end = caretIndex;
  while (end < text.length && !isSpace(text[end])) end += 1;
  return { query: text.slice(start + 1, caretIndex), start, end };
}

/** Remove a mention token from the text; the caret lands where `@` was. */
export function stripMentionToken(text: string, mention: MentionQuery): string {
  return text.slice(0, mention.start) + text.slice(mention.end);
}

/** Replace a mention token in the text with `@path ` and position caret right after the space. */
export function replaceMentionToken(
  text: string,
  mention: MentionQuery,
  replacement: string,
): { readonly newText: string; readonly newCaret: number } {
  const insert = `@${replacement} `;
  const newText = text.slice(0, mention.start) + insert + text.slice(mention.end);
  const newCaret = mention.start + insert.length;
  return { newText, newCaret };
}

const mentionRegistry = new Map<string, string>();

/** Record a picked file mention mapping (e.g. "sessions.ts" -> "src/host/handlers/sessions.ts"). */
export function recordMentionPath(fileName: string, fullPath: string): void {
  mentionRegistry.set(fileName, fullPath);
}

/**
 * Expand all recorded @filename mentions in the text to @fullPath before
 * sending to the backend/model.
 */
export function expandMentionPaths(text: string): string {
  if (mentionRegistry.size === 0) return text;
  return text.replace(/@([^\s]+)/g, (match, name) => {
    const full = mentionRegistry.get(name);
    return full !== undefined ? `@${full}` : match;
  });
}

// ---------------------------------------------------------------------------
// Chip factory for server-reported paths.
// ---------------------------------------------------------------------------

/** Mirror of the host's mimeForPath (same table, same default). */
export function mimeForPath(path: string): string {
  const name = baseNameOfPath(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1);
  switch (ext) {
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "text/plain";
  }
}

/** Mirror of the host's toFileUrl (segments encoded, drive colon kept). */
export function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0) return segment;
    return encodeURIComponent(segment);
  });
  return `file://${segments.join("/")}`;
}

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/;

/**
 * Chip url for a server-reported path: absolute paths become file:// URLs;
 * server-relative paths ride verbatim (the server resolves them against the
 * project root whose find route returned them — see the module header).
 */
export function urlFromServerPath(path: string): string {
  return ABSOLUTE_PATH.test(path) ? toFileUrl(path) : path;
}

/** One staged chip from a picked path; sensitive flag derived locally. */
export function chipFromPath(path: string, id: string): StagedAttachment {
  const sensitive = sensitivePathReason(path);
  return {
    id,
    name: baseNameOfPath(path),
    mimeType: mimeForPath(path),
    url: urlFromServerPath(path),
    ...(sensitive === undefined ? {} : { sensitive }),
  };
}

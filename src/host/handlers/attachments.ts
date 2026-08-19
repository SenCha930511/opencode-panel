// i18n-allow-literal — host-side labels (toast payloads, sensitive reasons)
// ride vscode.l10n / the webview banner; strings.ts is frozen for todo 17.
/**
 * Attachments domain host handlers (plan todo 17): the `searchFiles`
 * request handler, editor-context attachment composers, the sensitive-path
 * flag list, and the image size/format gate.
 *
 * WIRE PUSH CONTRACT (chosen push — mirrors the todo-12 SESSIONS_LIST_EVENT
 * pattern): the editor context-menu commands (`opencodePanel.attachSelection`
 * / `attachFile` in extension.ts) compose an attachment and push it to the
 * chat composer over the todo-3 `event` channel as
 * {@link ATTACHMENTS_ADD_EVENT} (`"attachments.add"`) carrying
 * {@link AttachmentPushPayload}. The chip state itself lives WEBVIEW-side
 * (todo-14's Composer owns no attachment logic; it renders the chips a
 * parent hands it), so there is no host-side pending store — the host is
 * stateless and the event IS the handoff, exactly like `sessions.list`.
 * The literal is mirrored in src/webview/src/chat/attachments/constants.ts
 * and pinned by tests on both sides (host/webview never import each other).
 *
 * searchFiles ROUTE DECISION (capability-defensive, todo-7 pattern):
 * 1. SDK `find.files({query})` → `GET /find/file` → paths verbatim.
 * 2. HTTP 404 (server without the route) → SDK `find.text({pattern})` →
 *    `GET /find` → distinct match paths (content-search semantics degrade,
 *    never invented).
 * 3. Also 404 → the injected {@link AttachmentsDomainDeps.workspaceFindFiles}
 *    (production default: `vscode.workspace.findFiles` via the todo-6-style
 *    adapter factory; handlers themselves NEVER touch vscode).
 * Results are deduped and capped at {@link SEARCH_RESULT_LIMIT}. Debounce is
 * a webview concern (150ms there); the host answers every request honestly.
 *
 * PART SHAPE (verified against the todo-5 mock end-to-end): the mock
 * `POST /session/:id/message` accepts the todo-14 file-part mapping
 * `{type:"file", url, mime, filename}` (asserted 200 in the acceptance
 * suite), so NO fenced-text degrade is needed for plain file chips. The
 * SELECTION chip is the documented exception: todo-3's wire `Attachment`
 * `{name, mimeType, url}` has no line-range fields, so the selection rides a
 * `data:text/markdown;base64` URL whose payload is a fenced code block with
 * a `{language} {path}#L{a}-L{b}` info header — the exact bytes the server
 * needs, delivered without any host-side fs read (host reads file bytes
 * ONLY via the SDK; here not even that — file chips use `file://` URLs and
 * let the SERVER read the file).
 *
 * SENSITIVE PATHS: {@link SENSITIVE_PATH_RULES} is the DATA-driven authority
 * (basenames/suffixes, matched case-insensitively on the basename). Flagging
 * is PATH-BASED ONLY — no content sniffing, no file reads — per the plan's
 * "warn-before-send banner for sensitive paths". The same rules are mirrored
 * webview-side for @-mention picks (whose paths never cross the host until
 * send); both copies are pinned by an identical test matrix.
 *
 * IMAGES: pasted/picked images are staged webview-side as
 * `data:<mime>;base64` parts; {@link assertImageAllowed} is the typed gate —
 * ≤ {@link MAX_IMAGE_BYTES} (10 MiB, the EXACT boundary is allowed) and an
 * allowlisted mime. A `size`/`format` {@link ImageAttachmentError} fires
 * BEFORE any request is issued (QA failure contract: 11 MB ⇒ rejected with a
 * size toast, nothing sent). The webview mirrors this gate for its UX;
 * this module is the authority both are tested against.
 */

import type { PanelLogger } from "../logger.js";
import type { FromWebviewResponse } from "../../shared/protocol.js";
import type { RegisterHandler, SessionClientSource } from "./sessions.js";

// ---------------------------------------------------------------------------
// Wire push contract.
// ---------------------------------------------------------------------------

/** Event-channel type carrying {@link AttachmentPushPayload} to the chat view. */
export const ATTACHMENTS_ADD_EVENT = "attachments.add";

/** The `attachments.add` payload: one staged chip plus its sensitive flag. */
export interface AttachmentPushPayload {
  readonly attachment: {
    readonly name: string;
    readonly mimeType: string;
    /** `file://` absolute path or a `data:` URL (selections/images). */
    readonly url: string;
  };
  /** Present when the source path matched {@link SENSITIVE_PATH_RULES}. */
  readonly sensitive?: string;
  readonly source: "selection" | "file";
}

// ---------------------------------------------------------------------------
// Sensitive-path rules (host authority; mirrored webview-side + pinned).
// ---------------------------------------------------------------------------

/**
 * One path rule. `basename` exact-matches the file name; `suffix` matches the
 * trailing characters (dot-including, e.g. ".pem"); `prefix` matches leading
 * basename characters (".env." for dotenv variants). All compares are
 * case-insensitive. Path-based ONLY — contents are never read.
 */
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

/** Basename of an fs path (both separators; trailing separators dropped). */
export function baseNameOfPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/** First matching rule's reason, or undefined when the path is unflagged. */
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
// Part composers (file chips + selection chips).
// ---------------------------------------------------------------------------

/**
 * Best-effort mime for a path the server will read itself. Text-first: the
 * server treats text/* as readable content; everything unknown is octet-stream
 * so it is never mis-served as text.
 */
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
    case "":
      return "text/plain";
    default:
      return "text/plain";
  }
}

/**
 * `file://` URL for an absolute path (mirrors the todo-14 prompt test's
 * expected part URL shape). Segments are URI-encoded; a drive-letter colon in
 * the first segment (Windows) is preserved.
 */
export function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0) return segment; // "" (posix root) or "C:" (drive)
    return encodeURIComponent(segment);
  });
  return `file://${segments.join("/")}`;
}

/** Clean chip for a workspace file; the SERVER reads the bytes. */
export function composeFileAttachment(path: string): AttachmentPushPayload["attachment"] {
  return { name: baseNameOfPath(path), mimeType: mimeForPath(path), url: toFileUrl(path) };
}

/** What the editor reports for the current selection (adapter-produced). */
export interface EditorSelectionSnapshot {
  /** Absolute fs path (file: scheme only — the adapter guarantees this). */
  readonly path: string;
  /** vscode languageId (e.g. "typescript"). */
  readonly language: string;
  /** 0-based editor lines, inclusive; displayed 1-based. */
  readonly startLine: number;
  readonly endLine: number;
  /** Selected text verbatim. */
  readonly text: string;
}

/**
 * Selection chip: a `data:text/markdown;base64` part whose payload is the
 * fenced selection with a `{language} {path}#L{a}-L{b}` header. This is the
 * documented degrade-mode carrier (todo-3's wire carries no line range), and
 * it is ALWAYS how selections ship — there is no richer server contract.
 */
export function composeSelectionAttachment(
  snapshot: EditorSelectionSnapshot,
): AttachmentPushPayload["attachment"] {
  const from = snapshot.startLine + 1;
  const to = snapshot.endLine + 1;
  const name = `${baseNameOfPath(snapshot.path)}#L${String(from)}-L${String(to)}`;
  const fenced = `\`\`\`${snapshot.language} ${snapshot.path}#L${String(from)}-L${String(to)}\n${snapshot.text}\n\`\`\`\n`;
  const base64 = Buffer.from(fenced, "utf8").toString("base64");
  return { name, mimeType: "text/markdown", url: `data:text/markdown;base64,${base64}` };
}

export type PushBuildResult =
  | { readonly ok: true; readonly payload: AttachmentPushPayload }
  | { readonly ok: false; readonly message: string };

/** Selection push, or a truthful reason the command could not compose one. */
export function buildSelectionPush(snapshot: EditorSelectionSnapshot | undefined): PushBuildResult {
  if (snapshot === undefined) return { ok: false, message: "No active editor with a file." };
  if (snapshot.text.trim().length === 0) return { ok: false, message: "Selection is empty." };
  const attachment = composeSelectionAttachment(snapshot);
  const sensitive = sensitivePathReason(snapshot.path);
  return {
    ok: true,
    payload: { attachment, ...(sensitive === undefined ? {} : { sensitive }), source: "selection" },
  };
}

/** File push for the editor-context / explorer-context command. */
export function buildFilePush(path: string | undefined): PushBuildResult {
  if (path === undefined) return { ok: false, message: "No file to attach." };
  const attachment = composeFileAttachment(path);
  const sensitive = sensitivePathReason(path);
  return {
    ok: true,
    payload: { attachment, ...(sensitive === undefined ? {} : { sensitive }), source: "file" },
  };
}

// ---------------------------------------------------------------------------
// Image gate (host authority; mirrored by the webview image module).
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIME_ALLOWLIST = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;
export type ImageMime = (typeof IMAGE_MIME_ALLOWLIST)[number];

export class ImageAttachmentError extends Error {
  readonly kind: "size" | "format";

  constructor(kind: "size" | "format", message: string) {
    super(message);
    this.name = "ImageAttachmentError";
    this.kind = kind;
  }
}

/** Decoded byte length of a `data:<mime>;base64,<payload>` URL. */
export function dataUrlByteLength(dataUrl: string): number {
  const match = /^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (match === null) {
    throw new ImageAttachmentError("format", "malformed data URL (expected data:<mime>;base64,…)");
  }
  const payload = match[2] ?? "";
  const remainder = payload.length % 4;
  let bytes = Math.floor(payload.length / 4) * 3;
  if (remainder === 2) bytes += 1;
  else if (remainder === 3) bytes += 2;
  if (payload.endsWith("==")) bytes -= 2;
  else if (payload.endsWith("=")) bytes -= 1;
  return bytes;
}

/**
 * The send gate: allowlisted mime AND ≤ MAX_IMAGE_BYTES (the exact 10 MiB
 * boundary is ALLOWED). Throws {@link ImageAttachmentError} before any
 * request exists; callers toast the message verbatim.
 */
export function assertImageAllowed(mimeType: string, byteLength: number): void {
  if (!(IMAGE_MIME_ALLOWLIST as readonly string[]).includes(mimeType)) {
    throw new ImageAttachmentError(
      "format",
      `image format not attachable: ${mimeType} (allowed: png, jpeg, gif, webp, svg)`,
    );
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    const mib = (byteLength / (1024 * 1024)).toFixed(1);
    throw new ImageAttachmentError("size", `image is ${mib} MiB — the limit is 10 MiB`);
  }
}

// ---------------------------------------------------------------------------
// searchFiles handler.
// ---------------------------------------------------------------------------

export const SEARCH_RESULT_LIMIT = 20;

/** One failed attachments-domain server call; carries no credentials. */
export class AttachmentSearchError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status: number | undefined) {
    super(`searchFiles failed: ${detail}`);
    this.name = "AttachmentSearchError";
    this.status = status;
  }
}

export interface AttachmentsDomainDeps {
  readonly source: SessionClientSource;
  readonly logger: PanelLogger;
  /**
   * Plan-mandated LAST-RESORT fallback when the server exposes neither find
   * route (production default: `vscode.workspace.findFiles` via the adapter;
   * tests inject a stub). Handlers never resolve vscode themselves.
   */
  readonly workspaceFindFiles: { (query: string): Promise<readonly string[]> };
}

interface SdkFindResultLike<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly response: Response;
}

function findErrorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * The route chain as one decision. Returns undefined ONLY when the server
 * answered 404 on BOTH find routes (capability missing) — the caller then
 * falls back to the workspace index. Any other failure throws.
 */
export async function searchFilesViaServer(
  deps: AttachmentsDomainDeps,
  query: string,
): Promise<readonly string[] | undefined> {
  const connection = await deps.source.connect();

  const files: SdkFindResultLike<readonly string[]> = await connection.client.find.files({
    query: { query, dirs: "false" },
  });
  if (files.error === undefined && files.data !== undefined) return files.data;
  if (files.response.status !== 404) {
    throw new AttachmentSearchError(findErrorDetail(files.error), files.response.status);
  }

  deps.logger.debug("attachments domain: /find/file missing (404); probing /find text search");
  const text = await connection.client.find.text({ query: { pattern: query } });
  if (text.error === undefined && text.data !== undefined) {
    return distinct(text.data.map((match) => match.path.text));
  }
  if (text.response.status === 404) return undefined;
  throw new AttachmentSearchError(findErrorDetail(text.error), text.response.status);
}

/**
 * Register the `searchFiles` handler. Empty queries answer `[]` without
 * touching the server; results are deduped and capped at the plan's limit.
 */
export function registerAttachmentHandlers(
  register: RegisterHandler,
  deps: AttachmentsDomainDeps,
): void {
  register("searchFiles", async ({ query }): Promise<FromWebviewResponse["searchFiles"]> => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const viaServer = await searchFilesViaServer(deps, trimmed);
    const results = viaServer ?? (await deps.workspaceFindFiles(trimmed));
    if (viaServer === undefined) {
      deps.logger.debug("attachments domain: server find routes missing; workspace fallback used");
    }
    return distinct(results).slice(0, SEARCH_RESULT_LIMIT);
  });
}

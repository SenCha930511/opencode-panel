// i18n-allow-literal — error messages are wire/toast data mirrored from the
// host authority (src/host/handlers/attachments.ts), not t() display copy.
/**
 * Image attachment gate (plan todo 17, webview side): the EXACT mirror of
 * the host authority in src/host/handlers/attachments.ts. The gate runs
 * BEFORE any request exists: paste/pick converts bytes to a `data:` URL,
 * {@link attachmentFromImageData} throws the typed
 * {@link ImageAttachmentError} on a violation, and the UI toasts the message
 * verbatim — an 11 MiB image never becomes a request (QA failure contract).
 * Pinned against the host suite by an identical boundary matrix.
 *
 * No file bytes are read beyond the picker/paste payload the browser already
 * holds (the plan's "no fs in webview" rule is untouched — there is no fs
 * here at all).
 */

import type { StagedAttachment } from "./constants.js";

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

/** The send gate: allowlisted mime AND ≤ MAX_IMAGE_BYTES (boundary allowed). */
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

/** What a paste/pick supplies once bytes became a data URL. */
export interface ImageInput {
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
}

/**
 * Gate + chip factory in one: throws {@link ImageAttachmentError} BEFORE the
 * chip (and therefore any send) can exist.
 */
export function attachmentFromImageData(input: ImageInput, id: string): StagedAttachment {
  assertImageAllowed(input.mimeType, dataUrlByteLength(input.dataUrl));
  return { id, name: input.name, mimeType: input.mimeType, url: input.dataUrl };
}

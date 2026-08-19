// i18n-allow-literal — doc comments carry no display copy.
/**
 * Attachments package (plan todo 17, webview side) — public surface.
 *
 * ARCHITECTURE:
 * - {@link ./constants} — `attachments.add` wire literal + boundary parser
 *   (mirrors src/host/handlers/attachments.ts; pinned both sides).
 * - {@link ./logic} — @-mention extraction, sensitive-path mirror, chip
 *   factories (DOM-free).
 * - {@link ./images} — the 10 MiB / allowlist gate (mirrors the host
 *   authority; throws BEFORE any request exists).
 * - {@link ./search} — the 150ms debounced searchFiles state machine.
 * - {@link ./controller} — chip state owner (parent of Todo-14 Composer's
 *   controlled props); subscribes the event channel so host editor commands
 *   stage chips and a proven send (busy transition) clears them.
 * - {@link ./useAttachments} — the React hook over the controller.
 * - {@link ./MentionPalette} — SSR-safe palette rows.
 * - {@link ./AttachmentsExtras} — the extras-slot composite (banner +
 *   palette + image intake) wired to the composer textarea via ./domGlue
 *   (the only DOM-touching module; no jsdom here, so DOM glue is untested —
 *   all behavior lives in the pure modules above).
 *
 * ONE-LINE INTEGRATION for the chat orchestrator (Todo-14 files untouched —
 * only their exported props contract is consumed):
 *
 * ```tsx
 * const attachments = useAttachments();
 * <ChatDock
 *   composer={{
 *     attachments: attachments.chips,
 *     onRemoveAttachment: attachments.remove,
 *     extras: <AttachmentsExtras controller={attachments} />,
 *   }}
 * />
 * ```
 *
 * With T15's pickers already in `extras`, compose the row:
 * `extras: <>{pickersExtras}<AttachmentsExtras controller={attachments} /></>`.
 */

export { ATTACHMENTS_ADD_EVENT, parseAttachmentPush } from "./constants.js";
export type { AttachmentPush, StagedAttachment } from "./constants.js";
export {
  createAttachmentsController,
  type AttachmentsController,
  type AttachmentsControllerDeps,
} from "./controller.js";
export {
  IMAGE_MIME_ALLOWLIST,
  MAX_IMAGE_BYTES,
  ImageAttachmentError,
  attachmentFromImageData,
  assertImageAllowed,
  dataUrlByteLength,
} from "./images.js";
export {
  SENSITIVE_PATH_RULES,
  baseNameOfPath,
  chipFromPath,
  extractMentionQuery,
  mimeForPath,
  sensitivePathReason,
  stripMentionToken,
  toFileUrl,
  urlFromServerPath,
  type MentionQuery,
} from "./logic.js";
export { MentionPalette } from "./MentionPalette.js";
export { createMentionSearch, MENTION_DEBOUNCE_MS } from "./search.js";
export { AttachmentsExtras } from "./AttachmentsExtras.js";
export { useAttachments } from "./useAttachments.js";

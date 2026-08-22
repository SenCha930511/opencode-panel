// i18n-allow-literal — wire literals + boundary parsers only; no display copy.
/**
 * Wire literals + boundary parsers for the attachments domain (plan todo 17,
 * webview side) — the todo-12 SESSIONS_LIST_EVENT / todo-15
 * CAPABILITIES_REFRESH_EVENT mirror pattern.
 *
 * `ATTACHMENTS_ADD_EVENT` mirrors src/host/handlers/attachments.ts: the host
 * editor commands (`opencodeChatSidebar.attachSelection` / `attachFile`) push one
 * composed attachment over the todo-3 `event` channel under this type, and
 * this module is the parse-don't-validate boundary for it. The two copies
 * are pinned by tests on both sides; host and webview bundles never import
 * each other. Malformed pushes are DROPPED, never partially adopted.
 */

import { isRecord } from "../../../../shared/protocol.js";
import type { ComposerAttachment } from "../composerLogic.js";

/** Event-channel type carrying the host's attachments.add payload. */
export const ATTACHMENTS_ADD_EVENT = "attachments.add";

/** One staged chip; `sensitive` carries the host/mirror reason when flagged. */
export interface StagedAttachment extends ComposerAttachment {
  readonly sensitive?: string;
}

/** The parsed attachments.add payload (url is a file:// or data: URL). */
export interface AttachmentPush {
  readonly attachment: {
    readonly name: string;
    readonly mimeType: string;
    readonly url: string;
  };
  readonly sensitive?: string;
  readonly source?: string;
}

/** Boundary parse of the event payload; undefined = ignore the push. */
export function parseAttachmentPush(value: unknown): AttachmentPush | undefined {
  if (!isRecord(value) || !isRecord(value.attachment)) return undefined;
  const { name, mimeType, url } = value.attachment;
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (typeof mimeType !== "string" || mimeType.length === 0) return undefined;
  if (typeof url !== "string" || url.length === 0) return undefined;
  return {
    attachment: { name, mimeType, url },
    ...(typeof value.sensitive === "string" && value.sensitive.length > 0
      ? { sensitive: value.sensitive }
      : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
  };
}

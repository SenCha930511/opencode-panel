// i18n-allow-literal — no display copy in this module.
/**
 * Composer DOM glue (plan todo 17, webview side): the ONLY module in the
 * attachments package that touches live DOM. Todo-14's Composer exports no
 * textarea seam (its text is internal state, no onChange/caret props), so
 * the @-flow and paste flow attach to the textarea the composer renders —
 * located by the documented `data-oc-composer` attribute — from the
 * `extras` row the composer already mounts. All logic stays testable
 * elsewhere; this file is thin runtime glue, untested under node by design
 * (no jsdom in this repo).
 *
 * Once Todo-14 grows a text seam (composer contract change), this module
 * shrinks away; nothing else imports DOM types.
 */

import { IMAGE_MIME_ALLOWLIST } from "./images.js";

/** The composer textarea hosting the extras row `from` renders inside. */
export function findComposerTextarea(from: Element): HTMLTextAreaElement | null {
  const host = from.closest("[data-oc-composer]");
  if (host === null) return null;
  const textarea = host.querySelector("textarea");
  return textarea instanceof HTMLTextAreaElement ? textarea : null;
}

/**
 * Replace the textarea's value through React's controlled-input backdoor:
 * assigning `.value` directly does not reach React's onChange, so the native
 * prototype setter is applied and a bubbling `input` event re-reads it —
 * the standard controlled-input bridge (kept isolated here deliberately).
 */
export function setTextareaValue(textarea: HTMLTextAreaElement, value: string, caret: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter === undefined) return;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

/** Clipboard/paste files that pass the image allowlist (others ignored). */
export function imageFilesFrom(data: DataTransfer | null): readonly File[] {
  if (data === null) return [];
  const files: File[] = [];
  for (const file of Array.from(data.files)) {
    if ((IMAGE_MIME_ALLOWLIST as readonly string[]).includes(file.type)) files.push(file);
  }
  return files;
}

/** File/paste bytes -> `data:<mime>;base64,` URL (the send-part carrier). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader produced no data URL"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("FileReader failed"));
    };
    reader.readAsDataURL(file);
  });
}

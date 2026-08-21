/**
 * Chat-list visibility rules (pure, node-testable): which server-persisted
 * content the panel never renders, and the revert-point cut.
 *
 * HIDDEN INJECTIONS (verified against oh-my-openagent dist + the
 * `@opencode-ai/sdk` TextPart contract — the opencode TUI hides the same
 * shapes):
 * - `synthetic: true` text parts — the official hide-from-display flag OMO
 *   writes its internal directives/reminders through
 * - user text starting `[SYSTEM DIRECTIVE: OH-MY-OPENCODE` — OMO's whole
 *   directive family (TODO/BOULDER continuation, delegation notices, ...)
 * - user text starting `[BACKGROUND TASK ` / `[ALL BACKGROUND TASKS ` — OMO's
 *   subagent completion notices
 * - user text starting `<system-reminder>` or containing the
 *   `<!-- OMO_INTERNAL_INITIATOR -->` marker
 *
 * Pattern rules apply to USER-role parts only: assistant output quoting one
 * of these phrases is real content and stays. A message whose parts all
 * filter out is dropped whole (an injected directive never leaves an empty
 * bubble behind); a message that still has any visible part survives.
 *
 * REVERT CUT: {@link visibleMessages} keeps everything up to and including
 * the marked message (the message returned to stays) and drops every message
 * BELOW it — the panel-side mirror of the server's revert marker.
 */

import type { MessageVM, PartVM } from "./types.js";

const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE";
const SYSTEM_REMINDER_PREFIX = "<system-reminder>";
const OMO_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->";

export function isSystemReminderText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith(SYSTEM_REMINDER_PREFIX) ||
    trimmed.startsWith("[BACKGROUND TASK ") ||
    trimmed.startsWith("[ALL BACKGROUND TASKS ") ||
    text.includes(SYSTEM_REMINDER_PREFIX)
  );
}

export function cleanSystemReminderText(text: string): string {
  return text
    .replace(/<\/?system-reminder>/gi, "")
    .replace(/<!--\s*OMO_INTERNAL[A-Z_]*\s*-->/gi, "")
    .trim();
}

/** True when USER-authored-channel text is a hidden internal directive. */
export function isInjectedUserText(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith(SYSTEM_DIRECTIVE_PREFIX)) return true;
  // System reminders are NOT hidden: they are rendered as dedicated SystemNoticeCards!
  if (isSystemReminderText(text)) return false;
  return text.includes(OMO_INITIATOR_MARKER);
}

function isHiddenPart(part: PartVM, role: string): boolean {
  if (part.kind !== "text") return false;
  if (part.synthetic === true) return true;
  // Only user-channel text is pattern-filtered; assistant prose stays.
  return role === "user" && isInjectedUserText(part.text); // i18n-allow-literal
}

/**
 * The message with hidden parts stripped, or `undefined` when nothing
 * visible remains (messages with zero parts to begin with are kept — the
 * list shows their tool/unknown cards, never an invented empty bubble).
 */
export function stripHiddenParts(message: MessageVM): MessageVM | undefined {
  if (message.parts.length === 0) return message;
  const parts = message.parts.filter((part) => !isHiddenPart(part, message.role));
  if (parts.length === 0) return undefined;
  return parts.length === message.parts.length ? message : { ...message, parts };
}

/** Injection-filtered list, then the optional revert cut (marker included). */
export function visibleMessages(
  messages: readonly MessageVM[],
  revertedMessageId?: string,
): MessageVM[] {
  const filtered: MessageVM[] = [];
  for (const message of messages) {
    const visible = stripHiddenParts(message);
    if (visible !== undefined) filtered.push(visible);
  }
  if (revertedMessageId === undefined) return filtered;
  const at = filtered.findIndex((message) => message.id === revertedMessageId); // i18n-allow-literal
  return at === -1 ? filtered : filtered.slice(0, at + 1);
}

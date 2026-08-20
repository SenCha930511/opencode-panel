/**
 * Message-ops pure logic (todo 19, webview side): capability visibility,
 * regenerate target selection, and host error classification. No React, no
 * DOM, no messenger — the same node-testable shape as composerLogic.ts.
 *
 * GUARD SOURCES (plan hard rule "must NOT show shell when hasShell false"):
 * there are TWO wire carriers for visibility, consulted per row:
 *  - `init.capabilities` (todo 3, frozen): names fork/question/todo today —
 *    an explicit `false` on the revert/summarize/shell keys still hides that
 *    row (forward-compat, see {@link resolveMessageOpAvailability}).
 *  - the todo-20 capability-flag store (mcp.status push): the AUTHORITATIVE
 *    `shell` bit — todo 3's init record never carries it, so this store is
 *    the ONLY way hasShell reaches the webview; {@link applyShellFlag} folds
 *    it in. revert/summarize have no todo-7 bit at all (the detector probes
 *    /doc only for fork/question/todo/shell), so their rows render by default
 *    and a genuinely-missing route degrades at call time to the typed
 *    MessageOpUnsupportedError 404 → capability toast (todo-7 fallback rule).
 */

import { isRecord } from "../../../../shared/protocol.js";
import type { MessageVM } from "../types.js";

// ---------------------------------------------------------------------------
// Capability visibility.

export interface MessageOpAvailability {
  readonly revert: boolean;
  readonly unrevert: boolean;
  readonly summarize: boolean;
  readonly shell: boolean;
}

/**
 * Explicit-`false` hides; anything else (missing key, non-boolean, non-record
 * payload) stays visible. Wire reality today: todo-3 `init.capabilities`
 * carries only fork/question/todo (src/providers/initPayload.ts) — NO
 * revert/summarize/shell bits cross the wire, so rows render by default and a
 * genuinely-missing server route surfaces at call time as the typed
 * MessageOpUnsupportedError 404 (the toast path). If a future host push (or a
 * test fixture) carries an explicit `false`, the row hides NOW — both degrade
 * paths are implemented, per the todo-7 UNSUPPORTED-FEATURE rule.
 */
export function resolveMessageOpAvailability(capabilities: unknown): MessageOpAvailability {
  const visible = (name: string): boolean => !(isRecord(capabilities) && capabilities[name] === false); // i18n-allow-literal
  const revertVisible = visible("revert");
  return {
    revert: revertVisible,
    // unrevert shares revert's generation: a server without revert routes
    // lacks unrevert too.
    unrevert: revertVisible,
    summarize: visible("summarize"),
    shell: visible("shell"),
  };
}

export const ALL_OPS_AVAILABLE: MessageOpAvailability = {
  revert: true,
  unrevert: true,
  summarize: true,
  shell: true,
};

/** The shell row shows only when BOTH guard sources allow it (see header). */
export function applyShellFlag(
  base: MessageOpAvailability,
  shellFlag: boolean,
): MessageOpAvailability {
  return { ...base, shell: base.shell && shellFlag };
}

// ---------------------------------------------------------------------------
// Regenerate target: the last non-in-flight user message (inclusive of an
// `upto` anchor) bearing text.

export interface UserTextTarget {
  readonly messageId: string;
  readonly text: string;
}

/** Concatenated text of one message's text parts; undefined when blank. */
export function userTextOf(message: MessageVM): string | undefined {
  let text = "";
  for (const part of message.parts) {
    if (part.kind === "text") text += part.text;
  }
  return text.trim().length === 0 ? undefined : text;
}

/**
 * Walk backwards from the anchor (inclusive — an anchor that IS a user
 * message targets itself; an assistant anchor targets its parent prompt).
 * An unknown anchor id targets nothing.
 */
export function findLastUserText(
  messages: readonly MessageVM[],
  uptoMessageId?: string,
): UserTextTarget | undefined {
  let end = messages.length;
  if (uptoMessageId !== undefined) {
    const at = messages.findIndex((candidate) => candidate.id === uptoMessageId); // i18n-allow-literal
    if (at === -1) return undefined;
    end = at + 1;
  }
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user" || message.inFlight) continue;
    const text = userTextOf(message);
    if (text !== undefined) return { messageId: message.id, text };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Host error classification (the todo-3 error reply carries
// "<ErrorName>: <message>" verbatim from the host messenger).

export type MessageOpErrorClass = "unsupported" | "other";

const UNSUPPORTED_PREFIX = "MessageOpUnsupportedError:";

/**
 * A 404 on an op route names MessageOpUnsupportedError — the degrade class
 * (capability toast, hide-and-move-on) per the todo-7 rule. Everything else
 * (500s, setup errors like SummarizeModelUnavailableError) surfaces its
 * detail text as a plain error toast.
 */
export function classifyMessageOpError(errorText: string): MessageOpErrorClass {
  return errorText.startsWith(UNSUPPORTED_PREFIX) ? "unsupported" : "other";
}

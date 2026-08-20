/**
 * Active-session seam (todo 13): the chat side's single source of truth
 * for the user's selection. Selection is EXPLICIT only — session-list
 * picks, composer new-session, fork — and is mirrored to the host through
 * the `selectSession` wire. Events NEVER steer the selection: any payload
 * arriving for another session (TUI activity, curl probes, a second
 * client on the shared server) is gated out downstream, so the visible
 * conversation can never be yanked away.
 */

import { useSyncExternalStore } from "react";
import { getWebviewMessenger } from "../../lib/messenger.js";

type Listener = { (): void };

let activeSessionId: string | undefined;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** T12 contract: the selected session everything chat-scoped renders. */
export function setActiveSession(sessionId: string): void {
  const changed = activeSessionId !== sessionId;
  activeSessionId = sessionId;
  if (changed) emit();
  try {
    void getWebviewMessenger().request("selectSession", { sessionId });
  } catch {
    // Ignore in tests / detached environments
  }
}

export function getActiveSession(): string | undefined {
  return activeSessionId;
}

export function subscribeActiveSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveSession(): string | undefined {
  return useSyncExternalStore(subscribeActiveSession, getActiveSession, getActiveSession);
}

/**
 * Clear the chat-side selection (T12 prune path): a selected session that no
 * longer exists server-side is cleared from the panel's list; the chat must
 * follow or the composer keeps prompting the dead id (404 "Session not
 * found"). No selectSession post — the next explicit pick re-pins the host.
 */
export function clearActiveSession(): void {
  if (activeSessionId === undefined) return;
  activeSessionId = undefined;
  emit();
}

/** Test seam: reset between suites (production never clears). */
export function resetActiveSessionForTest(): void {
  activeSessionId = undefined;
  emit();
}

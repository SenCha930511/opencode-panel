/**
 * Active-session seam (todo 13, TEMPORARY ownership).
 *
 * T12 (sessions domain) owns selection long-term: when their session list
 * lands, their selection signal must call {@link setActiveSession} here (and
 * `MessageSync.setActiveSession` on the host). Until then this module is the
 * chat side's own source of truth: it adopts the first session id observed
 * on any forwarded chat event (`messages.sync`, deltas, `session.status`),
 * which covers the single-session flow without any selection UI.
 */

import { useSyncExternalStore } from "react";
import { isRecord } from "../../../shared/protocol.js";

type Listener = { (): void };

let activeSessionId: string | undefined;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** T12 contract: the selected session everything chat-scoped renders. */
export function setActiveSession(sessionId: string): void {
  if (activeSessionId === sessionId) return;
  activeSessionId = sessionId;
  emit();
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
  return useSyncExternalStore(subscribeActiveSession, getActiveSession);
}

/**
 * Adopt a session id from a forwarded payload when nothing is selected yet.
 * Once set, later events for OTHER sessions never clobber the selection —
 * explicit `setActiveSession` (T12) is the only override.
 */
export function adoptSessionFrom(payload: unknown): void {
  if (activeSessionId !== undefined || !isRecord(payload)) return;
  const direct = payload.sessionID;
  if (typeof direct === "string") {
    setActiveSession(direct);
    return;
  }
  if (isRecord(payload.info) && typeof payload.info.sessionID === "string") {
    setActiveSession(payload.info.sessionID);
  }
}

/** Test seam: reset between suites (production never clears). */
export function resetActiveSessionForTest(): void {
  activeSessionId = undefined;
  emit();
}

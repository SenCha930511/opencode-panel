/**
 * Session auto arming (completes the composer auto toggle): when auto mode
 * is ON, every session the user opens gets a server-side permission wildcard
 * rule (wildcard allow) so opencode's own permission engine authorizes tool
 * calls without per-request prompts. When auto mode turns OFF, only sessions
 * the panel actually armed get restored to wildcard ask (last-match-wins
 * against any earlier wildcard allow we installed).
 *
 * Tracking is an in-memory per-session set because the server stores rules
 * per session and the panel should not repeatedly PATCH a session it already
 * armed — PATCH /session also bumps `time.updated`, which would churn the
 * session list ordering on every selection.
 */

import { getWebviewMessenger } from "../../lib/messenger.js";

const armedSessions = new Set<string>();

export function markSessionArmed(sessionId: string): void {
  armedSessions.add(sessionId);
}

export function clearArmedSessions(): void {
  armedSessions.clear();
}

async function patchSessionRuleset(sessionId: string, enabled: boolean): Promise<boolean> {
  try {
    await getWebviewMessenger().request("setSessionAuto", { sessionId, enabled });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync server rulesets with the UI toggle: arms every session the user opens
 * while ON; disarms previously-armed sessions when the toggle goes OFF. A
 * failed PATCH leaves the tracking untouched so a reopen retries.
 */
export function ensureAutoArmed(activeSession: string | undefined, autoOn: boolean): void {
  if (autoOn) {
    if (activeSession === undefined || armedSessions.has(activeSession)) return;
    void patchSessionRuleset(activeSession, true).then((ok) => {
      if (ok) markSessionArmed(activeSession);
    });
    return;
  }
  for (const sessionId of armedSessions) {
    void patchSessionRuleset(sessionId, false).then((ok) => {
      if (ok) armedSessions.delete(sessionId);
    });
  }
}

/**
 * Session auto arming (completes the composer auto toggle): when auto mode
 * is ON, every session the user opens gets a server-side permission wildcard
 * rule (wildcard allow) so opencode's own permission engine authorizes tool
 * calls without per-request prompts. When auto mode turns OFF, only sessions
 * the panel actually armed get restored to wildcard ask (last-match-wins
 * against any earlier wildcard allow we installed).
 *
 * Armed state is persisted in localStorage (best-effort) because the panel
 * lifecycle is short (webview kills on close) while server-side rulesets
 * survive; a panel restart must keep being able to unarm what it armed, or
 * auto would silently leak ON after the toggle flipped OFF.
 *
 * Arming is also positioned to run BEFORE the first prompt of a newly
 * created session resolves (see composerLogic.ensureSessionForSend) so the
 * very first tool call in that session clears permissions; per-session
 * dedupe stays a Set so repeated selection does not re-PATCH (the PATCH
 * bumps the session's `time.updated` and would churn the list ordering).
 */

import type { WebviewMessenger } from "../../lib/messenger.js";
import { getWebviewMessenger } from "../../lib/messenger.js";
import { getAutoMode } from "./composerOptions.js";

const ARMED_KEY = "opencode.composer.autoArmedSessions";

function hydrateArmedSessions(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(ARMED_KEY);
    if (raw === null) return new Set();
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

let armedSessions = hydrateArmedSessions();
let lazyMessenger: WebviewMessenger | null = null;

function persistArmedSessions(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ARMED_KEY, JSON.stringify([...armedSessions]));
  } catch {
    // Persistence is best-effort; the in-memory set still drives this run.
  }
}

function messengerOrLazy(messenger?: WebviewMessenger): WebviewMessenger {
  if (messenger !== undefined) return messenger;
  lazyMessenger ??= getWebviewMessenger();
  return lazyMessenger;
}

async function patchSessionRuleset(
  messenger: WebviewMessenger,
  sessionId: string,
  enabled: boolean,
): Promise<boolean> {
  try {
    await messenger.request("setSessionAuto", { sessionId, enabled });
    return true;
  } catch {
    return false;
  }
}

async function armSession(messenger: WebviewMessenger, sessionId: string): Promise<void> {
  if (armedSessions.has(sessionId)) return;
  const ok = await patchSessionRuleset(messenger, sessionId, true);
  if (ok) {
    armedSessions.add(sessionId);
    persistArmedSessions();
  }
}

async function disarmSession(messenger: WebviewMessenger, sessionId: string): Promise<void> {
  if (!armedSessions.has(sessionId)) return;
  const ok = await patchSessionRuleset(messenger, sessionId, false);
  if (ok) {
    armedSessions.delete(sessionId);
    persistArmedSessions();
  }
}

/**
 * Awaited BEFORE a freshly-created session's first prompt is dispatched —
 * the whole point of auto is that the first tool call clears without asking.
 * No-op when auto is off.
 */
export async function armSessionForSend(messenger: WebviewMessenger, sessionId: string): Promise<void> {
  if (!getAutoMode()) return;
  await armSession(messengerOrLazy(messenger), sessionId);
}

/**
 * Effect-sync server rulesets with the UI state: arms the newly-active
 * session while ON (fast-path for sessions the user revisits); flips OFF
 * disarms every session this runtime (or a persisted previous runtime)
 * armed. Net effect per arming points stays single-PATCH.
 */
export function ensureAutoArmed(
  activeSession: string | undefined,
  autoOn: boolean,
  messenger?: WebviewMessenger,
): void {
  const wire = messengerOrLazy(messenger);
  if (autoOn) {
    if (activeSession === undefined) return;
    void armSession(wire, activeSession);
    return;
  }
  for (const sessionId of [...armedSessions]) {
    void disarmSession(wire, sessionId);
  }
}

/** Test seam: reset both the in-memory set and any persisted state. */
export function resetArmingStateForTests(): void {
  armedSessions = new Set();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(ARMED_KEY);
    } catch {
      // ignore
    }
  }
}

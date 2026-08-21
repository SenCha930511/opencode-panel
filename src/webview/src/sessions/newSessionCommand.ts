// i18n-allow-literal — wire literals + doc comments carry no display copy.
/**
 * New-session command intake (FIX-E): the host forwards
 * `opencodePanel.newSession` into the chat webview as a `command.newSession`
 * event (src/extension.ts -> ChatViewProvider.postEvent); until now nothing
 * webview-side consumed it. This seam is the consumer: it routes the event
 * through the REAL sessions store — `store.select(null)` drops chat back
 * to the HOME composer WITHOUT creating a session server-side; the session
 * only comes into being when the first send actually dispatches
 * (ensureSessionForSend path), matching ChatGPT/Claude's create-on-first-prompt.
 *
 * The `"command.newSession"` literal mirrors src/extension.ts verbatim; the
 * two copies are pinned by tests on the webview side because the host and
 * webview bundles never import each other (precedent: todo-12's
 * SESSIONS_LIST_EVENT, todo-20's MCP_STATUS_EVENT).
 */

import type { WebviewMessenger } from "../../lib/messenger.js";
import type { SessionsStore } from "./sessionsStore.js";

/** Host-forwarded event type for the New Session command (mirror literal). */
export const NEW_SESSION_COMMAND_EVENT = "command.newSession";

/**
 * Subscribe the store to the forwarded command; returns the unsubscribe.
 * Op failures already surface through the store's error banner (fail()), so
 * the rejection is consumed here — the event handler never throws async.
 */
export function attachNewSessionCommand(
  messenger: WebviewMessenger,
  store: SessionsStore,
): () => void {
  return messenger.on("event", (event) => {
    if (event.type !== NEW_SESSION_COMMAND_EVENT) return;
    store.select(null);
  });
}

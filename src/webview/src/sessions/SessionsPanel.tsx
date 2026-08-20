import { useEffect, useState, type ReactNode } from "react";
import { getWebviewMessenger } from "../../lib/messenger.js";
import { setActiveSession } from "../chat/activeSession.js";
import { attachNewSessionCommand } from "./newSessionCommand.js";
import { createWebviewPersistence } from "./persistence.js";
import { SessionsStore } from "./sessionsStore.js";
import { SessionList } from "./SessionList.js";

/**
 * INTEGRATION STUB (todo-11 slot contract): the self-wired sessions panel.
 *
 * Mount point (binding): todo 11's shell mounts this via
 * `<AppProvider slots={{ sessions: <SessionsPanel />, chat: ... }}>` inside
 * `src/webview/src/app/bootstrap.tsx`, below the StringsProvider. The aside
 * rail wrapper (`data-oc-slot="sessions"`) is the shell's; this component
 * fills it edge-to-edge.
 *
 * Self-wiring (no props): the store binds the todo-3 webview messenger
 * singleton (listens on both list carriers and issues the six domain
 * requests) and vscode.setState persistence.
 *
 * ACTIVE-SESSION BRIDGE (todo-13 contract): every committed selection change
 * is forwarded to the chat domain's `setActiveSession` alongside the store's
 * own typed emitter (`store.activeSession` — the long-term contract; see
 * ./activeSession.ts). Cleared selections map to T13's no-change (their
 * setter accepts ids only; a deleted selection refetches as null and their
 * next explicit set re-pins).
 *
 * NEW-SESSION COMMAND INTAKE (FIX-E): the host forwards
 * `opencodePanel.newSession` as a `command.newSession` event; this panel —
 * the owner of the only SessionsStore — consumes it through
 * ./newSessionCommand so the command creates AND selects a session through
 * the real store.
 */
export function SessionsPanel(): ReactNode {
  const [store] = useState(() => {
    const created = new SessionsStore({
      messenger: getWebviewMessenger(),
      persistence: createWebviewPersistence(),
    });
    return created;
  });

  useEffect(() => {
    const wire = store.attach();
    return () => {
      wire.dispose();
    };
  }, [store]);

  useEffect(() => {
    return attachNewSessionCommand(store.messenger, store);
  }, [store]);

  useEffect(
    () =>
      store.activeSession.subscribe((id) => {
        if (id !== null) setActiveSession(id);
      }),
    [store],
  );

  return <SessionList store={store} />;
}

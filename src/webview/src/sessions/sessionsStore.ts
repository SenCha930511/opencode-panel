/**
 * DOM-free sessions panel store (todo 12): session list state, client-side
 * title filter, selection with rollback, and optimistic mutations over the
 * todo-3 webview messenger.
 *
 * STATE SHAPE (the React snapshot): `sessions` (newest first, as the host
 * orders them), `filter` (search box text), `selectedId`, `status`
 * (`loading` until the first host list arrives, `ready`, `error` with
 * `errorMessage` — the banner), `copiedId` (transient share-link-copied
 * marker). Every transition replaces the snapshot reference so
 * useSyncExternalStore subscribers re-render.
 *
 * DATA IN: two carriers, both boundary-parsed — the typed todo-3
 * `sessionList` push AND the todo-12 event-channel broadcast
 * ({@link SESSIONS_LIST_EVENT}), so the store works no matter which seam the
 * host's composition uses (see the sync.ts header for why both exist).
 *
 * OPTIMISTIC RULES (todo-12 binding): every mutation applies locally first
 * and ROLLS BACK on a failed request — never an unprotected optimistic title;
 * deleting the selected session clears the selection and restores it on
 * failure (the todo-12 QA scenario). Op errors ALSO raise the error banner;
 * the request REJECTS so callers (dialogs) can stay open on failure.
 *
 * INTERNAL SEAMS for sessionActions.ts (not for general consumers):
 * `messenger`, `commit`, `applySelection`, `patchSession`, `replaceSessionId`,
 * `dropSession`, `fail` are public ONLY so the actions module can share the
 * state machine — everything else uses the intent API below.
 */

import type { SessionListPayload } from "../../../shared/protocol.js";
import type { WebviewMessenger } from "../../lib/messenger.js";
import { ActiveSessionEmitter, type ActiveSession } from "./activeSession.js";
import {
  SESSIONS_LIST_EVENT,
  toSessionEntries,
  type Disposable,
  type SessionEntry,
} from "./constants.js";
import type { SessionsPersistence } from "./persistence.js";
import { SessionActions } from "./sessionActions.js";

export type SessionsStatus = "loading" | "ready" | "error";

export interface SessionsSnapshot {
  readonly sessions: readonly SessionEntry[];
  readonly filter: string;
  readonly selectedId: string | null;
  readonly status: SessionsStatus;
  readonly errorMessage: string | null;
  readonly copiedId: string | null;
}

export interface SessionsStoreDeps {
  readonly messenger: WebviewMessenger;
  readonly persistence?: SessionsPersistence | undefined;
  readonly active?: ActiveSessionEmitter | undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class SessionsStore {
  /** Todo-13's read seam (see activeSession.ts for the contract). */
  readonly activeSession: ActiveSession;

  /** INTERNAL: shared with SessionActions (see module header). */
  readonly messenger: WebviewMessenger;
  private readonly persistence: SessionsPersistence | undefined;
  private readonly active: ActiveSessionEmitter;
  private readonly listeners = new Set<() => void>();
  private readonly actions: SessionActions;
  private snapshotValue: SessionsSnapshot;

  constructor(deps: SessionsStoreDeps) {
    this.messenger = deps.messenger;
    this.persistence = deps.persistence;
    this.active = deps.active ?? new ActiveSessionEmitter();
    this.activeSession = this.active;
    this.actions = new SessionActions(this);

    let selectedId: string | null = null;
    let filter = "";
    const persisted = deps.persistence?.load();
    if (persisted !== undefined) {
      selectedId = persisted.selectedId;
      filter = persisted.filter;
    }
    this.snapshotValue = {
      sessions: [],
      filter,
      selectedId,
      status: "loading",
      errorMessage: null,
      copiedId: null,
    };
    if (selectedId !== null) this.active.set(selectedId);
  }

  // -- React / external observation -----------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionsSnapshot => {
    return this.snapshotValue;
  };

  /** Attach to the messenger push channels; detaches via the returned disposable. */
  attach(): Disposable {
    const offList = this.messenger.on("sessionList", (payload: SessionListPayload) => {
      this.applyList(toSessionEntries(payload));
    });
    const offEvents = this.messenger.on("event", (event) => {
      if (event.type === SESSIONS_LIST_EVENT) {
        this.applyList(toSessionEntries(event.payload));
      }
    });
    // Proactive pull for the initial list (pushes cover later changes;
    // offline ⇒ keep whatever init/push delivers).
    void this.messenger
      .request("listSessions", {})
      .then((res: unknown) => {
        const entries = toSessionEntries(res);
        this.applyList(entries);
      })
      .catch(() => {});
    const disposer: Disposable = {
      dispose: () => {
        offList();
        offEvents();
      },
    };
    return disposer;
  }

  // -- Reads ------------------------------------------------------------------

  /** Search box: case-insensitive substring filter on the title. */
  visibleSessions(): readonly SessionEntry[] {
    const query = this.snapshotValue.filter.trim().toLowerCase();
    if (query === "") return this.snapshotValue.sessions;
    return this.snapshotValue.sessions.filter((session) =>
      session.title.toLowerCase().includes(query),
    );
  }

  // -- Synchronous UI intents ---------------------------------------------------

  setFilter(filter: string): void {
    this.commit({ ...this.snapshotValue, filter });
    this.persist();
  }

  select(id: string | null): void {
    this.applySelection(id);
  }

  clearError(): void {
    if (this.snapshotValue.status !== "error") return;
    this.commit({ ...this.snapshotValue, status: "ready", errorMessage: null });
  }

  clearCopied(): void {
    if (this.snapshotValue.copiedId === null) return;
    this.commit({ ...this.snapshotValue, copiedId: null });
  }

  // -- Mutations: the public API delegates to SessionActions (sessionActions.ts).

  createSession(title: string | undefined): Promise<string> {
    return this.actions.create(title);
  }

  renameSession(id: string, title: string): Promise<void> {
    return this.actions.rename(id, title);
  }

  deleteSession(id: string): Promise<void> {
    return this.actions.remove(id);
  }

  shareSession(id: string): Promise<string> {
    return this.actions.share(id);
  }

  unshareSession(id: string): Promise<void> {
    return this.actions.unshare(id);
  }

  forkSession(id: string, messageID: string | undefined): Promise<string> {
    return this.actions.fork(id, messageID);
  }

  markCopied(id: string): void {
    this.commit({ ...this.snapshotValue, copiedId: id });
  }

  // -- INTERNAL seams for sessionActions.ts (see module header) -----------------

  applyList(sessions: readonly SessionEntry[]): void {
    const selectedId = this.snapshotValue.selectedId;
    const exists =
      selectedId !== null &&
      sessions.some((session) => {
        return session.id === selectedId;
      });
    const nextSelection = exists ? selectedId : null;
    this.commit({
      ...this.snapshotValue,
      sessions,
      selectedId: nextSelection,
      status: "ready",
      errorMessage: null,
    });
    if (nextSelection !== selectedId) this.setSelectionEverywhere(null);
  }

  applySelection(id: string | null): void {
    this.commit({ ...this.snapshotValue, selectedId: id });
    this.setSelectionEverywhere(id);
  }

  setSelectionEverywhere(id: string | null): void {
    this.active.set(id);
    this.persist();
  }

  patchSession(id: string, patch: (session: SessionEntry) => SessionEntry): void {
    this.commit({
      ...this.snapshotValue,
      sessions: this.snapshotValue.sessions.map((session) =>
        session.id === id ? patch(session) : session,
      ),
    });
  }

  replaceSessionId(beforeId: string, afterId: string): void {
    this.patchSession(beforeId, (session) => ({ ...session, id: afterId }));
    if (this.snapshotValue.selectedId === beforeId) {
      this.commit({ ...this.snapshotValue, selectedId: afterId });
    }
  }

  dropSession(id: string): void {
    this.commit({
      ...this.snapshotValue,
      sessions: this.snapshotValue.sessions.filter((session) => {
        return session.id !== id;
      }),
    });
  }

  fail(error: unknown): void {
    this.commit({ ...this.snapshotValue, status: "error", errorMessage: errorText(error) });
  }

  private persist(): void {
    this.persistence?.save({
      selectedId: this.snapshotValue.selectedId,
      filter: this.snapshotValue.filter,
    });
  }

  commit(next: SessionsSnapshot): void {
    if (next === this.snapshotValue) return;
    this.snapshotValue = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

let sharedSessionsStore: SessionsStore | null = null;
const sharedStoreListeners = new Set<() => void>();

export function subscribeSharedSessionsStore(listener: () => void): () => void {
  sharedStoreListeners.add(listener);
  return () => {
    sharedStoreListeners.delete(listener);
  };
}

export function getSharedSessionsStore(deps?: SessionsStoreDeps): SessionsStore | null {
  if (sharedSessionsStore === null && deps !== undefined) {
    sharedSessionsStore = new SessionsStore(deps);
  }
  return sharedSessionsStore;
}

export function setSharedSessionsStore(store: SessionsStore | null): void {
  sharedSessionsStore = store;
  for (const listener of sharedStoreListeners) {
    listener();
  }
}

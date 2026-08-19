/**
 * Remote-mutation actions for the sessions store (todo 12): the six domain
 * operations with their optimistic apply → rollback-on-error choreographies.
 * Split from sessionsStore.ts by responsibility (state machine vs remote
 * actions); the SessionsStore public API delegates here unchanged.
 *
 * These methods touch the store through its documented-internal seams
 * (commit/selection/patch/fail — see sessionsStore.ts `INTERNAL` markers).
 */

import type { SessionEntry } from "./constants.js";
import type { SessionsStore } from "./sessionsStore.js";

const PENDING_PREFIX = "pending:";

export class SessionActions {
  private readonly store: SessionsStore;

  constructor(store: SessionsStore) {
    this.store = store;
  }

  async create(title: string | undefined): Promise<string> {
    const store = this.store;
    const pendingId = `${PENDING_PREFIX}${globalThis.crypto.randomUUID()}`;
    const pending: SessionEntry = {
      id: pendingId,
      title: title ?? "",
      updatedAt: new Date().toISOString(),
      shared: false,
    };
    store.commit({ ...store.getSnapshot(), sessions: [pending, ...store.getSnapshot().sessions] });
    try {
      const created = await store.messenger.request("createSession", {
        ...(title === undefined ? {} : { title }),
      });
      store.replaceSessionId(pendingId, created.id);
      store.applySelection(created.id);
      return created.id;
    } catch (error) {
      store.dropSession(pendingId);
      store.fail(error);
      throw error;
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const store = this.store;
    const before = store.getSnapshot().sessions;
    store.patchSession(id, (session) => ({ ...session, title }));
    try {
      await store.messenger.request("renameSession", { id, title });
    } catch (error) {
      store.commit({ ...store.getSnapshot(), sessions: before });
      store.fail(error);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const store = this.store;
    const before = store.getSnapshot().sessions;
    const beforeSelection = store.getSnapshot().selectedId;
    store.commit({
      ...store.getSnapshot(),
      sessions: before.filter((session) => {
        return session.id !== id;
      }),
    });
    if (beforeSelection === id) {
      store.applySelection(null);
    }
    try {
      await store.messenger.request("deleteSession", { id });
    } catch (error) {
      // QA (todo-12 failure path): roll back the list AND the selection.
      store.commit({ ...store.getSnapshot(), sessions: before });
      if (beforeSelection === id) {
        store.applySelection(beforeSelection);
      }
      store.fail(error);
      throw error;
    }
  }

  /** Resolves the server share URL (the UI copies it, then marks `copiedId`). */
  async share(id: string): Promise<string> {
    const { url } = await this.store.messenger.request("share", { id });
    return url;
  }

  async unshare(id: string): Promise<void> {
    await this.store.messenger.request("unshare", { id });
  }

  async fork(id: string, messageID: string | undefined): Promise<string> {
    const store = this.store;
    const forked = await store.messenger.request("fork", {
      id,
      ...(messageID === undefined ? {} : { messageID }),
    });
    store.applySelection(forked.id);
    return forked.id;
  }
}

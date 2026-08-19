/**
 * SessionsStore suite (todo 12 webview half) over the todo-3 protocol
 * loopback (real WebviewMessenger + scripted stub host):
 * list ingestion (both carriers), client-side filter, selection persistence
 * via the setState seam, active-session emissions for todo 13, optimistic
 * mutations and — the todo-12 QA failure path — rollback of list AND
 * selection when the host answers an error.
 */

import { describe, expect, it } from "vitest";
import { SessionsStore } from "../sessionsStore.js";
import type { SessionsPersistedShape, SessionsPersistence } from "../persistence.js";
import { createShareLink } from "../sessionOps.js";
import { createLoopback, makeEntry } from "./stubHost.js";

/** In-memory fake behind the SessionsPersistence seam (records every save). */
class FakePersistence implements SessionsPersistence {
  saved: SessionsPersistedShape[] = [];
  constructor(private readonly initial: SessionsPersistedShape | undefined = undefined) {}
  load(): SessionsPersistedShape | undefined {
    return this.initial;
  }
  save(shape: SessionsPersistedShape): void {
    this.saved.push(shape);
  }
  last(): SessionsPersistedShape {
    const last = this.saved[this.saved.length - 1];
    if (last === undefined) throw new Error("nothing persisted");
    return last;
  }
}

function makeStore(persisted?: SessionsPersistedShape): {
  readonly store: SessionsStore;
  readonly host: ReturnType<typeof createLoopback>["host"];
  readonly persistence: FakePersistence;
} {
  const loopback = createLoopback();
  const persistence = new FakePersistence(persisted);
  const store = new SessionsStore({ messenger: loopback.messenger, persistence });
  store.attach();
  return { store, host: loopback.host, persistence };
}

describe("list ingestion", () => {
  it("the typed sessionList push populates the store and flips status to ready", () => {
    const { store, host } = makeStore();
    expect(store.getSnapshot().status).toBe("loading");
    host.pushSessionList([makeEntry("ses_1", "Alpha"), makeEntry("ses_2", "Beta")]);
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().sessions.map((s) => { return s.title; })).toEqual(["Alpha", "Beta"]);
  });

  it("the event-carried sessions.list broadcast ALSO populates (carrier parity)", () => {
    const { store, host } = makeStore();
    host.pushSessionsEvent([makeEntry("ses_9", "Via event")]);
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().sessions.map((s) => { return s.id; })).toEqual(["ses_9"]);
  });

  it("a vanished selected session clears selection and emits todo-13's signal", () => {
    const { store, host } = makeStore({ selectedId: "ses_1", filter: "" });
    const seen: Array<string | null> = [];
    store.activeSession.subscribe((id) => {
      seen.push(id);
    });
    store.select("ses_1");
    host.pushSessionList([makeEntry("ses_2", "Other")]);
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(seen).toContain(null);
  });
});

describe("search filter", () => {
  it("narrows rows by case-insensitive title substring and persists the query", () => {
    const { store, host, persistence } = makeStore();
    host.pushSessionList([
      makeEntry("ses_1", "Refactor Auth Module"),
      makeEntry("ses_2", "Write tests"),
      makeEntry("ses_3", "auth follow-up"),
    ]);
    store.setFilter("auth");
    expect(store.visibleSessions().map((s) => { return s.id; })).toEqual(["ses_1", "ses_3"]);
    expect(persistence.last().filter).toBe("auth");
    store.setFilter("");
    expect(store.visibleSessions()).toHaveLength(3);
  });
});

describe("selection persistence", () => {
  it("rehydrates selection + filter from the persisted shape", () => {
    const persistence = new FakePersistence({ selectedId: "ses_7", filter: "fix" });
    const loopback = createLoopback();
    const store = new SessionsStore({ messenger: loopback.messenger, persistence });
    expect(store.getSnapshot().selectedId).toBe("ses_7");
    expect(store.getSnapshot().filter).toBe("fix");
    expect(store.activeSession.current()).toBe("ses_7");
  });

  it("persists every selection change and emits todo-13's active-session signal", () => {
    const { store, persistence } = makeStore();
    const seen: Array<string | null> = [];
    store.activeSession.subscribe((id) => {
      seen.push(id);
    });
    store.select("ses_3");
    expect(persistence.last().selectedId).toBe("ses_3");
    expect(store.activeSession.current()).toBe("ses_3");
    expect(seen).toEqual(["ses_3"]);
    store.select(null);
    expect(persistence.last().selectedId).toBeNull();
    expect(seen).toEqual(["ses_3", null]);
  });
});

describe("optimistic mutations", () => {
  it("create: pending entry resolves to the real id, selected, on success", async () => {
    const { store, host } = makeStore();
    host.respond("createSession", () => ({ ok: true, content: { id: "ses_new" } }));
    const promise = store.createSession("Fresh");
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().sessions[0]?.title).toBe("Fresh");
    await expect(promise).resolves.toBe("ses_new");
    expect(store.getSnapshot().sessions[0]?.id).toBe("ses_new");
    expect(store.getSnapshot().selectedId).toBe("ses_new");
  });

  it("create: drops the pending entry and raises the banner on error", async () => {
    const { store, host } = makeStore();
    host.respond("createSession", () => ({ ok: false, error: "SessionOperationError: no" }));
    await expect(store.createSession(undefined)).rejects.toThrow();
    expect(store.getSnapshot().sessions).toHaveLength(0);
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().errorMessage).toContain("SessionOperationError");
  });

  it("rename: applies the title optimistically, keeps it on success", async () => {
    const { store, host } = makeStore();
    host.pushSessionList([makeEntry("ses_1", "before")]);
    host.respond("renameSession", () => ({ ok: true, content: null }));
    await store.renameSession("ses_1", "after");
    expect(store.getSnapshot().sessions[0]?.title).toBe("after");
    expect(store.getSnapshot().status).toBe("ready");
    const request = host.requests[host.requests.length - 1];
    expect(request?.type).toBe("renameSession");
  });

  it("rename: restores the old title on error (no unprotected optimistic title)", async () => {
    const { store, host } = makeStore();
    host.pushSessionList([makeEntry("ses_1", "before")]);
    host.respond("renameSession", () => ({ ok: false, error: "SessionOperationError: 500" }));
    await expect(store.renameSession("ses_1", "after")).rejects.toThrow();
    expect(store.getSnapshot().sessions[0]?.title).toBe("before");
    expect(store.getSnapshot().status).toBe("error");
  });

  it("share returns the url; markCopied/clearCopied drive the copied marker", async () => {
    const { store, host } = makeStore();
    host.respond("share", () => ({ ok: true, content: { url: "https://mock/s/ses_1" } }));
    await expect(store.shareSession("ses_1")).resolves.toBe("https://mock/s/ses_1");
    store.markCopied("ses_1");
    expect(store.getSnapshot().copiedId).toBe("ses_1");
    store.clearCopied();
    expect(store.getSnapshot().copiedId).toBeNull();
  });

  it("unshare and fork succeed; fork selects the new session", async () => {
    const { store, host } = makeStore();
    host.respond("unshare", () => ({ ok: true, content: null }));
    host.respond("fork", () => ({ ok: true, content: { id: "ses_fork" } }));
    await expect(store.unshareSession("ses_1")).resolves.toBeUndefined();
    await expect(store.forkSession("ses_1", "msg_2")).resolves.toBe("ses_fork");
    expect(store.getSnapshot().selectedId).toBe("ses_fork");
    const fork = host.requests.find((r) => { return r.type === "fork"; });
    expect(fork?.payload).toEqual({ id: "ses_1", messageID: "msg_2" });
  });
});

describe("share link flow (injected bindings)", () => {
  it("copies the url and drives the copied mark via the scheduled clear", async () => {
    const { store, host } = makeStore();
    host.respond("share", () => ({ ok: true, content: { url: "https://mock/s/ses_1" } }));
    const clipboard: string[] = [];
    const scheduled: Array<() => void> = [];
    const shareLink = createShareLink({
      writeClipboard: (text) => {
        clipboard.push(text);
        return Promise.resolve();
      },
      schedule: (run) => {
        scheduled.push(run);
      },
    });
    await shareLink(store, makeEntry("ses_1", "doc"));
    expect(clipboard).toEqual(["https://mock/s/ses_1"]);
    expect(store.getSnapshot().copiedId).toBe("ses_1");
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(store.getSnapshot().copiedId).toBeNull();
  });

  it("a shared entry unshares instead of copying", async () => {
    const { store, host } = makeStore();
    host.respond("unshare", () => ({ ok: true, content: null }));
    const clipboard: string[] = [];
    const shareLink = createShareLink({
      writeClipboard: (text) => {
        clipboard.push(text);
        return Promise.resolve();
      },
      schedule: () => {
        return undefined;
      },
    });
    await shareLink(store, makeEntry("ses_1", "doc", true));
    expect(clipboard).toEqual([]);
    expect(host.requests.some((r) => { return r.type === "unshare"; })).toBe(true);
  });

  it("a failing clipboard writes no copied mark", async () => {
    const { store, host } = makeStore();
    host.respond("share", () => ({ ok: true, content: { url: "https://mock/s/ses_1" } }));
    const shareLink = createShareLink({
      writeClipboard: () => {
        return Promise.reject(new Error("denied"));
      },
      schedule: () => {
        return undefined;
      },
    });
    await shareLink(store, makeEntry("ses_1", "doc"));
    expect(store.getSnapshot().copiedId).toBeNull();
  });
});

describe("delete + the todo-12 QA failure path", () => {
  it("delete of the selected session clears selection optimistically, keeps it on success", async () => {
    const { store, host } = makeStore({ selectedId: "ses_1", filter: "" });
    host.pushSessionList([makeEntry("ses_1", "doomed"), makeEntry("ses_2", "survivor")]);
    host.respond("deleteSession", () => ({ ok: true, content: null }));
    await store.deleteSession("ses_1");
    expect(store.getSnapshot().sessions.map((s) => { return s.id; })).toEqual(["ses_2"]);
    expect(store.getSnapshot().selectedId).toBeNull();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("QA failure: host answers error -> list restored AND selection rolled back, banner set", async () => {
    const { store, host, persistence } = makeStore({ selectedId: "ses_1", filter: "" });
    host.pushSessionList([makeEntry("ses_1", "protected"), makeEntry("ses_2", "other")]);
    const savedBefore = persistence.saved.length;
    host.respond("deleteSession", () => ({
      ok: false,
      error: "SessionOperationError: session delete failed: boom (HTTP 500)",
    }));
    await expect(store.deleteSession("ses_1")).rejects.toThrow();
    // list rollback
    expect(store.getSnapshot().sessions.map((s) => { return s.id; })).toEqual(["ses_1", "ses_2"]);
    // selection rollback (the QA assertion)
    expect(store.getSnapshot().selectedId).toBe("ses_1");
    expect(store.activeSession.current()).toBe("ses_1");
    expect(persistence.last().selectedId).toBe("ses_1");
    expect(persistence.saved.length).toBeGreaterThan(savedBefore);
    // error banner
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().errorMessage).toContain("HTTP 500");
    // banner clears back to ready
    store.clearError();
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().errorMessage).toBeNull();
  });

  it("delete of a NON-selected session never touches the selection", async () => {
    const { store, host } = makeStore({ selectedId: "ses_1", filter: "" });
    host.pushSessionList([makeEntry("ses_1", "keep"), makeEntry("ses_2", "drop")]);
    host.respond("deleteSession", () => ({
      ok: false,
      error: "SessionOperationError: session delete failed: boom (HTTP 500)",
    }));
    await expect(store.deleteSession("ses_2")).rejects.toThrow();
    expect(store.getSnapshot().selectedId).toBe("ses_1");
    expect(store.getSnapshot().sessions.map((s) => { return s.id; })).toEqual(["ses_1", "ses_2"]);
  });
});

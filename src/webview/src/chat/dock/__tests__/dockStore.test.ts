// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (todo contents, file paths mirrored from the mock server), not display copy.
/**
 * Dock webview store suite (plan todo 18, node env, DOM-free):
 * - both full-feed paths converge: host `todos.sync`/`diffs.sync` pushes and
 *   forwarded `todo.updated`/`session.diff` SSE payloads replace the
 *   per-session list (isolated per session);
 * - capability degradation: unsupported latches fire their notice EXACTLY
 *   once per episode (the one `capability.hidden` toast), and a later full
 *   payload clears the latch and re-arms the notice (server upgraded after
 *   reconnect restores the panel);
 * - collapse persistence: merge-writes under `sessionDock` never clobber
 *   sibling keys, round-trip across store instances, foreign shapes ignored.
 */
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../events.js";
import {
  DIFFS_SYNC_EVENT_TYPE,
  SESSION_DIFF_EVENT_TYPE,
  TODO_UPDATED_EVENT_TYPE,
  TODOS_SYNC_EVENT_TYPE,
  type DockDiffFileVM,
  type DockNotice,
  type DockTodoVM,
} from "../dockTypes.js";
import {
  diffsForSession,
  DOCK_STATE_KEY,
  DockStateStore,
  DockStore,
  todosForSession,
} from "../dockStore.js";
import type { WebviewStateLike } from "../../draftStore.js";

function todo(id: string, content: string, status = "pending"): DockTodoVM {
  return { id, content, status, priority: "high" };
}

function diff(file: string, additions = 1, deletions = 1): DockDiffFileVM {
  return { file, additions, deletions };
}

function sync(type: string, payload: unknown): ChatEvent {
  return { type, payload };
}

function fakeWebviewState(initial?: unknown): WebviewStateLike & { readonly current: () => unknown } {
  let state = initial;
  return {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    current: () => state,
  };
}

describe("DockStore event intake", () => {
  it("pins the event literals the host mirrors", () => {
    expect(TODOS_SYNC_EVENT_TYPE).toBe("todos.sync");
    expect(DIFFS_SYNC_EVENT_TYPE).toBe("diffs.sync");
    expect(TODO_UPDATED_EVENT_TYPE).toBe("todo.updated");
    expect(SESSION_DIFF_EVENT_TYPE).toBe("session.diff");
  });

  it("applies todos.sync per session, replacing and isolating", () => {
    const store = new DockStore();
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_a", todos: [todo("t1", "alpha")] }));
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_b", todos: [todo("t2", "beta"), todo("t3", "gamma")] }));
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_a", todos: [todo("t4", "alpha2")] }));

    expect(todosForSession(store.getState(), "ses_a")).toEqual([todo("t4", "alpha2")]);
    expect(todosForSession(store.getState(), "ses_b")).toEqual([todo("t2", "beta"), todo("t3", "gamma")]);
    expect(todosForSession(store.getState(), "ses_c")).toEqual([]);
    expect(todosForSession(store.getState(), undefined)).toEqual([]);
  });

  it("merges forwarded todo.updated payloads as replacements", () => {
    const store = new DockStore();
    store.applyEvent(sync(TODO_UPDATED_EVENT_TYPE, { sessionID: "ses_1", todos: [todo("t1", "one"), todo("t2", "two", "in_progress")] }));
    expect(todosForSession(store.getState(), "ses_1")).toEqual([
      todo("t1", "one"),
      todo("t2", "two", "in_progress"),
    ]);
    store.applyEvent(sync(TODO_UPDATED_EVENT_TYPE, { sessionID: "ses_1", todos: [todo("t3", "three")] }));
    expect(todosForSession(store.getState(), "ses_1")).toEqual([todo("t3", "three")]);
  });

  it("applies diffs.sync and forwarded session.diff payloads per session", () => {
    const store = new DockStore();
    store.applyEvent(sync(DIFFS_SYNC_EVENT_TYPE, { sessionId: "ses_1", diffs: [diff("a.ts", 3, 2)] }));
    store.applyEvent(sync(SESSION_DIFF_EVENT_TYPE, { sessionID: "ses_2", diff: [diff("b.ts")] }));

    expect(diffsForSession(store.getState(), "ses_1")).toEqual([diff("a.ts", 3, 2)]);
    expect(diffsForSession(store.getState(), "ses_2")).toEqual([diff("b.ts")]);

    store.applyEvent(sync(SESSION_DIFF_EVENT_TYPE, { sessionID: "ses_1", diff: [diff("c.ts", 5, 0)] }));
    expect(diffsForSession(store.getState(), "ses_1")).toEqual([diff("c.ts", 5, 0)]);
  });

  it("ignores malformed payloads entirely (previous snapshot stays)", () => {
    const store = new DockStore();
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_1", todos: [todo("t1", "one")] }));
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_1", todos: [{ noId: true }] }));
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, "garbage"));
    store.applyEvent(sync(DIFFS_SYNC_EVENT_TYPE, { sessionId: "ses_1", diffs: "garbage" }));

    expect(todosForSession(store.getState(), "ses_1")).toEqual([todo("t1", "one")]);
    expect(diffsForSession(store.getState(), "ses_1")).toEqual([]);
  });

  it("latches todos-unsupported once per episode and fires ONE notice; a full payload revives and re-arms", () => {
    const notices: DockNotice[] = [];
    const store = new DockStore({ onNotice: (notice) => notices.push(notice) });

    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_1", unsupported: true }));
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { unsupported: true }));
    expect(store.getState().todosUnsupported).toBe(true);
    expect(notices).toEqual([{ kind: "todos-unsupported" }]);

    // Server upgraded after reconnect: a concrete list revives the surface…
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { sessionId: "ses_1", todos: [todo("t1", "one")] }));
    expect(store.getState().todosUnsupported).toBe(false);

    // …and a later regression notifies again (a NEW episode).
    store.applyEvent(sync(TODOS_SYNC_EVENT_TYPE, { unsupported: true }));
    expect(notices).toEqual([{ kind: "todos-unsupported" }, { kind: "todos-unsupported" }]);
    expect(store.getState().todosUnsupported).toBe(true);
  });

  it("latches diffs-unsupported independently of todos state", () => {
    const notices: DockNotice[] = [];
    const store = new DockStore({ onNotice: (notice) => notices.push(notice) });

    store.applyEvent(sync(DIFFS_SYNC_EVENT_TYPE, { unsupported: true }));
    store.applyEvent(sync(DIFFS_SYNC_EVENT_TYPE, { sessionId: "ses_1", unsupported: true }));

    expect(store.getState().diffsUnsupported).toBe(true);
    expect(store.getState().todosUnsupported).toBe(false);
    expect(notices).toEqual([{ kind: "diffs-unsupported" }]);

    store.applyEvent(sync(SESSION_DIFF_EVENT_TYPE, { sessionID: "ses_1", diff: [diff("a.ts")] }));
    expect(store.getState().diffsUnsupported).toBe(false);
    expect(diffsForSession(store.getState(), "ses_1")).toEqual([diff("a.ts")]);
  });

  it("never touches unrelated event families", () => {
    const store = new DockStore();
    store.applyEvent(sync("messages.sync", { kind: "full", sessionId: "ses_1", messages: [] }));
    store.applyEvent(sync("permission.asked", {}));
    expect(store.getState().todosBySession).toEqual({});
    expect(store.getState().diffsBySession).toEqual({});
  });
});

describe("DockStateStore collapse persistence", () => {
  it("defaults to open and round-trips a closed preference into a fresh instance", () => {
    const state = fakeWebviewState();
    const first = new DockStateStore(state);
    expect(first.readOpen()).toBe(true);

    first.writeOpen(false);
    const persisted = state.current();
    expect(persisted).toEqual({ [DOCK_STATE_KEY]: { open: false } });

    const second = new DockStateStore(state);
    expect(second.readOpen()).toBe(false);
  });

  it("merge-writes under sessionDock, never clobbering sibling keys", () => {
    const state = fakeWebviewState({ composerDrafts: { ses_1: "draft text" }, selectedId: "ses_9" });
    const store = new DockStateStore(state);
    store.writeOpen(false);

    expect(state.current()).toEqual({
      composerDrafts: { ses_1: "draft text" },
      selectedId: "ses_9",
      [DOCK_STATE_KEY]: { open: false },
    });
  });

  it("ignores a foreign stored shape and repairs it on next write", () => {
    const state = fakeWebviewState({ [DOCK_STATE_KEY]: "nope" });
    const store = new DockStateStore(state);
    expect(store.readOpen()).toBe(true);

    store.writeOpen(false);
    expect(state.current()).toEqual({ [DOCK_STATE_KEY]: { open: false } });
  });

  it("writeOpen with the current value is a no-op", () => {
    const state = fakeWebviewState();
    const store = new DockStateStore(state);
    store.writeOpen(true);
    expect(state.current()).toBeUndefined();
  });
});

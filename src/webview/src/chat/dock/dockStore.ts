/**
 * Todos + session diffs dock store (plan todo 18, webview side). Pure,
 * DOM-free, `useSyncExternalStore`-compatible — the same posture as todo-16's
 * PendingRequestsStore.
 *
 * STATE: per-session keyed lists (events for other sessions are recorded,
 * never rendered — the panel selects the ACTIVE session's slice, mirroring
 * todo-16's cards-for-session selector). Two full-replacement feeds per
 * domain converge here: the host's poll-sync push (`todos.sync`/`diffs.sync`)
 * and the forwarded SSE payloads (`todo.updated`/`session.diff`, which carry
 * the same full lists verbatim per the SDK event types).
 *
 * CAPABILITY DEGRADATION (todo-18 binding, QA failure scenario): a
 * `todos.sync {unsupported:true}` latch hides the whole dock; a
 * `diffs.sync {unsupported:true}` latch hides only the diffs panel. Each
 * latch fires its {@link DockNotice} EXACTLY ONCE per episode (the one
 * `capability.hidden` toast) and a later full payload clears the latch and
 * re-arms the notice, so a server upgrade after reconnect restores the
 * panel without a stale hidden state.
 *
 * COLLAPSE PERSISTENCE: {@link DockStateStore} rides the existing
 * getWebviewState seam under ONE namespaced key ({@link DOCK_STATE_KEY}) and
 * every write MERGES into the existing top-level state — the todo-14
 * drafts/todo-12 selection keys are never clobbered (same pattern as
 * ../draftStore.ts).
 */

import { isRecord } from "../../../../shared/protocol.js";
import { getWebviewState } from "../../../lib/messenger.js";
import type { WebviewStateLike } from "../draftStore.js";
import type { ChatEvent } from "../events.js";
import {
  DIFFS_SYNC_EVENT_TYPE,
  parseDiffsSyncPayload,
  parseSessionDiffPayload,
  parseTodosSyncPayload,
  parseTodoUpdatedPayload,
  SESSION_DIFF_EVENT_TYPE,
  TODO_UPDATED_EVENT_TYPE,
  TODOS_SYNC_EVENT_TYPE,
  type DockDiffFileVM,
  type DockNotice,
  type DockTodoVM,
} from "./dockTypes.js";

export type { DockNotice } from "./dockTypes.js";

export interface DockState {
  readonly todosBySession: Readonly<Record<string, readonly DockTodoVM[]>>;
  readonly diffsBySession: Readonly<Record<string, readonly DockDiffFileVM[]>>;
  readonly todosUnsupported: boolean;
  readonly diffsUnsupported: boolean;
}

export type DockListener = { (): void };

export interface DockStoreOptions {
  /** Fired once per unsupported episode (maps onto the single toast). */
  onNotice?(notice: DockNotice): void;
}

export class DockStore {
  private state: DockState = {
    todosBySession: {},
    diffsBySession: {},
    todosUnsupported: false,
    diffsUnsupported: false,
  };
  private readonly listeners = new Set<DockListener>();
  private todosNoticeSent = false;
  private diffsNoticeSent = false;

  constructor(private readonly options: DockStoreOptions = {}) {}

  readonly subscribe = (listener: DockListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): DockState => {
    return this.state;
  };

  private emit(next: DockState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** One forwarded chat event; unknown families are other todos' domains. */
  applyEvent(event: ChatEvent): void {
    switch (event.type) {
      case TODOS_SYNC_EVENT_TYPE: {
        const payload = parseTodosSyncPayload(event.payload);
        if (payload === undefined) return;
        if ("unsupported" in payload) {
          this.markTodosUnsupported();
          return;
        }
        this.setTodos(payload.sessionId, payload.todos);
        return;
      }
      case TODO_UPDATED_EVENT_TYPE: {
        const payload = parseTodoUpdatedPayload(event.payload);
        if (payload === undefined) return;
        this.setTodos(payload.sessionID, payload.todos);
        return;
      }
      case DIFFS_SYNC_EVENT_TYPE: {
        const payload = parseDiffsSyncPayload(event.payload);
        if (payload === undefined) return;
        if ("unsupported" in payload) {
          this.markDiffsUnsupported();
          return;
        }
        this.setDiffs(payload.sessionId, payload.diffs);
        return;
      }
      case SESSION_DIFF_EVENT_TYPE: {
        const payload = parseSessionDiffPayload(event.payload);
        if (payload === undefined) return;
        this.setDiffs(payload.sessionID, payload.diffs);
        return;
      }
      default:
        return;
    }
  }

  private setTodos(sessionId: string, todos: readonly DockTodoVM[]): void {
    // A concrete payload revives the surface (server upgraded after reconnect).
    this.emit({
      ...this.state,
      todosUnsupported: false,
      todosBySession: { ...this.state.todosBySession, [sessionId]: todos },
    });
    this.todosNoticeSent = false;
  }

  private setDiffs(sessionId: string, diffs: readonly DockDiffFileVM[]): void {
    this.emit({
      ...this.state,
      diffsUnsupported: false,
      diffsBySession: { ...this.state.diffsBySession, [sessionId]: diffs },
    });
    this.diffsNoticeSent = false;
  }

  private markTodosUnsupported(): void {
    if (!this.state.todosUnsupported) this.emit({ ...this.state, todosUnsupported: true });
    this.notifyOnce("todos");
  }

  private markDiffsUnsupported(): void {
    if (!this.state.diffsUnsupported) this.emit({ ...this.state, diffsUnsupported: true });
    this.notifyOnce("diffs");
  }

  private notifyOnce(domain: "todos" | "diffs"): void {
    if (domain === "todos") {
      if (this.todosNoticeSent || this.options.onNotice === undefined) return;
      this.todosNoticeSent = true;
      this.options.onNotice({ kind: "todos-unsupported" });
      return;
    }
    if (this.diffsNoticeSent || this.options.onNotice === undefined) return;
    this.diffsNoticeSent = true;
    this.options.onNotice({ kind: "diffs-unsupported" });
  }
}

// ---------------------------------------------------------------------------
// Selectors (pure; the panel renders the active session's slice).

export function todosForSession(state: DockState, sessionId: string | undefined): readonly DockTodoVM[] {
  if (sessionId === undefined) return [];
  return state.todosBySession[sessionId] ?? [];
}

export function diffsForSession(state: DockState, sessionId: string | undefined): readonly DockDiffFileVM[] {
  if (sessionId === undefined) return [];
  return state.diffsBySession[sessionId] ?? [];
}

// ---------------------------------------------------------------------------
// Collapse persistence (todo-14 merge pattern: one namespaced key, always
// merged into the existing top-level state — never a wholesale replace).

/** Top-level webview-state key holding `{open: boolean}`. */
export const DOCK_STATE_KEY = "sessionDock";

export class DockStateStore {
  private open = true;
  private hydrated = false;

  constructor(private readonly state: WebviewStateLike) {}

  /** Current collapsed preference (default open). Hydrates on first call. */
  readOpen(): boolean {
    this.hydrate();
    return this.open;
  }

  writeOpen(open: boolean): void {
    this.hydrate();
    if (this.open === open) return;
    this.open = open;
    this.persistNow();
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const value = this.state.getState();
    if (!isRecord(value)) return;
    const stored = value[DOCK_STATE_KEY];
    if (!isRecord(stored) || typeof stored.open !== "boolean") return;
    this.open = stored.open;
  }

  private persistNow(): void {
    const value = this.state.getState();
    const base = isRecord(value) ? value : {};
    this.state.setState({ ...base, [DOCK_STATE_KEY]: { open: this.open } });
  }
}

/** Production value: vscode webview state behind the shared api handle. */
export function createWebviewDockStateStore(): DockStateStore {
  return new DockStateStore(getWebviewState());
}

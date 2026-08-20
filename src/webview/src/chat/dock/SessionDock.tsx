/**
 * SessionDock (plan todo 18, EXPORTED mount contract for the chat slot).
 *
 * allow: SIZE_OK — the mount contract docblock must quote the whole prop
 * surface the integration wave consumes, and the file owns exactly the three
 * panel primitives that contract composes (TodosPanel/DiffsPanel/DiffFileRow);
 * extracting the two 12-line SVG icons into their own module would trade a
 * marginal line count for a helper-for-one-off split (todo-16's
 * ChatCardsDock.tsx keeps the same primitives-plus-contract shape).
 *
 * The right-side collapsible panel the integration wave composes beside the
 * chat content (T11's single <section data-oc-slot="chat">; this component
 * never edits those files — it mounts the same way T13's MessageList, T14's
 * Composer and T16's ChatCardsDock do, as an exported composition target):
 *
 *   <SessionDock
 *     store={dockStore}                                   // optional; binds lazily
 *     todosEnabled={init.capabilities.todo}               // todo-7 capability bit
 *     onNotice={() => pushToast("info", t("capability.hidden"))}
 *   />
 *
 * Every prop is optional: un-propped, the dock binds its own stores and the
 * todo-3 webview messenger lazily (never at module scope), so SSR and node
 * tests need no VSCode API. Event intake consumes the EXPORTED todo-13 seam
 * (`ChatEventSource` from ../events) — `todo.updated`/`session.diff`/
 * `*.sync` payloads are deliberately ignored by the message router
 * ("unknown event families are other todos' domains"), so no router edits
 * are needed.
 *
 * Behavior: rows from the per-session store slice of the ACTIVE session;
 * todo rows show status dots + content; diff rows show +adds/−dels and route
 * clicks to the `openDiff`/`openFile` wire requests (T13's chatContext
 * carries the same defaults; this dock keeps its own DockActions seam so the
 * mount contract stays self-contained). The whole dock hides when
 * `todosEnabled` is false or the todos unsupported latch fired; the diffs
 * section alone hides on its own latch. Each latch survives as exactly one
 * capability notice per episode (mapping to ONE `capability.hidden` toast).
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { getWebviewMessenger } from "../../../lib/messenger.js";
import { getActiveSession, subscribeActiveSession } from "../activeSession.js";
import { createMessengerEventSource, type ChatEventSource } from "../events.js";
import {
  createWebviewDockStateStore,
  diffsForSession,
  DockStateStore,
  DockStore,
  todosForSession,
  type DockNotice,
} from "./dockStore.js";
import { todoDone, todoDotClass, type DockDiffFileVM, type DockTodoVM } from "./dockTypes.js";

export interface DockActions {
  openDiff(input: { readonly sessionId: string; readonly messageID?: string }): void;
  openFile(path: string): void;
}

/** Provider fallback only; the real defaults resolve lazily at click time. */
const defaultActions: DockActions = {
  openDiff: ({ sessionId, messageID }) => {
    void getWebviewMessenger().request(
      "openDiff",
      messageID === undefined ? { sessionId } : { sessionId, messageID },
    );
  },
  openFile: (path) => {
    void getWebviewMessenger().request("openFile", { path });
  },
};

export interface SessionDockProps {
  readonly store?: DockStore;
  readonly stateStore?: DockStateStore;
  readonly source?: ChatEventSource;
  readonly actions?: DockActions;
  /** Todo-7 `hasTodo` bit (init.capabilities.todo); hides the dock when false. */
  readonly todosEnabled?: boolean;
  onNotice?(notice: DockNotice): void;
}

function ChevronIcon(props: { readonly open: boolean }): ReactNode {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={props.open ? "rotate-90 transition-transform" : "transition-transform"}
    >
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 2h5l3 3v9H4V2zm5 0v3h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TodosPanel(props: { readonly todos: readonly DockTodoVM[] }): ReactNode {
  const { t } = useStrings();
  if (props.todos.length === 0) {
    return <p className="px-2 py-1.5 text-xs text-muted-fg">{t("dock.todos.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-1">
      {props.todos.map((todo) => (
        <li key={todo.id} className="flex items-start gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${todoDotClass(todo.status)}`}
          />
          <span className={todoDone(todo.status) ? "text-muted-fg line-through" : undefined}>
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DiffsPanel(props: {
  readonly diffs: readonly DockDiffFileVM[];
  readonly sessionId: string | undefined;
  readonly actions: DockActions;
}): ReactNode {
  const { t } = useStrings();
  if (props.diffs.length === 0) {
    return <p className="px-2 py-1.5 text-xs text-muted-fg">{t("dock.diffs.empty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-1">
      {props.diffs.map((diff) => (
        <DiffFileRow
          key={diff.file}
          diff={diff}
          sessionId={props.sessionId}
          actions={props.actions}
          openDiffLabel={t("dock.diffs.openDiff")}
          openFileLabel={t("dock.diffs.openFile")}
        />
      ))}
    </ul>
  );
}

/**
 * Hook-free file-change row: labels are resolved by the hook-driven parent.
 * Exported as the direct-invocation click-walk target (todo-16
 * PermissionReplyButtons test pattern).
 */
export function DiffFileRow(props: {
  readonly diff: DockDiffFileVM;
  readonly sessionId: string | undefined;
  readonly actions: DockActions;
  readonly openDiffLabel: string;
  readonly openFileLabel: string;
}): ReactNode {
  const { diff } = props;
  return (
    <li className="flex items-center gap-1 text-xs">
      <button
        type="button"
        data-diff-file={diff.file}
        title={diff.file}
        aria-label={props.openDiffLabel}
        disabled={props.sessionId === undefined}
        className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-start hover:bg-hover-bg disabled:opacity-50"
        onClick={() => {
          if (props.sessionId === undefined) return;
          props.actions.openDiff({ sessionId: props.sessionId });
        }}
      >
        {diff.file}
      </button>
      <span className="shrink-0 text-ok">+{diff.additions}</span>
      <span className="shrink-0 text-err">−{diff.deletions}</span>
      <button
        type="button"
        data-open-file={diff.file}
        title={diff.file}
        aria-label={props.openFileLabel}
        className="shrink-0 rounded p-0.5 text-muted-fg hover:bg-hover-bg hover:text-fg"
        onClick={() => props.actions.openFile(diff.file)}
      >
        <FileIcon />
      </button>
    </li>
  );
}

export function SessionDock(props: SessionDockProps): ReactNode {
  const { t } = useStrings();
  const noticeRef = useRef<SessionDockProps["onNotice"]>(undefined);
  useEffect(() => {
    noticeRef.current = props.onNotice;
  }, [props.onNotice]);
  const store = useMemo(
    () =>
      props.store ??
      new DockStore({
        onNotice: (notice) => {
          noticeRef.current?.(notice);
        },
      }),
    [props.store],
  );
  const stateStore = useMemo(() => {
    return props.stateStore ?? createWebviewDockStateStore();
  }, [props.stateStore]);
  const actions = props.actions ?? defaultActions;

  useEffect(() => {
    const source = props.source ?? createMessengerEventSource(getWebviewMessenger());
    return source.subscribeEvent((event) => {
      store.applyEvent(event);
    });
  }, [props.source, store]);

  // getServerSnapshot mirrors the client read so SSR renders never diverge.
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const activeSession = useSyncExternalStore(
    subscribeActiveSession,
    getActiveSession,
    getActiveSession,
  );
  const [open, setOpen] = useState(() => {
    return stateStore.readOpen();
  });

  if (props.todosEnabled === false || state.todosUnsupported) return null;

  const toggle = (): void => {
    setOpen((current) => {
      const next = !current;
      stateStore.writeOpen(next);
      return next;
    });
  };
  const todos = todosForSession(state, activeSession);
  const diffs = diffsForSession(state, activeSession);

  return (
    <section
      data-oc-dock="session"
      className="flex w-60 shrink-0 flex-col border-s border-border bg-panel-bg text-fg"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs text-muted-fg hover:bg-hover-bg"
        onClick={toggle}
      >
        <ChevronIcon open={open} />
        <span className="truncate">{t("dock.todos.title")}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{t("dock.diffs.title")}</span>
      </button>
      {open ? (
        <div className="flex-1 overflow-y-auto">
          <h3 className="px-2 pb-0.5 pt-2 text-[0.8em] font-semibold uppercase tracking-wide text-muted-fg">
            {t("dock.todos.title")}
          </h3>
          <TodosPanel todos={todos} />
          {state.diffsUnsupported ? null : (
            <>
              <h3 className="px-2 pb-0.5 pt-2 text-[0.8em] font-semibold uppercase tracking-wide text-muted-fg">
                {t("dock.diffs.title")}
              </h3>
              <DiffsPanel diffs={diffs} sessionId={activeSession} actions={actions} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

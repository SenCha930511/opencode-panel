/**
 * Inline todo strip (companion to {@link SessionDock}): the ACTIVE session's
 * todo list pinned directly above the composer so an in-flight plan is
 * visible without opening the dock. Shares ONE DockStore with the dock (the
 * chat slot wires both), so rows update off the same event stream the dock
 * consumes — no second subscription, no drift. Terminal statuses strike
 * through; the row hides entirely when the session carries no todos or the
 * server lacks the todos route (the unsupported latch).
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { useActiveSession } from "../activeSession.js";
import { todosForSession, type DockStore } from "./dockStore.js";
import { todoDone, type DockTodoVM } from "./dockTypes.js";

function StatusGlyph(props: { readonly status: string }): ReactNode {
  switch (props.status) {
    case "completed":
      return <span aria-hidden="true" className="shrink-0 text-ok">✓</span>;
    case "cancelled":
      return <span aria-hidden="true" className="shrink-0 text-err">✗</span>;
    case "in_progress":
      return <span aria-hidden="true" className="shrink-0 text-accent">▶</span>;
    default:
      return <span aria-hidden="true" className="shrink-0 text-muted-fg/60">○</span>;
  }
}

export function TodoRows(props: { readonly todos: readonly DockTodoVM[] }): ReactNode {
  return (
    <ul className="max-h-28 overflow-y-auto px-2.5 pb-1.5">
      {props.todos.map((todo) => (
        <li key={todo.id} className="flex items-start gap-1.5 py-0.5 text-[11px] leading-4">
          <StatusGlyph status={todo.status} />
          <span
            className={`min-w-0 flex-1 ${
              todoDone(todo.status) ? "text-muted-fg/60 line-through" : "text-fg/85"
            }`}
          >
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TodoPinnedList(props: { readonly store: DockStore }): ReactNode {
  const { t } = useStrings();
  const state = useSyncExternalStore(props.store.subscribe, props.store.getState, props.store.getState);
  const activeSession = useActiveSession();
  if (state.todosUnsupported) return null;
  const todos = todosForSession(state, activeSession);
  if (todos.length === 0) return null;
  const completed = todos.filter((todo) => todoDone(todo.status)).length;
  return (
    <section
      data-oc-todo-pinned
      aria-label={t("dock.todos.title")}
      className="shrink-0 border-t border-card-border/50 bg-card-bg/25"
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">
        <span>{t("dock.todos.title")}</span>
        <span className="text-muted-fg/50 normal-case tracking-normal">
          {completed}/{todos.length}
        </span>
      </div>
      <TodoRows todos={todos} />
    </section>
  );
}

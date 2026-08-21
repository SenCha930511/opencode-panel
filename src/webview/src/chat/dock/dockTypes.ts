/**
 * Todos + session diffs dock (plan todo 18, webview side): wire literals,
 * view models and boundary parsers for the host's `todos.sync`/`diffs.sync`
 * pushes plus the forwarded `todo.updated`/`session.diff` SSE events.
 *
 * WIRE CONTRACT (mirrored in src/host/handlers/dock.ts — pinned by tests on
 * both sides; the webview tree is never imported into the host bundle):
 * - `todos.sync`  — `{sessionId, todos}` full replacement, boundary-parsed
 *   here; `{unsupported: true}` (+ optional sessionId) hides the whole dock
 *   and fires ONE capability notice per episode (see ./dockStore.ts).
 * - `diffs.sync`  — same shape, scoped to the diffs panel only.
 * - `todo.updated` (forwarded, SDK EventTodoUpdated): `{sessionID, todos}` —
 *   carries the full list verbatim; merged as a replacement.
 * - `session.diff` (forwarded, SDK EventSessionDiff): `{sessionID, diff}` —
 *   same full-payload merge.
 * A malformed payload is dropped entirely (the previous snapshot stays — a
 * drifted schema must not blank the panel mid-session).
 */

export const TODOS_SYNC_EVENT_TYPE = "todos.sync";
export const DIFFS_SYNC_EVENT_TYPE = "diffs.sync";
export const TODO_UPDATED_EVENT_TYPE = "todo.updated";
export const SESSION_DIFF_EVENT_TYPE = "session.diff";

/** One todo row the panel renders. */
export interface DockTodoVM {
  readonly id: string;
  readonly content: string;
  readonly status: string;
  readonly priority: string;
}

/** One changed-file row the panel renders (counters + path only). */
export interface DockDiffFileVM {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
}

export type TodosSyncPayload =
  | { readonly sessionId: string; readonly todos: readonly DockTodoVM[] }
  | { readonly sessionId?: string | undefined; readonly unsupported: true };

export type DiffsSyncPayload =
  | { readonly sessionId: string; readonly diffs: readonly DockDiffFileVM[] }
  | { readonly sessionId?: string | undefined; readonly unsupported: true };

/** One-shot capability surface notice (the dock maps it onto ONE toast). */
export type DockNotice =
  | { readonly kind: "todos-unsupported" }
  | { readonly kind: "diffs-unsupported" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTodoVM(item: unknown): DockTodoVM | undefined {
  if (!isRecord(item)) return undefined;
  if (typeof item.id !== "string" || typeof item.content !== "string") return undefined;
  return {
    id: item.id,
    content: item.content,
    status: typeof item.status === "string" ? item.status : "",
    priority: typeof item.priority === "string" ? item.priority : "",
  };
}

function toDiffFileVM(item: unknown): DockDiffFileVM | undefined {
  if (!isRecord(item)) return undefined;
  if (typeof item.file !== "string") return undefined;
  if (typeof item.additions !== "number" || typeof item.deletions !== "number") return undefined;
  return { file: item.file, additions: item.additions, deletions: item.deletions };
}

function parseList<T>(items: unknown, each: (item: unknown) => T | undefined): readonly T[] | undefined {
  if (!Array.isArray(items)) return undefined;
  const parsed: T[] = [];
  for (const item of items) {
    const vm = each(item);
    // A drifted row drops alone, never its valid neighbors (host parity).
    if (vm !== undefined) parsed.push(vm);
  }
  // …but a non-empty list where EVERY row drifted is a broken payload, and
  // the previous snapshot outranks silence (existing store contract).
  if (items.length > 0 && parsed.length === 0) return undefined;
  return parsed;
}

/** Boundary parse of the host `todos.sync` push; undefined on drift. */
export function parseTodosSyncPayload(value: unknown): TodosSyncPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (value.unsupported === true) {
    const sessionId = typeof value.sessionId === "string" ? value.sessionId : undefined;
    return { ...(sessionId === undefined ? {} : { sessionId }), unsupported: true };
  }
  if (typeof value.sessionId !== "string") return undefined;
  const todos = parseList(value.todos, toTodoVM);
  if (todos === undefined) return undefined;
  return { sessionId: value.sessionId, todos };
}

/** Boundary parse of the host `diffs.sync` push; undefined on drift. */
export function parseDiffsSyncPayload(value: unknown): DiffsSyncPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (value.unsupported === true) {
    const sessionId = typeof value.sessionId === "string" ? value.sessionId : undefined;
    return { ...(sessionId === undefined ? {} : { sessionId }), unsupported: true };
  }
  if (typeof value.sessionId !== "string") return undefined;
  const diffs = parseList(value.diffs, toDiffFileVM);
  if (diffs === undefined) return undefined;
  return { sessionId: value.sessionId, diffs };
}

/** Boundary parse of a forwarded `todo.updated` SSE payload. */
export function parseTodoUpdatedPayload(
  value: unknown,
): { readonly sessionID: string; readonly todos: readonly DockTodoVM[] } | undefined {
  if (!isRecord(value) || typeof value.sessionID !== "string") return undefined;
  const todos = parseList(value.todos, toTodoVM);
  if (todos === undefined) return undefined;
  return { sessionID: value.sessionID, todos };
}

/** Boundary parse of a forwarded `session.diff` SSE payload. */
export function parseSessionDiffPayload(
  value: unknown,
): { readonly sessionID: string; readonly diffs: readonly DockDiffFileVM[] } | undefined {
  if (!isRecord(value) || typeof value.sessionID !== "string") return undefined;
  const diffs = parseList(value.diff, toDiffFileVM);
  if (diffs === undefined) return undefined;
  // The SSE payload field is `diff`; the VM mirrors it to the panel noun.
  return { sessionID: value.sessionID, diffs };
}

// ---------------------------------------------------------------------------
// Presentation logic (pure; SSR tests pin these mappings).

const DONE_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

/** Muted+struck content for terminal todo statuses; DATA-driven otherwise. */
export function todoDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}

/** Status dot color class; unknown statuses fall back to the neutral dot. */
export function todoDotClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-ok";
    case "in_progress":
      return "bg-info";
    default:
      return "bg-off";
  }
}

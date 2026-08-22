/**
 * Todos + session diffs dock (plan todo 18, host side): the todos/diffs sync
 * controller, the diff-route fetchers, and the `openDiff` / `openFile` wire
 * handlers — all vscode-free (the vscode-backed surface factories live in
 * ../vscode-adapter.ts; this module carries only pure seams).
 *
 * allow: SIZE_OK — the todo-18 binding fixes ONE host module whose wire
 * contract header the webview mirror (chat/dock/dockTypes.ts) quotes
 * verbatim, and the domain (parsers, fetchers, DockSync, diff documents,
 * renderer, opener, service, registry) is one indivisible ownership unit per
 * the plan; the contract must sit beside every literal it governs (same
 * sanction as todo-9's eventBridge.ts / todo-8's serverManager.ts).
 *
 * WIRE CONTRACT (webview consumes; ForwardedEvent over ToWebview `event`,
 * same carrier precedent as todo-12 `sessions.list` / todo-13 `messages.sync`):
 * - {@link TODOS_SYNC_EVENT_TYPE} = "todos.sync", payload {@link TodosSyncPayload}:
 *   - `{ sessionId, todos }` — the session's full todo list, boundary-parsed.
 *   - `{ unsupported: true }` (+ `sessionId` when known) — the todo route is
 *     absent / unprobeable (todo-7 `hasTodo=false` or a 404 route-absent
 *     answer). Posted EXACTLY ONCE per connection epoch; the webview hides
 *     the whole dock and shows ONE `capability.hidden` toast (QA failure
 *     scenario: old-server 404). While latched, BOTH syncs stay silent —
 *     "dock surfaces nothing" per the binding.
 * - {@link DIFFS_SYNC_EVENT_TYPE} = "diffs.sync", payload {@link DiffsSyncPayload}:
 *   - `{ sessionId, diffs }` — the session's full changed-file list
 *     (`{file, before, after, additions, deletions}` per file).
 *   - `{ unsupported: true }` — same one-shot semantics, scoped to the diffs
 *     panel only (the todos panel keeps rendering when only the diff route
 *     is absent).
 *
 * SYNC TRIGGERS (todo-9 bridge seams):
 * - `invalidate` — the todo-9 {@link InvalidateSink} shape; registered into
 *   todo-12's InvalidationHub (`hub.add`, the documented multiplicity
 *   point). `todos` kind (from `todo.updated`) refetches todos; `sessions`
 *   kind (which covers `session.diff` — the bridge maps every `session.*`
 *   event there) refetches diffs, debounced 250ms by the bridge.
 * - `setActiveSession(sessionId)` — the todo-12 selection contract mirrored
 *   from todo-13's MessageSync; records the id and refetches both domains.
 *   Until T12's selection signal reaches the host, the LAST sessionId seen
 *   on any invalidation is remembered as the active fallback (same as
 *   MessageSync).
 * - DOCUMENTED GAP: `file.edited` carries only `{file}` (no session id) and
 *   maps to NO SyncKind, so it cannot reach the hub. Its user-visible effect
 *   is always paired with a `session.diff` broadcast, which DOES trigger the
 *   diffs refetch (plus the webview merges `session.diff` payloads directly).
 *
 * DIFF-ROUTE GUARD: todo-7's Capabilities carry no `hasDiff` bit, so route
 * presence is probed here the same way the detector does — `GET /doc` via
 * {@link probeDoc} on the connection's auth-injecting probeFetch, matched
 * against `/session/{id}/diff` (cached per baseUrl, cleared by {@link
 * DockSync.reset} on every managed|attached transition, mirroring the
 * capability-info resync-equivalent subscription). When the spec cannot be
 * obtained (fallback probe mode) the route is assumed present and the fetch
 * itself decides: a 404 whose body marks the route ABSENT (mock phrasing
 * "route not found" / "not available on this server", matching docProbe's
 * body-decides semantics) latches the unsupported branch; a 404 naming the
 * SESSION is treated as an ordinary error (never latches).
 *
 * `openDiff`/`openFile` wire handlers (todo-3 types, registry seam): the
 * native `vscode.diff` preview is driven through injected seams —
 * {@link createDiffRenderer} (URI pair + title for `vscode.commands.
 * executeCommand("vscode.diff", ...)` against read-only in-memory docs from
 * {@link DiffDocumentStore}, served by the `opencode-panel-diff://`
 * TextDocumentContentProvider) and {@link createFileOpener} (workspace-
 * relative resolution + openTextDocument/showTextDocument). The plan's
 * MUST-NOT is honored: no custom diff viewer, native `vscode.diff` only,
 * and the `before` side rides the diff route's revert-aware snapshot
 * verbatim (never reconstructed locally).
 */

import type { PanelLogger } from "../logger.js";
import type { InvalidateSink } from "../../server/eventBridge.js";
import type { ServerConnection } from "../../server/serverManager.js";
import type { Capabilities } from "../../server/capabilities.js";
import { probeDoc } from "../../server/docProbe.js";
import { isRecord, type FromWebviewResponse, type ToastLevel } from "../../shared/protocol.js";
import type { RegisterHandler, SessionClientSource } from "./sessions.js";
import type { ViewEventSink } from "./sync.js";

// ---------------------------------------------------------------------------
// Event-channel wire contract (mirrored verbatim in
// src/webview/src/chat/dock/dockTypes.ts — pinned by tests on both sides).

/** Host -> webview full todo sync + one-shot unsupported flag. */
export const TODOS_SYNC_EVENT_TYPE = "todos.sync";
/** Host -> webview full session-diff sync + one-shot unsupported flag. */
export const DIFFS_SYNC_EVENT_TYPE = "diffs.sync";

/** Custom TextDiff document scheme; the provider serves read-only content. */
export const DOCK_DIFF_SCHEME = "opencode-panel-diff";
/** Native diff title format: `<file> (session diff)`. */
export const SESSION_DIFF_TITLE_SUFFIX = "(session diff)";

// ---------------------------------------------------------------------------
// Boundary-parsed view models (the wire only ever carries these).

/** One todo item, boundary-parsed from `GET /session/:id/todo`. */
export interface DockTodo {
  readonly id: string;
  readonly content: string;
  readonly status: string;
  readonly priority: string;
}

/** One changed file, boundary-parsed from `GET /session/:id/diff`. */
export interface DockFileDiff {
  readonly file: string;
  /** Revert-aware snapshot content for the left (read-only) diff side. */
  readonly before: string;
  readonly after: string;
  readonly additions: number;
  readonly deletions: number;
}

export type TodosSyncPayload =
  | { readonly sessionId: string; readonly todos: readonly DockTodo[] }
  | { readonly sessionId?: string | undefined; readonly unsupported: true };

export type DiffsSyncPayload =
  | { readonly sessionId: string; readonly diffs: readonly DockFileDiff[] }
  | { readonly sessionId?: string | undefined; readonly unsupported: true };

/** Defensive parse; malformed entries drop silently (never an invented row). */
export function parseDockTodos(payload: unknown): DockTodo[] {
  if (!Array.isArray(payload)) return [];
  const todos: DockTodo[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.content !== "string") continue;
    todos.push({
      id: item.id,
      content: item.content,
      status: typeof item.status === "string" ? item.status : "",
      priority: typeof item.priority === "string" ? item.priority : "",
    });
  }
  return todos;
}

/**
 * Rebuild before/after contents from a unified-diff `patch` (current
 * servers ship `{file, patch, status}` with NO before/after fields, and the
 * patches are full-file — context + removed = the before side, context +
 * added = the after side). `undefined` on a malformed/empty patch so the
 * caller keeps its empty-string fallback rather than a fabricated half-doc.
 */
export function unifiedToBeforeAfter(
  patch: string,
): { readonly before: string; readonly after: string } | undefined {
  const before: string[] = [];
  const after: string[] = [];
  let inHunk = false;
  let sawLine = false;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+")) {
      after.push(raw.slice(1));
      sawLine = true;
      continue;
    }
    if (raw.startsWith("-")) {
      before.push(raw.slice(1));
      sawLine = true;
      continue;
    }
    // Context (" " prefix) and the tail-empty line after the last hunk row.
    const context = raw.startsWith(" ") ? raw.slice(1) : raw.length === 0 ? raw : null;
    if (context === null) continue;
    before.push(context);
    after.push(context);
    sawLine = true;
  }
  if (!sawLine) return undefined;
  return { before: before.join("\n"), after: after.join("\n") };
}

/** Defensive parse; numeric counters must actually be numbers. */
export function parseDockFileDiffs(payload: unknown): DockFileDiff[] {
  if (!Array.isArray(payload)) return [];
  const diffs: DockFileDiff[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    const file =
      typeof item.file === "string"
        ? item.file
        : typeof item.path === "string"
          ? item.path
          : typeof item.filename === "string"
            ? item.filename
            : undefined;
    if (file === undefined) continue;
    if (typeof item.additions !== "number" || typeof item.deletions !== "number") continue;

    let before = typeof item.before === "string" ? item.before : "";
    let after = typeof item.after === "string" ? item.after : "";
    if ((before.length === 0 || after.length === 0) && typeof item.patch === "string") {
      // Patch-only wire shape (newer servers): rebuild the sides so the
      // native diff preview shows real content instead of two empty buffers.
      const sides = unifiedToBeforeAfter(item.patch);
      if (sides !== undefined) {
        if (before.length === 0) before = sides.before;
        if (after.length === 0) after = sides.after;
      }
    } else if (before.length === 0 && after.length === 0 && typeof item.diff === "string") {
      const sides = unifiedToBeforeAfter(item.diff);
      if (sides !== undefined) {
        if (before.length === 0) before = sides.before;
        if (after.length === 0) after = sides.after;
      }
    }

    diffs.push({
      file,
      before,
      after,
      additions: item.additions,
      deletions: item.deletions,
    });
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Fetchers (SDK calls + classification).

export type DockFetchKind = "unsupported" | "error";

export type DockFetchOutcome<T> =
  | { readonly ok: true; readonly items: readonly T[] }
  | { readonly ok: false; readonly kind: DockFetchKind; readonly error: unknown };

interface SdkResultLike {
  readonly data: unknown;
  readonly error: unknown;
  readonly response: Response;
}

/** Body-decides 404 classification (docProbe fallback phrasing). */
const ROUTE_ABSENT_MARKERS = ["route not found", "not available on this server"];

function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (isRecord(error)) {
    if (isRecord(error.data) && typeof error.data.message === "string") {
      return error.data.message;
    }
    if (typeof error.message === "string") return error.message;
  }
  return String(error);
}

function classifyFetchFailure(result: SdkResultLike): DockFetchKind {
  const status = result.response.status;
  const detail = errorDetail(result.error);
  if (status === 404 && ROUTE_ABSENT_MARKERS.some((marker) => detail.includes(marker))) {
    return "unsupported";
  }
  return "error";
}

/**
 * `GET /session/:id/todo` via the onboarded SDK client, boundary-parsed.
 * Transport throws fold into `{ok:false, kind:"error"}`; a route-absent 404
 * folds into `{ok:false, kind:"unsupported"}`.
 */
export async function todosForSession(
  connection: ServerConnection,
  sessionId: string,
): Promise<DockFetchOutcome<DockTodo>> {
  let result: SdkResultLike;
  try {
    result = await connection.client.session.todo({ path: { id: sessionId } });
  } catch (error) {
    return { ok: false, kind: "error", error };
  }
  if (result.error !== undefined || result.data === undefined) {
    return { ok: false, kind: classifyFetchFailure(result), error: result.error };
  }
  return { ok: true, items: parseDockTodos(result.data) };
}

/**
 * Merge message block's `info.summary.diffs` into a per-file view:
 * When user prompt turns exist in the payload, restricts the diff aggregation
 * to the target turn (or latest user turn by default), matching the pinned
 * prompt behavior.
 */
export function mergeSummaryDiffs(payload: unknown, messageID?: string): DockFileDiff[] {
  if (!Array.isArray(payload)) return [];

  let targetEntries = payload;
  const hasUserRoles = payload.some(
    (e) => isRecord(e) && (e.role === "user" || (isRecord(e.info) && e.info.role === "user")),
  );

  if (hasUserRoles) {
    if (messageID !== undefined) {
      const idx = payload.findIndex(
        (e) =>
          isRecord(e) &&
          (e.id === messageID || (isRecord(e.info) && e.info.id === messageID)),
      );
      if (idx >= 0) {
        let end = payload.length;
        for (let i = idx + 1; i < payload.length; i++) {
          const item = payload[i];
          if (
            isRecord(item) &&
            (item.role === "user" || (isRecord(item.info) && item.info.role === "user"))
          ) {
            end = i;
            break;
          }
        }
        targetEntries = payload.slice(idx, end);
      }
    } else {
      let lastUserIdx = -1;
      for (let i = payload.length - 1; i >= 0; i--) {
        const item = payload[i];
        if (
          isRecord(item) &&
          (item.role === "user" || (isRecord(item.info) && item.info.role === "user"))
        ) {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        targetEntries = payload.slice(lastUserIdx);
      }
    }
  }

  const byFile = new Map<string, DockFileDiff>();
  for (const entry of targetEntries) {
    if (!isRecord(entry) || !isRecord(entry.info) || !isRecord(entry.info.summary)) continue;
    const diffs = parseDockFileDiffs(entry.info.summary.diffs);
    for (const diff of diffs) {
      const previous = byFile.get(diff.file);
      byFile.set(
        diff.file,
        previous === undefined
          ? diff
          : {
              file: diff.file,
              before: previous.before,
              after: diff.after,
              additions: previous.additions + diff.additions,
              deletions: previous.deletions + diff.deletions,
            },
      );
    }
  }
  return [...byFile.values()];
}

/**
 * `GET /session/:id/diff?messageID=` via the onboarded SDK client,
 * boundary-parsed. Same outcome semantics as {@link todosForSession}.
 *
 * SESSION-SCOPE FALLBACK: current servers answer the no-messageID route with
 * `[]` even for edit-heavy sessions (verified live) — the per-message
 * `summary.diffs` data is the authoritative source there. An empty
 * session-scope result therefore re-derives from the message list instead
 * of declaring "no changes".
 */
export async function diffsForSession(
  connection: ServerConnection,
  sessionId: string,
  messageID?: string,
): Promise<DockFetchOutcome<DockFileDiff>> {
  let result: SdkResultLike;
  try {
    result = await connection.client.session.diff({
      path: { id: sessionId },
      ...(messageID === undefined ? {} : { query: { messageID } }),
    });
  } catch (error) {
    return { ok: false, kind: "error", error };
  }
  if (result.error !== undefined || result.data === undefined) {
    return { ok: false, kind: classifyFetchFailure(result), error: result.error };
  }
  const items = parseDockFileDiffs(result.data);
  if (items.length > 0 || messageID !== undefined) {
    return { ok: true, items };
  }
  try {
    const messages = await connection.client.session.messages({ path: { id: sessionId } });
    if (messages.error !== undefined || messages.data === undefined) {
      return { ok: true, items };
    }
    return { ok: true, items: mergeSummaryDiffs(messages.data, messageID) };
  } catch {
    // Aggregation is best-effort: the (empty) route answer stands.
    return { ok: true, items };
  }
}

// ---------------------------------------------------------------------------
// DockSync: poll-refetch + broadcast for both domains; NEVER rejects (a lost
// server or a fetch failure yields a log line and no post, mirroring
// SessionSync/MessageSync).

const DIFF_PATH = /^\/session\/[^/]+\/diff$/;

type ConnectionCapabilities = Pick<Capabilities, "hasTodo">;

export interface DockSyncDeps {
  readonly source: SessionClientSource;
  readonly sink: ViewEventSink;
  readonly logger: PanelLogger;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class DockSync {
  private readonly deps: DockSyncDeps;
  private activeSessionId: string | undefined;
  private todosUnsupportedPosted = false;
  private diffsUnsupportedPosted = false;
  private readonly tokens = new Map<string, number>();
  private readonly diffRouteCache = new Map<string, boolean>();

  constructor(deps: DockSyncDeps) {
    this.deps = deps;
  }

  /** The session future id-less invalidations refetch (T12 contract). */
  get activeSession(): string | undefined {
    return this.activeSessionId;
  }

  /** Todo-12 seam: selection change records the id and refetches both lists. */
  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    void this.refreshTodos(sessionId);
    void this.refreshDiffs(sessionId);
  }

  /**
   * New connection epoch (managed|attached transition): re-probe the diff
   * route and re-arm the one-shot unsupported posts, so a server upgrade or
   * downgrade is reflected after reconnect (the todo-7 detector's own cache
   * is invalidated on the same transition by the capability-info wiring).
   */
  reset(): void {
    this.todosUnsupportedPosted = false;
    this.diffsUnsupportedPosted = false;
    this.diffRouteCache.clear();
  }

  /**
   * Todo-9 bridge seam: `todos` invalidations refetch todos; `sessions`
   * invalidations (covers `session.diff`) refetch diffs. Both fire ONLY for
   * the pinned active session — foreign sessions on the shared server (TUI,
   * curl probes, other clients) never surface in this panel's dock (the
   * faithful-selection contract from the stale-view regression fix).
   */
  readonly invalidate: InvalidateSink = (kind, sessionId) => {
    if (kind !== "todos" && kind !== "sessions") return;
    if (this.activeSessionId === undefined) return;
    const target = sessionId ?? this.activeSessionId;
    if (target !== this.activeSessionId) return;
    if (kind === "todos") void this.refreshTodos(target);
    else void this.refreshDiffs(target);
  };

  /** Refetch the todo list for one session and post `todos.sync`. */
  async refreshTodos(sessionId: string): Promise<void> {
    if (this.todosUnsupportedPosted) return;
    const token = this.nextToken(`todos:${sessionId}`);
    const connection = await this.connect();
    if (connection === undefined) return;
    if (!this.todoSupported(connection.capabilities)) {
      if (this.stale(`todos:${sessionId}`, token)) return;
      this.postTodosUnsupportedOnce(sessionId, "hasTodo=false (capability probe)");
      return;
    }
    const outcome = await todosForSession(connection, sessionId);
    if (this.stale(`todos:${sessionId}`, token)) return;
    if (!outcome.ok) {
      if (outcome.kind === "unsupported") {
        this.postTodosUnsupportedOnce(sessionId, errorDetail(outcome.error));
        return;
      }
      this.deps.logger.warn(
        `dock sync: todo fetch for session ${sessionId} failed: ${errorSummary(outcome.error)}`,
      );
      return;
    }
    this.deps.sink.postEvent(TODOS_SYNC_EVENT_TYPE, {
      sessionId,
      todos: outcome.items,
    } satisfies TodosSyncPayload);
  }

  /** Refetch the diff set for one session and post `diffs.sync`. */
  async refreshDiffs(sessionId: string, messageID?: string): Promise<void> {
    // The whole dock collapses when the todos guard fired; diffs stay silent.
    if (this.todosUnsupportedPosted || this.diffsUnsupportedPosted) return;
    const token = this.nextToken(`diffs:${sessionId}`);
    const connection = await this.connect();
    if (connection === undefined) return;
    const supported = await this.diffRouteSupported(connection);
    if (this.stale(`diffs:${sessionId}`, token)) return;
    if (!supported) {
      this.postDiffsUnsupportedOnce(sessionId, "route absent from GET /doc");
      return;
    }
    const outcome = await diffsForSession(connection, sessionId, messageID);
    if (this.stale(`diffs:${sessionId}`, token)) return;
    if (!outcome.ok) {
      if (outcome.kind === "unsupported") {
        this.postDiffsUnsupportedOnce(sessionId, errorDetail(outcome.error));
        return;
      }
      this.deps.logger.warn(
        `dock sync: diff fetch for session ${sessionId} failed: ${errorSummary(outcome.error)}`,
      );
      return;
    }
    this.deps.sink.postEvent(DIFFS_SYNC_EVENT_TYPE, {
      sessionId,
      diffs: outcome.items,
    } satisfies DiffsSyncPayload);
  }

  private async connect(): Promise<ServerConnection | undefined> {
    try {
      return await this.deps.source.connect();
    } catch (error) {
      this.deps.logger.debug(`dock sync skipped: ${errorSummary(error)}`);
      return undefined;
    }
  }

  /** The todo-7 pre-hiding bit rides the fresh connection every refresh. */
  private todoSupported(capabilities: ConnectionCapabilities): boolean {
    return capabilities.hasTodo;
  }

  /**
   * `/doc`-spec presence check for `/session/{id}/diff` (cached per baseUrl;
   * {@link reset} clears). When the spec is unobtainable the route is assumed
   * present and the fetch's own 404 classification decides the latch.
   */
  private async diffRouteSupported(connection: ServerConnection): Promise<boolean> {
    const cached = this.diffRouteCache.get(connection.baseUrl);
    if (cached !== undefined) return cached;
    const doc = await probeDoc(connection.probeFetch, connection.baseUrl);
    const supported = doc.kind !== "spec" || doc.paths.some((path) => DIFF_PATH.test(path));
    this.diffRouteCache.set(connection.baseUrl, supported);
    return supported;
  }

  private postTodosUnsupportedOnce(sessionId: string | undefined, reason: string): void {
    if (this.todosUnsupportedPosted) return;
    this.todosUnsupportedPosted = true;
    this.deps.logger.info(
      `dock hidden: this server does not support session todos (${reason})`,
    );
    const payload: TodosSyncPayload =
      sessionId === undefined
        ? { unsupported: true }
        : { sessionId, unsupported: true };
    this.deps.sink.postEvent(TODOS_SYNC_EVENT_TYPE, payload);
  }

  private postDiffsUnsupportedOnce(sessionId: string | undefined, reason: string): void {
    if (this.diffsUnsupportedPosted) return;
    this.diffsUnsupportedPosted = true;
    this.deps.logger.info(
      `diffs panel hidden: this server does not support session diffs (${reason})`,
    );
    const payload: DiffsSyncPayload =
      sessionId === undefined
        ? { unsupported: true }
        : { sessionId, unsupported: true };
    this.deps.sink.postEvent(DIFFS_SYNC_EVENT_TYPE, payload);
  }

  private nextToken(key: string): number {
    const token = (this.tokens.get(key) ?? 0) + 1;
    this.tokens.set(key, token);
    return token;
  }

  private stale(key: string, token: number): boolean {
    return this.tokens.get(key) !== token;
  }
}

// ---------------------------------------------------------------------------
// Read-only in-memory diff documents (provider side). URIs are pure strings
// here; the vscode adapter parses them into real Uri instances.

export type DiffSide = "before" | "after";

const DIFF_DOC_CAP = 64;

/**
 * Content table behind the `opencode-panel-diff://` provider. Entries are
 * append-only tokens (`/doc_<n>/<side>`); the map is capped at
 * {@link DIFF_DOC_CAP} entries with oldest-first eviction so long sessions
 * cannot grow it unboundedly (an evicted diff re-opens fine from a fresh
 * put — the provider only ever reads).
 */
export class DiffDocumentStore {
  private readonly docs = new Map<string, { readonly side: DiffSide; readonly content: string }>();
  private counter = 0;

  /** Store one side's content; returns the provider `uri.path` key. */
  put(side: DiffSide, content: string): string {
    this.counter += 1;
    const path = `/doc_${this.counter}/${side}`;
    this.docs.set(path, { side, content });
    while (this.docs.size > DIFF_DOC_CAP) {
      const oldest = this.docs.keys().next().value;
      if (oldest === undefined) break;
      this.docs.delete(oldest);
    }
    return path;
  }

  /** Provider lookup: content for a `uri.path`, undefined when unknown. */
  resolve(uriPath: string): string | undefined {
    return this.docs.get(uriPath)?.content;
  }
}

/** Read-only provider seam; structurally assignable to vscode's own type. */
export interface DiffContentProviderLike {
  provideTextDocumentContent(uri: { readonly path: string }): string | undefined;
}

/** The `opencode-panel-diff://` provider: read-only, store-backed. */
export function createDiffContentProvider(store: DiffDocumentStore): DiffContentProviderLike {
  return {
    provideTextDocumentContent: (uri) => store.resolve(uri.path),
  };
}

// ---------------------------------------------------------------------------
// Diff renderer (native vscode.diff through injected seams) + file opener.

export interface DiffReveal {
  readonly left: string;
  readonly right: string;
  readonly title: string;
}

/**
 * Build the (left, right, title) triple for one file's native diff. Both
 * sides are in-memory docs (read-only provider): the `before` content is the
 * diff route's revert-aware snapshot verbatim, never reconstructed locally.
 */
export function buildDiffReveal(store: DiffDocumentStore, diff: DockFileDiff): DiffReveal {
  const leftPath = store.put("before", diff.before);
  const rightPath = store.put("after", diff.after);
  return {
    left: `${DOCK_DIFF_SCHEME}://diff${leftPath}`,
    right: `${DOCK_DIFF_SCHEME}://diff${rightPath}`,
    title: `${diff.file} ${SESSION_DIFF_TITLE_SUFFIX}`,
  };
}

/** Opens one file's native `vscode.diff` editor. */
export interface DockDiffRenderer {
  open(diff: DockFileDiff): Promise<void>;
}

/**
 * Pure diff-command glue over two vscode seams (URI factory + command
 * execution). Typed generic over the Uri representation so the production
 * adapter and the node tests share the exact assembly path without casts.
 */
export function createDiffRenderer<TUri>(deps: {
  readonly store: DiffDocumentStore;
  readonly parseUri: (value: string) => TUri;
  readonly executeCommand: (
    command: string,
    ...args: readonly unknown[]
  ) => Promise<unknown> | Thenable<unknown>;
}): DockDiffRenderer {
  return {
    async open(diff) {
      const reveal = buildDiffReveal(deps.store, diff);
      await deps.executeCommand(
        "vscode.diff",
        deps.parseUri(reveal.left),
        deps.parseUri(reveal.right),
        reveal.title,
      );
    },
  };
}

/** One failed `openDiff` call (server fetch or renderer); carries no credentials. */
export class DockOpenDiffError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status: number | undefined) {
    super(`open diff failed: ${detail}`);
    this.name = "DockOpenDiffError";
    this.status = status;
  }
}

/**
 * The diff route is absent on this server (the todo-7-style pre-hiding
 * equivalent for the click path; name is the machine-readable marker, same
 * precedent as QuestionUnsupportedError).
 */
export class DockDiffUnsupportedError extends Error {
  constructor(detail: string) {
    super(`session diffs unsupported on this server: ${detail}`);
    this.name = "DockDiffUnsupportedError";
  }
}

/** One failed `openFile` call; the detail names the resolved path. */
export class DockOpenFileError extends Error {
  constructor(detail: string) {
    super(`open file failed: ${detail}`);
    this.name = "DockOpenFileError";
  }
}

/** Shows a workspace file in the editor. */
export interface DockFileOpener {
  openFile(path: string): Promise<void>;
}

/**
 * Workspace-relative resolution: absolute paths (posix, drive-letter, UNC)
 * pass through; anything else resolves against the manager's workspace
 * folder (the same folder the server was spawned in) and refuses honestly
 * when no folder is open.
 */
export function resolveDockFilePath(input: string, workspaceFolder: string | undefined): string {
  if (isAbsoluteDockPath(input)) return input;
  if (workspaceFolder === undefined || workspaceFolder.length === 0) {
    throw new DockOpenFileError(`cannot resolve "${input}": no workspace folder is open`);
  }
  const base = workspaceFolder.replace(/[/\\]+$/, "");
  const rel = input.replace(/^[/\\]+/, "");
  return `${base}/${rel}`;
}

function isAbsoluteDockPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[/\\]/.test(value)
  );
}

/**
 * Pure openFile glue over the vscode document seams. `openTextDocument` ->
 * `showTextDocument`, with failures wrapped in {@link DockOpenFileError}
 * (the todo-3 messenger turns it into an error reply).
 */
export function createFileOpener<TUri, TDocument>(deps: {
  readonly workspaceFolder: () => string | undefined;
  readonly fileUri: (fsPath: string) => TUri;
  readonly openDocument: (uri: TUri) => Promise<TDocument> | Thenable<TDocument>;
  readonly showDocument: (document: TDocument) => Promise<unknown> | Thenable<unknown>;
}): DockFileOpener {
  return {
    async openFile(path) {
      const resolved = resolveDockFilePath(path, deps.workspaceFolder());
      try {
        const document = await deps.openDocument(deps.fileUri(resolved));
        await deps.showDocument(document);
      } catch (error) {
        throw new DockOpenFileError(`${resolved}: ${errorSummary(error)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// DockService: the openDiff/openFile request implementations.

export interface OpenDiffInput {
  readonly sessionId: string;
  readonly messageID?: string;
  readonly file?: string;
}

export interface DockServiceDeps {
  readonly source: SessionClientSource;
  readonly renderer: DockDiffRenderer;
  readonly opener: DockFileOpener;
  readonly logger: PanelLogger;
  /** User-visible toast seam (the empty-set path has no other signal). */
  readonly notify?: { (level: ToastLevel, text: string): void };
  /** Localized body for the empty-diff toast (defaults to the en table). */
  readonly emptyDiffText?: string | (() => string);
}

export interface DockService {
  openDiff(input: OpenDiffInput): Promise<void>;
  openFile(path: string): Promise<void>;
}

/**
 * Click-path semantics: fetch the session's diff set and open ONE native
 * `vscode.diff` editor per changed file (sequential, so tab order matches
 * the file order). An empty set is not an error — the panel row cannot be
 * clicked then, so at most arrive here via a stale patch button; logged AND
 * toasted (the click must never feel dead).
 */
export function createDockService(deps: DockServiceDeps): DockService {
  return {
    async openDiff({ sessionId, messageID, file }) {
      const connection = await deps.source.connect();
      const outcome = await diffsForSession(connection, sessionId, messageID);
      if (!outcome.ok) {
        const detail = errorDetail(outcome.error);
        if (outcome.kind === "unsupported") {
          deps.logger.warn(`dock: openDiff unsupported: ${detail}`);
          throw new DockDiffUnsupportedError(detail);
        }
        deps.logger.warn(`dock: openDiff fetch failed: ${detail}`);
        throw new DockOpenDiffError(detail, undefined);
      }
      if (outcome.items.length === 0) {
        deps.logger.debug(`dock: openDiff for session ${sessionId}: no changed files`);
        const emptyText = deps.emptyDiffText;
        deps.notify?.(
          "info",
          (typeof emptyText === "function" ? emptyText() : emptyText) ??
            "No file changes in this session",
        );
        return;
      }
      const targetItems = file
        ? outcome.items.filter(
            (item) =>
              item.file === file ||
              item.file.endsWith(`/${file}`) ||
              file.endsWith(`/${item.file}`),
          )
        : outcome.items;
      const itemsToOpen = targetItems.length > 0 ? targetItems : outcome.items;

      for (const diff of itemsToOpen) {
        try {
          await deps.renderer.open(diff);
        } catch (error) {
          throw new DockOpenDiffError(
            `${diff.file}: ${errorSummary(error)}`,
            undefined,
          );
        }
      }
    },

    async openFile(path) {
      await deps.opener.openFile(path);
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration (todo-10 registry seam; mirrors ./answers.ts).

export interface DockDomainDeps {
  readonly service: DockService;
  /** Error-toast seam: every openDiff failure becomes visible feedback. */
  readonly notify?: { (level: ToastLevel, text: string): void };
  /** Localized toast for an openDiff payload that lost its session (defaults en). */
  readonly sessionLostText?: () => string;
}

/**
 * Register the frozen todo-3 `openDiff`/`openFile` handlers. Success replies
 * null (the operation's contract IS the reply). openDiff failures are folded
 * into an error toast instead of a protocol error reply — every webview
 * caller fires the request with `void`, so a rejection would be invisible.
 */
export function registerDockHandlers(register: RegisterHandler, deps: DockDomainDeps): void {
  const { service } = deps;

  register(
    "openDiff",
    async (payload): Promise<FromWebviewResponse["openDiff"]> => {
      if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
        if (deps.notify === undefined || deps.sessionLostText === undefined) return null;
        deps.notify("error", deps.sessionLostText());
        return null;
      }
      try {
        await service.openDiff(payload);
      } catch (error) {
        // User feedback beats protocol purity here: the click surfaced dead.
        if (deps.notify === undefined) throw error;
        deps.notify("error", errorSummary(error));
      }
      return null;
    },
  );

  register(
    "openFile",
    async ({ path }): Promise<FromWebviewResponse["openFile"]> => {
      try {
        await service.openFile(path);
      } catch (error) {
        // Same dead-click seam as openDiff: void callers swallow rejections.
        if (deps.notify === undefined) throw error;
        deps.notify("error", errorSummary(error));
      }
      return null;
    },
  );
}

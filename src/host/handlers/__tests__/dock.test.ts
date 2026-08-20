// allow: SIZE_OK — one acceptance narrative per todo-18 requirement (parsers,
// fetchers vs the todo-5 mock, DockSync routing/guards, the QA old-server
// latch, diff documents, openDiff titles, the opener, the registry) — the
// prompt.test.ts / Composer.test.tsx sanction.
/**
 * Dock host suite (plan todo 18):
 * - wire literals both bundles mirror + boundary parsers (todos/diffs);
 * - todosForSession/diffsForSession against the todo-5 mock server (items,
 *   empty list, route-absent 404 -> unsupported, session-missing 404 ->
 *   error, messageID query pass-through);
 * - DockSync: InvalidateSink routing (todos+sessions kinds), active-session
 *   fallback adoption, stale-fetch sequencing, error/connect degradation;
 * - QA FAILURE (todo-18 acceptance): old-server hasTodo=false -> ONE
 *   todos.sync {unsupported:true} post + ONE info log + diffs fully silenced
 *   (webview hides the dock and toasts once; the webview halves are asserted
 *   in src/webview/src/chat/dock/__tests__), plus the mid-fetch 404 latch;
 * - read-only diff documents (store cap/eviction, provider content);
 * - openDiff executing native vscode.diff with expected URIs + title against
 *   stubbed commands, empty diff set, unsupported typing; openFile seams;
 * - registerDockHandlers mapping the frozen todo-3 wire payloads.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import type { Capabilities } from "../../../server/capabilities.js";
import { createPanelClient, type ProbeFetch } from "../../../server/clientFactory.js";
import type { ServerConnection } from "../../../server/ServerManager.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import type { HandlerContext } from "../../messenger.js";
import { staticSessionSource } from "../sessions.js";
import type { ViewEventSink } from "../sync.js";
import {
  buildDiffReveal,
  createDiffContentProvider,
  createDiffRenderer,
  createDockService,
  createFileOpener,
  DIFFS_SYNC_EVENT_TYPE,
  DiffDocumentStore,
  DOCK_DIFF_SCHEME,
  DockDiffUnsupportedError,
  DockOpenDiffError,
  DockOpenFileError,
  DockSync,
  diffsForSession,
  mergeSummaryDiffs,
  parseDockFileDiffs,
  parseDockTodos,
  registerDockHandlers,
  resolveDockFilePath,
  TODOS_SYNC_EVENT_TYPE,
  todosForSession,
  unifiedToBeforeAfter,
  type DiffsSyncPayload,
  type DockDiffRenderer,
  type DockFileOpener,
  type DockService,
  type TodosSyncPayload,
} from "../dock.js";

// ---------------------------------------------------------------------------
// Test seams.

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
  }
}

/** SecretStorage fake: never holds credentials (mock server needs none). */
class EmptySecrets implements SecretStorage {
  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingEventSink implements ViewEventSink {
  readonly events: Array<{ readonly type: string; readonly payload: unknown }> = [];
  postEvent(type: string, payload: unknown): void {
    this.events.push({ type, payload });
  }
  todosPayloads(): TodosSyncPayload[] {
    return this.events
      .filter((event) => event.type === TODOS_SYNC_EVENT_TYPE)
      .map((event) => event.payload as TodosSyncPayload);
  }
  diffsPayloads(): DiffsSyncPayload[] {
    return this.events
      .filter((event) => event.type === DIFFS_SYNC_EVENT_TYPE)
      .map((event) => event.payload as DiffsSyncPayload);
  }
}

const BASE_CAPABILITIES: Capabilities = {
  version: "1.0.42-mock",
  hasFork: true,
  hasQuestion: true,
  hasTodo: true,
  hasShell: true,
  agents: [],
  commands: [],
  mcpNative: [],
  omoDetected: false,
  omoMcpNote: false,
};

function silentLogger(channel: CapturingChannel): PanelLogger {
  return new PanelLogger(channel, () => true);
}

function panelFor(url: string, fetchImpl?: ProbeFetch) {
  return createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}

function craftedConnection(url: string, capabilities: Capabilities): ServerConnection {
  const panel = panelFor(url);
  return {
    baseUrl: url,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities,
  };
}

/**
 * Panel client whose fetch is a scripted function (no network). Used for
 * route-absent 404s, empty payload shaping and request URL capture — the
 * mock server cannot express a present-todo/absent-diff server.
 */
function scriptedConnection(
  capabilities: Capabilities,
  handler: (request: Request) => Response | Promise<Response>,
): { readonly connection: ServerConnection; readonly requests: string[] } {
  const requests: string[] = [];
  const url = "http://dock-scripted.invalid";
  const panel = panelFor(url, (request) => {
    requests.push(request.url);
    return Promise.resolve(handler(request));
  });
  return {
    requests,
    connection: {
      baseUrl: url,
      ownership: "attached",
      client: panel.client,
      probeFetch: panel.probeFetch,
      capabilities,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createMockSession(url: string, title = "Dock session"): Promise<string> {
  const response = await fetch(`${url}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const info = (await response.json()) as { id: string };
  return info.id;
}

/** Run the scripted basic-chat replay to completion (adds user+assistant). */
async function postMockMessage(url: string, sessionId: string): Promise<void> {
  const response = await fetch(`${url}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`mock message failed: ${response.status}`);
}

function syncHarness(
  connection: ServerConnection,
): { readonly sync: DockSync; readonly sink: RecordingEventSink; readonly channel: CapturingChannel } {
  const sink = new RecordingEventSink();
  const channel = new CapturingChannel();
  const sync = new DockSync({
    source: staticSessionSource(connection),
    sink,
    logger: silentLogger(channel),
  });
  return { sync, sink, channel };
}

const context: HandlerContext = { messageId: "msg_test" };

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

// ---------------------------------------------------------------------------
// Wire literals + boundary parsers.

describe("dock wire contract", () => {
  it("pins the event literals both bundles mirror", () => {
    expect(TODOS_SYNC_EVENT_TYPE).toBe("todos.sync");
    expect(DIFFS_SYNC_EVENT_TYPE).toBe("diffs.sync");
    expect(DOCK_DIFF_SCHEME).toBe("opencode-panel-diff");
  });

  it("parses todos defensively, dropping malformed entries", () => {
    const parsed = parseDockTodos([
      { id: "a", content: "first", status: "pending", priority: "high" },
      { id: "b", content: "no status" },
      { content: "missing id" },
      "garbage",
      null,
    ]);
    expect(parsed).toEqual([
      { id: "a", content: "first", status: "pending", priority: "high" },
      { id: "b", content: "no status", status: "", priority: "" },
    ]);
    expect(parseDockTodos({ not: "an array" })).toEqual([]);
  });

  it("parses file diffs defensively (numeric counters required)", () => {
    const parsed = parseDockFileDiffs([
      { file: "a.ts", before: "b", after: "a", additions: 3, deletions: 2 },
      { file: "b.ts", additions: "3", deletions: 0 },
      { file: "c.ts", additions: 1, deletions: 1 },
    ]);
    expect(parsed).toEqual([
      { file: "a.ts", before: "b", after: "a", additions: 3, deletions: 2 },
      { file: "c.ts", before: "", after: "", additions: 1, deletions: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fetchers: mock server + scripted routes.

describe("todosForSession / diffsForSession", () => {
  it("returns the session's todo items, boundary-parsed (mock)", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const outcome = await todosForSession(craftedConnection(mock.url, BASE_CAPABILITIES), sessionId);
    expect(outcome).toEqual({
      ok: true,
      items: [
        { id: "todo_1", content: "Replay scripted deltas", status: "in_progress", priority: "high" },
        { id: "todo_2", content: "Complete assistant message", status: "pending", priority: "medium" },
      ],
    });
  });

  it("returns an empty list when the route answers [] (scripted)", async () => {
    const { connection } = scriptedConnection(BASE_CAPABILITIES, (request) => {
      expect(request.url).toContain("/session/ses_x/todo");
      return jsonResponse(200, []);
    });
    const outcome = await todosForSession(connection, "ses_x");
    expect(outcome).toEqual({ ok: true, items: [] });
  });

  it("classifies a route-absent 404 as unsupported (old-server phrasing)", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const sessionId = await createMockSession(mock.url);
    const outcome = await todosForSession(craftedConnection(mock.url, BASE_CAPABILITIES), sessionId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("unsupported");
  });

  it("classifies a session-missing 404 as an ordinary error (never latches)", async () => {
    mock = await startMockServer(0);
    const outcome = await todosForSession(craftedConnection(mock.url, BASE_CAPABILITIES), "ses_nope");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("error");
  });

  it("returns [] for a session without messages, then the diff set after one (mock)", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const connection = craftedConnection(mock.url, BASE_CAPABILITIES);

    const before = await diffsForSession(connection, sessionId);
    expect(before).toEqual({ ok: true, items: [] });

    await postMockMessage(mock.url, sessionId);
    const after = await diffsForSession(connection, sessionId);
    expect(after).toEqual({
      ok: true,
      items: [
        {
          file: "src/example.ts",
          before: "export const value = 1;\n",
          after: "export const value = 2;\nexport const extra = true;\n",
          additions: 2,
          deletions: 0,
        },
      ],
    });
  });

  it("passes messageID through as the diff query parameter (scripted URL capture)", async () => {
    const { connection, requests } = scriptedConnection(BASE_CAPABILITIES, () =>
      jsonResponse(200, []),
    );
    await diffsForSession(connection, "ses_x", "msg_42");
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0] ?? "");
    expect(url.pathname).toBe("/session/ses_x/diff");
    expect(url.searchParams.get("messageID")).toBe("msg_42");
  });
});

// ---------------------------------------------------------------------------
// DockSync: routing, adoption, guards, degradation.

describe("DockSync", () => {
  it("routes only todos/sessions invalidations and posts both syncs", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const { sync, sink } = syncHarness(craftedConnection(mock.url, BASE_CAPABILITIES));

    sync.invalidate("messages", sessionId);
    await Promise.resolve();
    expect(sink.events).toEqual([]);

    sync.invalidate("todos", sessionId);
    await sync.refreshTodos(sessionId);
    expect(sink.todosPayloads()).toEqual([
      {
        sessionId,
        todos: [
          { id: "todo_1", content: "Replay scripted deltas", status: "in_progress", priority: "high" },
          { id: "todo_2", content: "Complete assistant message", status: "pending", priority: "medium" },
        ],
      },
    ]);

    sync.invalidate("sessions", sessionId);
    // `sessions` kind covers session.diff refetches; await the pipeline directly (never race the fire-and-forget path).
    await sync.refreshDiffs(sessionId);
    expect(sink.diffsPayloads()).toEqual([{ sessionId, diffs: [] }]);
  });

  it("adopts the last seen session; setActiveSession refetches both domains", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const { sync, sink } = syncHarness(craftedConnection(mock.url, BASE_CAPABILITIES));

    expect(sync.activeSession).toBeUndefined();
    sync.invalidate("todos", sessionId);
    expect(sync.activeSession).toBe(sessionId);
    await sync.refreshTodos(sessionId);
    await sync.refreshDiffs(sessionId);
    const beforeReset = sink.events.length;

    sync.setActiveSession(sessionId);
    await Promise.resolve();
    // setActiveSession fired one todos + one diffs refresh for the new active.
    await sync.refreshTodos(sessionId);
    await sync.refreshDiffs(sessionId);
    expect(sink.todosPayloads().length).toBeGreaterThanOrEqual(2);
    expect(sink.diffsPayloads().length).toBeGreaterThanOrEqual(1);
    expect(sink.events.length).toBeGreaterThan(beforeReset);
  });

  it("QA failure: hasTodo=false (old-server) posts todos.sync {unsupported:true} exactly once, logs it, and silences diffs", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const sessionId = await createMockSession(mock.url);
    const connection = craftedConnection(mock.url, { ...BASE_CAPABILITIES, hasTodo: false });
    const { sync, sink, channel } = syncHarness(connection);

    await sync.refreshTodos(sessionId);
    await sync.refreshDiffs(sessionId);
    sync.invalidate("todos", sessionId);
    sync.invalidate("sessions", sessionId);
    await sync.refreshTodos(sessionId);
    await sync.refreshDiffs(sessionId);

    expect(sink.events).toEqual([
      { type: TODOS_SYNC_EVENT_TYPE, payload: { sessionId, unsupported: true } },
    ]);
    expect(channel.joined()).toContain("dock hidden");
    expect(channel.joined().match(/dock hidden/g)?.length).toBe(1);
  });

  it("latches unsupported once when a todo route 404s mid-fetch (real old-server route-absent)", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const sessionId = await createMockSession(mock.url);
    // Crafted capabilities claim todo support; the route itself 404s with
    // "not available on this server" (the mid-fetch guard path).
    const { sync, sink, channel } = syncHarness(craftedConnection(mock.url, BASE_CAPABILITIES));

    await sync.refreshTodos(sessionId);
    await sync.refreshTodos(sessionId);

    expect(sink.todosPayloads()).toEqual([{ sessionId, unsupported: true }]);
    expect(channel.joined().match(/dock hidden/g)?.length).toBe(1);
  });

  it("marks diffs unsupported once when /doc lacks the diff route, while todos still sync (scripted mixed server)", async () => {
    const { connection } = scriptedConnection(BASE_CAPABILITIES, (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/doc") return jsonResponse(200, { paths: { "/session/{id}/todo": {} } });
      if (url.pathname === "/session/ses_x/todo") return jsonResponse(200, []);
      return jsonResponse(404, { name: "NotFoundError", data: { message: `route not found: ${request.method} ${url.pathname}` } });
    });
    const { sync, sink, channel } = syncHarness(connection);

    await sync.refreshTodos("ses_x");
    await sync.refreshDiffs("ses_x");
    await sync.refreshDiffs("ses_x");

    expect(sink.todosPayloads()).toEqual([{ sessionId: "ses_x", todos: [] }]);
    expect(sink.diffsPayloads()).toEqual([{ sessionId: "ses_x", unsupported: true }]);
    expect(channel.joined().match(/diffs panel hidden/g)?.length).toBe(1);
  });

  it("warns and posts nothing when the fetch fails with an ordinary error", async () => {
    mock = await startMockServer(0);
    const { sync, sink, channel } = syncHarness(craftedConnection(mock.url, BASE_CAPABILITIES));

    await sync.refreshTodos("ses_nope");

    expect(sink.events).toEqual([]);
    expect(channel.joined()).toContain("todo fetch for session ses_nope failed");
  });

  it("connect failure degrades to a debug log and silence", async () => {
    const sink = new RecordingEventSink();
    const channel = new CapturingChannel();
    const sync = new DockSync({
      source: { connect: () => Promise.reject(new Error("server down")) },
      sink,
      logger: silentLogger(channel),
    });

    await sync.refreshTodos("ses_1");

    expect(sink.events).toEqual([]);
    expect(channel.joined()).toContain("dock sync skipped");
  });

  it("only the latest in-flight todos fetch posts (stale fetch discarded)", async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const responses: Array<Promise<Response> | Response> = [
      first,
      jsonResponse(200, [{ id: "t_new", content: "newest", status: "pending", priority: "high" }]),
    ];
    const { connection } = scriptedConnection(BASE_CAPABILITIES, () => {
      const next = responses.shift();
      if (next === undefined) return jsonResponse(200, []);
      return next;
    });
    const { sync, sink } = syncHarness(connection);

    void sync.refreshTodos("ses_1");
    await sync.refreshTodos("ses_1");
    releaseFirst?.(jsonResponse(200, [{ id: "t_stale", content: "stale" }]));
    await first;

    expect(sink.todosPayloads()).toEqual([
      {
        sessionId: "ses_1",
        todos: [{ id: "t_new", content: "newest", status: "pending", priority: "high" }],
      },
    ]);
  });

  it("reset() re-arms the unsupported posts for a new connection epoch", async () => {
    const { connection } = scriptedConnection(
      { ...BASE_CAPABILITIES, hasTodo: false },
      () => jsonResponse(200, []),
    );
    const { sync, sink } = syncHarness(connection);

    await sync.refreshTodos("ses_1");
    sync.reset();
    await sync.refreshTodos("ses_1");

    expect(sink.todosPayloads()).toEqual([
      { sessionId: "ses_1", unsupported: true },
      { sessionId: "ses_1", unsupported: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Diff documents: read-only store, reveal, provider.

describe("diff documents", () => {
  it("stores/ resolves both sides and builds the reveal triple", () => {
    const store = new DiffDocumentStore();
    const reveal = buildDiffReveal(store, {
      file: "src/example.ts",
      before: "before-body",
      after: "after-body",
      additions: 1,
      deletions: 1,
    });
    expect(reveal.title).toBe("src/example.ts (session diff)");
    expect(reveal.left).toMatch(/^opencode-panel-diff:\/\/diff\/doc_\d+\/before$/);
    expect(reveal.right).toMatch(/^opencode-panel-diff:\/\/diff\/doc_\d+\/after$/);

    const provider = createDiffContentProvider(store);
    const leftPath = new URL(reveal.left).pathname;
    const rightPath = new URL(reveal.right).pathname;
    expect(provider.provideTextDocumentContent({ path: leftPath })).toBe("before-body");
    expect(provider.provideTextDocumentContent({ path: rightPath })).toBe("after-body");
    expect(provider.provideTextDocumentContent({ path: "/doc_999/before" })).toBeUndefined();
  });

  it("evicts the oldest entries past the cap", () => {
    const store = new DiffDocumentStore();
    let firstPath = "";
    for (let index = 0; index < 70; index += 1) {
      const path = store.put("before", `content ${index}`);
      if (index === 0) firstPath = path;
    }
    expect(store.resolve(firstPath)).toBeUndefined();
    expect(store.resolve("/doc_70/before")).toBe("content 69");
  });
});

// ---------------------------------------------------------------------------
// DockService: openDiff against stubbed commands; openFile stubs.

interface CapturedUri {
  readonly kind: "uri";
  readonly value: string;
  readonly path: string;
}

function fakeParseUri(value: string): CapturedUri {
  return { kind: "uri", value, path: new URL(value).pathname };
}

interface CommandCall {
  readonly command: string;
  readonly args: readonly unknown[];
}

function stubRenderer(store: DiffDocumentStore, calls: CommandCall[]): DockDiffRenderer {
  return createDiffRenderer<CapturedUri>({
    store,
    parseUri: fakeParseUri,
    executeCommand: (command, ...args) => {
      calls.push({ command, args });
      return Promise.resolve(null);
    },
  });
}

const NOOP_OPENER: DockFileOpener = {
  openFile: () => Promise.resolve(),
};

function serviceHarness(
  connection: ServerConnection,
  overrides: { readonly renderer?: DockDiffRenderer; readonly opener?: DockFileOpener } = {},
): { readonly service: DockService; readonly channel: CapturingChannel } {
  const channel = new CapturingChannel();
  const store = new DiffDocumentStore();
  const calls: CommandCall[] = [];
  const service = createDockService({
    source: staticSessionSource(connection),
    renderer: overrides.renderer ?? stubRenderer(store, calls),
    opener: overrides.opener ?? NOOP_OPENER,
    logger: silentLogger(channel),
  });
  return { service, channel };
}

describe("DockService.openDiff", () => {
  it("executes vscode.diff with the expected read-only URIs and title (mock diff payload)", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    await postMockMessage(mock.url, sessionId);
    const connection = craftedConnection(mock.url, BASE_CAPABILITIES);

    const store = new DiffDocumentStore();
    const calls: CommandCall[] = [];
    const channel = new CapturingChannel();
    const service = createDockService({
      source: staticSessionSource(connection),
      renderer: stubRenderer(store, calls),
      opener: NOOP_OPENER,
      logger: silentLogger(channel),
    });

    await service.openDiff({ sessionId });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.command).toBe("vscode.diff");
    const [left, right, title] = call?.args ?? [];
    expect(left).toMatchObject({ kind: "uri", path: "/doc_1/before" });
    expect(right).toMatchObject({ kind: "uri", path: "/doc_2/after" });
    expect(title).toBe("src/example.ts (session diff)");

    // The registered provider serves exactly the diff route's revert-aware
    // before/after snapshots for those URIs (read-only, in-memory).
    const provider = createDiffContentProvider(store);
    expect(provider.provideTextDocumentContent({ path: "/doc_1/before" })).toBe(
      "export const value = 1;\n",
    );
    expect(provider.provideTextDocumentContent({ path: "/doc_2/after" })).toBe(
      "export const value = 2;\nexport const extra = true;\n",
    );
  });

  it("opens nothing when the diff set is empty (debug log only)", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const store = new DiffDocumentStore();
    const calls: CommandCall[] = [];
    const channel = new CapturingChannel();
    const service = createDockService({
      source: staticSessionSource(craftedConnection(mock.url, BASE_CAPABILITIES)),
      renderer: stubRenderer(store, calls),
      opener: NOOP_OPENER,
      logger: silentLogger(channel),
    });

    await service.openDiff({ sessionId });

    expect(calls).toEqual([]);
    expect(channel.joined()).toContain("no changed files");
  });

  it("an empty diff set also acknowledges the click via the notify seam", async () => {
    mock = await startMockServer(0);
    const sessionId = await createMockSession(mock.url);
    const toasts: Array<{ readonly level: string; readonly text: string }> = [];
    const service = createDockService({
      source: staticSessionSource(craftedConnection(mock.url, BASE_CAPABILITIES)),
      renderer: stubRenderer(new DiffDocumentStore(), []),
      opener: NOOP_OPENER,
      logger: silentLogger(new CapturingChannel()),
      notify: (level, text) => {
        toasts.push({ level, text });
      },
      emptyDiffText: "此工作階段尚無檔案變更",
    });

    await service.openDiff({ sessionId });

    // The localized text crosses verbatim (host resolves it from the shared tables).
    expect(toasts).toEqual([{ level: "info", text: "此工作階段尚無檔案變更" }]);
  });

  it("rejects with DockDiffUnsupportedError on a route-absent 404 (scripted)", async () => {
    const { connection } = scriptedConnection(BASE_CAPABILITIES, (request) => {
      const url = new URL(request.url);
      return jsonResponse(404, {
        name: "NotFoundError",
        data: { message: `route not found: ${request.method} ${url.pathname}` },
      });
    });
    const { service } = serviceHarness(connection);

    await expect(service.openDiff({ sessionId: "ses_x" })).rejects.toMatchObject({
      name: "DockDiffUnsupportedError",
    });
    await expect(service.openDiff({ sessionId: "ses_x" })).rejects.toBeInstanceOf(
      DockDiffUnsupportedError,
    );
  });

  it("rejects with DockOpenDiffError on an ordinary fetch failure", async () => {
    mock = await startMockServer(0);
    const { service } = serviceHarness(craftedConnection(mock.url, BASE_CAPABILITIES));

    await expect(service.openDiff({ sessionId: "ses_nope" })).rejects.toMatchObject({
      name: "DockOpenDiffError",
    });
  });
});

// ---------------------------------------------------------------------------
// Diff aggregation (the live-server fallback): unified-patch reconstruction,
// message-summary merge, and the session-scope fallback path.

describe("unifiedToBeforeAfter", () => {
  it("rebuilds both sides from a full-file unified patch", () => {
    const patch = [
      "Index: src/a.ts",
      "===================================================================",
      "--- src/a.ts",
      "+++ src/a.ts",
      "@@ -1,3 +1,3 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      " const c = 4;",
    ].join("\n");
    expect(unifiedToBeforeAfter(patch)).toEqual({
      before: "const a = 1;\nconst b = 2;\nconst c = 4;",
      after: "const a = 1;\nconst b = 3;\nconst c = 4;",
    });
  });

  it("handles added files (no removed/context lines to a before side)", () => {
    const patch = ["Index: new.ts", "====", "--- /dev/null", "+++ new.ts", "@@ -0,0 +1,2 @@", "+a", "+b"].join(
      "\n",
    );
    expect(unifiedToBeforeAfter(patch)).toEqual({ before: "", after: "a\nb" });
  });

  it("reports undefined on a malformed patch so fallbacks stay honest", () => {
    expect(unifiedToBeforeAfter("")).toBeUndefined();
    expect(unifiedToBeforeAfter("@@ -1,1 +1,1 @@\nnot-a-diff-line")).toBeUndefined();
  });
});

describe("parseDockFileDiffs patch fallback", () => {
  it("prefers verbatim before/after; reconstructs from `patch` only when empty", () => {
    const parsed = parseDockFileDiffs([
      { file: "a.ts", before: "B", after: "A", additions: 1, deletions: 1, patch: "@@ -1,1 +1,1 @@\n-x\n+y" },
      { file: "b.ts", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+p\n+q" },
    ]);
    expect(parsed).toEqual([
      { file: "a.ts", before: "B", after: "A", additions: 1, deletions: 1 },
      { file: "b.ts", before: "", after: "p\nq", additions: 2, deletions: 0 },
    ]);
  });
});

describe("mergeSummaryDiffs + session-scope fallback", () => {
  it("merges per-file: first before, last after, counters summed", () => {
    const payload = [
      {
        info: { id: "m1", summary: { diffs: [
          { file: "a.ts", before: "b0", after: "a1", additions: 3, deletions: 2 },
          { file: "b.ts", before: "x", after: "y", additions: 1, deletions: 0 },
        ] } },
        parts: [],
      },
      { info: { id: "m2" }, parts: [] },
      {
        info: { id: "m3", summary: { diffs: [{ file: "a.ts", before: "a1", after: "a2", additions: 4, deletions: 1 }] } },
        parts: [],
      },
    ];
    expect(mergeSummaryDiffs(payload)).toEqual([
      { file: "a.ts", before: "b0", after: "a2", additions: 7, deletions: 3 },
      { file: "b.ts", before: "x", after: "y", additions: 1, deletions: 0 },
    ]);
  });

  it("falls back to message-summary aggregation when the session diff route answers empty", async () => {
    const { connection } = scriptedConnection(BASE_CAPABILITIES, (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/diff")) return jsonResponse(200, []);
      if (url.pathname.endsWith("/message")) {
        return jsonResponse(200, [
          {
            info: { id: "m1", sessionID: "ses_x", role: "user", summary: { diffs: [
              { file: "a.ts", before: "old", after: "new", additions: 2, deletions: 1 },
            ] } },
            parts: [],
          },
        ]);
      }
      return jsonResponse(404, { name: "NotFoundError", data: { message: "route not found" } });
    });
    const outcome = await diffsForSession(connection, "ses_x");
    expect(outcome.ok && outcome.items).toEqual([
      { file: "a.ts", before: "old", after: "new", additions: 2, deletions: 1 },
    ]);
  });

  it("a message-scoped fetch never falls back (per-message empties are honest)", async () => {
    const { connection } = scriptedConnection(BASE_CAPABILITIES, (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/diff")) return jsonResponse(200, []);
      return jsonResponse(404, { name: "NotFoundError", data: { message: "route not found" } });
    });
    const outcome = await diffsForSession(connection, "ses_x", "msg_q");
    expect(outcome.ok && outcome.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// File opener seams.

describe("resolveDockFilePath + createFileOpener", () => {
  it("passes absolute paths through and joins relatives against the workspace", () => {
    expect(resolveDockFilePath("/abs/file.ts", "/ws")).toBe("/abs/file.ts");
    expect(resolveDockFilePath("C:\\proj\\file.ts", "/ws")).toBe("C:\\proj\\file.ts");
    expect(resolveDockFilePath("\\\\share\\file.ts", "/ws")).toBe("\\\\share\\file.ts");
    expect(resolveDockFilePath("src/a.ts", "/ws")).toBe("/ws/src/a.ts");
    expect(resolveDockFilePath("/leading.ts", undefined)).toBe("/leading.ts");
    expect(resolveDockFilePath("src/a.ts", "/ws/")).toBe("/ws/src/a.ts");
  });

  it("refuses workspace-relative paths without a workspace folder", () => {
    expect(() => resolveDockFilePath("src/a.ts", undefined)).toThrow(DockOpenFileError);
    expect(() => resolveDockFilePath("src/a.ts", "")).toThrow(DockOpenFileError);
  });

  it("opens the resolved document and shows it through the seam pair", async () => {
    const opened: unknown[] = [];
    const shown: unknown[] = [];
    const opener = createFileOpener<{ readonly file: string }, { readonly doc: string }>({
      workspaceFolder: () => "/ws",
      fileUri: (fsPath) => ({ file: fsPath }),
      openDocument: (uri) => {
        opened.push(uri);
        return Promise.resolve({ doc: "document" });
      },
      showDocument: (document) => {
        shown.push(document);
        return Promise.resolve(null);
      },
    });

    await opener.openFile("src/a.ts");

    expect(opened).toEqual([{ file: "/ws/src/a.ts" }]);
    expect(shown).toEqual([{ doc: "document" }]);
  });

  it("wraps open failures in DockOpenFileError naming the resolved path", async () => {
    const opener = createFileOpener<{ readonly file: string }, never>({
      workspaceFolder: () => "/ws",
      fileUri: (fsPath) => ({ file: fsPath }),
      openDocument: () => Promise.reject(new Error("ENOENT")),
      showDocument: () => Promise.resolve(null),
    });

    await expect(opener.openFile("src/missing.ts")).rejects.toMatchObject({
      name: "DockOpenFileError",
    });
    await expect(opener.openFile("src/missing.ts")).rejects.toThrow(/\/ws\/src\/missing\.ts/);
  });
});

// ---------------------------------------------------------------------------
// Handler registration.

describe("registerDockHandlers", () => {
  it("maps the frozen wire payloads onto the service verbatim", async () => {
    const calls: Array<{ readonly method: string; readonly arg: unknown }> = [];
    const service: DockService = {
      openDiff: (input) => {
        calls.push({ method: "openDiff", arg: input });
        return Promise.resolve();
      },
      openFile: (path) => {
        calls.push({ method: "openFile", arg: path });
        return Promise.resolve();
      },
    };
    const handlers = new Map<string, (payload: never, ctx: HandlerContext) => unknown>();
    registerDockHandlers(
      (type, handler) => {
        handlers.set(type, handler as (payload: never, ctx: HandlerContext) => unknown);
      },
      { service },
    );

    expect(handlers.size).toBe(2);
    const openDiff = handlers.get("openDiff");
    const openFile = handlers.get("openFile");
    if (openDiff === undefined || openFile === undefined) throw new Error("handlers missing");

    await openDiff({ sessionId: "ses_1" } as never, context);
    await openDiff({ sessionId: "ses_1", messageID: "msg_9" } as never, context);
    const openFileResult = openFile({ path: "src/a.ts" } as never, context);

    expect(calls).toEqual([
      { method: "openDiff", arg: { sessionId: "ses_1" } },
      { method: "openDiff", arg: { sessionId: "ses_1", messageID: "msg_9" } },
      { method: "openFile", arg: "src/a.ts" },
    ]);
    expect(await openFileResult).toBeNull();
  });

  it("openDiff folds a service failure into an error toast, never a rejection", async () => {
    const failing: DockService = {
      openDiff: () => Promise.reject(new DockOpenDiffError("blown (HTTP 500)", undefined)),
      openFile: () => Promise.resolve(),
    };
    const toasts: Array<{ readonly level: string; readonly text: string }> = [];
    const handlers = new Map<string, (payload: never, ctx: HandlerContext) => unknown>();
    registerDockHandlers(
      (type, handler) => {
        handlers.set(type, handler as (payload: never, ctx: HandlerContext) => unknown);
      },
      {
        service: failing,
        notify: (level, text) => {
          toasts.push({ level, text });
        },
      },
    );
    const openDiff = handlers.get("openDiff");
    if (openDiff === undefined) throw new Error("handlers missing");

    // The webview callers fire with `void`: the handler must RESOLVE and let
    // the toast carry the feedback.
    expect(await openDiff({ sessionId: "ses_1" } as never, undefined as never)).toBeNull();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.level).toBe("error");
    expect(toasts[0]?.text).toContain("blown");
  });

  it("openDiff without a notify seam still propagates failures (test/dev path)", async () => {
    const failing: DockService = {
      openDiff: () => Promise.reject(new DockOpenDiffError("blown", undefined)),
      openFile: () => Promise.resolve(),
    };
    const handlers = new Map<string, (payload: never, ctx: HandlerContext) => unknown>();
    registerDockHandlers(
      (type, handler) => {
        handlers.set(type, handler as (payload: never, ctx: HandlerContext) => unknown);
      },
      { service: failing },
    );
    const openDiff = handlers.get("openDiff");
    if (openDiff === undefined) throw new Error("handlers missing");
    await expect(openDiff({ sessionId: "ses_1" } as never, undefined as never)).rejects.toMatchObject({
      name: "DockOpenDiffError",
    });
  });
});

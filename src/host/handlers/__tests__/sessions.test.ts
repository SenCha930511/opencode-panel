/**
 * Sessions domain handlers acceptance suite (plan todo 12), run end-to-end
 * through the todo-3 HostMessenger against the todo-5 mock server:
 * - create ⇒ list (sync broadcast) contains the new session
 * - rename persists on a second list
 * - delete removes
 * - share returns a share url string (and the broadcast flags `shared`)
 * - fork returns a NEW id
 * - unshare uses the SDK's DELETE verb and clears the share field
 * - QA FAILURE: DELETE answered 500 ⇒ the handler surfaces an error reply
 *   (posted to the webview, which rolls its optimistic update back and shows
 *   an error toast — the webview half is covered in
 *   src/webview/src/sessions/__tests__)) and the failure is logged.
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { HostMessenger, type HostPort } from "../../messenger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import { createPanelClient, type ProbeFetch } from "../../../server/clientFactory.js";
import type { ServerConnection } from "../../../server/serverManager.js";
import type { Capabilities } from "../../../server/capabilities.js";
import {
  isRecord,
  type HostMessage,
  type RequestEnvelope,
  type SessionListPayload,
  type StreamChunkPayload,
} from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import {
  createSessionService,
  extractSubagentProgress,
  isSessionAutoArmed,
  registerSessionHandlers,
  staticSessionSource,
  type SessionClientSource,
} from "../sessions.js";
import { SESSIONS_LIST_EVENT, SessionSync, type ViewEventSink } from "../sync.js";

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

const FAKE_CAPABILITIES: Capabilities = {
  version: "0.0.0-test",
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

/** Records every bridge-bound event post (the sessionList broadcast carrier). */
class RecordingEventSink implements ViewEventSink {
  readonly events: Array<{ readonly type: string; readonly payload: unknown }> = [];
  postEvent(type: string, payload: unknown): void {
    this.events.push({ type, payload });
  }
  sessionLists(): SessionListPayload[] {
    return this.events
      .filter((event) => event.type === SESSIONS_LIST_EVENT)
      .map((event) => event.payload as SessionListPayload);
  }
  lastSessionList(): SessionListPayload {
    const lists = this.sessionLists();
    const last = lists[lists.length - 1];
    if (last === undefined) throw new Error("no session list broadcast recorded");
    return last;
  }
}

interface Harness {
  readonly messenger: HostMessenger;
  readonly sink: RecordingEventSink;
  readonly channel: CapturingChannel;
  readonly connection: ServerConnection;
  post(type: RequestEnvelope["type"], payload: unknown): string;
  replies(): StreamChunkPayload[];
  nextReply(messageId: string): Promise<StreamChunkPayload>;
}

let messageCounter = 0;

function createHarness(connection: ServerConnection): Harness {
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const source = staticSessionSource(connection);
  const service = createSessionService({ source, logger });
  const sink = new RecordingEventSink();
  const sync = new SessionSync({ service, sink, logger });

  const posted: HostMessage[] = [];
  const waiters = new Map<string, (payload: StreamChunkPayload) => void>();
  let listener: (message: unknown) => void = () => {
    throw new Error("message listener not wired");
  };
  const port: HostPort = {
    postMessage: (message) => {
      posted.push(message);
      if (message.type === "streamChunk") {
        const waiter = waiters.get(message.payload.messageId);
        if (waiter !== undefined) {
          waiters.delete(message.payload.messageId);
          waiter(message.payload);
        }
      }
    },
    onMessage: (registered) => {
      listener = registered;
    },
  };
  const messenger = new HostMessenger(port);
  registerSessionHandlers((type, handler) => messenger.register(type, handler), {
    service,
    sync,
  });

  return {
    messenger,
    sink,
    channel,
    connection,
    post(type, payload) {
      messageCounter += 1;
      const messageId = `m-${messageCounter}`;
      listener({ messageId, type, payload });
      return messageId;
    },
    replies() {
      return posted
        .filter((message) => message.type === "streamChunk")
        .map((message) => {
          if (message.type !== "streamChunk") throw new Error("unreachable");
          return message.payload;
        });
    },
    nextReply(messageId) {
      const existing = posted.find(
        (message) => message.type === "streamChunk" && message.payload.messageId === messageId,
      );
      if (existing !== undefined && existing.type === "streamChunk") {
        return Promise.resolve(existing.payload);
      }
      return new Promise<StreamChunkPayload>((resolve) => {
        waiters.set(messageId, resolve);
      });
    },
  };
}

function connectionFor(url: string, fetchImpl?: ProbeFetch): ServerConnection {
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  return {
    baseUrl: panel.baseUrl,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: FAKE_CAPABILITIES,
  };
}

function isSessionListPayload(value: unknown): value is SessionListPayload {
  return isRecord(value) && Array.isArray(value.sessions);
}

// ---------------------------------------------------------------------------
// Suite.

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

describe("sessions domain handlers", () => {
  it("create -> the sync broadcast list contains the new session", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(connectionFor(mock.url));

    const reply = await harness.nextReply(harness.post("createSession", { title: "Alpha session" }));
    expect(reply.status).toBe("success");
    expect(reply.done).toBe(true);
    const content = reply.content;
    expect(isRecord(content) && typeof content.id === "string").toBe(true);
    if (!isRecord(content) || typeof content.id !== "string") throw new Error("no id in reply");

    const list = harness.sink.lastSessionList();
    expect(list.sessions.some((session) => session.id === content.id)).toBe(true);
    expect(list.sessions.some((session) => session.title === "Alpha session")).toBe(true);
  });

  it("rename persists on a second list", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);

    const created = await harness.nextReply(harness.post("createSession", { title: "before rename" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;

    const renamed = await harness.nextReply(harness.post("renameSession", { id, title: "after rename" }));
    expect(renamed.status).toBe("success");

    const list = harness.sink.lastSessionList();
    const entry = list.sessions.find((session) => session.id === id);
    expect(entry?.title).toBe("after rename");
  });

  it("delete removes the session", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(connectionFor(mock.url));

    const created = await harness.nextReply(harness.post("createSession", { title: "to delete" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;

    const deleted = await harness.nextReply(harness.post("deleteSession", { id }));
    expect(deleted.status).toBe("success");

    const list = harness.sink.lastSessionList();
    expect(list.sessions.some((session) => session.id === id)).toBe(false);
  });

  it("share returns a share url string and flags the entry shared", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(connectionFor(mock.url));

    const created = await harness.nextReply(harness.post("createSession", { title: "to share" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;

    const shared = await harness.nextReply(harness.post("share", { id }));
    expect(shared.status).toBe("success");
    expect(isRecord(shared.content) && typeof shared.content.url === "string").toBe(true);
    if (!isRecord(shared.content) || typeof shared.content.url !== "string") {
      throw new Error("no share url in reply");
    }
    expect(shared.content.url.length).toBeGreaterThan(0);

    const list = harness.sink.lastSessionList();
    const entry = list.sessions.find((session) => session.id === id);
    expect(entry && "shared" in entry && entry.shared === true).toBe(true);
  });

  it("fork returns a NEW id and the fork appears in the list", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(connectionFor(mock.url));

    const created = await harness.nextReply(harness.post("createSession", { title: "to fork" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;

    const forked = await harness.nextReply(harness.post("fork", { id }));
    expect(forked.status).toBe("success");
    if (!isRecord(forked.content) || typeof forked.content.id !== "string") {
      throw new Error("no fork id in reply");
    }
    expect(forked.content.id).not.toBe(id);
    const forkId = forked.content.id;

    const list = harness.sink.lastSessionList();
    expect(list.sessions.some((session) => session.id === forkId)).toBe(true);
  });

  it("unshare (SDK DELETE verb) clears the share field", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);

    const created = await harness.nextReply(harness.post("createSession", { title: "to unshare" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;

    const shared = await harness.nextReply(harness.post("share", { id }));
    expect(shared.status).toBe("success");

    const unshared = await harness.nextReply(harness.post("unshare", { id }));
    expect(unshared.status).toBe("success");

    // Prove the DELETE cleared server state via a fresh GET through the same client.
    const gotten = await connection.client.session.get({ path: { id } });
    expect(gotten.error).toBeUndefined();
    expect(gotten.data?.share).toBeUndefined();

    const list = harness.sink.lastSessionList();
    const entry = list.sessions.find((session) => session.id === id);
    expect(entry && "shared" in entry && entry.shared === false).toBe(true);
  });

  it("QA failure: mock DELETE answers 500 -> error reply posted, nothing broadcast, warn logged", async () => {
    mock = await startMockServer(0);
    // Fetch-layer monkey patch: DELETE /session/:id answers 500; every other
    // request flows to the real mock. This stands in for a scenario-driven
    // 500 (the mock carries no such scenario; see evidence log).
    const raw: ProbeFetch = (request) => globalThis.fetch(request);
    const sabotaged: ProbeFetch = (request) => {
      const url = new URL(request.url);
      if (request.method === "DELETE" && /^\/session\/[^/]+$/.test(url.pathname)) {
        return Promise.resolve(
          new Response(JSON.stringify({ name: "InternalError", data: { message: "boom" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return raw(request);
    };
    const harness = createHarness(connectionFor(mock.url, sabotaged));

    const created = await harness.nextReply(harness.post("createSession", { title: "doomed delete" }));
    if (!isRecord(created.content) || typeof created.content.id !== "string") {
      throw new Error("create failed");
    }
    const id = created.content.id;
    const broadcastsBefore = harness.sink.sessionLists().length;

    const reply = await harness.nextReply(harness.post("deleteSession", { id }));
    expect(reply.status).toBe("error");
    expect(reply.done).toBe(true);
    expect(typeof reply.content).toBe("string");
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("SessionOperationError");
    expect(reply.content).toContain("HTTP 500");

    // The op failed, so no post-op refresh broadcast was attempted.
    expect(harness.sink.sessionLists().length).toBe(broadcastsBefore);
    // QA: the failure is logged (evidence: warn line names the operation).
    expect(harness.channel.joined()).toContain("delete failed: boom (HTTP 500)");

    // The session is still on the server (the UI rollback mirrors this truth).
    const service = createSessionService({
      source: staticSessionSource(connectionFor(mock.url)),
      logger: new PanelLogger(new CapturingChannel(), () => false),
    });
    const sessions = await service.listSessions();
    expect(sessions.some((session) => session.id === id)).toBe(true);
  });

  it("the broadcast payload is a protocol SessionListPayload", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(connectionFor(mock.url));
    await harness.nextReply(harness.post("createSession", { title: "shape check" }));
    const lists = harness.sink.sessionLists();
    expect(lists.length).toBeGreaterThan(0);
    for (const payload of lists) {
      expect(isSessionListPayload(payload)).toBe(true);
    }
  });
});

  function scriptedService(fetchImpl: ProbeFetch) {
    return createSessionService({
      source: staticSessionSource(connectionFor("http://share-scripted.invalid", fetchImpl)),
      logger: new PanelLogger(new CapturingChannel(), () => false),
    });
  }

describe("share idempotency + error detail", () => {
  function shareScripted(getBody: unknown): ProbeFetch {
    return (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname.endsWith("/share")) {
        // What current servers answer for an ALREADY-shared session.
        return Promise.resolve(
          new Response(JSON.stringify({ _tag: "InternalServerError" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (request.method === "GET" && /^\/session\/[^/]+$/.test(url.pathname)) {
        return Promise.resolve(
          new Response(JSON.stringify(getBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );
    };
  }

  it("a duplicate-share 500 folds to the session's existing link (idempotent share)", async () => {
    const service = scriptedService(
      shareScripted({ id: "ses_x", share: { url: "https://opncd.ai/share/existing" } }),
    );
    await expect(service.shareSession("ses_x")).resolves.toEqual({
      url: "https://opncd.ai/share/existing",
    });
  });

  it("plain-object error bodies surface as JSON detail, never '[object Object]'", async () => {
    const service = scriptedService(shareScripted({ id: "ses_x" }));
    try {
      await service.shareSession("ses_x");
      throw new Error("share should have failed");
    } catch (error) {
      const text = String(error);
      expect(text).toContain("SessionOperationError");
      expect(text).toContain('"_tag":"InternalServerError"');
      expect(text).not.toContain("[object Object]");
    }
  });
});


describe("setSessionAuto service (raw PATCH ruleset)", () => {
  it("PATCHes a wildcard allow ruleset when enabling auto", async () => {
    const recorded: Array<{ method: string; url: string; body: string }> = [];
    const fetchImpl: ProbeFetch = async (request) => {
      recorded.push({
        method: request.method,
        url: request.url,
        body: await request.text(),
      });
      return new Response(JSON.stringify({ permission: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const service = scriptedService(fetchImpl);
    await expect(service.setSessionAuto("ses_x", true)).resolves.toBeUndefined();
    expect(recorded).toHaveLength(1);
    const patch = recorded[0];
    if (patch === undefined) throw new Error("no PATCH recorded");
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe("http://share-scripted.invalid/session/ses_x");
    expect(JSON.parse(patch.body)).toEqual({
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    });
  });

  it("PATCHes a wildcard ask ruleset when disabling auto", async () => {
    const recorded: Array<{ method: string; url: string; body: string }> = [];
    const fetchImpl: ProbeFetch = async (request) => {
      recorded.push({ method: request.method, url: request.url, body: await request.text() });
      return new Response(JSON.stringify({ permission: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const service = scriptedService(fetchImpl);
    await service.setSessionAuto("ses_y", false);
    const patch = recorded[0];
    if (patch === undefined) throw new Error("no PATCH recorded");
    expect(JSON.parse(patch.body)).toEqual({
      permission: [{ permission: "*", pattern: "*", action: "ask" }],
    });
  });

  it("a non-2xx PATCH throws SessionOperationError with the HTTP status", async () => {
    const fetchImpl: ProbeFetch = () =>
      Promise.resolve(new Response("gone", { status: 404 }));
    const service = scriptedService(fetchImpl);
    try {
      await service.setSessionAuto("ses_z", true);
      throw new Error("setSessionAuto should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const text = String(error);
      expect(text).toContain("SessionOperationError");
      expect(text).toContain("HTTP 404");
    }
  });
});

describe("isSessionAutoArmed helper", () => {
  it("returns false for invalid or empty data", () => {
    expect(isSessionAutoArmed(null)).toBe(false);
    expect(isSessionAutoArmed({})).toBe(false);
    expect(isSessionAutoArmed({ permission: [] })).toBe(false);
  });

  it("detects wildcard allow as true", () => {
    expect(
      isSessionAutoArmed({
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      }),
    ).toBe(true);
  });

  it("detects wildcard ask as false", () => {
    expect(
      isSessionAutoArmed({
        permission: [{ permission: "*", pattern: "*", action: "ask" }],
      }),
    ).toBe(false);
  });

  it("uses the latest wildcard rule (last-match-wins)", () => {
    expect(
      isSessionAutoArmed({
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "*", pattern: "*", action: "ask" },
        ],
      }),
    ).toBe(false);

    expect(
      isSessionAutoArmed({
        permission: [
          { permission: "*", pattern: "*", action: "ask" },
          { permission: "*", pattern: "*", action: "allow" },
        ],
      }),
    ).toBe(true);
  });
});

describe("getSessionAuto service", () => {
  it("returns true when server returns allow rules", async () => {
    const fetchImpl: ProbeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "ses_auto",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const service = scriptedService(fetchImpl);
    const result = await service.getSessionAuto("ses_auto");
    expect(result).toBe(true);
  });

  it("returns false on 404 or network errors", async () => {
    const fetchImpl: ProbeFetch = () => Promise.resolve(new Response("not found", { status: 404 }));
    const service = scriptedService(fetchImpl);
    const result = await service.getSessionAuto("ses_missing");
    expect(result).toBe(false);
  });
});

// i18n-allow-literal — fixtures below hand-shape wire envelopes and emoji
// step strings; they are payloads under test, not display copy.
function assistantFixture(parts: readonly unknown[], completed: boolean): Record<string, unknown> {
  return {
    info: {
      role: "assistant",
      time: completed ? { created: 1, completed: 2 } : { created: 1 },
    },
    parts,
  };
}

describe("extractSubagentProgress", () => {
  const reasoning = (text: string): Record<string, unknown> => ({ type: "reasoning", text });
  const tool = (name: string, status: string, input: Record<string, unknown>): Record<string, unknown> => ({
    type: "tool",
    tool: name,
    state: { status, input },
  });

  it("empty message stream is idle, not running, and carries no tool", () => {
    const { progress, isRunning } = extractSubagentProgress([]);
    expect(progress).toEqual({ phase: "idle", thinking: "", thinkingTruncated: false });
    expect(isRunning).toBe(false);
  });

  it("a reasoning-only live run surfaces thinking text and phase thinking", () => {
    const { progress, isRunning } = extractSubagentProgress([
      assistantFixture([reasoning("let me consider the failing test\n because it flakes")], false),
    ]);
    expect(progress.phase).toBe("thinking");
    expect(progress.thinking).toBe("let me consider the failing test\n because it flakes");
    expect(progress.thinkingTruncated).toBe(false);
    expect(isRunning).toBe(true);
  });

  it("a running tool after reasoning wins the phase yet keeps the thinking", () => {
    const { progress, isRunning } = extractSubagentProgress([
      assistantFixture(
        [reasoning("I should run the compiler"), tool("bash", "running", { command: "npm test" })],
        false,
      ),
    ]);
    expect(progress).toEqual({
      phase: "tool",
      thinking: "I should run the compiler",
      thinkingTruncated: false,
      toolName: "bash",
      toolSummary: "npm test",
    });
    expect(isRunning).toBe(true);
  });

  it("completed assistant with a done tool reports not running", () => {
    const { progress, isRunning } = extractSubagentProgress([
      assistantFixture([tool("read", "completed", { path: "src/a.ts" }), reasoning("all read")], true),
    ]);
    expect(progress.phase).toBe("thinking");
    expect(progress.thinking).toBe("all read");
    expect(isRunning).toBe(false);
  });

  it("thinking text is tail-capped at 1200 chars with the truncated flag", () => {
    const long = "x".repeat(1500);
    const { progress } = extractSubagentProgress([assistantFixture([reasoning(long)], false)]);
    expect(progress.thinkingTruncated).toBe(true);
    expect(progress.thinking.length).toBe(1200);
    expect(progress.thinking).toBe(long.slice(-1200));
  });

  it("an assistant text part last means the subagent is writing", () => {
    const { progress } = extractSubagentProgress([
      assistantFixture([reasoning("plan"), { type: "text", text: "Here is my analysis." }], false),
    ]);
    expect(progress.phase).toBe("writing");
    expect(progress.thinking).toBe("plan");
  });

  it("system-reminder text does not flip the phase to writing", () => {
    const { progress } = extractSubagentProgress([
      assistantFixture([reasoning("still thinking"), { type: "text", text: "<system-reminder>note</system-reminder>" }], false),
    ]);
    expect(progress.phase).toBe("thinking");
  });

  it("malformed envelopes and parts are skipped without throwing", () => {
    const { progress, isRunning } = extractSubagentProgress([
      "garbage",
      { parts: null },
      { info: { role: "assistant" }, parts: ["x", null, 7] },
    ]);
    expect(progress.phase).toBe("idle");
    expect(isRunning).toBe(true);
  });
});

describe("getSubagentLogs progress over the wire", () => {
  function subagentServer(childParts: readonly unknown[]): ProbeFetch {
    const ok = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    return (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/session") {
        return ok([
          { id: "ses_parent", title: "parent chat", time: { created: 1, updated: 1 } },
          { id: "ses_child", parentID: "ses_parent", title: "subagent: investigate", time: { created: 2, updated: 2 } },
        ]);
      }
      if (request.method === "GET" && url.pathname === "/session/ses_child/message") {
        return ok([
          {
            info: { role: "assistant", time: { created: 1 } },
            parts: [
              { type: "reasoning", text: "the export boundary is the suspect" },
              { type: "tool", tool: "grep", state: { status: "running", input: { query: "extractSubagentProgress" } } },
            ],
          },
        ]);
      }
      return ok([]);
    };
  }

  it("steps, live progress, and a real isRunning reach the reply", async () => {
    const service = scriptedService(subagentServer([]));
    const result = await service.getSubagentLogs({ sessionId: "ses_parent" });
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.isRunning).toBe(true);
    expect(result.progress).toEqual({
      phase: "tool",
      thinking: "the export boundary is the suspect",
      thinkingTruncated: false,
      toolName: "grep",
      toolSummary: "extractSubagentProgress",
    });
  });

  it("no child session degrades to an empty result without progress", async () => {
    const service = scriptedService((request) => {
      const url = new URL(request.url);
      const ok = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      if (request.method === "GET" && url.pathname === "/session") {
        return ok([{ id: "ses_parent", title: "parent chat", time: { created: 1, updated: 1 } }]);
      }
      if (request.method === "GET" && url.pathname === "/session/ses_parent/message") {
        return ok([]);
      }
      return ok([]);
    });
    const result = await service.getSubagentLogs({ sessionId: "ses_parent" });
    expect(result).toEqual({ steps: [], isRunning: false });
    expect(result.progress).toBeUndefined();
  });
});


/**
 * Message-ops domain handlers acceptance suite (plan todo 19), run
 * end-to-end through the todo-3 HostMessenger against the todo-5 mock server:
 * - revert posts the wire messageID verbatim and returns ok
 * - unrevert clears the reverted state
 * - summarize resolves its model from config.get and posts the SDK body
 * - old-server scenario keeps /doc (and routes) for revert/summarize/shell:
 *   all four ops still succeed (todo-7 ruling: only fork/question/todo hide;
 *   shell is VISIBLE on old servers — asserted, never regressed)
 * - a 404 on an op route becomes the typed unsupported error (the capability
 *   fallback path for old servers missing the route)
 * - QA FAILURE: revert mocked 500 -> error reply naming HTTP 500, warn logged,
 *   and no state removal server-side (the webview mirrors this by removing
 *   no local messages; covered in src/webview/src/chat/messageOps)
 * - runShell composes {agent (first advertised primary), command} with no
 *   fabricated model; empty agent list / missing config model are the typed
 *   setup errors.
 *
 * A scoped fetch wrapper records POST bodies (verbatim-post assertions) or
 * sabotages one route (404/500/unavailable fixtures) — the same seam the
 * todo-12 QA failure test used for its mock-less 500.
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
  type StreamChunkPayload,
} from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource, type SessionListRefresher } from "../sessions.js";
import { createMessageOpsService, registerMessageOpsHandlers } from "../messageOps.js";

// ---------------------------------------------------------------------------
// Test seams (mirrors __tests__/sessions.test.ts scaffolding).

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
  joined(): string {
    return this.lines.join("\n");
  }
}

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

/** Records session-list refreshes: revert/unrevert refresh, others do not. */
class RecordingRefresher implements SessionListRefresher {
  count = 0;
  refresh(): Promise<void> {
    this.count += 1;
    return Promise.resolve();
  }
}

interface RecordedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly body: string | undefined;
}

/**
 * Wrap the base fetch: record every non-GET request's body verbatim, and let
 * the optional saboteur answer selected requests before the real mock.
 */
function wrapFetch(
  saboteur?: (request: RecordedRequest) => Response | undefined,
): { readonly fetchImpl: ProbeFetch; readonly requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const raw: ProbeFetch = (request) => globalThis.fetch(request);
  const fetchImpl: ProbeFetch = async (request) => {
    const url = new URL(request.url);
    const recorded: RecordedRequest = {
      method: request.method,
      pathname: url.pathname,
      body: request.method === "GET" ? undefined : await request.clone().text(),
    };
    requests.push(recorded);
    const sabotaged = saboteur?.(recorded);
    if (sabotaged !== undefined) return sabotaged;
    return raw(request);
  };
  return { fetchImpl, requests };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function connectionFor(url: string, fetchImpl: ProbeFetch): ServerConnection {
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
    fetchImpl,
  });
  return {
    baseUrl: panel.baseUrl,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: FAKE_CAPABILITIES,
  };
}

interface Harness {
  readonly refresher: RecordingRefresher;
  readonly channel: CapturingChannel;
  readonly connection: ServerConnection;
  readonly requests: readonly RecordedRequest[];
  post(type: RequestEnvelope["type"], payload: unknown): string;
  nextReply(messageId: string): Promise<StreamChunkPayload>;
  createSession(title: string): Promise<string>;
}

let messageCounter = 0;

function createHarness(
  url: string,
  saboteur?: (request: RecordedRequest) => Response | undefined,
): Harness {
  const { fetchImpl, requests } = wrapFetch(saboteur);
  const connection = connectionFor(url, fetchImpl);
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const source = staticSessionSource(connection);
  const service = createMessageOpsService({ source, logger });
  const refresher = new RecordingRefresher();

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
  registerMessageOpsHandlers((type, handler) => messenger.register(type, handler), {
    service,
    sync: refresher,
  });

  return {
    refresher,
    channel,
    connection,
    requests,
    post(type, payload) {
      messageCounter += 1;
      const messageId = `mo-${messageCounter}`;
      listener({ messageId, type, payload });
      return messageId;
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
    async createSession(title) {
      const created = await connection.client.session.create({ body: { title } });
      if (created.error !== undefined || created.data === undefined) {
        throw new Error("session create failed in test setup");
      }
      return created.data.id;
    },
  };
}

async function errorText(reply: Promise<StreamChunkPayload>): Promise<string> {
  const settled = await reply;
  expect(settled.status).toBe("error");
  expect(typeof settled.content).toBe("string");
  if (typeof settled.content !== "string") throw new Error("error reply carries no text");
  return settled.content;
}

const REVERT_RE = /^\/session\/[^/]+\/revert$/;
const SUMMARIZE_RE = /^\/session\/[^/]+\/summarize$/;
const SHELL_RE = /^\/session\/[^/]+\/shell$/;

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

describe("message-ops domain handlers", () => {
  it("revert posts the wire messageID verbatim and marks the session reverted", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const id = await harness.createSession("revert target");

    const reply = await harness.nextReply(harness.post("revert", { id, messageID: "msg_target" }));
    expect(reply.status).toBe("success");
    expect(reply.content).toBeNull();

    const posted = harness.requests.find((request) => REVERT_RE.test(request.pathname));
    expect(posted?.method).toBe("POST");
    expect(posted?.body).toBeDefined();
    const body: unknown = JSON.parse(posted?.body ?? "null");
    expect(isRecord(body) && body.messageID === "msg_target").toBe(true);

    // Server truth: the session now carries the reverted marker.
    const gotten = await harness.connection.client.session.get({ path: { id } });
    expect(gotten.data?.revert?.messageID).toBe("msg_target");
    // The session record mutated, so exactly one list refresh broadcast ran.
    expect(harness.refresher.count).toBe(1);
  });

  it("unrevert clears the reverted state", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const id = await harness.createSession("unrevert target");

    await harness.nextReply(harness.post("revert", { id, messageID: "msg_target" }));
    const reply = await harness.nextReply(harness.post("unrevert", { id }));
    expect(reply.status).toBe("success");

    const gotten = await harness.connection.client.session.get({ path: { id } });
    expect(gotten.data?.revert).toBeUndefined();
    expect(harness.refresher.count).toBe(2);
  });

  it("summarize resolves the model from config.get and posts the SDK body", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const id = await harness.createSession("summarize me");

    const reply = await harness.nextReply(harness.post("summarize", { id }));
    expect(reply.status).toBe("success");

    const posted = harness.requests.find((request) => SUMMARIZE_RE.test(request.pathname));
    const body: unknown = JSON.parse(posted?.body ?? "null");
    // The mock /config fixture names "mock-provider/mock-large".
    expect(isRecord(body) && body.providerID === "mock-provider").toBe(true);
    expect(isRecord(body) && body.modelID === "mock-large").toBe(true);
    // No session-record mutation -> no list refresh owed.
    expect(harness.refresher.count).toBe(0);
  });

  it("runShell composes {agent: first advertised primary, command} with no model", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const id = await harness.createSession("shell target");

    const reply = await harness.nextReply(
      harness.post("runShell", { sessionId: id, input: "git status" }),
    );
    expect(reply.status).toBe("success");

    const posted = harness.requests.find((request) => SHELL_RE.test(request.pathname));
    const body: unknown = JSON.parse(posted?.body ?? "null");
    // Mock /agent order: build(primary), plan(primary), general, explore.
    expect(isRecord(body) && body.agent === "build").toBe(true);
    expect(isRecord(body) && body.command === "git status").toBe(true);
    expect(isRecord(body) && "model" in body).toBe(false);
    // The assistant stub output arrives as SSE-driven messages, not here:
    // the reply carries the todo-3 null (nothing fabricated into content).
    expect(reply.content).toBeNull();
    expect(harness.refresher.count).toBe(0);
  });

  it("old-server scenario: all four ops stay available (todo-7 rulings)", async () => {
    mock = await startMockServer(0);
    await mock.setScenario("old-server");
    const harness = createHarness(mock.url);
    const id = await harness.createSession("legacy ops");

    const revert = await harness.nextReply(harness.post("revert", { id, messageID: "msg_x" }));
    expect(revert.status).toBe("success");
    const unrevert = await harness.nextReply(harness.post("unrevert", { id }));
    expect(unrevert.status).toBe("success");
    const summarize = await harness.nextReply(harness.post("summarize", { id }));
    expect(summarize.status).toBe("success");
    const shell = await harness.nextReply(
      harness.post("runShell", { sessionId: id, input: "ls" }),
    );
    expect(shell.status).toBe("success");
  });

  it("omo-agents scenario: the first primary-mode agent still wins (data-driven)", async () => {
    mock = await startMockServer(0);
    await mock.setScenario("omo-agents");
    const harness = createHarness(mock.url);
    const id = await harness.createSession("omo shell");

    const reply = await harness.nextReply(
      harness.post("runShell", { sessionId: id, input: "ls" }),
    );
    expect(reply.status).toBe("success");
    const posted = harness.requests.find((request) => SHELL_RE.test(request.pathname));
    const body: unknown = JSON.parse(posted?.body ?? "null");
    // omo-agents appends sisyphus(primary) AFTER the core build(primary).
    expect(isRecord(body) && body.agent === "build").toBe(true);
  });

  it("a 404 on the revert route becomes the typed unsupported error", async () => {
    mock = await startMockServer(0);
    // Mirrors an old server whose /doc (and routes) predate revert — the
    // mock's own old-server keeps these routes, so the gap is sabotaged at
    // the fetch layer (todo-12 QA-failure precedent).
    const harness = createHarness(mock.url, (request) =>
      REVERT_RE.test(request.pathname)
        ? jsonResponse(404, { name: "NotFoundError", data: { message: "route not found" } })
        : undefined,
    );
    const id = await harness.createSession("404 target");

    const text = await errorText(harness.nextReply(harness.post("revert", { id, messageID: "m" })));
    expect(text).toContain("MessageOpUnsupportedError");
    expect(text).toContain("HTTP 404");
    expect(harness.channel.joined()).toContain("revert failed");
  });

  it("QA failure: revert mocked 500 -> error reply names HTTP 500, warn logged, state untouched", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, (request) =>
      REVERT_RE.test(request.pathname)
        ? jsonResponse(500, { name: "InternalError", data: { message: "boom" } })
        : undefined,
    );
    const id = await harness.createSession("doomed revert");

    const text = await errorText(
      harness.nextReply(harness.post("revert", { id, messageID: "msg_target" })),
    );
    expect(text).toContain("MessageOpError");
    expect(text).toContain("HTTP 500");
    expect(text).toContain("boom");
    expect(harness.channel.joined()).toContain("revert failed: boom (HTTP 500)");

    // No state was marked reverted and no list refresh was broadcast, so the
    // webview's local messages cannot be removed by this op (QA contract).
    const gotten = await harness.connection.client.session.get({ path: { id } });
    expect(gotten.data?.revert).toBeUndefined();
    expect(harness.refresher.count).toBe(0);
  });

  it("runShell with an empty advertised agent list -> ShellAgentUnavailableError, no POST", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, (request) =>
      request.method === "GET" && request.pathname === "/agent" ? jsonResponse(200, []) : undefined,
    );
    const id = await harness.createSession("no agents");

    const text = await errorText(
      harness.nextReply(harness.post("runShell", { sessionId: id, input: "ls" })),
    );
    expect(text).toContain("ShellAgentUnavailableError");
    expect(harness.requests.some((request) => SHELL_RE.test(request.pathname))).toBe(false);
  });

  it("summarize with no configured model -> SummarizeModelUnavailableError, no POST", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, (request) =>
      request.method === "GET" && request.pathname === "/config" ? jsonResponse(200, {}) : undefined,
    );
    const id = await harness.createSession("no model");

    const text = await errorText(harness.nextReply(harness.post("summarize", { id })));
    expect(text).toContain("SummarizeModelUnavailableError");
    expect(harness.requests.some((request) => SUMMARIZE_RE.test(request.pathname))).toBe(false);
  });
});

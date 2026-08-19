// i18n-allow-literal — test fixtures/assertions carry English machine-source
// strings (error names, mock text) — dev-logging domain, not display copy.
/**
 * Answers domain handlers acceptance suite (plan todo 16), run end-to-end
 * through the todo-3 HostMessenger against the todo-5 mock server:
 *
 * - permission-flow happy: prompt blocks on permission.asked; replying
 *   "once" settles the mock's pending request and the replay continues
 *   ("Permission granted, continuing the task." appears in the transcript).
 *   The mock's `pending.settle(response)` IS the recorded response.
 * - question-flow happy: answering settles the pending question; the replay
 *   continues ("Got it, building your choice.").
 * - QA FAILURE: replying after the session finished/aborted => the mock's
 *   pending entry is gone => 404 => typed error reply
 *   (PermissionAnswerError with HTTP 404 => the webview flips the card into
 *   its "expired" state; old servers 404 the question route entirely =>
 *   QuestionUnsupportedError => hide + one toast).
 * - old-server scenario: the question route is `modern()`-gated in the mock,
 *   so any answer => QuestionUnsupportedError typed error.
 *
 * The sync `POST /session/:id/message` route awaits the replay, so each flow
 * starts that request UN-awaited and polls the reply endpoint until the
 * scenario has published its pending request (retry on 404 — the pending id
 * appears only after the scripted first text chunk).
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { HostMessenger, type HostPort } from "../../messenger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import { createPanelClient, type ProbeFetch } from "../../../server/clientFactory.js";
import type { ServerConnection } from "../../../server/ServerManager.js";
import type { Capabilities } from "../../../server/capabilities.js";
import {
  isRecord,
  type HostMessage,
  type RequestEnvelope,
  type StreamChunkPayload,
} from "../../../shared/protocol.js";
import {
  startMockServer,
  type MockServer,
  type ScenarioName,
} from "../../../test/mock-server/index.js";
import {
  createAnswerService,
  registerAnswerHandlers,
  staticAnswerSource,
} from "../answers.js";

// ---------------------------------------------------------------------------
// Test seams (same fakes as the todo-12 sessions suite).

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

interface Harness {
  readonly channel: CapturingChannel;
  post(type: RequestEnvelope["type"], payload: unknown): string;
  nextReply(messageId: string): Promise<StreamChunkPayload>;
}

interface SessionHandle {
  readonly sessionId: string;
  /** Fires the sync message route; resolves with the completed transcript. */
  readonly transcript: Promise<string>;
}

let messageCounter = 0;

function createHarness(connection: ServerConnection): Harness {
  const channel = new CapturingChannel();
  const logger = new PanelLogger(channel, () => true);
  const service = createAnswerService({ source: staticAnswerSource(connection), logger });

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
  registerAnswerHandlers((type, handler) => messenger.register(type, handler), { service });

  return {
    channel,
    post(type, payload) {
      messageCounter += 1;
      const messageId = `m-${messageCounter}`;
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

async function createFlowSession(
  connection: ServerConnection,
  scenario: ScenarioName,
  mock: MockServer,
): Promise<SessionHandle> {
  mock.setScenario(scenario);
  const created = await connection.client.session.create({ body: { title: `flow ${scenario}` } });
  if (created.data === undefined) throw new Error("session create failed");
  const sessionId = created.data.id;
  const transcript = (async (): Promise<string> => {
    const result = await connection.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: "drive the scenario" }] },
    });
    const data = result.data;
    if (data === undefined) throw new Error("prompt route failed");
    const texts: string[] = [];
    for (const part of data.parts) {
      if (part.type === "text") texts.push(part.text);
    }
    return texts.join("");
  })();
  return { sessionId, transcript };
}

/** Retry the reply until the scenario has published its pending request. */
async function answerUntilPublished(
  harness: Harness,
  type: "answerPermission" | "answerQuestion",
  payload: Record<string, unknown>,
): Promise<StreamChunkPayload> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const reply = await harness.nextReply(harness.post(type, payload));
    if (reply.status === "success") return reply;
    // Not-published-yet reads exactly like a defunct request (404); retry.
    const text = typeof reply.content === "string" ? reply.content : "";
    if (!text.includes("HTTP 404")) return reply;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return harness.nextReply(harness.post(type, payload));
}

function assistantTextOf(message: Record<string, unknown>): string {
  if (!isRecord(message.info) || !Array.isArray(message.parts)) return "";
  const texts: string[] = [];
  for (const part of message.parts) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.join("");
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

describe("answers domain handlers (plan todo 16)", () => {
  it("permission-flow: replying 'once' settles the mock's pending permission and the replay continues", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const flow = await createFlowSession(connection, "permission-flow", mock);

    const reply = await answerUntilPublished(harness, "answerPermission", {
      sessionId: flow.sessionId,
      permissionID: "per_1",
      response: "once",
    });
    expect(reply.status).toBe("success");
    expect(reply.done).toBe(true);
    expect(reply.content).toBeNull();

    const transcript = await flow.transcript;
    // Granted path: the mock recorded "once" and continued the task.
    expect(transcript).toContain("Permission granted, continuing the task.");
    expect(transcript).not.toContain("Permission rejected; stopping.");
  });

  it("permission-flow: replying 'reject' takes the rejected branch of the replay", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const flow = await createFlowSession(connection, "permission-flow", mock);

    const reply = await answerUntilPublished(harness, "answerPermission", {
      sessionId: flow.sessionId,
      permissionID: "per_1",
      response: "reject",
    });
    expect(reply.status).toBe("success");

    const transcript = await flow.transcript;
    expect(transcript).toContain("Permission rejected; stopping.");
  });

  it("question-flow: answering settles the pending question and the replay continues", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const flow = await createFlowSession(connection, "question-flow", mock);

    const reply = await answerUntilPublished(harness, "answerQuestion", {
      sessionId: flow.sessionId,
      questionID: "qst_1",
      answers: ["minimal"],
    });
    expect(reply.status).toBe("success");
    expect(reply.content).toBeNull();

    const transcript = await flow.transcript;
    expect(transcript).toContain("Got it, building your choice.");
  });

  it("QA FAILURE: permission reply after abort => 404 => typed PermissionAnswerError (card expires)", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const created = await connection.client.session.create({ body: { title: "aborted flow" } });
    if (created.data === undefined) throw new Error("session create failed");
    const sessionId = created.data.id;
    // Abort with no pending request: the request was defunct server-side.
    await connection.probeFetch(
      new Request(`${mock.url}/session/${sessionId}/abort`, { method: "POST" }),
    );

    const reply = await harness.nextReply(
      harness.post("answerPermission", {
        sessionId,
        permissionID: "per_defunct",
        response: "once",
      }),
    );
    expect(reply.status).toBe("error");
    expect(reply.done).toBe(true);
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("PermissionAnswerError");
    expect(reply.content).toContain("HTTP 404");
  });

  it("QA FAILURE: question reply to a defunct request => typed QuestionUnsupportedError (hide + toast)", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const created = await connection.client.session.create({ body: { title: "defunct question" } });
    if (created.data === undefined) throw new Error("session create failed");
    const sessionId = created.data.id;

    const reply = await harness.nextReply(
      harness.post("answerQuestion", {
        sessionId,
        questionID: "qst_defunct",
        answers: ["minimal"],
      }),
    );
    expect(reply.status).toBe("error");
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("QuestionUnsupportedError");
  });

  it("old-server scenario: the modern-gated question route 404s => QuestionUnsupportedError", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const created = await connection.client.session.create({ body: { title: "legacy" } });
    if (created.data === undefined) throw new Error("session create failed");
    const sessionId = created.data.id;

    const reply = await harness.nextReply(
      harness.post("answerQuestion", {
        sessionId,
        questionID: "qst_anything",
        answers: ["full"],
      }),
    );
    expect(reply.status).toBe("error");
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("QuestionUnsupportedError");
  });

  it("old-server scenario: the permission route is NOT modern-gated => a defunct reply is a plain 404, not unsupported", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const connection = connectionFor(mock.url);
    const harness = createHarness(connection);
    const created = await connection.client.session.create({ body: { title: "legacy permission" } });
    if (created.data === undefined) throw new Error("session create failed");
    const sessionId = created.data.id;

    const reply = await harness.nextReply(
      harness.post("answerPermission", {
        sessionId,
        permissionID: "per_defunct",
        response: "always",
      }),
    );
    expect(reply.status).toBe("error");
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("PermissionAnswerError");
    expect(reply.content).toContain("HTTP 404");
    expect(reply.content).not.toContain("QuestionUnsupportedError");
  });

  it("question reply posts {answers} verbatim to the assumed mirror route", async () => {
    mock = await startMockServer(0);
    const seen: { url: string; method: string; body: string }[] = [];
    const raw: ProbeFetch = (request) => globalThis.fetch(request);
    const tapping: ProbeFetch = async (request) => {
      if (request.url.includes("/questions/")) {
        const clone = request.clone();
        seen.push({ url: request.url, method: request.method, body: await clone.text() });
      }
      return raw(request);
    };
    const connection = connectionFor(mock.url, tapping);
    const harness = createHarness(connection);
    // No flow needed: a defunct reply still exercises the route hit.
    const reply = await harness.nextReply(
      harness.post("answerQuestion", {
        sessionId: "ses_x",
        questionID: "qst_7",
        answers: ["alpha", "beta"],
      }),
    );
    expect(reply.status).toBe("error");
    expect(seen.length).toBe(1);
    const hit = seen[0];
    if (hit === undefined) throw new Error("no question route hit recorded");
    expect(hit.method).toBe("POST");
    expect(new URL(hit.url).pathname).toBe("/session/ses_x/questions/qst_7");
    expect(JSON.parse(hit.body)).toEqual({ answers: ["alpha", "beta"] });
    // sanity for the fixture helper
    expect(assistantTextOf({ info: {}, parts: [{ type: "text", text: "x" }] })).toBe("x");
  });
});

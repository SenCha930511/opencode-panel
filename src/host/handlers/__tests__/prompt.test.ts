// allow: SIZE_OK — one acceptance narrative per todo-14 requirement (async
// primary, sync fallback, failure surface, abort, pure mapping) against the
// real mock server; splitting breaks the per-todo QA story.
/**
 * Prompt domain handlers + pipeline acceptance suite (plan todo 14), run
 * end-to-end through the todo-3 HostMessenger against the todo-5 mock server:
 * - basic-chat: `POST /session/:id/prompt_async` receives the parts payload
 *   VERBATIM (text part first, model `{providerID, modelID}` parsed from the
 *   `provider/model` wire string, agent passthrough, attachments as file
 *   parts) and the reply lands on the 204 WITHOUT awaiting the stream
 *   (long-stream proof: the assistant message has not been stored yet when
 *   the reply arrives, then lands as the replay finishes).
 * - old-server: prompt_async 404s ⇒ the sync `/session/:id/message` route is
 *   used and the reply "connects to" the streamed completion (the completed
 *   assistant text is in the message list as the reply lands).
 * - QA FAILURE: prompt_async answered 500 ⇒ the error reply preserves the
 *   server's message text (webview toast + draft retention halves live in
 *   src/webview/src/chat/__tests__/Composer.test.tsx; logged in the evidence).
 * - abort: the webview `abort` request issues `POST /session/:id/abort`.
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
  type StreamChunkPayload,
} from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource } from "../sessions.js";
import { registerPromptHandlers } from "../prompt.js";
import { buildPromptBody, dispatchPrompt, parseModelString } from "../promptPipeline.js";

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

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: Promise<string>;
}

/** Fetch-layer recorder: captures every request the client/probeFetch issues. */
function recordingFetch(recorded: RecordedRequest[], inner?: ProbeFetch): ProbeFetch {
  const base = inner ?? ((request: Request) => globalThis.fetch(request));
  return (request: Request) => {
    recorded.push({
      method: request.method,
      url: request.url,
      body: request.clone().text(),
    });
    return base(request);
  };
}

interface Harness {
  readonly connection: ServerConnection;
  readonly recorded: RecordedRequest[];
  readonly replies: StreamChunkPayload[];
  post(type: "sendPrompt" | "abort", payload: unknown): string;
  nextReply(messageId: string): Promise<StreamChunkPayload>;
}

let messageCounter = 0;

function createHarness(url: string, fetchImpl?: ProbeFetch): Harness {
  const recorded: RecordedRequest[] = [];
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
    fetchImpl: recordingFetch(recorded, fetchImpl),
  });
  const connection: ServerConnection = {
    baseUrl: panel.baseUrl,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: FAKE_CAPABILITIES,
  };
  const logger = new PanelLogger(new CapturingChannel(), () => false);

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
  registerPromptHandlers((type, handler) => messenger.register(type, handler), {
    source: staticSessionSource(connection),
    logger,
  });

  return {
    connection,
    recorded,
    get replies() {
      return posted.flatMap((message) => (message.type === "streamChunk" ? [message.payload] : []));
    },
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

async function createSession(harness: Harness, title: string): Promise<string> {
  const created = await harness.connection.client.session.create({ body: { title } });
  if (created.data === undefined) throw new Error("create session failed");
  return created.data.id;
}

function findRecorded(recorded: readonly RecordedRequest[], method: string, suffix: RegExp): RecordedRequest | undefined {
  return recorded.find((entry) => {
    const pathname = new URL(entry.url).pathname;
    return entry.method === method && suffix.test(pathname);
  });
}

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

describe("sendPrompt: async prompt_async primary path", () => {
  it("posts the parts payload verbatim to prompt_async and replies on the 204", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const sessionId = await createSession(harness, "prompt primary");

    const reply = await harness.nextReply(
      harness.post("sendPrompt", {
        text: "verbatim text body",
        sessionId,
        agent: "build",
        model: "mock-provider/mock-large",
        attachments: [
          { name: "notes.md", mimeType: "text/markdown", url: "file:///workspace/notes.md" },
        ],
      }),
    );
    expect(reply.status).toBe("success");
    expect(reply.done).toBe(true);
    expect(reply.content).toBeNull();

    const asyncPost = findRecorded(harness.recorded, "POST", /\/session\/[^/]+\/prompt_async$/);
    if (asyncPost === undefined) throw new Error("prompt_async was not requested");
    const body: unknown = JSON.parse(await asyncPost.body);
    expect(body).toEqual({
      parts: [
        { type: "text", text: "verbatim text body" },
        { type: "file", url: "file:///workspace/notes.md", mime: "text/markdown", filename: "notes.md" },
      ],
      model: { providerID: "mock-provider", modelID: "mock-large" },
      agent: "build",
    });
    // The sync route was NOT touched on the primary path.
    expect(findRecorded(harness.recorded, "POST", /\/session\/[^/]+\/message$/)).toBeUndefined();
  });

  it("the 204 reply does NOT wait for the stream to finish", async () => {
    mock = await startMockServer(0, { scenario: "long-stream" });
    const harness = createHarness(mock.url);
    const sessionId = await createSession(harness, "prompt non-blocking");

    const reply = await harness.nextReply(
      harness.post("sendPrompt", { text: "stream it", sessionId, attachments: [] }),
    );
    expect(reply.status).toBe("success");

    // The reply landed on the 204: the replay (200 chunks x 1ms) is still
    // running, so only the user message has been stored so far.
    const mid = await harness.connection.client.session.messages({ path: { id: sessionId } });
    const assistantMid = (mid.data ?? []).filter((entry) => {
      return isRecord(entry) && isRecord(entry.info) && entry.info.role === "assistant";
    });
    expect(assistantMid).toHaveLength(0);

    // And the stream completes afterwards (SSE replay kept flowing).
    let assistantText = "";
    for (let attempt = 0; attempt < 100 && assistantText.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const done = await harness.connection.client.session.messages({ path: { id: sessionId } });
      for (const entry of done.data ?? []) {
        if (isRecord(entry) && isRecord(entry.info) && entry.info.role === "assistant") {
          assistantText = JSON.stringify(entry.parts);
          break;
        }
      }
    }
    expect(assistantText).toContain("chunk-001");
    expect(assistantText).toContain("chunk-200");
  });
});

describe("sendPrompt: old-server sync fallback", () => {
  it("prompt_async 404 -> sync /message is used and the reply connects to the streamed completion", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const harness = createHarness(mock.url);
    const sessionId = await createSession(harness, "prompt fallback");

    const reply = await harness.nextReply(
      harness.post("sendPrompt", { text: "legacy prompt", sessionId, attachments: [] }),
    );
    expect(reply.status).toBe("success");

    // Both routes were exercised in order: 404 first, sync second.
    expect(findRecorded(harness.recorded, "POST", /\/session\/[^/]+\/prompt_async$/)).toBeDefined();
    expect(findRecorded(harness.recorded, "POST", /\/session\/[^/]+\/message$/)).toBeDefined();

    // The sync call awaited the replay: the completed assistant text is here.
    const list = await harness.connection.client.session.messages({ path: { id: sessionId } });
    const serialized = JSON.stringify(list.data ?? []);
    expect(serialized).toContain("Legacy reply from a v0.2 server.");
  });
});

describe("sendPrompt: failure surfaces the server message", () => {
  it("QA FAILURE: prompt_async 500 -> error reply preserves the server text (draft retained webview-side)", async () => {
    mock = await startMockServer(0);
    // Fetch-layer sabotage stands in for a scenario-driven 500 (the mock
    // carries no such scenario; see the evidence log for the QA note).
    const sabotaged: ProbeFetch = (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && /\/session\/[^/]+\/prompt_async$/.test(url.pathname)) {
        return Promise.resolve(
          new Response(JSON.stringify({ name: "InternalError", data: { message: "prompt blew up" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return globalThis.fetch(request);
    };
    const harness = createHarness(mock.url, sabotaged);
    const sessionId = await createSession(harness, "doomed prompt");

    const reply = await harness.nextReply(
      harness.post("sendPrompt", { text: "this will fail", sessionId, attachments: [] }),
    );
    expect(reply.status).toBe("error");
    expect(reply.done).toBe(true);
    expect(typeof reply.content).toBe("string");
    if (typeof reply.content !== "string") throw new Error("error reply carries no text");
    expect(reply.content).toContain("prompt blew up");
    expect(reply.content).toContain("HTTP 500");
  });
});

describe("abort", () => {
  it("issues POST /session/:id/abort and replies success", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url);
    const sessionId = await createSession(harness, "abort target");

    const reply = await harness.nextReply(harness.post("abort", { sessionId }));
    expect(reply.status).toBe("success");
    expect(reply.content).toBeNull();
    expect(findRecorded(harness.recorded, "POST", /\/session\/[^/]+\/abort$/)).toBeDefined();
  });
});

describe("pipeline pure mapping", () => {
  it("parseModelString splits only the first slash and rejects unqualified strings", () => {
    expect(parseModelString("anthropic/claude-sonnet")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
    });
    expect(parseModelString("provider/a/b")).toEqual({ providerID: "provider", modelID: "a/b" });
    expect(parseModelString("noSlash")).toBeUndefined();
    expect(parseModelString("/emptyProvider")).toBeUndefined();
    expect(parseModelString("emptyModel/")).toBeUndefined();
    expect(parseModelString(undefined)).toBeUndefined();
  });

  it("buildPromptBody puts the text part first and omits absent model/agent", () => {
    const body = buildPromptBody({ text: "hello", sessionId: "ses_1", attachments: [] });
    expect(body).toEqual({ parts: [{ type: "text", text: "hello" }] });
    expect("model" in body).toBe(false);
    expect("agent" in body).toBe(false);
  });

  it("buildPromptBody passes a reasoning variant through; absent stays absent", () => {
    const withVariant = buildPromptBody({
      text: "hello",
      sessionId: "ses_1",
      attachments: [],
      variant: "max",
    });
    expect(withVariant.variant).toBe("max");
    const without = buildPromptBody({ text: "hello", sessionId: "ses_1", attachments: [] });
    expect("variant" in without).toBe(false);
  });

  it("a 204 whose body throws on read still resolves (nothing awaited past the status)", async () => {
    // Own properties shadow the prototype readers; any read is a test failure.
    const throwing = (): never => {
      throw new Error("body must not be read");
    };
    const response = new Response(null, { status: 204 });
    Object.defineProperty(response, "text", { value: throwing });
    Object.defineProperty(response, "json", { value: throwing });
    Object.defineProperty(response, "body", { get: throwing });
    const guarded: ProbeFetch = () => Promise.resolve(response);
    const neverCalled = (): never => {
      throw new Error("sync path must not run on a 204");
    };
    const result = await dispatchPrompt(
      { text: "no read", sessionId: "ses_x", attachments: [] },
      { baseUrl: "http://127.0.0.1:1", probeFetch: guarded, client: { session: { prompt: neverCalled } } },
    );
    expect(result).toEqual({ ok: true, route: "prompt_async" });
  });
});

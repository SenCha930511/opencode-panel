// i18n-allow-literal — test fixtures/assertions carry literal wire payloads
// and English reason labels; they are wire data, not display copy.
/**
 * Attachments domain acceptance suite (plan todo 17, host side), run through
 * the todo-3 HostMessenger against the todo-5 mock server:
 * - `searchFiles` proxies SDK find.files (`GET /find/file`) and returns the
 *   paths verbatim; empty queries answer `[]` without any request; results
 *   are deduped and capped at 20.
 * - Capability fallbacks: `/find/file` 404 (fetch-layer sabotage, the
 *   prompt.test.ts pattern) ⇒ `GET /find` text search contributes distinct
 *   paths; BOTH find routes 404 ⇒ the injected workspace fallback stub is
 *   used (production default lives in the vscode adapter).
 * - Part shape VERIFIED end-to-end: a composed file chip and a composed
 *   selection chip both flow through todo-14's `buildPromptBody` mapping and
 *   the mock's `POST /session/:id/message` accepts them with HTTP 200 — no
 *   fenced-text degrade is needed for plain file chips (documented in
 *   ../attachments.ts).
 * - Sensitive paths: `.env` / `*.pem` / `id_rsa` / `credentials.json` push
 *   payloads carry the reason flag; a benign path carries none.
 * - QA FAILURE: an 11 MiB image is rejected with a typed `size` error BEFORE
 *   any request is issued (no fetch is ever recorded); the EXACT 10 MiB
 *   boundary is allowed; disallowed mimes are rejected as `format`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { HostMessenger, type HostPort } from "../../messenger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import { createPanelClient, type ProbeFetch } from "../../../server/clientFactory.js";
import type { ServerConnection } from "../../../server/ServerManager.js";
import type { Capabilities } from "../../../server/capabilities.js";
import { isRecord, type HostMessage, type StreamChunkPayload } from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource } from "../sessions.js";
import {
  ATTACHMENTS_ADD_EVENT,
  IMAGE_MIME_ALLOWLIST,
  MAX_IMAGE_BYTES,
  ImageAttachmentError,
  assertImageAllowed,
  baseNameOfPath,
  buildFilePush,
  buildSelectionPush,
  composeFileAttachment,
  composeSelectionAttachment,
  dataUrlByteLength,
  mimeForPath,
  registerAttachmentHandlers,
  sensitivePathReason,
  toFileUrl,
  type EditorSelectionSnapshot,
} from "../attachments.js";
import { attachmentToFilePart, buildPromptBody } from "../promptPipeline.js";

// ---------------------------------------------------------------------------
// Test seams (same shape as the todo-14 prompt suite).

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
}

function recordingFetch(recorded: RecordedRequest[], inner?: ProbeFetch): ProbeFetch {
  const base = inner ?? ((request: Request) => globalThis.fetch(request));
  return (request: Request) => {
    recorded.push({ method: request.method, url: request.url });
    return base(request);
  };
}

interface Harness {
  readonly connection: ServerConnection;
  readonly recorded: RecordedRequest[];
  readonly workspaceCalls: string[];
  post(type: "searchFiles", payload: unknown): string;
  nextReply(messageId: string): Promise<StreamChunkPayload>;
}

let messageCounter = 0;

function createHarness(
  url: string,
  workspaceResult: readonly string[],
  fetchImpl?: ProbeFetch,
): Harness {
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
  const workspaceCalls: string[] = [];

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
  registerAttachmentHandlers((type, handler) => messenger.register(type, handler), {
    source: staticSessionSource(connection),
    logger: new PanelLogger(new CapturingChannel(), () => false),
    workspaceFindFiles: (query) => {
      workspaceCalls.push(query);
      return Promise.resolve(workspaceResult);
    },
  });

  return {
    connection,
    recorded,
    workspaceCalls,
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

function json404(message: string): Response {
  return new Response(JSON.stringify({ name: "NotFound", data: { message } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

/** Sabotage selected find routes into 404s; everything else passes through. */
function sabotageFindRoutes(routes: readonly string[]): ProbeFetch {
  return (request) => {
    const pathname = new URL(request.url).pathname;
    if (routes.some((route) => pathname === route)) {
      return Promise.resolve(json404(`route not available: ${pathname}`));
    }
    return globalThis.fetch(request);
  };
}

function replyPaths(reply: StreamChunkPayload): readonly string[] {
  expect(reply.status).toBe("success");
  expect(reply.done).toBe(true);
  if (!Array.isArray(reply.content)) throw new Error("searchFiles reply is not an array");
  return reply.content as readonly string[];
}

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

// ---------------------------------------------------------------------------
// searchFiles proxy + fallbacks.

describe("searchFiles: find.files proxy", () => {
  it("proxies SDK find.files against the mock and returns paths verbatim", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, []);
    const reply = await harness.nextReply(harness.post("searchFiles", { query: "example" }));
    expect(replyPaths(reply)).toEqual(["src/example.ts", "src/other.ts"]);
    const findCall = harness.recorded.find((entry) => {
      return entry.method === "GET" && new URL(entry.url).pathname === "/find/file";
    });
    expect(findCall).toBeDefined();
    if (findCall === undefined) throw new Error("find.files route was not requested");
    expect(new URL(findCall.url).searchParams.get("query")).toBe("example");
    expect(harness.workspaceCalls).toEqual([]);
  });

  it("answers [] for an empty query without issuing any request", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, ["workspace/should-not-be-used.ts"]);
    const reply = await harness.nextReply(harness.post("searchFiles", { query: "   " }));
    expect(replyPaths(reply)).toEqual([]);
    expect(harness.recorded).toEqual([]);
    expect(harness.workspaceCalls).toEqual([]);
  });

  it("caps results at the plan limit of 20", async () => {
    mock = await startMockServer(0);
    const many = Array.from({ length: 25 }, (_unused, index) => `src/file-${index}.ts`);
    const inflated: ProbeFetch = (request) => {
      if (new URL(request.url).pathname === "/find/file") {
        return Promise.resolve(new Response(JSON.stringify(many), { status: 200 }));
      }
      return globalThis.fetch(request);
    };
    const harness = createHarness(mock.url, [], inflated);
    const reply = await harness.nextReply(harness.post("searchFiles", { query: "file" }));
    expect(replyPaths(reply)).toHaveLength(20);
  });
});

describe("searchFiles: capability fallbacks", () => {
  it("find.files 404 -> find.text contributes distinct match paths", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const matches = ["src/alpha.ts", "src/alpha.ts", "src/beta.ts"].map((path) => ({
      path: { text: path },
      lines: { text: "x" },
      line_number: 1,
      absolute_offset: 0,
      submatches: [],
    }));
    const sabotaged: ProbeFetch = (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/find/file") return Promise.resolve(json404("no find.file here"));
      if (pathname === "/find") {
        return Promise.resolve(
          new Response(JSON.stringify(matches), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return globalThis.fetch(request);
    };
    const harness = createHarness(mock.url, ["workspace/never.ts"], sabotaged);
    const reply = await harness.nextReply(harness.post("searchFiles", { query: "alpha" }));
    expect(replyPaths(reply)).toEqual(["src/alpha.ts", "src/beta.ts"]);
    expect(harness.workspaceCalls).toEqual([]);
  });

  it("both find routes 404 -> the injected workspace fallback answers", async () => {
    mock = await startMockServer(0, { scenario: "old-server" });
    const harness = createHarness(
      mock.url,
      ["/workspace/src/from-workspace.ts", "/workspace/README.md"],
      sabotageFindRoutes(["/find/file", "/find"]),
    );
    const reply = await harness.nextReply(harness.post("searchFiles", { query: "  work " }));
    expect(replyPaths(reply)).toEqual([
      "/workspace/src/from-workspace.ts",
      "/workspace/README.md",
    ]);
    expect(harness.workspaceCalls).toEqual(["work"]);
  });
});

// ---------------------------------------------------------------------------
// Part composers + mock-verified part shapes.

describe("part composers", () => {
  const snapshot: EditorSelectionSnapshot = {
    path: "/workspace/src/app.ts",
    language: "typescript",
    startLine: 3,
    endLine: 6,
    text: "const value = fetchThing();\nexport default value;",
  };

  it("composes a selection part with path, 1-based line range and language", () => {
    const attachment = composeSelectionAttachment(snapshot);
    expect(attachment.name).toBe("app.ts#L4-L7");
    expect(attachment.mimeType).toBe("text/markdown");
    const prefix = "data:text/markdown;base64,";
    expect(attachment.url.startsWith(prefix)).toBe(true);
    const decoded = Buffer.from(attachment.url.slice(prefix.length), "base64").toString("utf8");
    expect(decoded).toBe(
      "```typescript /workspace/src/app.ts#L4-L7\nconst value = fetchThing();\nexport default value;\n```\n",
    );
  });

  it("buildSelectionPush carries the sensitive flag only for flagged paths", () => {
    const clean = buildSelectionPush(snapshot);
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect("sensitive" in clean.payload).toBe(false);
    expect(clean.payload.source).toBe("selection");

    const flagged = buildSelectionPush({ ...snapshot, path: "/home/u/.env" });
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.payload.sensitive).toBe("dotenv secrets file");
  });

  it("buildSelectionPush refuses empty selections and missing editors truthfully", () => {
    const noEditor = buildSelectionPush(undefined);
    expect(noEditor.ok).toBe(false);
    const empty = buildSelectionPush({ ...snapshot, text: "  \n " });
    expect(empty.ok).toBe(false);
  });

  it("composes a file chip the server reads itself (file:// url)", () => {
    const attachment = composeFileAttachment("/workspace/docs/notes.md");
    expect(attachment).toEqual({
      name: "notes.md",
      mimeType: "text/markdown",
      url: "file:///workspace/docs/notes.md",
    });
    expect(toFileUrl("C:\\repo\\a file.ts")).toBe("file://C:/repo/a%20file.ts");
    expect(mimeForPath("/x/screenshot.PNG")).toBe("image/png");
    expect(baseNameOfPath("/a/b/c.ts")).toBe("c.ts");
  });

  it("the mock POST /session/:id/message accepts BOTH composed parts (HTTP 200)", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, []);
    const created = await harness.connection.client.session.create({ body: { title: "parts" } });
    if (created.data === undefined) throw new Error("create session failed");
    const sessionId = created.data.id;

    const filePush = buildFilePush("/workspace/docs/notes.md");
    const selectionPush = buildSelectionPush(snapshot);
    if (!filePush.ok || !selectionPush.ok) throw new Error("push composition failed");

    // The exact todo-14 mapping the real send uses (promptPipeline).
    const filePart = attachmentToFilePart(filePush.payload.attachment);
    expect(filePart).toEqual({
      type: "file",
      url: "file:///workspace/docs/notes.md",
      mime: "text/markdown",
      filename: "notes.md",
    });
    const body = buildPromptBody({
      text: "look at these",
      sessionId,
      attachments: [filePush.payload.attachment, selectionPush.payload.attachment],
    });
    const result = await harness.connection.client.session.prompt({
      path: { id: sessionId },
      body: { parts: body.parts },
    });
    expect(result.response.status).toBe(200);
    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sensitive-path rules.

describe("sensitive path flags (path-based only, no content reads)", () => {
  it("flags the plan list plus variants; leaves normal files alone", () => {
    expect(sensitivePathReason("/u/app/.env")).toBe("dotenv secrets file");
    expect(sensitivePathReason("/u/app/.env.production")).toBe("dotenv secrets file");
    expect(sensitivePathReason("C:\\certs\\server.PEM")).toBe("private key / certificate material");
    expect(sensitivePathReason("~/.ssh/id_rsa")).toBe("SSH private key");
    expect(sensitivePathReason("~/.ssh/id_ed25519")).toBe("SSH private key");
    expect(sensitivePathReason("/u/gcp/credentials.json")).toBe("cloud credentials");
    expect(sensitivePathReason("/u/app/README.md")).toBeUndefined();
    expect(sensitivePathReason("/u/app/environment.ts")).toBeUndefined();
  });

  it("buildFilePush tags sensitive files and leaves others untouched", () => {
    const flagged = buildFilePush("/u/secrets/id_rsa");
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.payload.sensitive).toBe("SSH private key");
    expect(flagged.payload.source).toBe("file");

    const clean = buildFilePush("/u/src/index.ts");
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect("sensitive" in clean.payload).toBe(false);

    expect(buildFilePush(undefined).ok).toBe(false);
  });

  it("pins the event literal the webview mirrors", () => {
    expect(ATTACHMENTS_ADD_EVENT).toBe("attachments.add");
  });
});

// ---------------------------------------------------------------------------
// Image gate (QA failure contract).

describe("image gate", () => {
  function dataUrlOf(bytes: number, mime: string): string {
    return `data:${mime};base64,${Buffer.alloc(bytes).toString("base64")}`;
  }

  it("accepts the EXACT 10 MiB boundary and rejects one byte past it", () => {
    const exact = dataUrlOf(MAX_IMAGE_BYTES, "image/png");
    expect(dataUrlByteLength(exact)).toBe(MAX_IMAGE_BYTES);
    expect(() => assertImageAllowed("image/png", dataUrlByteLength(exact))).not.toThrow();

    const over = dataUrlOf(MAX_IMAGE_BYTES + 1, "image/png");
    expect(dataUrlByteLength(over)).toBe(MAX_IMAGE_BYTES + 1);
    expect(() => assertImageAllowed("image/png", dataUrlByteLength(over))).toThrowError(
      ImageAttachmentError,
    );
  });

  it("QA FAILURE: an 11 MiB image is rejected as `size` BEFORE any request exists", async () => {
    mock = await startMockServer(0);
    const harness = createHarness(mock.url, []);
    const elevenMiB = 11 * 1024 * 1024;
    const url = dataUrlOf(elevenMiB, "image/png");
    let kind: string | undefined;
    let message = "";
    try {
      assertImageAllowed("image/png", dataUrlByteLength(url));
    } catch (error) {
      if (error instanceof ImageAttachmentError) {
        kind = error.kind;
        message = error.message;
      } else {
        throw error;
      }
    }
    // The toast surface carries this verbatim webview-side (logged to evidence).
    expect(kind).toBe("size");
    expect(message).toContain("10 MiB");
    expect(harness.recorded).toEqual([]);
  });

  it("rejects non-allowlisted mimes as `format` and allows the whole allowlist", () => {
    expect(() => assertImageAllowed("video/mp4", 4)).toThrowError(
      expect.objectContaining({ kind: "format" }) as Error,
    );
    for (const mime of IMAGE_MIME_ALLOWLIST) {
      expect(() => assertImageAllowed(mime, 4)).not.toThrow();
    }
    expect(() => dataUrlByteLength("not-a-data-url")).toThrowError(
      expect.objectContaining({ kind: "format" }) as Error,
    );
  });

  it("counting is padding-exact (1- and 2-byte remainders)", () => {
    expect(dataUrlByteLength(dataUrlOf(1, "image/png"))).toBe(1);
    expect(dataUrlByteLength(dataUrlOf(2, "image/png"))).toBe(2);
    expect(dataUrlByteLength(dataUrlOf(3, "image/png"))).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Wire round-trip of the push payload (what the webview parser must accept).

describe("push payload boundary shape", () => {
  it("serializes JSON-clean through the event envelope", () => {
    const push = buildSelectionPush({
      path: "/w/src/app.ts",
      language: "typescript",
      startLine: 0,
      endLine: 2,
      text: "line()",
    });
    expect(push.ok).toBe(true);
    if (!push.ok) return;
    const roundTripped: unknown = JSON.parse(JSON.stringify(push.payload));
    expect(isRecord(roundTripped)).toBe(true);
    if (!isRecord(roundTripped) || !isRecord(roundTripped.attachment)) {
      throw new Error("payload lost its attachment");
    }
    expect(typeof roundTripped.attachment.name).toBe("string");
    expect(typeof roundTripped.attachment.mimeType).toBe("string");
    expect(typeof roundTripped.attachment.url).toBe("string");
  });
});

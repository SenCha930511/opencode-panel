import { describe, expect, it } from "vitest";
import { HostMessenger } from "../../host/messenger";
import { WebviewMessenger } from "../../webview/lib/messenger";
import {
  RemoteError,
  UnknownMessageIdError,
  UnknownMessageTypeError,
  type HostMessage,
} from "../protocol";

/**
 * Pure-node round-trip suite for the typed messenger protocol: a loopback
 * port pair connects HostMessenger and WebviewMessenger with no VSCode APIs.
 */

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Loopback {
  readonly host: HostMessenger;
  readonly webview: WebviewMessenger;
  readonly hostPosts: readonly HostMessage[];
  readonly emitToHost: (message: unknown) => void;
  readonly emitToWebview: (message: unknown) => void;
}

function createLoopback(): Loopback {
  const posts: HostMessage[] = [];
  let hostListener: (message: unknown) => void = () => {};
  let webviewListener: (message: unknown) => void = () => {};
  const host = new HostMessenger({
    postMessage: (message) => {
      posts.push(message);
      webviewListener(message);
    },
    onMessage: (listener) => {
      hostListener = listener;
    },
  });
  const webview = new WebviewMessenger({
    postMessage: (message) => {
      hostListener(message);
    },
    onMessage: (listener) => {
      webviewListener = listener;
    },
  });
  return {
    host,
    webview,
    hostPosts: posts,
    emitToHost: (message) => {
      hostListener(message);
    },
    emitToWebview: (message) => {
      webviewListener(message);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StreamChunkMessage = Extract<HostMessage, { type: "streamChunk" }>;

function isStreamChunk(message: HostMessage): message is StreamChunkMessage {
  return message.type === "streamChunk";
}

async function settle(): Promise<void> {
  await sleep(0);
  await Promise.resolve();
}

describe("messenger protocol", () => {
  it("correlates concurrent request/response pairs by messageId", async () => {
    const { host, webview } = createLoopback();
    host.register("searchFiles", ({ query }, { messageId }) =>
      // Stagger resolutions so replies arrive out of request order.
      sleep(messageId.endsWith("0") ? 0 : 3).then(() => [`hit:${query}`]),
    );
    host.register("renameSession", async ({ id, title }) => {
      await sleep(2);
      return `${id}=${title}`;
    });

    const pending = Array.from({ length: 8 }, (_, i) => [
      webview.request("searchFiles", { query: `q${i}` }),
      webview.request("renameSession", { id: `s${i}`, title: `t${i}` }),
    ]).flat();

    const results = await Promise.all(pending);
    expect(results).toHaveLength(16);
    expect(results).toContainEqual(["hit:q7"]);
    expect(results).toContain("s3=t3");
    expect(new Set(results).size).toBe(16);
  });

  it("streams >=3 chunks in order, then resolves on the terminal done:true", async () => {
    const { host, webview, hostPosts } = createLoopback();
    host.register("sendPrompt", () => {
      async function* stream(): AsyncGenerator<string, string> {
        yield "chunk-1";
        yield "chunk-2";
        yield "chunk-3";
        yield "chunk-4";
        return "final-content";
      }
      return stream();
    });

    const chunks: unknown[] = [];
    const result = await webview.request(
      "sendPrompt",
      { text: "hi", sessionId: "s1", attachments: [] },
      (chunk) => {
        chunks.push(chunk);
      },
    );

    expect(chunks).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(result).toBe("final-content");

    const envelopes = hostPosts.filter(isStreamChunk);
    expect(envelopes).toHaveLength(5);
    expect(envelopes.slice(0, 4).every((m) => m.payload.done === false)).toBe(true);
    expect(envelopes[4]?.payload).toMatchObject({ status: "success", done: true, content: "final-content" });
  });

  it("throws on unknown message types received by the host", () => {
    const { emitToHost } = createLoopback();
    expect(() => emitToHost({ messageId: "m-1", type: "definitelyNotAType", payload: {} })).toThrow(
      UnknownMessageTypeError,
    );
    // A valid protocol type with no registered handler also throws.
    expect(() => emitToHost({ messageId: "m-2", type: "ready", payload: {} })).toThrow(UnknownMessageTypeError);
  });

  it("rejects a forged streamChunk for an unknown messageId (failure QA)", () => {
    const { emitToWebview } = createLoopback();
    const forged = {
      type: "streamChunk",
      payload: { messageId: "forged-id", status: "success", done: true, content: null },
    };
    let caught: unknown;
    try {
      emitToWebview(forged);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownMessageIdError);
    console.log("[failure-qa] forged streamChunk for unknown messageId threw:", (caught as Error).name);
  });

  it("rejects the request promise when the handler throws", async () => {
    const { host, webview } = createLoopback();
    host.register("createSession", () => {
      throw new Error("boom");
    });
    await expect(webview.request("createSession", {})).rejects.toThrow(RemoteError);
    await expect(webview.request("createSession", {})).rejects.toThrow(/boom/);
  });

  it("never lets a secret value cross to the webview", async () => {
    const { host, webview } = createLoopback();
    host.register("getSecret", () => ({ isSet: true }));
    host.register("setSecret", () => null);
    const status = await webview.request("getSecret", { key: "token" });
    expect(Object.keys(status)).toEqual(["isSet"]);
    expect(status.isSet).toBe(true);
  });

  it("dispose() cancels an infinite stream: generator returns and no done:true is emitted afterwards", async () => {
    const { host, webview, hostPosts } = createLoopback();
    let generatorStopped = false;
    host.register("sendPrompt", () => {
      async function* infinite(): AsyncGenerator<number, void> {
        try {
          let i = 0;
          for (;;) {
            yield i;
            i += 1;
            await sleep(1);
          }
        } finally {
          generatorStopped = true;
        }
      }
      return infinite();
    });

    const firstChunk = deferred<null>();
    let streamMessageId: string | null = null;
    const done = webview.request(
      "sendPrompt",
      { text: "stream forever", sessionId: "s1", attachments: [] },
      () => {
        firstChunk.resolve(null);
      },
    );
    void done.catch(() => {}); // never resolves; silence rejections defensively

    await firstChunk.promise;
    const lastPost = hostPosts.at(-1);
    streamMessageId = lastPost !== undefined && isStreamChunk(lastPost) ? lastPost.payload.messageId : null;
    expect(streamMessageId).not.toBeNull();
    expect(generatorStopped).toBe(false);

    const postsAtDispose = hostPosts.length;
    host.dispose();
    await sleep(25);

    expect(generatorStopped).toBe(true);
    const after = hostPosts.slice(postsAtDispose);
    const stillStreaming = after.filter(
      (m): m is StreamChunkMessage => isStreamChunk(m) && m.payload.messageId === streamMessageId,
    );
    expect(stillStreaming.every((m) => m.payload.done !== true)).toBe(true);
    console.log(
      `[acceptance] dispose() stopped infinite generator; ${String(stillStreaming.length)} envelopes for the disposed stream after dispose, done:true emitted: ${String(
        stillStreaming.some((m) => m.payload.done === true),
      )}`,
    );
    await settle();
  });
});

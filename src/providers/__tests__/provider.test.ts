/**
 * Provider behavior suite (todo 10): init handshake on webview `ready`,
 * init-refresh on server state transitions, HostMessenger domain-handler
 * passthrough, dispose behavior, the `_test` dev recorder, and the honest
 * "no secrets in markup or payload" scan.
 */

import { describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import type { HostMessage } from "../../shared/protocol.js";
import { isRecord } from "../../shared/protocol.js";
import { ChatViewProvider } from "../ChatViewProvider";
import { SessionsViewProvider } from "../SessionsViewProvider";
import { HandlerRegistry } from "../handlers";
import type { ServerManagerState } from "../../server/ServerManager.js";
import {
  FakeEventSource,
  FakeWebviewView,
  fakeUri,
  joinPathFake,
  sampleInitPayload,
} from "./fakes";

class NullChannel implements OutputChannelLike {
  appendLine(_line: string): void {}
}

interface Fixture {
  readonly chat: ChatViewProvider;
  readonly sessions: SessionsViewProvider;
  readonly states: FakeEventSource<ServerManagerState>;
  readonly initBuilds: () => number;
}

function createFixture(devMode = false, payload = sampleInitPayload()): Fixture {
  let builds = 0;
  const handlers = new HandlerRegistry();
  const states = new FakeEventSource<ServerManagerState>();
  const sharedDeps = {
    extensionUri: fakeUri("/ext"),
    joinPath: joinPathFake,
    handlers,
    buildInitPayload: async () => {
      builds += 1;
      return payload;
    },
    onManagerStateChange: states.event,
    devMode,
    logger: new PanelLogger(new NullChannel(), () => false),
  };
  return {
    chat: new ChatViewProvider(sharedDeps),
    sessions: new SessionsViewProvider(sharedDeps),
    states,
    initBuilds: () => builds,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function postedOfType<T extends HostMessage["type"]>(
  view: FakeWebviewView,
  type: T,
): Extract<HostMessage, { type: T }>[] {
  return view.webview.posted.filter(
    (message): message is Extract<HostMessage, { type: T }> =>
      isRecord(message) && message.type === type,
  );
}

describe("init handshake", () => {
  it("posts no init before the webview says ready", async () => {
    const { chat } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    await flush();
    expect(postedOfType(view, "init")).toHaveLength(0);
  });

  it("answers `ready` by posting the full init payload through the messenger", async () => {
    const payload = sampleInitPayload({
      server: { url: "http://172.16.0.1:9999", version: "9.9.9" },
    });
    const { chat } = createFixture(false, payload);
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    // When the webview completes its handshake
    view.webview.incoming.fire({ messageId: "m-ready", type: "ready", payload: {} });
    await flush();
    // Then the init payload went out verbatim (locale/strings/settings/server/capabilities)
    const [init] = postedOfType(view, "init");
    if (init === undefined) throw new Error("init message was not posted");
    expect(init.payload).toEqual(payload);
    // And the todo-3 messenger (not a fork) also answered the ready request
    const [reply] = postedOfType(view, "streamChunk");
    expect(reply?.payload.messageId).toBe("m-ready");
    expect(reply?.payload.done).toBe(true);
    expect(reply?.payload.status).toBe("success");
  });

  it("re-posts init on attach and on server loss, not on probing/stopping", async () => {
    const { chat, states } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    view.webview.incoming.fire({ messageId: "m-ready", type: "ready", payload: {} });
    await flush();
    expect(postedOfType(view, "init")).toHaveLength(1);
    states.fire({ kind: "attached", baseUrl: "http://172.16.0.1:9999" });
    await flush();
    expect(postedOfType(view, "init")).toHaveLength(2);
    states.fire({ kind: "probing", baseUrl: "http://172.16.0.1:9999" });
    states.fire({ kind: "stopping" });
    await flush();
    expect(postedOfType(view, "init")).toHaveLength(2);
    states.fire({ kind: "managed", baseUrl: "http://172.16.0.1:9999" });
    await flush();
    expect(postedOfType(view, "init")).toHaveLength(3);
  });

  it("never carries a credential literal in the init payload or the markup", async () => {
    const { chat } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    view.webview.incoming.fire({ messageId: "m-ready", type: "ready", payload: {} });
    await flush();
    const [init] = postedOfType(view, "init");
    if (init === undefined) throw new Error("init message was not posted");
    // The strings slice is static UI copy shipped in the webview bundle (the
    // `settings.field.serverpassword` entry is a field label, not a secret);
    // the scan guards dynamic host data + the generated markup.
    const { strings: _strings, ...dynamicSlices } = init.payload;
    const scanned = (JSON.stringify(dynamicSlices) + view.webview.html).toLowerCase();
    expect(scanned).not.toContain("password");
  });
});

describe("handler passthrough", () => {
  it("routes domain handlers registered BEFORE resolve through the view messenger", async () => {
    const { sessions } = createFixture();
    sessions.registerHandler("renameSession", ({ id, title }) => {
      expect(id).toBe("s-1");
      return `renamed:${title}`;
    });
    const view = new FakeWebviewView();
    sessions.resolveWebviewView(view, {}, {});
    view.webview.incoming.fire({
      messageId: "m-1",
      type: "renameSession",
      payload: { id: "s-1", title: "Roadmap" },
    });
    await flush();
    const [reply] = postedOfType(view, "streamChunk");
    expect(reply?.payload).toEqual({
      messageId: "m-1",
      status: "success",
      done: true,
      content: "renamed:Roadmap",
    });
  });

  it("routes handlers registered AFTER resolve into the live messenger", async () => {
    const { chat } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    chat.registerHandler("deleteSession", () => null);
    view.webview.incoming.fire({
      messageId: "m-2",
      type: "deleteSession",
      payload: { id: "s-9" },
    });
    await flush();
    const [reply] = postedOfType(view, "streamChunk");
    expect(reply?.payload.messageId).toBe("m-2");
    expect(reply?.payload.status).toBe("success");
  });
});

describe("dev transport recorder (_test hook)", () => {
  it("records every posted message in dev builds", async () => {
    const { chat } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    chat.postEvent("command.newSession", null);
    view.webview.incoming.fire({ messageId: "m-ready", type: "ready", payload: {} });
    await flush();
    const types = chat.getDevPostedMessages().map((message) => message.type);
    expect(types).toEqual(["event", "init", "streamChunk"]);
  });

  it("exposes the same recorder through the `_test` accessor", () => {
    const { chat } = createFixture();
    const hooks: unknown = Reflect.get(chat, "_test");
    expect(isRecord(hooks)).toBe(true);
    if (!isRecord(hooks)) throw new Error("_test hook missing in dev build");
    expect(typeof hooks.getPostedMessages).toBe("function");
  });
});

describe("view lifecycle", () => {
  it("drops posts and ignores state changes after dispose", async () => {
    const { chat, states } = createFixture();
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    view.dispose();
    states.fire({ kind: "managed", baseUrl: "http://172.16.0.1:9999" });
    chat.postEvent("command.newSession", null);
    await flush();
    expect(view.webview.posted).toHaveLength(0);
    expect(states.listenerCount).toBe(0);
  });
});

describe("dev mode shell", () => {
  it("points the shell at the Vite dev server only when devMode is on", () => {
    const { chat } = createFixture(true);
    const view = new FakeWebviewView();
    chat.resolveWebviewView(view, {}, {});
    expect(view.webview.html).toContain("http://localhost:5173/src/main.tsx");
    expect(view.webview.html).toContain("ws://localhost:5173");
  });
});

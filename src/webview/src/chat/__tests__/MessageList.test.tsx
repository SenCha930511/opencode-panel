// i18n-allow-literal — test fixtures/assertions carry literal markdown
// payloads (incl. intentional XSS fixtures) and English fixture strings;
// they are wire data, not display copy routed through t().
/**
 * MessageList (todo 13) acceptance suite — node environment.
 *
 * jsdom/@testing-library are NOT in the install set (npm installs are
 * forbidden this todo), so DOM assertions run against
 * `react-dom/server` static markup and streaming logic against the pure
 * store/router. Fixtures mirror the todo-5 mock shapes verbatim
 * (basic-chat user/assistant, omo-agents `skill_mcp` tool call), and the
 * QA failure fixture lives in "neutralizes XSS markdown".
 */
import { describe, expect, it, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { InitPayload } from "../../../../shared/protocol.js";
import { StringsProvider } from "../../../lib/i18n.js";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { AppProvider } from "../../app/context.js";
import { AutoScrollPark } from "../autoScroll.js";
import { resetActiveSessionForTest, setActiveSession } from "../activeSession.js";
import { routeChatEvent } from "../events.js";
import { MessageStore } from "../messageStore.js";
import { MessageListBody } from "../messageList.js";
import type { MessageVM } from "../types.js";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const INIT: InitPayload = {
  locale: "en",
  strings: {},
  server: { url: "", version: null },
  capabilities: { fork: true, question: true, todo: true },
  settings: {},
};

function fakeMessenger(): WebviewMessenger {
  const port: WebviewPort = {
    postMessage: () => undefined,
    onMessage: () => undefined,
  };
  return new WebviewMessenger(port);
}

// FIX-E: MessageView mounts the todo-19 hover menu, which resolves reporter/
// availability from the app context — the row map therefore renders below
// the same providers production composes (previously provider-free).
function renderMessages(messages: readonly MessageVM[]): string {
  return render(
    <StringsProvider init={INIT}>
      <AppProvider init={INIT} messenger={fakeMessenger()}>
        <MessageListBody messages={messages} />
      </AppProvider>
    </StringsProvider>,
  );
}

// -- fixtures mirroring src/test/mock-server shapes ----------------------------

const SESSION = "ses_1";

function userInfo(id: string): Record<string, unknown> {
  return {
    id,
    sessionID: SESSION,
    role: "user",
    time: { created: 1000 },
    agent: "build",
    model: { providerID: "mock-provider", modelID: "mock-large" },
  };
}

function assistantInfo(id: string, parentID: string): Record<string, unknown> {
  return {
    id,
    sessionID: SESSION,
    role: "assistant",
    time: { created: 1001, completed: 1200 },
    parentID,
    modelID: "mock-large",
    providerID: "mock-provider",
    mode: "build",
    path: { cwd: "/mock/workspace", root: "/mock/workspace" },
    cost: 0,
    tokens: { input: 12, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  };
}

function textPart(id: string, messageID: string, text: string): Record<string, unknown> {
  return {
    id,
    sessionID: SESSION,
    messageID,
    type: "text",
    text,
    time: { start: 1001, end: 1200 },
  };
}

function basicChatMessages(): unknown[] {
  return [
    { info: userInfo("msg_1"), parts: [] },
    {
      info: assistantInfo("msg_2", "msg_1"),
      parts: [textPart("prt_1", "msg_2", "Here is your mock assistant reply. **It renders.**")],
    },
  ];
}

function skillMcpToolMessage(): unknown {
  return {
    info: assistantInfo("msg_3", "msg_2"),
    parts: [
      {
        id: "prt_9",
        sessionID: SESSION,
        messageID: "msg_3",
        type: "tool",
        callID: "call_1",
        tool: "skill_mcp",
        state: {
          status: "completed",
          input: {
            mcp_name: "flux-image-gen",
            tool_name: "generate_image",
            arguments: "{\"prompt\":\"mock\"}",
          },
          output: "generated mock-image.png",
          title: "skill_mcp: generate_image",
          metadata: {},
          time: { start: 1002, end: 1005 },
        },
      },
    ],
  };
}

function textMessage(id: string, text: string): unknown {
  return {
    info: { id, sessionID: SESSION, role: "assistant", time: { created: 1 } },
    parts: [{ id: `${id}_prt`, sessionID: SESSION, messageID: id, type: "text", text }],
  };
}

function storedMessages(store: MessageStore): readonly MessageVM[] {
  return store.getState().messages;
}

beforeEach(() => {
  resetActiveSessionForTest();
});

describe("MessageList rendering", () => {
  it("renders the basic-chat scenario parts", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("Here is your mock assistant reply.");
    expect(html).toContain("<strong>It renders.</strong>");
    expect(html).toContain('data-role="assistant"');
    expect(html).toContain('data-role="user"');
  });

  it("a full sync for a foreign session is dropped — selection re-aligns only via setSession", () => {
    // Given: the store is bound to session A with its messages
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    expect(store.getState().sessionId).toBe(SESSION);

    // When: a sync for another session arrives WITHOUT a selection change
    const other = basicChatMessages().map((raw, index) => ({
      ...(raw as Record<string, unknown>),
      info: {
        ...((raw as { info: Record<string, unknown> }).info),
        id: `other_${index}`,
        sessionID: "ses_other",
      },
    }));
    store.applyFullSync("ses_other", other);

    // Then: it is ignored — the visible conversation can never be yanked away
    expect(store.getState().sessionId).toBe(SESSION);
    expect(store.getState().messages.length).toBeGreaterThan(0);

    // When: the user explicitly selects the other session (useEffect ->
    // setSession path) and THEN its sync lands
    store.setSession("ses_other");
    store.applyFullSync("ses_other", other);

    // Then: the chat follows the authoritative selection
    expect(store.getState().sessionId).toBe("ses_other");
    expect(store.getState().messages.length).toBeGreaterThan(0);
  });

  it("renders an unknown tool name (skill_mcp) without special-casing", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [skillMcpToolMessage()]);
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("skill_mcp");
    expect(html).toContain("skill_mcp: generate_image");
    expect(html).toContain("generated mock-image.png");
    expect(html).toContain("Completed");
  });

  it("renders reasoning collapsed by default", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [
      {
        info: assistantInfo("msg_4", "msg_3"),
        parts: [
          {
            id: "prt_r",
            sessionID: SESSION,
            messageID: "msg_4",
            type: "reasoning",
            text: "weighing the trade-offs\nhidden detail",
          },
        ],
      },
    ]);
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Thinking");
    expect(html).toContain("weighing the trade-offs");
    expect(html).toContain("hidden detail");
  });

  it("renders unknown part types as a JSON card without crashing, while hiding step lifecycle parts", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [
      {
        info: assistantInfo("msg_5", "msg_4"),
        parts: [
          {
            id: "prt_x",
            sessionID: SESSION,
            messageID: "msg_5",
            type: "custom-plugin-data",
            value: "payload-123",
          },
          {
            id: "prt_step",
            sessionID: SESSION,
            messageID: "msg_5",
            type: "step-finish",
            reason: "stop",
          },
        ],
      },
    ]);
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("custom-plugin-data");
    expect(html).toContain("&quot;value&quot;: &quot;payload-123&quot;");
    expect(html).not.toContain("step-finish");
  });

  it("QA FAILURE FIXTURE: neutralizes XSS markdown payloads", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [
      {
        info: assistantInfo("msg_x", "msg_5"),
        parts: [
          textPart("prt_x1", "msg_x", "before <script>alert(1)</script> after"),
          textPart("prt_x2", "msg_x", "x <img src=x onerror=alert(1)> y"),
          textPart("prt_x3", "msg_x", "[click](javascript:alert(1))"),
        ],
      },
    ]);
    const html = renderMessages(storedMessages(store));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});

describe("whitespace placeholders during streaming", () => {
  it("a whitespace-only in-flight placeholder renders (no early-flicker disappearance)", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: SESSION, messageID: "msg_w", partID: "prt_1", field: "text", delta: " " }],
      },
    });
    const html = renderMessages(storedMessages(store));
    // A whitespace-only placeholder part still renders its row
    expect(html).toContain("prose-oc");
    expect(html).toContain('data-in-flight="true"');
  });
});

describe("streaming", () => {
  it("appends 3 in-order deltas into the in-flight part", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [
          { sessionID: SESSION, messageID: "msg_s", partID: "prt_1", field: "text", delta: "alpha " },
          { sessionID: SESSION, messageID: "msg_s", partID: "prt_1", field: "text", delta: "beta " },
          { sessionID: SESSION, messageID: "msg_s", partID: "prt_1", field: "text", delta: "gamma" },
        ],
      },
    });
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("alpha beta gamma");
  });

  it("handles the unbatched message.part.delta fallback identically", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    routeChatEvent(store, {
      type: "message.part.delta",
      payload: { sessionID: SESSION, messageID: "msg_d", partID: "prt_1", field: "text", delta: "raw-" },
    });
    routeChatEvent(store, {
      type: "message.part.delta",
      payload: { sessionID: SESSION, messageID: "msg_d", partID: "prt_1", field: "text", delta: "delta" },
    });
    expect(renderMessages(storedMessages(store))).toContain("raw-delta");
  });

  it("renders out-of-order delta arrival in natural part order", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, []);
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [
          { sessionID: SESSION, messageID: "msg_o", partID: "prt_2", field: "text", delta: "second-chunk" },
          { sessionID: SESSION, messageID: "msg_o", partID: "prt_1", field: "text", delta: "first-chunk" },
        ],
      },
    });
    const html = renderMessages(storedMessages(store));
    const firstAt = html.indexOf("first-chunk");
    const secondAt = html.indexOf("second-chunk");
    expect(firstAt).toBeGreaterThan(-1);
    expect(secondAt).toBeGreaterThan(firstAt);
  });

  it("message.part.updated finalizes a part without losing streamed text", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, []);
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: SESSION, messageID: "msg_f", partID: "prt_1", field: "text", delta: "streamed " }],
      },
    });
    routeChatEvent(store, {
      type: "message.part.updated",
      payload: { part: textPart("prt_1", "msg_f", "streamed text") },
    });
    const html = renderMessages(storedMessages(store));
    expect(html).toContain("streamed text");
    expect(html).not.toContain("streamed streamed");
  });

  it("full sync replaces the list; a stale refetch never duplicates tails", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: SESSION, messageID: "msg_2", partID: "prt_1", field: "text", delta: " tail" }],
      },
    });
    const stale = basicChatMessages();
    store.applyFullSync(SESSION, stale);
    const html = renderMessages(storedMessages(store));
    expect(html).toContain(" tail");
    expect(html.match(/Here is your mock assistant reply\./g)).toHaveLength(1);
  });
});

describe("user-send scroll contract (stop-yank fix)", () => {
  it("passive inserts (message.updated sync) do NOT request a user scroll", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    store.applyFullSync(SESSION, []);
    routeChatEvent(store, {
      type: "message.updated",
      payload: {
        info: { id: "msg_passive", sessionID: SESSION, role: "user", time: { created: 5 } },
      },
    });
    expect(store.takeUserScrollRequest()).toBe(false);
  });

  it("markUserSent arms exactly one scroll request; setSession clears a stray arm", () => {
    const store = new MessageStore();
    store.markUserSent();
    expect(store.takeUserScrollRequest()).toBe(true);
    expect(store.takeUserScrollRequest()).toBe(false);

    store.markUserSent();
    store.setSession("ses_other");
    expect(store.takeUserScrollRequest()).toBe(false);
  });
});

describe("message.updated final info", () => {
  it("adopts the completed info into the in-flight message and clears inFlight", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: SESSION, messageID: "msg_a1", partID: "prt_1", field: "text", delta: "hello " }],
      },
    });
    const before = store.getState().messages.find((m) => m.id === "msg_a1");
    expect(before?.inFlight).toBe(true);
    expect(before?.info.tokens).toBeUndefined();

    routeChatEvent(store, {
      type: "message.updated",
      payload: {
        info: {
          id: "msg_a1",
          sessionID: SESSION,
          role: "assistant",
          finish: "stop",
          time: { created: 1000, completed: 2000 },
          tokens: { input: 10, output: 42, reasoning: 7 },
        },
      },
    });

    const after = store.getState().messages.find((m) => m.id === "msg_a1");
    expect(after?.inFlight).toBe(false);
    expect(after?.info.finish).toBe("stop");
    expect((after?.info.tokens as Record<string, unknown> | undefined)?.output).toBe(42);
    // Streamed text must survive the info merge.
    expect(renderMessages(storedMessages(store))).toContain("hello");
  });

  it("a foreign session's message.updated NEVER touches this store", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: SESSION, messageID: "msg_mine", partID: "prt_1", field: "text", delta: "mine" }],
      },
    });
    routeChatEvent(store, {
      type: "message.updated",
      payload: {
        info: { id: "msg_foreign", sessionID: "ses_foreign", role: "assistant", finish: "stop" },
      },
    });
    expect(store.getState().messages.find((m) => m.id === "msg_foreign")).toBeUndefined();
    expect(renderMessages(storedMessages(store))).not.toContain("foreign");
  });
});

describe("session.status and busy state", () => {
  it("drives busy on session.status and back to idle", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, []);
    expect(store.getState().status).toBe("idle");
    routeChatEvent(store, {
      type: "session.status",
      payload: { sessionID: SESSION, status: { type: "busy" } },
    });
    expect(store.getState().status).toBe("busy");
    routeChatEvent(store, {
      type: "session.status",
      payload: { sessionID: SESSION, status: { type: "idle" } },
    });
    expect(store.getState().status).toBe("idle");
    routeChatEvent(store, { type: "session.idle", payload: { sessionID: SESSION } });
    expect(store.getState().status).toBe("idle");
  });

  it("ignores events for other sessions once bound", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    routeChatEvent(store, {
      type: "message.part.deltaBatch",
      payload: {
        parts: [{ sessionID: "ses_other", messageID: "msg_z", partID: "prt_1", delta: "stray" }],
      },
    });
    expect(renderMessages(storedMessages(store))).not.toContain("stray");
  });
});

describe("large-session delta sync (host >250 merge)", () => {
  it("upserts land in server time order, not at the end of the tail", () => {
    setActiveSession(SESSION);
    const store = new MessageStore();
    // Preload three messages from a "server" with distinct created times.
    const seed = [
      { id: "msg_1", t: 100 },
      { id: "msg_2", t: 200 },
      { id: "msg_3", t: 300 },
    ];
    store.applyFullSync(SESSION, seed.map((entry) => ({
      info: { id: entry.id, sessionID: SESSION, role: "user", time: { created: entry.t } },
      parts: [],
    })));
    // Server inserts msg_new between msg_2 and msg_3 (revert/fork-driven).
    store.applyDeltaSync(SESSION, [
      {
        info: { id: "msg_new", sessionID: SESSION, role: "assistant", time: { created: 250 } },
        parts: [],
      },
    ], []);
    const ids = store.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["msg_1", "msg_2", "msg_new", "msg_3"]);
  });


  it("keyed delta upserts edits and drops removed messages", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, [textMessage("msg_a", "first"), textMessage("msg_b", "second")]);
    routeChatEvent(store, {
      type: "messages.sync",
      payload: {
        kind: "delta",
        sessionId: SESSION,
        upserted: [
          {
            info: { id: "msg_b", sessionID: SESSION, role: "assistant" },
            parts: [{ id: "msg_b_prt", type: "text", text: "second edited" }],
          },
        ],
        removed: ["msg_a"],
      },
    });
    const html = renderMessages(storedMessages(store));
    expect(html).not.toContain("first");
    expect(html).toContain("second edited");
  });
});

describe("active session cleared (deleted sessions)", () => {
  it("setSession(undefined) empties the view so a deleted session cannot linger as busy", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    expect(store.getState().messages.length).toBeGreaterThan(0);

    store.setSession(undefined);
    expect(store.getState().sessionId).toBeUndefined();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().status).toBe("idle");
  });

  it("selecting a fresh session after clearing repopulates from its sync", () => {
    const store = new MessageStore();
    store.applyFullSync(SESSION, basicChatMessages());
    store.setSession(undefined);
    store.setSession("ses_next");
    store.applyFullSync("ses_next", basicChatMessages().map((raw) => ({
      ...(raw as Record<string, unknown>),
      info: { ...((raw as { info: Record<string, unknown> }).info), sessionID: "ses_next" },
    })));
    expect(store.getState().sessionId).toBe("ses_next");
    expect(store.getState().messages.length).toBeGreaterThan(0);
  });
});

describe("AutoScrollPark", () => {
  it("pins to bottom until the user scrolls up; re-bottom re-pins", () => {
    const park = new AutoScrollPark();
    expect(park.isPinned).toBe(true);
    expect(park.followFor(true)).toBe("smooth");
    park.onAtBottomChange(false);
    expect(park.isPinned).toBe(false);
    expect(park.followFor(true)).toBe(false);
    expect(park.followFor(false)).toBe(false);
    park.onAtBottomChange(true);
    expect(park.isPinned).toBe(true);
    expect(park.followFor(true)).toBe("smooth");
  });
});

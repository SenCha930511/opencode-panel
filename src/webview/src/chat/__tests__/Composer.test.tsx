// i18n-allow-literal — test fixtures/assertions carry literal wire payloads
// and English fallback strings; they are wire data, not display copy through t().
// allow: SIZE_OK — one acceptance narrative per todo-14 requirement; the
// suites share harness seams and splitting them breaks the per-todo QA story.
/**
 * Composer (todo 14) acceptance suite — node environment.
 *
 * jsdom is NOT installed, so component assertions run against
 * `react-dom/server` static markup and everything behavioral runs through
 * the DOM-free modules (draftStore / composerLogic) and a REAL
 * WebviewMessenger over a stub port:
 * - draft round-trip per session id (write -> flush -> fresh store reads
 *   back; simulated reload) and per-session isolation
 * - Enter vs Shift+Enter vs Cmd/Ctrl+Enter via shouldSend
 * - send disabled while busy (SSR markup) + Stop visible; stopped/probing
 *   drive textarea-disabled + status placeholder
 * - send posts the payload VERBATIM through the wire (stub port capture)
 *   and keeps the draft on failure (submitPrompt false + error surfaced)
 * - abort during busy invokes the todo-3 abort wire
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { en, type StringId } from "../../../../shared/strings.js";
import { isRecord, type InitPayload } from "../../../../shared/protocol.js";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { StringsProvider } from "../../../lib/i18n.js";
import { AppProvider } from "../../app/context.js";
import { Composer, ChatDock } from "../Composer.js";
import {
  buildPromptPayload,
  composerDisabled,
  placeholderForStatus,
  requestAbort,
  shouldSend,
  submitPrompt,
  type ComposerAttachment,
} from "../composerLogic.js";
import { DRAFTS_STATE_KEY, DraftStore, type WebviewStateLike } from "../draftStore.js";
import { MessageStore } from "../messageStore.js";

// ---------------------------------------------------------------------------
// Seams.

class FakeState implements WebviewStateLike {
  value: unknown = {};
  getState(): unknown {
    return this.value;
  }
  setState(state: unknown): void {
    this.value = state;
  }
}

interface Loopback {
  readonly messenger: WebviewMessenger;
  readonly posted: unknown[];
  emit(message: unknown): void;
}

function createLoopback(): Loopback {
  const posted: unknown[] = [];
  let listener: (message: unknown) => void = () => {
    throw new Error("no listener registered");
  };
  const port: WebviewPort = {
    postMessage: (message) => {
      posted.push(message);
    },
    onMessage: (registered) => {
      listener = registered;
    },
  };
  return { messenger: new WebviewMessenger(port), posted, emit: (m) => { listener(m); } };
}

function initFor(server: { url: string; version: string | null }): InitPayload {
  return {
    locale: "en",
    strings: en,
    server,
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
  };
}

function renderWithProviders(ui: ReactNode, server?: { url: string; version: string | null }): string {
  const init = initFor(server ?? { url: "http://127.0.0.1:9", version: "0.0.0-mock" });
  const { messenger } = createLoopback();
  return renderToStaticMarkup(
    <StringsProvider init={init}>
      <AppProvider init={init} messenger={messenger}>
        {ui}
      </AppProvider>
    </StringsProvider>,
  );
}

function renderComposer(overrides: {
  readonly store?: MessageStore;
  readonly sessionId?: string;
  readonly drafts?: DraftStore;
  readonly server?: { url: string; version: string | null };
}): string {
  const store = overrides.store ?? new MessageStore();
  const drafts = overrides.drafts ?? new DraftStore(new FakeState());
  return renderWithProviders(
    <Composer store={store} drafts={drafts} sessionId={overrides.sessionId ?? "ses_1"} />,
    overrides.server,
  );
}

function busyStore(sessionId: string): MessageStore {
  const store = new MessageStore();
  store.setSession(sessionId);
  store.applySessionStatus(sessionId, "busy");
  return store;
}

interface CapturedEnvelope {
  readonly messageId: string;
  readonly type: string;
  readonly payload: unknown;
}

function captured(posted: readonly unknown[], index = 0): CapturedEnvelope {
  const raw = posted[index];
  if (!isRecord(raw) || typeof raw.messageId !== "string" || typeof raw.type !== "string") {
    throw new Error("no well-formed envelope posted");
  }
  return { messageId: raw.messageId, type: raw.type, payload: raw.payload };
}

// ---------------------------------------------------------------------------
// Pure key handling + payload mapping.

describe("shouldSend", () => {
  const enter = { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false };
  it("Enter sends, Shift+Enter newlines, Cmd/Ctrl+Enter also sends", () => {
    expect(shouldSend(enter)).toBe(true);
    expect(shouldSend({ ...enter, shiftKey: true })).toBe(false);
    expect(shouldSend({ ...enter, metaKey: true })).toBe(true);
    expect(shouldSend({ ...enter, ctrlKey: true })).toBe(true);
    expect(shouldSend({ ...enter, ctrlKey: true, shiftKey: true })).toBe(true);
  });
  it("any other key is plain editing", () => {
    expect(shouldSend({ key: "a", shiftKey: false, metaKey: false, ctrlKey: false })).toBe(false);
    expect(shouldSend({ key: "Enter" , shiftKey: false, metaKey: false, ctrlKey: false })).toBe(true);
  });
});

describe("buildPromptPayload", () => {
  it("maps chips onto wire attachments and omits unset agent/model", () => {
    const chip: ComposerAttachment = {
      id: "chip-1",
      name: "notes.md",
      mimeType: "text/markdown",
      url: "file:///workspace/notes.md",
    };
    expect(buildPromptPayload({ sessionId: "ses_1", text: "hi", attachments: [chip] })).toEqual({
      text: "hi",
      sessionId: "ses_1",
      attachments: [{ name: "notes.md", mimeType: "text/markdown", url: "file:///workspace/notes.md" }],
    });
    // The wire attachment carries no chip id.
    const payload = buildPromptPayload({
      sessionId: "ses_1",
      text: "hi",
      attachments: [chip],
      agent: "build",
      model: "mock-provider/mock-large",
    });
    expect(payload).toEqual({
      text: "hi",
      sessionId: "ses_1",
      attachments: [{ name: "notes.md", mimeType: "text/markdown", url: "file:///workspace/notes.md" }],
      agent: "build",
      model: "mock-provider/mock-large",
    });
  });
});

describe("server status placeholder/disable mapping", () => {
  it("maps every status to a StringId and disable flag", () => {
    const cases: ReadonlyArray<[StringId, "connected" | "probing" | "stopped" | "lost", boolean]> = [
      ["composer.placeholder", "connected", false],
      ["server.status.probing", "probing", true],
      ["server.status.stopped", "stopped", true],
      ["server.status.lost", "lost", true],
    ];
    for (const [expected, status, disabled] of cases) {
      expect(placeholderForStatus(status)).toBe(expected);
      expect(composerDisabled(status)).toBe(disabled);
    }
  });
});

// ---------------------------------------------------------------------------
// DraftStore round-trip.

describe("DraftStore", () => {
  it("round-trips drafts per session id across a simulated reload", () => {
    const state = new FakeState();
    const store = new DraftStore(state);
    store.write("ses_1", "draft for one");
    store.write("ses_2", "draft for two\nmulti-line");
    store.flush();

    // Fresh instance over the same state object = webview reload.
    const reloaded = new DraftStore(state);
    expect(reloaded.read("ses_1")).toBe("draft for one");
    expect(reloaded.read("ses_2")).toBe("draft for two\nmulti-line");
    expect(reloaded.read("ses_3")).toBe("");
  });

  it("debounces the persist (no state write before flush) and preserves foreign top-level keys", () => {
    const state = new FakeState();
    state.value = { selectedId: "ses_9", filter: "fix" };
    const store = new DraftStore(state, { debounceMs: 10_000 });
    store.write("ses_1", "pending");
    expect(state.value).toEqual({ selectedId: "ses_9", filter: "fix" });
    store.flush();
    expect(state.value).toEqual({
      selectedId: "ses_9",
      filter: "fix",
      [DRAFTS_STATE_KEY]: { ses_1: "pending" },
    });
    // And the todo-12 shape still parses around our key.
    const record = state.value;
    expect(typeof record === "object" && record !== null && "selectedId" in record).toBe(true);
  });

  it("clear removes the key and an empty write behaves like clear", () => {
    const state = new FakeState();
    const store = new DraftStore(state);
    store.write("ses_1", "to clear");
    store.flush();
    store.clear("ses_1");
    expect(store.read("ses_1")).toBe("");
    store.write("ses_2", "x");
    store.write("ses_2", "");
    store.flush();
    const reloaded = new DraftStore(state);
    expect(reloaded.read("ses_2")).toBe("");
    expect(reloaded.read("ses_1")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// SSR component states.

describe("Composer rendering", () => {
  it("idle + connected renders an enabled composer with the t() placeholder", () => {
    const html = renderComposer({});
    expect(html).toContain("data-oc-composer");
    expect(html).toContain("data-oc-composer-send");
    expect(html).not.toContain("data-oc-composer-stop");
    expect(html).toContain("Enter to send, Shift+Enter for a new line");
  });

  it("busy renders Send DISABLED plus the Stop button", () => {
    const html = renderComposer({ store: busyStore("ses_1") });
    expect(/data-oc-composer-send[^>]*disabled/.test(html)).toBe(true);
    expect(html).toContain("data-oc-composer-stop");
    expect(html).toContain("Stop generating");
  });

  it("stopped server disables the textarea with the status placeholder", () => {
    const html = renderComposer({ server: { url: "", version: null } });
    expect(/<textarea[^>]*disabled/.test(html)).toBe(true);
    expect(html).toContain('placeholder="Server stopped"');
  });

  it("probing server disables with the probing placeholder", () => {
    const html = renderComposer({ server: { url: "http://127.0.0.1:9", version: null } });
    expect(/<textarea[^>]*disabled/.test(html)).toBe(true);
    expect(html).toContain("Connecting to server");
  });

  it("restores the session draft into the textarea on mount", () => {
    const state = new FakeState();
    const drafts = new DraftStore(state);
    drafts.write("ses_1", "restored draft body");
    drafts.flush();
    const html = renderComposer({ drafts });
    expect(html).toContain("restored draft body");
  });

  it("renders staged attachment chips through the default renderer", () => {
    const html = renderWithProviders(
      <Composer
        store={new MessageStore()}
        drafts={new DraftStore(new FakeState())}
        sessionId="ses_1"
        attachments={[{ id: "c1", name: "notes.md", mimeType: "text/markdown", url: "file:///n.md" }]}
        onRemoveAttachment={() => undefined}
      />,
    );
    expect(html).toContain("data-oc-attachments");
    expect(html).toContain("notes.md");
  });

  it("ChatDock mounts MessageList + Composer against one store", () => {
    const init = initFor({ url: "http://127.0.0.1:9", version: "0.0.0-mock" });
    const { messenger } = createLoopback();
    const html = renderToStaticMarkup(
      <StringsProvider init={init}>
        <AppProvider init={init} messenger={messenger}>
          <ChatDock composer={{ drafts: new DraftStore(new FakeState()) }} />
        </AppProvider>
      </StringsProvider>,
    );
    expect(html).toContain("data-oc-composer");
    expect(html).toContain("No messages yet");
  });
});

// ---------------------------------------------------------------------------
// Wire round-trips through a real WebviewMessenger over a stub port.

describe("wire round-trips", () => {
  it("send posts the payload VERBATIM and resolves true on the success reply", async () => {
    const loop = createLoopback();
    const errors: string[] = [];
    const payload = buildPromptPayload({
      sessionId: "ses_1",
      text: "verbatim body\nline two",
      attachments: [{ id: "c1", name: "a.txt", mimeType: "text/plain", url: "file:///a.txt" }],
      agent: "build",
      model: "mock-provider/mock-large",
    });
    const pending = submitPrompt(loop.messenger, payload, (message) => errors.push(message));

    const envelope = captured(loop.posted);
    expect(envelope.type).toBe("sendPrompt");
    expect(envelope.payload).toEqual({
      text: "verbatim body\nline two",
      sessionId: "ses_1",
      attachments: [{ name: "a.txt", mimeType: "text/plain", url: "file:///a.txt" }],
      agent: "build",
      model: "mock-provider/mock-large",
    });

    loop.emit({
      type: "streamChunk",
      payload: { messageId: envelope.messageId, status: "success", done: true, content: null },
    });
    expect(await pending).toBe(true);
    expect(errors).toEqual([]);
  });

  it("failure folds to false + reports the error text (draft stays: the caller never clears on false)", async () => {
    const loop = createLoopback();
    const errors: string[] = [];
    const payload = buildPromptPayload({ sessionId: "ses_1", text: "keep me", attachments: [] });
    const pending = submitPrompt(loop.messenger, payload, (message) => errors.push(message));

    const envelope = captured(loop.posted);
    loop.emit({
      type: "streamChunk",
      payload: {
        messageId: envelope.messageId,
        status: "error",
        done: true,
        content: "PromptDispatchError: sendPrompt failed: prompt blown (HTTP 500)",
      },
    });
    expect(await pending).toBe(false);
    expect(errors).toEqual(["PromptDispatchError: sendPrompt failed: prompt blown (HTTP 500)"]);
  });

  it("abort during busy invokes the abort wire with the session id", async () => {
    const loop = createLoopback();
    const errors: string[] = [];
    const pending = requestAbort(loop.messenger, { sessionId: "ses_1" }, (message) => errors.push(message));

    const envelope = captured(loop.posted);
    expect(envelope.type).toBe("abort");
    expect(envelope.payload).toEqual({ sessionId: "ses_1" });

    loop.emit({
      type: "streamChunk",
      payload: { messageId: envelope.messageId, status: "success", done: true, content: null },
    });
    expect(await pending).toBe(true);
    expect(errors).toEqual([]);
  });
});

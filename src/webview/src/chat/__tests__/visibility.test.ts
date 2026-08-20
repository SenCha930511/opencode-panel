// i18n-allow-literal — fixtures quote OMO's injected wire text verbatim
// (directive prefixes, background-task notices, reminder tags) — wire data,
// not display copy routed through t().
/**
 * Chat visibility suite: the injection filter (OMO/system text the panel
 * never renders, per the oh-my-openagent dist shapes + the SDK `synthetic`
 * flag) and the revert-marker cut, both at the pure level and through the
 * MessageStore raw/visible split.
 */

import { describe, expect, it } from "vitest";

import { MessageStore } from "../messageStore.js";
import type { MessageVM, PartVM } from "../types.js";
import { isInjectedUserText, stripHiddenParts, visibleMessages } from "../visibility.js";

// ---------------------------------------------------------------------------
// Fixtures.

function textPart(id: string, text: string, synthetic = false): PartVM {
  return { kind: "text", id, text, ...(synthetic ? { synthetic } : {}) };
}

function filePart(id: string): PartVM {
  return { kind: "file", id, filename: "notes.md", url: "file:///notes.md", mime: "text/markdown" };
}

function message(id: string, role: "user" | "assistant", parts: PartVM[]): MessageVM {
  return { id, sessionID: "ses_1", role, info: {}, inFlight: false, parts };
}

/** server-payload shape for a full sync: {info, parts} envelopes. */
function syncPayload(entries: Array<{ id: string; role: string; parts: unknown[] }>): unknown[] {
  return entries.map((entry) => ({
    info: { id: entry.id, sessionID: "ses_1", role: entry.role },
    parts: entry.parts,
  }));
}

const DIRECTIVE_USER = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\nIncomplete tasks";
const BACKGROUND_NOTICE = "[ALL BACKGROUND TASKS FINISHED]\nResult: bg_42 done";

// ---------------------------------------------------------------------------
// Pure predicates.

describe("isInjectedUserText", () => {
  it("catches the OMO directive family, background notices, reminders, and the initiator marker", () => {
    expect(isInjectedUserText(DIRECTIVE_USER)).toBe(true);
    expect(isInjectedUserText("[BACKGROUND TASK COMPLETED]\nmore")).toBe(true);
    expect(isInjectedUserText(`  ${BACKGROUND_NOTICE}`)).toBe(true); // leading ws tolerated
    expect(isInjectedUserText("<system-reminder>Background task bg_1 completed.</system-reminder>")).toBe(true);
    expect(isInjectedUserText("prefix\n<!-- OMO_INTERNAL_INITIATOR -->")).toBe(true);
  });

  it("leaves real user-authored text alone", () => {
    expect(isInjectedUserText("fix the parser")).toBe(false);
    expect(isInjectedUserText("/init docs")).toBe(false);
    // Mentioned mid-sentence (not the prefix) is a conversation, not an injection.
    expect(isInjectedUserText('what does "[SYSTEM DIRECTIVE: OH-MY-OPENCODE" mean?')).toBe(false);
  });
});

describe("stripHiddenParts", () => {
  it("drops synthetic parts for ANY role (the opencode hide-from-display flag)", () => {
    const injected = message("m1", "assistant", [
      textPart("m1:a", "visible answer"),
      textPart("m1:b", "injected context", true),
    ]);
    const stripped = stripHiddenParts(injected);
    expect(stripped?.parts.map((part) => part.id)).toEqual(["m1:a"]);
  });

  it("drops directive-shaped USER text but keeps identical ASSISTANT prose", () => {
    expect(stripHiddenParts(message("m2", "user", [textPart("m2:a", DIRECTIVE_USER)]))).toBeUndefined();
    const quoted = message("m3", "assistant", [textPart("m3:a", DIRECTIVE_USER)]);
    expect(stripHiddenParts(quoted)).toBe(quoted);
  });

  it("keeps a message that still has visible parts, drops one reduced to none", () => {
    const withFile = message("m4", "user", [filePart("m4:a"), textPart("m4:b", DIRECTIVE_USER)]);
    expect(stripHiddenParts(withFile)?.parts.map((part) => part.id)).toEqual(["m4:a"]);
    expect(
      stripHiddenParts(message("m5", "user", [textPart("m5:a", BACKGROUND_NOTICE)])),
    ).toBeUndefined();
  });

  it("never invents an empty bubble for genuinely part-less messages", () => {
    const bare = message("m6", "user", []);
    expect(stripHiddenParts(bare)).toBe(bare);
  });
});

describe("visibleMessages revert cut", () => {
  const list = [
    message("m1", "user", [textPart("m1:a", "one")]),
    message("m2", "assistant", [textPart("m2:a", "reply one")]),
    message("m3", "user", [textPart("m3:a", "two")]),
    message("m4", "assistant", [textPart("m4:a", "reply two")]),
  ];

  it("keeps everything up to and including the marker; drops all below", () => {
    const visible = visibleMessages(list, "m2");
    expect(visible.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("no marker no cut; an unknown marker id is a safe no-op", () => {
    expect(visibleMessages(list)).toHaveLength(4);
    expect(visibleMessages(list, "msg_gone")).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Store level: raw stays whole; only the published view is filtered.

describe("MessageStore visibility", () => {
  it("full sync hides injected content from the published list", () => {
    const store = new MessageStore();
    store.applyFullSync(
      "ses_1",
      syncPayload([
        { id: "m1", role: "user", parts: [{ type: "text", id: "m1:p", text: "real ask" }] },
        { id: "m2", role: "user", parts: [{ type: "text", id: "m2:p", text: DIRECTIVE_USER }] },
        {
          id: "m3",
          role: "assistant",
          parts: [
            { type: "text", id: "m3:p1", text: "answer" },
            { type: "text", id: "m3:p2", text: "injected tail", synthetic: true },
          ],
        },
      ]),
    );
    const visible = store.getState().messages;
    expect(visible.map((entry) => entry.id)).toEqual(["m1", "m3"]);
    const assistant = visible.find((entry) => entry.id === "m3");
    expect(assistant?.parts.map((part) => part.id)).toEqual(["m3:p1"]);
  });

  it("applyReverted cuts below the marker; re-sync from the server keeps the cut", () => {
    const store = new MessageStore();
    const full = syncPayload([
      { id: "m1", role: "user", parts: [{ type: "text", id: "m1:p", text: "first" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", id: "m2:p", text: "reply" }] },
      { id: "m3", role: "user", parts: [{ type: "text", id: "m3:p", text: "second" }] },
      { id: "m4", role: "assistant", parts: [{ type: "text", id: "m4:p", text: "reply two" }] },
    ]);
    store.applyFullSync("ses_1", full);
    store.applyReverted("m2");
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    // The server still holds the tail (revert is a marker, not a delete): the
    // next sync must NOT resurrect it.
    store.applyFullSync("ses_1", full);
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("clearReverted restores the tail from raw without any refetch", () => {
    const store = new MessageStore();
    store.applyFullSync(
      "ses_1",
      syncPayload([
        { id: "m1", role: "user", parts: [{ type: "text", id: "m1:p", text: "first" }] },
        { id: "m2", role: "assistant", parts: [{ type: "text", id: "m2:p", text: "reply" }] },
      ]),
    );
    store.applyReverted("m1");
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m1"]);
    store.clearReverted();
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("the marker is per-session: a session switch never bleeds it across", () => {
    const store = new MessageStore();
    const sesOne = syncPayload([
      { id: "m1", role: "user", parts: [{ type: "text", id: "m1:p", text: "first" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", id: "m2:p", text: "reply" }] },
    ]);
    store.applyFullSync("ses_1", sesOne);
    store.applyReverted("m1");

    store.setSession("ses_2");
    store.applyFullSync(
      "ses_2",
      syncPayload([
        { id: "n1", role: "user", parts: [{ type: "text", id: "n1:p", text: "other" }] },
        { id: "n2", role: "assistant", parts: [{ type: "text", id: "n2:p", text: "other reply" }] },
      ]),
    );
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["n1", "n2"]);

    // Back on ses_1 the stored marker still applies to the next sync.
    store.setSession("ses_1");
    store.applyFullSync("ses_1", sesOne);
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("a stale revert marker id degrades to no cut instead of losing the list", () => {
    const store = new MessageStore();
    store.applyFullSync(
      "ses_1",
      syncPayload([
        { id: "m1", role: "user", parts: [{ type: "text", id: "m1:p", text: "first" }] },
      ]),
    );
    store.applyReverted("m1");
    store.applyFullSync(
      "ses_1",
      syncPayload([
        { id: "m9", role: "user", parts: [{ type: "text", id: "m9:p", text: "replaced" }] },
      ]),
    );
    expect(store.getState().messages.map((entry) => entry.id)).toEqual(["m9"]);
  });
});

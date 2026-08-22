// i18n-allow-literal — fixtures carry literal message text; they are data,
// not display copy through t().
/**
 * Sticky-prompt suite: the pure anchor rules (scroll-back absorb + previous
 * prompt switch) and the bar's SSR surface. The anchor is index-driven so
 * Virtuoso's rangeChanged feeding it stays a thin seam.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { stickyUserMessage, StickyPromptBar, type StickyAnchor } from "../stickyPromptBar.js";
import type { MessageVM, PartVM } from "../types.js";

function textPart(id: string, text: string): PartVM {
  return { kind: "text", id, text };
}

function message(id: string, role: "user" | "assistant", text: string, inFlight = false): MessageVM {
  return {
    id,
    sessionID: "ses_1",
    role,
    info: {},
    inFlight,
    parts: [textPart(`${id}:p`, text)],
  };
}

const LIST = [
  message("m1", "user", "first ask"),
  message("m2", "assistant", "reply one"),
  message("m3", "user", "second ask\nwith a newline"),
  message("m4", "assistant", "reply two"),
  message("m5", "assistant", "reply two continued"),
];

describe("stickyUserMessage", () => {
  it("no anchor when viewing a user message at the top", () => {
    // m1 is a user message visible at the top itself — nothing pinned
    expect(stickyUserMessage(LIST, 0)).toBeUndefined();
    // m3 is a user message at the top (定點) — shows original text in place
    expect(stickyUserMessage(LIST, 2)).toBeUndefined();
  });

  it("anchors the closest user message above the first visible row", () => {
    // viewing m2 (assistant reply to m1) -> pins m1
    expect(stickyUserMessage(LIST, 1)).toEqual({ index: 0, messageId: "m1", text: "first ask" });
    // viewing m4 / m5 (assistant reply to m3) -> pins m3
    expect(stickyUserMessage(LIST, 3)).toEqual({ index: 2, messageId: "m3", text: "second ask\nwith a newline" });
    expect(stickyUserMessage(LIST, 4)).toEqual({ index: 2, messageId: "m3", text: "second ask\nwith a newline" });
  });

  it("switches to the previous prompt once scrolling further up past the user message", () => {
    // firstVisible 1 = assistant reply to m1 — pins m1
    expect(stickyUserMessage(LIST, 1)).toEqual({ index: 0, messageId: "m1", text: "first ask" });
  });

  it("skips text-free user placeholder rows", () => {
    const ragged = [
      message("m1", "user", "real ask"),
      { ...message("m2", "user", ""), parts: [] },
      { ...message("m3", "user", ""), parts: [] },
    ];
    expect(stickyUserMessage(ragged, 3)).toEqual({ index: 0, messageId: "m1", text: "real ask" });
  });

  it("preserves full multi-line prompt text without flattening newlines", () => {
    const anchor = stickyUserMessage(LIST, 3);
    expect(anchor?.text).toBe("second ask\nwith a newline");
  });
});

describe("StickyPromptBar", () => {
  const anchor: StickyAnchor = { index: 2, messageId: "m3", text: "second ask" };

  it("renders the anchored text inside the floating card", () => {
    const html = renderToStaticMarkup(<StickyPromptBar anchor={anchor} onJump={() => {}} />);
    expect(html).toContain("data-oc-sticky-prompt");
    expect(html).toContain("second ask");
    expect(html).toContain("absolute inset-x-0 top-0");
  });
});

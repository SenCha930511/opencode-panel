// i18n-allow-literal — fixtures carry literal message text; they are data,
// not display copy through t().
/**
 * Sticky-prompt suite: the pure anchor rules (scroll-back absorb + previous
 * prompt switch) and the bar's SSR surface. The anchor is index-driven so
 * Virtuoso's rangeChanged feeding it stays a thin seam.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { stickyUserMessage, StickyPromptBar, type StickyAnchor } from "../StickyPromptBar.js";
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
  it("no anchor while the first visible row is the list start", () => {
    expect(stickyUserMessage(LIST, 0)).toBeUndefined();
    // m1 is visible at the top itself — nothing above to pin.
    expect(stickyUserMessage(LIST, 1)).toBeUndefined();
  });

  it("anchors the closest user message above the first visible row", () => {
    expect(stickyUserMessage(LIST, 3)).toEqual({ index: 2, messageId: "m3", text: "second ask with a newline" });
    expect(stickyUserMessage(LIST, 5)).toEqual({ index: 2, messageId: "m3", text: "second ask with a newline" });
  });

  it("switches to the previous prompt once the first visible row climbs past this one (merge rule)", () => {
    // firstVisible 2 = m3 itself is at the top — the bar MERGES (no anchor
    // on/above it); the previous user message m1 takes over.
    expect(stickyUserMessage(LIST, 2)).toEqual({ index: 0, messageId: "m1", text: "first ask" });
  });

  it("skips in-flight placeholders and text-free user rows", () => {
    const ragged = [
      message("m1", "user", "real ask"),
      { ...message("m2", "user", ""), parts: [] },
      message("m3", "user", "streaming", true),
    ];
    expect(stickyUserMessage(ragged, 3)).toEqual({ index: 0, messageId: "m1", text: "real ask" });
  });

  it("collapses whitespace runs so multi-line prompts pin as one line", () => {
    const anchor = stickyUserMessage(LIST, 3);
    expect(anchor?.text.includes("\n")).toBe(false);
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

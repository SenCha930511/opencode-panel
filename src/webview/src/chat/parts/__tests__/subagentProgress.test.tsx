// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (reasoning text, tool names) and English table lookups; they are wire
// payloads, not display copy routed through t().
/**
 * SubagentToolCard live-progress suite:
 * - subagentProgressLine maps each phase to the one-line headline rendered
 *   under the card header while the subagent runs (tool⚡/thinking🧠/writing💬)
 * - the card's initial render (progress not yet polled in) carries NO progress
 *   box or headline — the live rows appear only once a reply lands
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { en, type StringId } from "../../../../../shared/strings.js";
import type { SubagentProgress } from "../../../../../shared/protocol.js";
import type { PartVM } from "../../types.js";
import { GenericToolCard, subagentProgressLine } from "../toolPartView.js";

type ToolPart = Extract<PartVM, { kind: "tool" }>;

const t = (id: StringId): string => en[id];

function progress(overrides: Partial<SubagentProgress>): SubagentProgress {
  return { phase: "idle", thinking: "", thinkingTruncated: false, ...overrides };
}

describe("subagentProgressLine", () => {
  it("undefined progress renders no line at all", () => {
    expect(subagentProgressLine(undefined, t)).toBeUndefined();
  });

  it("tool phase headlines the tool summary (or its name)", () => {
    expect(
      subagentProgressLine(
        progress({ phase: "tool", toolName: "bash", toolSummary: "npm run build" }),
        t,
      ),
    ).toEqual({ icon: "⚡", text: "npm run build" });
    expect(subagentProgressLine(progress({ phase: "tool", toolName: "grep" }), t)).toEqual({
      icon: "⚡",
      text: "grep",
    });
  });

  it("thinking phase headlines the first non-blank reasoning line", () => {
    expect(
      subagentProgressLine(
        progress({ phase: "thinking", thinking: "\n\nfirst useful line\nsecond line" }),
        t,
      ),
    ).toEqual({ icon: "🧠", text: "first useful line" });
  });

  it("writing phase falls back to the localized writing caption", () => {
    expect(subagentProgressLine(progress({ phase: "writing" }), t)).toEqual({
      icon: "💬",
      text: en["subagent.writingReply"],
    });
  });

  it("idle phase renders nothing", () => {
    expect(subagentProgressLine(progress({}), t)).toBeUndefined();
  });
});

describe("SubagentToolCard initial render", () => {
  function taskPart(status: "running" | "completed"): ToolPart {
    return {
      kind: "tool",
      id: "prt_1",
      tool: "task",
      callID: "call_1",
      status,
      title: "explore the codebase",
      input: { description: "explore the codebase", agent: "explore" },
      output: undefined,
      error: undefined,
      raw: { sessionID: "ses_parent" },
    };
  }

  it("a running task shows the agent chip, title, and pulse — but no progress yet", () => {
    const html = renderToStaticMarkup(<GenericToolCard part={taskPart("running")} />);
    expect(html).toContain("[explore]");
    expect(html).toContain("explore the codebase");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain(en["subagent.currentProgress"]);
    expect(html).not.toContain(en["subagent.thinkingLabel"]);
  });

  it("a completed task shows the finished caption and no live indicator", () => {
    const html = renderToStaticMarkup(<GenericToolCard part={taskPart("completed")} />);
    expect(html).toContain(en["subagent.statusFinished"]);
    expect(html).not.toContain(en["subagent.currentProgress"]);
  });
});

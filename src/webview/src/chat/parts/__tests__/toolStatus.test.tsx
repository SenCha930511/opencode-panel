// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (tool names, filediff metadata shapes) and English fallback strings; they
// are wire payloads, not display copy routed through t().
/**
 * GenericToolCard terminal-status suite: finished tools headline a status
 * GLYPH (completed ✓ / failed ✗ — the localized word survives on the
 * aria-label), and a completed tool whose `state.metadata.filediff` carries
 * counters shows +adds/−dels in place of the glyph (data-driven, any tool
 * name). Running keeps the pulse; pending falls back to its label.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { PartVM, ToolStatus } from "../../types.js";
import { GenericToolCard, readFileDiffStat } from "../toolPartView.js";

type ToolPart = Extract<PartVM, { kind: "tool" }>;

function toolPart(overrides: {
  readonly status?: ToolStatus;
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly output?: string;
}): ToolPart {
  return {
    kind: "tool",
    id: "prt_1",
    tool: "bash",
    callID: "call_1",
    status: overrides.status ?? "completed",
    title: "ls -la",
    input: {},
    output: overrides.output,
    error: undefined,
    raw: overrides.raw ?? {},
  };
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function filediffRaw(additions: number, deletions: number): Readonly<Record<string, unknown>> {
  return {
    type: "tool",
    state: {
      status: "completed",
      metadata: { filediff: { file: "src/a.ts", additions, deletions } },
    },
  };
}

describe("readFileDiffStat", () => {
  it("reads additions/deletions out of state.metadata.filediff", () => {
    expect(readFileDiffStat(filediffRaw(12, 4))).toEqual({ additions: 12, deletions: 4 });
  });

  it("reports undefined on missing, drifted, or partial metadata", () => {
    expect(readFileDiffStat({})).toBeUndefined();
    expect(readFileDiffStat({ state: {} })).toBeUndefined();
    expect(readFileDiffStat({ state: { metadata: { filediff: {} } } })).toBeUndefined();
    expect(
      readFileDiffStat({ state: { metadata: { filediff: { additions: "3", deletions: 1 } } } }),
    ).toBeUndefined();
  });
});

describe("GenericToolCard long-output truncation", () => {
  it("an output over 80 lines renders truncated with an expand affordance", () => {
    const longOutput = Array.from({ length: 120 }, (_, i) => `line-${i + 1}`).join("\n");
    const html = render(
      <GenericToolCard part={{ ...toolPart({ status: "completed" }), output: longOutput }} />,
    );
    expect(html).toContain("line-80");
    expect(html).not.toContain("line-81");
    expect(html).toContain("data-oc-tool-output-expand");
    expect(html).toContain("+40");
  });

  it("an output of 80 lines or fewer renders whole (no expand control)", () => {
    const shortOutput = Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join("\n");
    const html = render(
      <GenericToolCard part={{ ...toolPart({ status: "completed" }), output: shortOutput }} />,
    );
    expect(html).toContain("line-80");
    expect(html).not.toContain("data-oc-tool-output-expand");
  });
});

describe("GenericToolCard status display", () => {
  it("completed renders ✓ (glyph on screen, localized word on the aria)", () => {
    const html = render(<GenericToolCard part={toolPart({ status: "completed" })} />);
    expect(html).toContain(">✓</span>");
    expect(html).toContain('aria-label="Completed"');
    expect(html).not.toContain(">Completed<");
  });

  it("failed renders ✗ with the failure aria", () => {
    const html = render(<GenericToolCard part={toolPart({ status: "error" })} />);
    expect(html).toContain(">✗</span>");
    expect(html).toContain('aria-label="Failed"');
  });

  it("a completed file edit headlines +adds/−dels instead of the ✓", () => {
    const html = render(
      <GenericToolCard part={toolPart({ status: "completed", raw: filediffRaw(12, 4) })} />,
    );
    expect(html).toContain(">+12</span>");
    expect(html).toContain("−4");
    expect(html).not.toContain(">✓</span>");
  });

  it("diff counters never appear for non-completed statuses", () => {
    const html = render(
      <GenericToolCard part={toolPart({ status: "running", raw: filediffRaw(1, 1) })} />,
    );
    expect(html).not.toContain("+1");
    expect(html).toContain("animate-pulse");
  });
});

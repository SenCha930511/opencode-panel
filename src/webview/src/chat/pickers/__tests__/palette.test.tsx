// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (command names incl. custom OMO spellings), not display copy.
/**
 * Slash palette SSR suite (plan todo 15): rows render through
 * renderToStaticMarkup (no jsdom in the install set), incl. a custom OMO-ish
 * command name rendered VERBATIM, the localized empty state, active-row
 * aria, and the runCommand wire step's payload shape.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { CommandPalette, runSlashSelection } from "../CommandPalette.js";
import type { CommandEntry } from "../constants.js";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const COMMANDS: readonly CommandEntry[] = [
  { name: "help", description: "Show help" },
  { name: "init", description: "Initialize the project" },
  { name: "ulw-research", description: "OMO research pipeline" },
  { name: "start-work", description: "OMO work executor" },
];

describe("CommandPalette rows", () => {
  it("lists every pushed command verbatim, custom names included", () => {
    const html = render(
      <CommandPalette commands={COMMANDS} query="" activeIndex={0} onSelect={() => {}} />,
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain(">help</span>");
    expect(html).toContain(">ulw-research</span>");
    expect(html).toContain(">start-work</span>");
    expect(html).toContain("OMO research pipeline");
    // Names must not be rewritten/normalized across the boundary.
    expect(html).not.toContain("ulw_research");
  });

  it("applies the query filter (prefix + contains ranking)", () => {
    const html = render(
      <CommandPalette commands={COMMANDS} query="ulw" activeIndex={0} onSelect={() => {}} />,
    );
    expect(html).toContain("ulw-research");
    expect(html).not.toContain(">help</span>");
  });

  it("marks the active row aria-selected", () => {
    const html = render(
      <CommandPalette commands={COMMANDS} query="" activeIndex={2} onSelect={() => {}} />,
    );
    const options = html.match(/role="option"[^>]*aria-selected="(true|false)"/g) ?? [];
    expect(options).toHaveLength(COMMANDS.length);
    expect(html).toContain('aria-selected="true" data-active="true"');
  });

  it("renders the localized empty state when nothing matches", () => {
    const html = render(
      <CommandPalette commands={COMMANDS} query="zzz" activeIndex={0} onSelect={() => {}} />,
    );
    // English fallback table value for commands.empty (no StringsProvider).
    expect(html).toContain("No matching commands");
    expect(html).not.toContain('role="option"');
  });
});

describe("runSlashSelection", () => {
  it("posts the todo-3 runCommand payload for the active session", () => {
    const sent: Array<{ readonly type: string; readonly payload: unknown }> = [];
    runSlashSelection(
      {
        sessionId: "ses_9",
        send: (type, payload) => {
          sent.push({ type, payload });
          return Promise.resolve(null);
        },
      },
      "ulw-research",
    );
    expect(sent).toEqual([
      { type: "runCommand", payload: { sessionId: "ses_9", command: "ulw-research", args: [] } },
    ]);
  });

  it("does nothing without an active session", () => {
    const sent: Array<{ readonly type: string; readonly payload: unknown }> = [];
    runSlashSelection(
      {
        sessionId: undefined,
        send: (type, payload) => {
          sent.push({ type, payload });
          return Promise.resolve(null);
        },
      },
      "help",
    );
    expect(sent).toEqual([]);
  });
});

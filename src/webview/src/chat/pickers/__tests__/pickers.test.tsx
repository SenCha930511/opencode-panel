// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (agent/model/provider names), not display copy.
/**
 * Agent/model picker SSR suite (plan todo 15): badge matrix, grouped model
 * rows, selection aria, and the HIDE rules — empty agent list (old-server
 * QA failure scenario) hides the agent dropdown; providers without models
 * hide their group; zero providers hides the whole model dropdown.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { AgentPicker, ModelPicker } from "../chatPickers.js";
import type { AgentEntry, ProviderEntry } from "../constants.js";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function agent(name: string, mode: string, builtIn: boolean): AgentEntry {
  return { name, mode, builtIn };
}

const AGENTS: readonly AgentEntry[] = [
  agent("build", "primary", true),
  agent("plan", "primary", true),
  agent("sisyphus", "primary", false),
  agent("librarian", "subagent", false),
];

const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "mock-provider",
    name: "Mock Provider",
    models: [
      { id: "mock-large", name: "Mock Large" },
      { id: "mock-small", name: "Mock Small" },
    ],
  },
  { id: "shell-provider", name: "Shell Provider", models: [] },
];

describe("AgentPicker", () => {
  it("renders every advertised agent verbatim with its mode", () => {
    const html = render(<AgentPicker agents={AGENTS} initialOpen onPick={() => {}} />);
    expect(html).toContain(">build</span>");
    expect(html).toContain(">sisyphus</span>");
    expect(html).toContain(">librarian</span>");
    expect(html).toContain(">subagent</span>");
  });

  it("badges agents outside the core set as custom, core agents not", () => {
    const html = render(<AgentPicker agents={AGENTS} initialOpen onPick={() => {}} />);
    // English fallback value for picker.agent.customBadge.
    const badges = html.match(/>custom</g) ?? [];
    expect(badges).toHaveLength(2);
    expect(html).not.toMatch(/build<\/span><span[^>]*>custom/);
  });

  it("marks the selected agent aria-selected", () => {
    const html = render(
      <AgentPicker agents={AGENTS} value="sisyphus" initialOpen onPick={() => {}} />,
    );
    expect(html).toContain('aria-selected="true" data-selected="true"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("QA failure: an empty agent list hides the dropdown entirely", () => {
    const html = render(<AgentPicker agents={[]} initialOpen onPick={() => {}} />);
    expect(html).toBe("");
  });
});

describe("ModelPicker", () => {
  it("groups rows by provider and hides providers without models", () => {
    const html = render(<ModelPicker providers={PROVIDERS} initialOpen onPick={() => {}} />);
    expect(html).toContain("Mock Provider");
    expect(html).toContain(">Mock Large</span>");
    expect(html).toContain(">Mock Small</span>");
    expect(html).toContain(">mock-large</span>");
    expect(html).not.toContain("Shell Provider");
  });

  it("marks the effective value (provider/model) aria-selected", () => {
    const html = render(
      <ModelPicker
        providers={PROVIDERS}
        value="mock-provider/mock-small"
        initialOpen
        onPick={() => {}}
      />,
    );
    expect(html).toContain('aria-selected="true"');
    // The trigger shows the resolved id.
    expect(html).toContain("mock-provider/mock-small");
  });

  it("shows the trigger placeholder title when there is no value", () => {
    const html = render(<ModelPicker providers={PROVIDERS} onPick={() => {}} />);
    // English fallback value for picker.model.title.
    expect(html).toContain("Select model");
  });

  it("hides entirely when no provider carries models", () => {
    const html = render(
      <ModelPicker providers={[PROVIDERS[1] ?? { id: "x", name: "x", models: [] }]} initialOpen onPick={() => {}} />,
    );
    expect(html).toBe("");
    expect(render(<ModelPicker providers={[]} onPick={() => {}} />)).toBe("");
  });
});

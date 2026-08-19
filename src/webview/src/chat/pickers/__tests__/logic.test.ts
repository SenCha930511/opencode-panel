// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (agent/command/provider names), not display copy routed through t().
/**
 * Pure picker logic suite (plan todo 15): slash detection at message start,
 * prefix/contains ranking, the custom-agent badge matrix (incl. the literal
 * CORE_AGENT_NAMES mirror pin), and initial-model resolution.
 */

import { describe, expect, it } from "vitest";

import {
  CORE_AGENT_NAMES,
  agentRows,
  detectSlashQuery,
  filterCommands,
  isCustomAgent,
  resolveInitialModel,
} from "../logic.js";
import type { CommandEntry, ProviderEntry } from "../constants.js";

function command(name: string, description?: string): CommandEntry {
  return description === undefined ? { name } : { name, description };
}

const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "mock-provider",
    name: "Mock Provider",
    models: [
      { id: "mock-large", name: "Mock Large" },
      { id: "mock-small", name: "Mock Small" },
    ],
  },
];

describe("detectSlashQuery", () => {
  it("opens at message start: '/' alone and the first token", () => {
    expect(detectSlashQuery("/")).toBe("");
    expect(detectSlashQuery("/he")).toBe("he");
    expect(detectSlashQuery("/ulw-research")).toBe("ulw-research");
  });

  it("stays closed away from message start and after the first token ends", () => {
    expect(detectSlashQuery("")).toBeNull();
    expect(detectSlashQuery(" /x")).toBeNull();
    expect(detectSlashQuery("hello /x")).toBeNull();
    expect(detectSlashQuery("/he arg")).toBeNull();
    expect(detectSlashQuery("a/b")).toBeNull();
  });
});

describe("filterCommands", () => {
  const commands = [
    command("help", "Show help"),
    command("init", "Initialize the project"),
    command("compact", "Compact the session"),
    command("heal"),
    command("shelve"),
  ];

  it("returns every command on an empty query", () => {
    expect(filterCommands(commands, "")).toBe(commands);
  });

  it("ranks prefix matches before contains matches, case-insensitively", () => {
    const result = filterCommands(commands, "HE");
    expect(result.map((entry) => entry.name)).toEqual(["help", "heal", "shelve"]);
  });

  it("keeps server order stable within each tier", () => {
    expect(filterCommands(commands, "c").map((entry) => entry.name)).toEqual(["compact"]);
    expect(filterCommands(commands, "e").map((entry) => entry.name)).toEqual([
      "help",
      "heal",
      "shelve",
    ]);
  });

  it("matches nothing gracefully", () => {
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });

  it("treats custom OMO names as data (no special-casing)", () => {
    const omo = [command("ulw-research"), command("start-work")];
    expect(filterCommands(omo, "work").map((entry) => entry.name)).toEqual(["start-work"]);
  });
});

describe("isCustomAgent / CORE_AGENT_NAMES", () => {
  it("pins the literal core set mirrored from src/server/capabilities.ts", () => {
    expect([...CORE_AGENT_NAMES]).toEqual([
      "build",
      "plan",
      "general",
      "explore",
      "scout",
      "compaction",
      "title",
      "summary",
    ]);
  });

  it("badges nothing inside the core set and everything outside it", () => {
    for (const name of CORE_AGENT_NAMES) {
      expect(isCustomAgent(name)).toBe(false);
    }
    expect(isCustomAgent("sisyphus")).toBe(true);
    expect(isCustomAgent("oracle")).toBe(true);
    expect(isCustomAgent("librarian")).toBe(true);
  });

  it("is case-sensitive: server names are exact data, not normalized", () => {
    expect(isCustomAgent("Build")).toBe(true);
  });

  it("agentRows preserves advertised order and computes the badge bit", () => {
    const rows = agentRows([
      { name: "build", mode: "primary", builtIn: true },
      { name: "sisyphus", mode: "primary", builtIn: false },
    ]);
    expect(rows.map((row) => [row.entry.name, row.custom])).toEqual([
      ["build", false],
      ["sisyphus", true],
    ]);
  });
});

describe("resolveInitialModel", () => {
  it("accepts the /config default when it verifies against a provider's models", () => {
    expect(
      resolveInitialModel({
        providers: PROVIDERS,
        defaultModel: "mock-provider/mock-small",
        defaultModels: {},
      }),
    ).toBe("mock-provider/mock-small");
  });

  it("accepts an unlisted model under a known provider (render what's there)", () => {
    expect(
      resolveInitialModel({
        providers: PROVIDERS,
        defaultModel: "mock-provider/mock-future",
        defaultModels: {},
      }),
    ).toBe("mock-provider/mock-future");
  });

  it("passes the default through when no providers were reported at all", () => {
    expect(
      resolveInitialModel({
        providers: [],
        defaultModel: "anything/at-all",
        defaultModels: {},
      }),
    ).toBe("anything/at-all");
  });

  it("falls back to the first defaultModels entry naming a known provider", () => {
    expect(
      resolveInitialModel({
        providers: PROVIDERS,
        defaultModel: "unknown-provider/ghost",
        defaultModels: { stranger: "x", "mock-provider": "mock-large" },
      }),
    ).toBe("mock-provider/mock-large");
  });

  it("uses defaultModels verbatim when providers are unlisted", () => {
    expect(
      resolveInitialModel({ providers: [], defaultModels: { p1: "m1", p2: "m2" } }),
    ).toBe("p1/m1");
  });

  it("skips defaultModels entries for providers the server did not list", () => {
    expect(
      resolveInitialModel({
        providers: PROVIDERS,
        defaultModels: { stranger: "x" },
      }),
    ).toBeUndefined();
  });

  it("reports undefined when the server reported nothing usable", () => {
    expect(resolveInitialModel({ providers: [], defaultModels: {} })).toBeUndefined();
    expect(
      resolveInitialModel({ providers: PROVIDERS, defaultModels: {} }),
    ).toBeUndefined();
  });
});

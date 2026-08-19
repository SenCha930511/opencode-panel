/** Canned GET payloads + route constants for the mock opencode server. Pure data tables. */
import type { AgentInfo, CommandInfo, JsonObject, ScenarioName, TodoItem } from "./types.js";

export const MOCK_DIRECTORY = "/mock/workspace";
export const MODERN_VERSION = "1.0.42-mock";
export const OLD_SERVER_VERSION = "0.2.9";

const coreAgents: ReadonlyArray<readonly [string, AgentInfo["mode"], boolean]> = [
  ["build", "primary", true],
  ["plan", "primary", true],
  ["general", "subagent", true],
  ["explore", "subagent", true],
];

/** OMO-flavoured custom agents (all outside the opencode core set). */
const omoAgents: ReadonlyArray<readonly [string, AgentInfo["mode"]]> = [
  ["sisyphus", "primary"],
  ["sisyphus-junior", "primary"],
  ["oracle", "subagent"],
  ["librarian", "subagent"],
  ["metis", "subagent"],
];

export function agentsFor(scenario: ScenarioName): AgentInfo[] {
  const agents = coreAgents.map(([name, mode, builtIn]) => makeAgent(name, mode, builtIn));
  if (scenario === "omo-agents") {
    for (const [name, mode] of omoAgents) agents.push(makeAgent(name, mode, false));
  }
  return agents;
}

function makeAgent(name: string, mode: AgentInfo["mode"], builtIn: boolean): AgentInfo {
  return {
    name,
    description: `${builtIn ? "Core" : "Custom"} mock agent '${name}'`,
    mode,
    builtIn,
    permission: { edit: "allow", bash: { "*": "ask" } },
    tools: { "*": true },
    options: {},
  };
}

const coreCommands: ReadonlyArray<readonly [string, string]> = [
  ["help", "Show help"],
  ["init", "Initialize the project"],
  ["compact", "Compact the session"],
];

export function commandsFor(scenario: ScenarioName): CommandInfo[] {
  const commands = coreCommands.map(([name, description]) => ({
    name,
    description,
    template: `/${name} mock template`,
  }));
  if (scenario === "omo-agents") {
    commands.push(
      { name: "ulw-research", description: "OMO research pipeline", template: "/ulw-research {query}" },
      { name: "start-work", description: "OMO work executor", template: "/start-work {plan}" },
    );
  }
  return commands;
}

export function defaultTodos(): TodoItem[] {
  return [
    { id: "todo_1", content: "Replay scripted deltas", status: "in_progress", priority: "high" },
    { id: "todo_2", content: "Complete assistant message", status: "pending", priority: "medium" },
  ];
}

/** GET /config payload (subset of the SDK Config type the panel reads). */
export function configFixture(): JsonObject {
  return {
    model: "mock-provider/mock-large",
    small_model: "mock-provider/mock-small",
    theme: "system",
    autoshare: false,
    provider: {
      "mock-provider": {
        npm: "@ai-sdk/mock",
        name: "Mock Provider",
        models: {
          "mock-large": { name: "Mock Large" },
          "mock-small": { name: "Mock Small" },
        },
      },
    },
  };
}

/** GET /config/providers payload. */
export function configProvidersFixture(): JsonObject {
  return {
    providers: [
      {
        id: "mock-provider",
        name: "Mock Provider",
        source: "env",
        env: ["MOCK_PROVIDER_API_KEY"],
        options: {},
        models: {
          "mock-large": modelFixture("mock-large", "Mock Large"),
          "mock-small": modelFixture("mock-small", "Mock Small"),
        },
      },
    ],
    default: { "mock-provider": "mock-large" },
  };
}

/** GET /provider payload (models map uses the leaner /provider shape). */
export function providerListFixture(): JsonObject {
  return {
    all: [
      {
        id: "mock-provider",
        name: "Mock Provider",
        env: ["MOCK_PROVIDER_API_KEY"],
        models: {
          "mock-large": providerModelFixture("mock-large", "Mock Large"),
          "mock-small": providerModelFixture("mock-small", "Mock Small"),
        },
      },
    ],
    default: { "mock-provider": "mock-large" },
    connected: ["mock-provider"],
  };
}

function modelFixture(id: string, name: string): JsonObject {
  return {
    id,
    providerID: "mock-provider",
    api: { id, url: "https://api.mock.invalid", npm: "@ai-sdk/mock" },
    name,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 1, output: 5, cache: { read: 0.1, write: 1.25 } },
    limit: { context: 200_000, output: 8_192 },
    status: "active",
    options: {},
    headers: {},
  };
}

function providerModelFixture(id: string, name: string): JsonObject {
  return {
    id,
    name,
    release_date: "2026-01-01",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    limit: { context: 200_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    status: "active",
    options: {},
  };
}

export function providerAuthFixture(): JsonObject {
  return { "mock-provider": [{ type: "api", label: "API key" }] };
}

export function mcpFixture(): JsonObject {
  return {
    context7: { status: "connected" },
    playwright: { status: "failed", error: "mock spawn failure" },
  };
}

export function pathFixture(): JsonObject {
  return {
    state: `${MOCK_DIRECTORY}/.mock/state`,
    config: `${MOCK_DIRECTORY}/.mock/opencode.json`,
    worktree: MOCK_DIRECTORY,
    directory: MOCK_DIRECTORY,
  };
}

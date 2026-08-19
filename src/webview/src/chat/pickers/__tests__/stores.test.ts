// i18n-allow-literal — test fixtures/assertions carry literal wire data.
/**
 * Picker stores suite (plan todo 15): capability snapshot attach/parse over
 * the real WebviewMessenger, and composerState's per-session selections,
 * persistence seam, and the buildPromptExtras QA matrix — incl. the todo-15
 * failure rule (empty agent list omits `agent` from prompts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { WebviewMessenger, type WebviewPort } from "../../../../lib/messenger.js";
import {
  buildPromptExtras,
  configureComposerPersistence,
  getPickerSelection,
  resetComposerStateForTest,
  setAgentSelection,
  setModelSelection,
  type ComposerPersistence,
  type PickerSelection,
} from "../../composerState.js";
import {
  attachCapabilityStore,
  getCapabilitySnapshot,
  resetCapabilityStoreForTest,
} from "../capabilityStore.js";
import { CAPABILITIES_REFRESH_EVENT } from "../constants.js";

interface FakeMessenger {
  readonly messenger: WebviewMessenger;
  readonly push: (message: unknown) => void;
}

function fakeMessenger(): FakeMessenger {
  let listener: (message: unknown) => void = () => {
    throw new Error("listener not registered");
  };
  const port: WebviewPort = {
    postMessage: () => {},
    onMessage: (registered) => {
      listener = registered;
    },
  };
  return {
    messenger: new WebviewMessenger(port),
    push: (message) => {
      listener(message);
    },
  };
}

class MemoryPersistence implements ComposerPersistence {
  store: Record<string, PickerSelection> | undefined;
  readonly saves: Array<Readonly<Record<string, PickerSelection>>> = [];
  load(): Readonly<Record<string, PickerSelection>> | undefined {
    return this.store;
  }
  save(selections: Readonly<Record<string, PickerSelection>>): void {
    this.saves.push(selections);
    this.store = { ...selections };
  }
}

beforeEach(() => {
  resetCapabilityStoreForTest();
  configureComposerPersistence(undefined);
  resetComposerStateForTest();
});

describe("capabilityStore", () => {
  it("adopts a full capabilities.refresh push (custom names verbatim)", () => {
    const fake = fakeMessenger();
    attachCapabilityStore(fake.messenger);
    fake.push({
      type: "event",
      payload: {
        type: CAPABILITIES_REFRESH_EVENT,
        payload: {
          agents: [
            { name: "build", mode: "primary", builtIn: true },
            { name: "sisyphus-junior", mode: "primary", builtIn: false },
          ],
          commands: [{ name: "ulw-research", description: "OMO research pipeline" }],
          providers: [
            { id: "mock-provider", name: "Mock Provider", models: [{ id: "m1", name: "M One" }] },
          ],
          defaultModels: { "mock-provider": "m1" },
          defaultModel: "mock-provider/m1",
        },
      },
    });
    const snapshot = getCapabilitySnapshot();
    expect(snapshot?.agents.map((entry) => entry.name)).toEqual(["build", "sisyphus-junior"]);
    expect(snapshot?.agents[1]?.builtIn).toBe(false);
    expect(snapshot?.commands[0]?.name).toBe("ulw-research");
    expect(snapshot?.providers[0]?.models[0]).toEqual({ id: "m1", name: "M One" });
    expect(snapshot?.defaultModels).toEqual({ "mock-provider": "m1" });
    expect(snapshot?.defaultModel).toBe("mock-provider/m1");
  });

  it("ignores malformed pushes and foreign event types (previous snapshot kept)", () => {
    const fake = fakeMessenger();
    attachCapabilityStore(fake.messenger);
    fake.push({
      type: "event",
      payload: {
        type: CAPABILITIES_REFRESH_EVENT,
        payload: { agents: [], commands: [], providers: [], defaultModels: {} },
      },
    });
    const before = getCapabilitySnapshot();

    fake.push({ type: "event", payload: { type: CAPABILITIES_REFRESH_EVENT, payload: "nope" } });
    fake.push({ type: "event", payload: { type: "messages.sync", payload: { kind: "full" } } });
    expect(getCapabilitySnapshot()).toBe(before);
  });
});

describe("composerState selections", () => {
  it("keys selections per session and persists each write", () => {
    const memory = new MemoryPersistence();
    configureComposerPersistence(memory);
    resetComposerStateForTest();

    setAgentSelection("ses_1", "sisyphus");
    setModelSelection("ses_1", "mock-provider/mock-small");
    setAgentSelection("ses_2", "plan");

    expect(getPickerSelection("ses_1")).toEqual({
      agent: "sisyphus",
      model: "mock-provider/mock-small",
    });
    expect(getPickerSelection("ses_2")).toEqual({ agent: "plan" });
    expect(memory.saves.length).toBe(3);
  });

  it("re-hydrates from persistence after a simulated reload", () => {
    const memory = new MemoryPersistence();
    configureComposerPersistence(memory);
    resetComposerStateForTest();

    setModelSelection("ses_1", "mock-provider/mock-large");
    // "Reload": clear the in-memory mirror; the injected fake survives reset.
    resetComposerStateForTest();
    expect(getPickerSelection("ses_1")).toEqual({ model: "mock-provider/mock-large" });
  });

  it("drops the session key when both selections are cleared", () => {
    const memory = new MemoryPersistence();
    configureComposerPersistence(memory);
    resetComposerStateForTest();

    setAgentSelection("ses_1", "build");
    setAgentSelection("ses_1", undefined);
    expect(getPickerSelection("ses_1")).toEqual({});
    const last = memory.saves[memory.saves.length - 1];
    expect(last !== undefined && "ses_1" in last).toBe(false);
  });
});

describe("buildPromptExtras", () => {
  const SNAPSHOT = {
    agents: [{ name: "build", builtIn: true }],
    providers: [
      {
        id: "mock-provider",
        name: "Mock Provider",
        models: [{ id: "mock-large", name: "Mock Large" }],
      },
    ],
    defaultModels: { "mock-provider": "mock-large" },
    defaultModel: "mock-provider/mock-large",
  } as const;

  it("QA failure: empty agent list omits agent even when one was selected", () => {
    setAgentSelection("ses_1", "sisyphus");
    const extras = buildPromptExtras("ses_1", { ...SNAPSHOT, agents: [] });
    expect(extras.agent).toBeUndefined();
  });

  it("passes the selected agent and model through when the server advertises agents", () => {
    setAgentSelection("ses_1", "sisyphus");
    setModelSelection("ses_1", "mock-provider/mock-large");
    const extras = buildPromptExtras("ses_1", SNAPSHOT);
    expect(extras).toEqual({ agent: "sisyphus", model: "mock-provider/mock-large" });
  });

  it("falls back to the resolved server default model without a selection", () => {
    const extras = buildPromptExtras("ses_1", SNAPSHOT);
    expect(extras.agent).toBeUndefined();
    expect(extras.model).toBe("mock-provider/mock-large");
  });

  it("emits neither field when nothing is selected or reported", () => {
    const extras = buildPromptExtras("ses_1", {
      agents: [],
      providers: [],
      defaultModels: {},
    });
    expect(extras).toEqual({});
  });
});

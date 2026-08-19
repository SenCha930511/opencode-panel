// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (guard keys mirrored from the host push), not display copy.
/**
 * Capability-flag store suite (plan todo 20, webview side): the hide-first
 * default, the init baseline overlay, the mcp.status authoritative overlay
 * (the documented omo/shell/oldServer carrier), the capabilities.refresh
 * forward-compat overlay, and malformed-push ignore rules — the
 * unsupported→hide contract T18/T19/T21 consume via useCapabilityFlags().
 */

import { beforeEach, describe, expect, it } from "vitest";

import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import {
  attachCapabilityFlags,
  getCapabilityFlags,
  INACTIVE_FLAGS,
  resetCapabilityFlagsForTest,
} from "../capabilityFlags.js";
import { MCP_STATUS_EVENT } from "../constants.js";

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

function pushInit(fake: FakeMessenger, capabilities: Record<string, unknown>): void {
  fake.push({
    type: "init",
    payload: {
      locale: "en",
      strings: {},
      server: { url: "http://127.0.0.1:4096", version: "0.0.0-test" },
      capabilities,
      settings: {},
    },
  });
}

beforeEach(() => {
  resetCapabilityFlagsForTest();
});

describe("capabilityFlags", () => {
  it("defaults to the hide-everything map before any wire data (unsupported→hide)", () => {
    expect(getCapabilityFlags()).toEqual({
      fork: false,
      question: false,
      todo: false,
      shell: false,
      omoMcpNote: false,
      omoDetected: false,
      oldServer: false,
    });
  });

  it("overlays the init.capabilities baseline (todo-3 minimal matrix)", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);

    pushInit(fake, { fork: true, question: true, todo: false });

    const flags = getCapabilityFlags();
    expect(flags.fork).toBe(true);
    expect(flags.question).toBe(true);
    expect(flags.todo).toBe(false);
    // Keys the frozen matrix does not carry stay hidden.
    expect(flags.shell).toBe(false);
    expect(flags.omoDetected).toBe(false);
    expect(flags.oldServer).toBe(false);
  });

  it("accepts additional boolean bits a later init revision carries (incl. the `omo` alias)", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);

    pushInit(fake, {
      fork: true,
      question: true,
      todo: true,
      shell: true,
      omo: true,
      omoMcpNote: true,
      oldServer: false,
    });

    const flags = getCapabilityFlags();
    expect(flags.shell).toBe(true);
    expect(flags.omoDetected).toBe(true);
    expect(flags.omoMcpNote).toBe(true);
    expect(flags.oldServer).toBe(false);
  });

  it("mcp.status guards overlay the full set and win over the init baseline", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);
    pushInit(fake, { fork: true, question: true, todo: true });

    fake.push({
      type: "event",
      payload: {
        type: MCP_STATUS_EVENT,
        payload: {
          servers: [],
          guards: {
            fork: false,
            question: false,
            todo: true,
            shell: true,
            omoDetected: true,
            omoMcpNote: true,
            oldServer: true,
          },
        },
      },
    });

    expect(getCapabilityFlags()).toEqual({
      fork: false,
      question: false,
      todo: true,
      shell: true,
      omoMcpNote: true,
      omoDetected: true,
      oldServer: true,
    });
  });

  it("accepts an optional guards block on capabilities.refresh (forward-compat, preserves prior keys)", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);
    pushInit(fake, { fork: true, question: false, todo: false });

    fake.push({
      type: "event",
      payload: {
        type: "capabilities.refresh",
        payload: {
          agents: [],
          commands: [],
          providers: [],
          defaultModels: {},
          guards: { shell: true },
        },
      },
    });

    const flags = getCapabilityFlags();
    expect(flags.shell).toBe(true);
    expect(flags.fork).toBe(true);
    expect(flags.question).toBe(false);
  });

  it("ignores a malformed mcp.status push entirely (flags stay)", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);
    pushInit(fake, { fork: true, question: true, todo: true });

    fake.push({
      type: "event",
      payload: {
        type: MCP_STATUS_EVENT,
        payload: { servers: [], guards: { fork: false } }, // partial guards block
      },
    });

    expect(getCapabilityFlags()).toEqual({
      ...INACTIVE_FLAGS,
      fork: true,
      question: true,
      todo: true,
    });
  });

  it("reset seam returns to the hide-everything map", () => {
    const fake = fakeMessenger();
    attachCapabilityFlags(fake.messenger);
    pushInit(fake, { fork: true, question: true, todo: true });
    resetCapabilityFlagsForTest();
    expect(getCapabilityFlags()).toEqual(INACTIVE_FLAGS);
  });
});

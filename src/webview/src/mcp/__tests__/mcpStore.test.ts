// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (MCP names/statuses mirrored from the mock server), not display copy.
/**
 * MCP snapshot store + wire parser suite (plan todo 20, webview side):
 * mcp.status adoption (entries + error passthrough verbatim), malformed-push
 * ignore rules, unknown statuses as data, and the dot-color token matrix.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import {
  dotForStatus,
  MCP_STATUS_EVENT,
  parseMcpStatusSnapshot,
  type McpGuards,
} from "../constants.js";
import {
  attachMcpStore,
  getMcpSnapshot,
  resetMcpStoreForTest,
  subscribeMcpSnapshot,
} from "../mcpStore.js";

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

const GUARDS: McpGuards = {
  fork: true,
  question: true,
  todo: true,
  shell: true,
  omoDetected: false,
  omoMcpNote: false,
  oldServer: false,
};

function pushMcpStatus(fake: FakeMessenger, payload: unknown): void {
  fake.push({ type: "event", payload: { type: MCP_STATUS_EVENT, payload } });
}

beforeEach(() => {
  resetMcpStoreForTest();
});

describe("mcpStore", () => {
  it("pins the event literal both bundles mirror", () => {
    expect(MCP_STATUS_EVENT).toBe("mcp.status");
  });

  it("adopts a full mcp.status push (entries and errors verbatim)", () => {
    const fake = fakeMessenger();
    attachMcpStore(fake.messenger);

    pushMcpStatus(fake, {
      servers: [
        { name: "context7", status: "connected" },
        { name: "playwright", status: "failed", error: "mock spawn failure" },
      ],
      guards: GUARDS,
    });

    expect(getMcpSnapshot()).toEqual({
      servers: [
        { name: "context7", status: "connected" },
        { name: "playwright", status: "failed", error: "mock spawn failure" },
      ],
    });
  });

  it("carries the host's error state (servers [] + error text, never a throw)", () => {
    const fake = fakeMessenger();
    attachMcpStore(fake.messenger);

    pushMcpStatus(fake, {
      servers: [],
      guards: GUARDS,
      error: "McpStatusFetchError: GET http://127.0.0.1:9/mcp failed: HTTP 500",
    });

    expect(getMcpSnapshot()).toEqual({
      servers: [],
      error: "McpStatusFetchError: GET http://127.0.0.1:9/mcp failed: HTTP 500",
    });
  });

  it("keeps unknown names and future statuses as data", () => {
    const parsed = parseMcpStatusSnapshot({
      servers: [
        { name: "x-omo-plugin", status: "needs_auth" },
        { name: "mystery", status: "half-linked-state" },
      ],
      guards: GUARDS,
    });

    expect(parsed?.servers).toEqual([
      { name: "x-omo-plugin", status: "needs_auth" },
      { name: "mystery", status: "half-linked-state" },
    ]);
  });

  it("ignores a malformed push entirely (previous snapshot stays)", () => {
    const fake = fakeMessenger();
    attachMcpStore(fake.messenger);
    pushMcpStatus(fake, { servers: [{ name: "context7", status: "connected" }], guards: GUARDS });
    expect(getMcpSnapshot()?.servers.length).toBe(1);

    pushMcpStatus(fake, { servers: [{ name: "context7", status: "connected" }] }); // guards missing
    pushMcpStatus(fake, { guards: GUARDS }); // servers missing
    pushMcpStatus(fake, "mcp.status");
    fake.push({ type: "event", payload: { type: "capabilities.refresh", payload: {} } });

    expect(getMcpSnapshot()?.servers).toEqual([{ name: "context7", status: "connected" }]);
  });

  it("notifies subscribers on accepted pushes only", () => {
    const fake = fakeMessenger();
    attachMcpStore(fake.messenger);
    let notifications = 0;
    const unsubscribe = subscribeMcpSnapshot(() => {
      notifications += 1;
    });

    pushMcpStatus(fake, { servers: [], guards: GUARDS });
    pushMcpStatus(fake, { malformed: true });
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("reset seam clears the snapshot between suites", () => {
    const fake = fakeMessenger();
    attachMcpStore(fake.messenger);
    pushMcpStatus(fake, { servers: [], guards: GUARDS });
    expect(getMcpSnapshot()).toBeDefined();
    resetMcpStoreForTest();
    expect(getMcpSnapshot()).toBeUndefined();
  });
});

describe("dotForStatus", () => {
  it("maps connected/disabled/failed onto the todo-11 theme dot tokens", () => {
    expect(dotForStatus("connected")).toBe("bg-ok");
    expect(dotForStatus("disabled")).toBe("bg-off");
    expect(dotForStatus("failed")).toBe("bg-err");
  });

  it("renders unknown/future statuses with the warn dot (never invents)", () => {
    expect(dotForStatus("needs_auth")).toBe("bg-warn");
    expect(dotForStatus("needs_client_registration")).toBe("bg-warn");
    expect(dotForStatus("unknown")).toBe("bg-warn");
    expect(dotForStatus("")).toBe("bg-warn");
  });
});

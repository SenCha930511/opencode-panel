// Given/When/Then — todo-24 env-test seam unit spec (F3 rejection fix):
// keeps src/host/testSeam.ts inside the coverage-by-file gate.
import { describe, expect, it } from "vitest";

import { DEFAULT_PANEL_CONFIG, type PanelConfigAccessor } from "../config";
import type { ServerManager } from "../../server/serverManager.js";
import type { PanelViewComposite } from "../../providers/registration";
import type { ChatViewProvider } from "../../providers/chatViewProvider";
import type { SessionsViewProvider } from "../../providers/sessionsViewProvider";
import { applyTestServerOverride, exposeTestAttach } from "../testSeam";

function makeAccessor(): { accessor: PanelConfigAccessor; disposed: () => number; listeners: () => number } {
  let disposeCalls = 0;
  let onDidChangeCalls = 0;
  let current = { ...DEFAULT_PANEL_CONFIG };
  const accessor: PanelConfigAccessor = {
    read: () => current,
    onDidChange: (listener) => {
      onDidChangeCalls += 1;
      void listener;
      return { dispose: () => undefined };
    },
    dispose: () => {
      disposeCalls += 1;
    },
  };
  return { accessor, disposed: () => disposeCalls, listeners: () => onDidChangeCalls };
}

function makeManager(): { manager: ServerManager; starts: () => number } {
  let startCalls = 0;
  const manager = {
    start: async () => {
      startCalls += 1;
    },
  } as unknown as ServerManager;
  return { manager, starts: () => startCalls };
}

function makePanel(): PanelViewComposite {
  return {
    chat: {} as unknown as ChatViewProvider,
    sessions: {} as unknown as SessionsViewProvider,
  } as unknown as PanelViewComposite;
}

describe("applyTestServerOverride", () => {
  it("returns the base accessor untouched when the port is empty", () => {
    // Given
    const { accessor } = makeAccessor();
    // When/Then
    expect(applyTestServerOverride(accessor, "")).toBe(accessor);
  });

  it("pins serverUrl and forces autoStartServer off while passing the rest through", () => {
    // Given
    const { accessor } = makeAccessor();
    // When
    const wrapped = applyTestServerOverride(accessor, "4999");
    const config = wrapped.read();
    // Then
    expect(config.serverUrl).toBe("http://127.0.0.1:4999");
    expect(config.autoStartServer).toBe(false);
    expect(config.binaryPath).toBe(DEFAULT_PANEL_CONFIG.binaryPath);
    expect(config.port).toBe(DEFAULT_PANEL_CONFIG.port);
  });

  it("reads stay dynamic and lifecycle delegates to the base accessor", () => {
    // Given
    const { accessor, disposed, listeners } = makeAccessor();
    const wrapped = applyTestServerOverride(accessor, "4999");
    // When
    const sub = wrapped.onDidChange(() => undefined);
    wrapped.dispose();
    // Then
    expect(listeners()).toBe(1);
    expect(disposed()).toBe(1);
    sub.dispose();
  });
});

describe("exposeTestAttach", () => {
  it("returns undefined and never starts the manager when the port is empty", () => {
    // Given
    const { manager, starts } = makeManager();
    // When/Then
    expect(exposeTestAttach("", manager, makePanel())).toBeUndefined();
    expect(starts()).toBe(0);
  });

  it("starts the manager once and exposes the harness surface when the port is set", () => {
    // Given
    const { manager, starts } = makeManager();
    const panel = makePanel();
    // When
    const api = exposeTestAttach("4999", manager, panel);
    // Then
    expect(starts()).toBe(1);
    expect(api?.manager).toBe(manager);
    expect(api?.chat).toBe(panel.chat);
    expect(api?.sessions).toBe(panel.sessions);
  });
});

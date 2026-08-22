// i18n-allow-literal — SSR assertions match the bundled ENGLISH fallback
// strings (no provider mounted; useStrings falls back to the en table).
/**
 * McpPanel SSR suite (plan todo 20, node env — no jsdom):
 * - the natively-configured header text and verbatim rows (connected/failed
 *   entries, theme-token dot classes, error tooltip);
 * - the OMO under-reporting note rendered ONLY when the guards flag it
 *   (plan acceptance: omo scenario shows the note; honest inventory rule);
 * - the localized error state on a failed /mcp push (QA failure scenario:
 *   the panel shows the error row and never crashes).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { attachMcpStores } from "../attach.js";
import { resetCapabilityFlagsForTest } from "../capabilityFlags.js";
import { MCP_STATUS_EVENT, type McpGuards } from "../constants.js";
import { resetMcpStoreForTest } from "../mcpStore.js";
import { McpPanel } from "../mcpPanel.js";

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

/** Seed both stores through the real messenger seam, mirroring the host push. */
function pushMcpStatus(fake: FakeMessenger, payload: unknown): void {
  fake.push({ type: "event", payload: { type: MCP_STATUS_EVENT, payload } });
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  resetMcpStoreForTest();
  resetCapabilityFlagsForTest();
});

describe("McpPanel (SSR)", () => {
  it("renders the natively-configured header text and verbatim rows", () => {
    const fake = fakeMessenger();
    attachMcpStores(fake.messenger);
    pushMcpStatus(fake, {
      servers: [
        { name: "context7", status: "connected" },
        { name: "playwright", status: "failed", error: "mock spawn failure" },
      ],
      guards: GUARDS,
    });

    const html = render(<McpPanel />);

    expect(html).toContain("MCP servers");
    expect(html).toContain("Natively configured MCP servers only");
    expect(html).toContain("context7");
    expect(html).toContain("connected");
    expect(html).toContain("playwright");
    expect(html).toContain("failed");
    // Error tooltip and theme-token dots ride the row markup.
    expect(html).toContain('title="mock spawn failure"');
    expect(html).toContain("bg-ok");
    expect(html).toContain("bg-err");
    // Without the OMO flag the under-reporting note stays hidden.
    expect(html).not.toContain("plugins may inject additional MCPs not listed here");
    expect(html).not.toContain("Connection failed");
  });

  it("renders the OMO note only when the guards flag it", () => {
    const fake = fakeMessenger();
    attachMcpStores(fake.messenger);
    pushMcpStatus(fake, {
      servers: [{ name: "context7", status: "connected" }],
      guards: { ...GUARDS, omoDetected: true, omoMcpNote: true },
    });

    const html = render(<McpPanel />);

    expect(html).toContain("plugins may inject additional MCPs not listed here");
    // The note never changes the honesty of the list itself.
    expect(html).toContain("Natively configured MCP servers only");
    expect(html).toContain("context7");
  });

  it("renders the localized error state on a failed /mcp push (QA failure)", () => {
    const fake = fakeMessenger();
    attachMcpStores(fake.messenger);
    pushMcpStatus(fake, {
      servers: [],
      guards: GUARDS,
      error: "McpStatusFetchError: GET http://127.0.0.1:9/mcp failed: HTTP 500",
    });

    const html = render(<McpPanel />);

    expect(html).toContain("Connection failed");
    expect(html).toContain('role="alert"');
    expect(html).toContain("MCP servers");
  });

  it("renders zero rows (header only) before any push lands", () => {
    const fake = fakeMessenger();
    attachMcpStores(fake.messenger);

    const html = render(<McpPanel />);

    expect(html).toContain("MCP servers");
    expect(html).toContain("Natively configured MCP servers only");
    expect(html).not.toContain("role=");
  });
});

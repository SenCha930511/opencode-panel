/**
 * Todo-10 acceptance suite for the webview HTML shell: exact production CSP
 * directives, fresh nonce per build, no loopback literals, fully externalized
 * scripts, media-only localResourceRoots.
 *
 * Failure QA (binding): stripping the nonce from the builder input breaks the
 * exact-directive and script-tag assertions below — the production shell is
 * nonce-bearing by construction and this suite proves it.
 */

import { describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import type { ServerManagerState } from "../../server/ServerManager.js";
import { ChatViewProvider } from "../ChatViewProvider";
import { HandlerRegistry } from "../handlers";
import { buildWebviewHtml, generateNonce, type WebviewShellInput } from "../html";
import { buildInitStrings } from "../../host/locale.js";
import { DEFAULT_PANEL_CONFIG } from "../../host/config.js";
import { FakeEventSource, FakeWebviewView, fakeUri, joinPathFake } from "./fakes";

const CSP_SOURCE = "test-vscode-resource:";
const SCRIPT_URI = `${CSP_SOURCE}//media/webview/main.js`;
const STYLE_URI = `${CSP_SOURCE}//media/webview/main.css`;

function productionShell(nonce?: string): string {
  const input: WebviewShellInput = {
    cspSource: CSP_SOURCE,
    scriptUri: SCRIPT_URI,
    styleUri: STYLE_URI,
    dev: false,
    ...(nonce === undefined ? {} : { nonce }),
  };
  return buildWebviewHtml(input);
}

function extractNonce(html: string): string {
  const match = /script-src 'nonce-([^']+)' 'strict-dynamic'/.exec(html);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("production shell CSP", () => {
  it("emits the exact plan directives in a CSP meta tag", () => {
    const nonce = generateNonce();
    const html = productionShell(nonce);
    const expected =
      `default-src 'none'; img-src ${CSP_SOURCE} data:; ` +
      `style-src ${CSP_SOURCE} 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}' 'strict-dynamic'; connect-src ${CSP_SOURCE}; ` +
      `font-src ${CSP_SOURCE}`;
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${expected}" />`,
    );
  });

  it("tags the script element with the same nonce the CSP carries", () => {
    const nonce = generateNonce();
    expect(productionShell(nonce)).toContain(`<script nonce="${nonce}" src="${SCRIPT_URI}">`);
  });

  it("generates a fresh nonce per build", () => {
    expect(extractNonce(productionShell())).not.toBe(extractNonce(productionShell()));
  });

  it("externalizes every script behind the nonce (no inline non-nonced script)", () => {
    expect(productionShell().match(/<script(?![^>]*\bnonce=")/g)).toBeNull();
  });

  it("contains no loopback server literal", () => {
    const html = productionShell();
    expect(html).not.toContain("http://127.0.0.1");
    expect(html).not.toContain("127.0.0.1");
  });

  it("links the external stylesheet, never inline styles", () => {
    const html = productionShell();
    expect(html).toContain(`<link href="${STYLE_URI}" rel="stylesheet" />`);
    expect(html).not.toContain("<style");
  });

  it("carries no credentials anywhere in the markup", () => {
    expect(productionShell().toLowerCase()).not.toContain("password");
  });
});

describe("view-kind discriminator (fix: duplicated stacked views)", () => {
  const STAMP = `globalThis.__OPENCODE_PANEL_VIEW__=`;

  it("stamps the production sessions shell with a nonce'd inline script before the bundle", () => {
    const nonce = generateNonce();
    const html = buildWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: SCRIPT_URI,
      styleUri: STYLE_URI,
      dev: false,
      nonce,
      viewKind: "sessions",
    });
    const stamp = `<script nonce="${nonce}">${STAMP}"sessions";</script>`;
    expect(html).toContain(stamp);
    // Injected BEFORE the main bundle tag so the global exists at module init
    expect(html.indexOf(stamp)).toBeLessThan(html.indexOf(`<script nonce="${nonce}" src=`));
    // CSP and bundle wiring stay byte-identical to the chat shell
    expect(html).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(html).toContain(`<script nonce="${nonce}" src="${SCRIPT_URI}">`);
    // Still zero non-nonced scripts anywhere in the production shell
    expect(html.match(/<script(?![^>]*\bnonce=")/g)).toBeNull();
  });

  it("leaves the chat CSP verbatim and stamps the default kind as chat", () => {
    const nonce = generateNonce();
    const html = productionShell(nonce);
    const expected =
      `default-src 'none'; img-src ${CSP_SOURCE} data:; ` +
      `style-src ${CSP_SOURCE} 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}' 'strict-dynamic'; connect-src ${CSP_SOURCE}; ` +
      `font-src ${CSP_SOURCE}`;
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${expected}" />`,
    );
    expect(html).toContain(`<script nonce="${nonce}">${STAMP}"chat";</script>`);
  });

  it("stamps the explicit chat kind identically to the default", () => {
    const nonce = generateNonce();
    const html = buildWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: SCRIPT_URI,
      styleUri: STYLE_URI,
      dev: false,
      nonce,
      viewKind: "chat",
    });
    expect(html).toContain(`<script nonce="${nonce}">${STAMP}"chat";</script>`);
    expect(productionShell(nonce)).toContain(`<script nonce="${nonce}">${STAMP}"chat";</script>`);
  });

  it("stamps the dev sessions shell before the Vite client", () => {
    const html = buildWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: "http://localhost:5173/src/main.tsx",
      dev: true,
      viewKind: "sessions",
    });
    const stamp = `${STAMP}"sessions";`;
    expect(html).toContain(stamp);
    expect(html.indexOf(stamp)).toBeLessThan(
      html.indexOf('<script type="module" src="http://localhost:5173/@vite/client">'),
    );
    // Dev CSP is untouched: still relaxed, never nonce-bound
    expect(html).toContain("script-src 'unsafe-inline' http://localhost:5173");
  });
});

describe("dev shell", () => {
  it("relaxes CSP to the Vite dev server only in dev mode", () => {
    const html = buildWebviewHtml({
      cspSource: CSP_SOURCE,
      scriptUri: "http://localhost:5173/src/main.tsx",
      dev: true,
    });
    expect(html).toContain("http://localhost:5173");
    expect(html).toContain("ws://localhost:5173");
    expect(html).not.toContain("strict-dynamic");
    expect(html).toContain('type="module"');
  });

  it("never relaxes production: dev origins absent from the production shell", () => {
    const html = productionShell();
    expect(html).not.toContain("localhost:5173");
    expect(html).not.toContain("ws://localhost:5173");
  });
});

describe("webview options", () => {
  it("limits localResourceRoots to the extension media/ root", () => {
    // Given a chat provider over the plain fakes
    const logger = new PanelLogger(new NullChannel(), () => false);
    const provider = new ChatViewProvider({
      extensionUri: fakeUri("/ext"),
      joinPath: joinPathFake,
      handlers: new HandlerRegistry(),
      buildInitPayload: async () => ({
        ...buildInitStrings("en"),
        settings: { ...DEFAULT_PANEL_CONFIG },
        server: { url: "", version: null },
        capabilities: { fork: false, question: false, todo: false },
      }),
      onManagerStateChange: new FakeEventSource<ServerManagerState>().event,
      devMode: false,
      logger,
    });
    const view = new FakeWebviewView();
    // When the view resolves
    provider.resolveWebviewView(view, {}, {});
    // Then scripts on, command URIs unticked, media-only roots
    expect(view.webview.options.enableScripts).toBe(true);
    expect("enableCommandUris" in view.webview.options).toBe(false);
    expect(view.webview.options.localResourceRoots?.map((uri) => uri.path)).toEqual(["/ext/media"]);
  });
});

class NullChannel implements OutputChannelLike {
  appendLine(_line: string): void {}
}

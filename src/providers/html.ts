/**
 * Webview HTML shell builder (plan todo 10).
 *
 * Production shell (binding CSP, verbatim from the plan):
 *   default-src 'none'; img-src <cspSource> data:; style-src <cspSource>
 *   'unsafe-inline'; script-src 'nonce-<n>' 'strict-dynamic'; connect-src
 *   <cspSource>; font-src <cspSource>
 * with a crypto-random per-load nonce, the bundle externalized as
 * media/webview/main.js + main.css through asWebviewUri, and NO inline
 * non-nonced script, no server URL, no secret of any kind.
 *
 * Dev mode (`dev: true`, only ever wired when the host bundle defines
 * `__DEV__`) the shell relaxes to the Vite dev server for HMR
 * (http://localhost:5173 + ws://localhost:5173) and drops 'strict-dynamic',
 * which breaks the dev client's module graph.
 *
 * VIEW-KIND INJECTION CONTRACT (fix: duplicated stacked blocks): both
 * contributed views load the same bundle, so the shell stamps WHICH view it
 * hosts — one tiny inline script BEFORE the bundle:
 *   `globalThis.__OPENCODE_PANEL_VIEW__ = "<kind>"` ("chat" | "sessions").
 * The webview reads it via src/webview/src/app/viewKind.ts: the chat view
 * renders the full app, the sessions view renders ONLY the sessions panel.
 * The production CSP admits the inline script through the SAME per-load
 * nonce the bundle tag carries — no non-nonced inline script is ever added;
 * the dev CSP is 'unsafe-inline' regardless.
 *
 * Pure module: no `vscode` import, no DOM — unit-testable under node.
 */

import { randomBytes } from "node:crypto";

export const DEV_SERVER_ORIGIN = "http://localhost:5173";
export const DEV_SERVER_WS_ORIGIN = "ws://localhost:5173";

/** Which contributed view a shell hosts (todo-1 two-view topology + settings tab). */
export type PanelViewKind = "chat" | "sessions" | "settings";

export interface WebviewShellInput {
  /** `webview.cspSource` — the only non-'none' origin production CSP trusts. */
  readonly cspSource: string;
  /** Production: asWebviewUri(media/webview/main.js). Dev: vite entry URL. */
  readonly scriptUri: string;
  /** Production: asWebviewUri(media/webview/main.css). Dev injects styles. */
  readonly styleUri?: string;
  /** Tests inject a fixed nonce; production callers leave it generated. */
  readonly nonce?: string;
  /** True ONLY behind the host `__DEV__` gate. */
  readonly dev?: boolean;
  /**
   * View kind stamped into `globalThis.__OPENCODE_PANEL_VIEW__` (see the
   * module-header injection contract). Defaults to "chat".
   */
  readonly viewKind?: PanelViewKind;
}

/** 128 bits of entropy, base64-encoded — per-load CSP nonce. */
export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

function productionCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `connect-src ${cspSource}`,
    `font-src ${cspSource}`,
  ].join("; ");
}

function devCsp(cspSource: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: ${DEV_SERVER_ORIGIN}`,
    `style-src ${cspSource} 'unsafe-inline' ${DEV_SERVER_ORIGIN}`,
    `script-src 'unsafe-inline' ${DEV_SERVER_ORIGIN}`,
    `connect-src ${cspSource} ${DEV_SERVER_ORIGIN} ${DEV_SERVER_WS_ORIGIN}`,
    `font-src ${cspSource} ${DEV_SERVER_ORIGIN}`,
  ].join("; ");
}

/**
 * Assembles the one-page shell the WebviewView renders. The React app below
 * `#root` is the only live surface; markup carries no data (strings/settings/
 * server state all ride the todo-3 `init` handshake, not the HTML).
 */
export function buildWebviewHtml(input: WebviewShellInput): string {
  // Double gate: the compile-time `__DEV__` half lets production bundlers
  // erase the Vite dev-server branch (and its origins) entirely.
  const dev = __DEV__ && (input.dev ?? false);
  const nonce = input.nonce ?? generateNonce();
  const viewKind = input.viewKind ?? "chat";
  const csp = dev ? devCsp(input.cspSource) : productionCsp(input.cspSource, nonce);
  const styleLink =
    input.styleUri === undefined ? "" : `<link href="${input.styleUri}" rel="stylesheet" />`;
  // View-kind stamp (see module header): nonce'd in production so the strict
  // CSP admits it; dev CSP is 'unsafe-inline' anyway. MUST precede the bundle.
  const viewKindScript = `<script nonce="${nonce}">globalThis.__OPENCODE_PANEL_VIEW__="${viewKind}";</script>`;
  const scriptTag = dev
    ? `${viewKindScript}\n<script type="module" src="${DEV_SERVER_ORIGIN}/@vite/client"></script>\n<script type="module" src="${input.scriptUri}"></script>`
    : `${viewKindScript}\n<script nonce="${nonce}" src="${input.scriptUri}"></script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
${styleLink}
<title>OpenCode Chat Sidebar</title>
</head>
<body>
<div id="root"></div>
${scriptTag}
</body>
</html>`;
}

/**
 * Compile-time development-mode gate, injected by the bundlers:
 *  - esbuild.config.mjs `define.__DEV__` (host bundle, false in production)
 *  - src/webview/vite.config.ts `define.__DEV__` (webview bundle)
 *  - vitest.config.mts `define.__DEV__` (unit tests, always true so the
 *    dev-only transport inspector exists for todo 24 style assertions)
 *
 * Dev-only code paths (Vite dev-server HTML, the todo-10 `_test` recorder)
 * key off this constant so production builds tree-shake them out entirely.
 */
declare const __DEV__: boolean;

/**
 * Webview-only view-kind discriminator, injected by the host shell (see
 * src/providers/html.ts — the two contributed sidebar views load one shared
 * bundle, and this stamp tells it which surface to mount: "chat" = the full
 * app, "sessions" = the slim standalone sessions panel).
 *
 * Read defensively via src/webview/src/app/viewKind.ts. Declared as a plain
 * `string` on purpose so the webview can narrow unknown/other host values
 * back to the chat surface. Absent (`undefined`) outside webviews — node/SSR
 * test code must tolerate that (and sets it explicitly only when exercising
 * the sessions branch).
 */
declare var __OPENCODE_CHAT_SIDEBAR_VIEW__: string | undefined;

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

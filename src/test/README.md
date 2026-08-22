# Integration test harness (todo 24)

Mocha suites running inside a real VS Code extension host via
`@vscode/test-electron`, exercising the extension end-to-end against the
todo-5 mock opencode server — never a real network, never the real binary.

## What runs

`npm run test` does two things:

1. `node esbuild.config.mjs --test` — dev-bundle the extension
   (`dist/extension.js`, `__DEV__` true so the todo-10/24 `_test` transport
   recorder exists) and this harness (`dist/test/runTest.js`,
   `dist/test/suite/index.js`, CJS, `vscode`/`mocha`/`@vscode/test-electron`
   external).
2. `node dist/test/runTest.js` — `@vscode/test-electron.runTests` launches a
   downloaded VS Code (cached under `.vscode-test/`, first run downloads it —
   the single sanctioned external fetch) with
   `--disable-gpu --no-sandbox --disable-extensions` plus isolated
   `--user-data-dir`/`--extensions-dir` under `.vscode-test/sandbox/` so
   settings round-trips never touch your real VS Code profile.

On CI-capable Linux boxes the same command works headless under xvfb
(`xvfb-run -a npm run test`); `--disable-gpu --no-sandbox` covers root
containers.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_CHAT_SIDEBAR_TEST_PORT` | `4099` | Fixed loopback port. The suite's in-band mock and the extension's activation seam both read it. |
| `OPENCODE_CHAT_SIDEBAR_TEST_SKIP_MOCK` | unset | When set (any value), the suite does NOT start the mock — the QA failure case (dead port ⇒ clean attach failure, no hang). |

The activation seam (`src/extension.ts`, env-gated): when
`OPENCODE_CHAT_SIDEBAR_TEST_PORT` is set, the effective config pins
`serverUrl=http://127.0.0.1:<port>` and `autoStartServer=false`, and
activation fires `manager.start()` so the ServerManager ATTACHES to the
pre-started mock (password-less: no credentials are ever stored in the
sandbox profile). When unset the extension is byte-for-byte the production
one. When the env is set, activation also returns
`{ manager, chat, sessions }` as the extension's public API surface; the
suite reaches it through `vscode.extensions.getExtension(...).exports`.

## Transport-level assertions only

Suites assert on the typed wire messages, never on webview DOM:

- host → webview: the provider's dev-only `_test.getPostedMessages()`
  recorder (erased in production builds).
- webview → host: `_test.receiveFromWebview(envelope)` feeds the SAME
  per-view `HostMessenger` dispatch that `webview.onDidReceiveMessage`
  drives (`HostMessenger.handleIncoming` is public for exactly this seam).

## Local fallback (no VS Code download)

If the machine cannot download the VS Code Electron build, the suite logic
still runs on any already-installed VS Code:

```sh
npm run build                 # dev extension bundle with __DEV__ recorders
node esbuild.config.mjs --test
code --extensionDevelopmentPath="$PWD" \
  --extensionTestsPath="$PWD/dist/test/suite/index.js"
```

(Use `code-insiders` likewise.) The same env knobs apply. Additionally,
`npx vitest run` exercises the same flows at unit level against the mock
(EventBridge/session-sync/prompt/answers domains), which is what keeps the
suite's wire expectations honest when the Electron run is impossible.

## Scenarios

The in-band mock starts on scenario `basic-chat`; suites switch with
`mock.setScenario(...)` (`permission-flow`, `old-server`, ...). The old-server
test restarts the mock on the same port pinned at `OLD_SERVER_VERSION` so the
capability detector re-probes a cold server (see the test's own header).

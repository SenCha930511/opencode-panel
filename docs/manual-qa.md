# Manual QA Checklist — opencode-panel 0.1.0

Executed during plan todo 25. Every scenario names its exact harness; automated
lines are run by the executor with evidence under `.omo/evidence/`, and lines
that genuinely need a GUI are marked **manual — user verification pending**
with precise reproduction steps (per the user directive, the executor does not
drive an interactive desktop session; the user performs those).

Environment record (captured at execute time, see
`.omo/evidence/task-25-opencode-vscode-sidebar.log` §env):

- `code --version` (bundled CLI, `>= 1.80` required for `--profile-temp`)
- `opencode --version`
- `node --version`, `vsce --version`
- Host: macOS arm64

State rules:

- Legend: `[x]` = evidenced this run, `[ ]` = manual — user verification pending.
- The extension under test is the built `opencode-panel-0.1.0.vsix` (not a dev run).
- Mock-driven scenarios use the repo harness: `node scripts/smoke-mock.mjs`
  (7 scenarios: `basic-chat`, `permission-flow`, `question-flow`, `long-stream`,
  `error-revert`, `omo-agents`, `old-server`) and `npm run test`
  (@vscode/test-electron suite against the mock).

---

## S01 — Packaged artifact integrity

- [x] `unzip -l opencode-panel-0.1.0.vsix` lists `extension/package.json`,
      `extension/dist/extension.js`, `extension/media/icon.svg`,
      `extension/media/webview/main.js`, `extension/media/webview/main.css`,
      `extension/l10n/…`, `extension/icon.png`, `extension/README.md`.
- [x] The same listing contains **no** `extension/src/` entries and no
      `.vscode-test/` entries.

```sh
unzip -l opencode-panel-0.1.0.vsix | tee .omo/evidence/task-25-vsix-listing.txt
grep -c "extension/src/" .omo/evidence/task-25-vsix-listing.txt   # must be 0
```

Evidence: `.omo/evidence/task-25-vsix-listing.txt`.

## S02 — Clean-profile install smoke

- [x] `code --profile-temp --install-extension opencode-panel-0.1.0.vsix` exits 0.
- [x] `code --profile-temp --list-extensions --show-versions | grep opencode-panel`
      prints `sencha930511.opencode-panel@0.1.0` (publisher id normalizes to
      lowercase on install; grep matched).

```sh
CODE="/path/to/code"   # recorded in evidence log §env
"$CODE" --profile-temp --install-extension opencode-panel-0.1.0.vsix
"$CODE" --profile-temp --list-extensions --show-versions | grep opencode-panel
```

Evidence: `.omo/evidence/task-25-opencode-vscode-sidebar.log` §S02.
Per the user directive, the install is left in place afterwards (nothing is
uninstalled, deleted, or reverted).

## S03 — Mock endpoint contract sweep (plain + omo-agents)

- [x] `node scripts/smoke-mock.mjs` exits 0 with
      `SMOKE OK — 91 checks passed across 7 scenarios + doc/404 contracts`.
- [x] `basic-chat` scenario emits ≥1 `message.part.delta` over SSE (plain server path).
- [x] `omo-agents` scenario asserts the agent list includes custom agents and
      tool parts carry custom tool names (OMO-friendly generic path).
- [x] `old-server` scenario asserts 404 JSON contracts for fork/question/todo routes.

```sh
node scripts/smoke-mock.mjs | tee .omo/evidence/task-25-mock-sweep.log
```

Evidence: `.omo/evidence/task-25-mock-sweep.log`.

## S04 — Activation + attach + status bar (mock)

- [x] `npm run test` (test-electron) passes 5/5 against the mock server.
- [x] The activation test asserts the extension activates, `ServerManager`
      attaches to the pre-started mock server, and the status bar shows
      the attached state.

```sh
npm run test 2>&1 | tee .omo/evidence/task-25-test-electron.log
```

Evidence: `.omo/evidence/task-25-test-electron.log` (activation + 4 more tests).

Manual eyeball (user): open the installed extension in a normal window, watch
the status bar item move `probing → attached:<port>`; the chat header status
dot turns green.

## S05 — Chat round-trip + Thinking (reasoning) collapsible

- [x] `chatRoundTrip.test.ts` passes: webview `ready` → `sendPrompt` →
      host handler receives `streamChunk`s then terminal `done`.
- [x] Mock `basic-chat` reply contains a `reasoning` part (asserted headlessly:
      1 reasoning part in the final assistant message; delta evidence in the
      main log §S05).

Manual eyeball (user): with the extension attached to the mock (`basic-chat`),
send any message; the assistant reply shows a collapsed, localized **Thinking**
(en) / **思考中** (zh-TW) affordance above the text; expanding it reveals the
reasoning content. Screenshot optional.

## S06 — Permission + question cards

- [x] `permissionFlow.test.ts` passes: scenario pushes `permission.asked`, card
      model is posted to the chat view, and the reply handler calls the mock
      reply endpoint (`POST /session/:id/permissions/:id {response:"once"}`).
- [x] Smoke sweep `permission-flow` + `question-flow` scenarios pass
      (`question.asked` answered, `question.replied` observed).

Manual eyeball (user): card shows **Allow once / Always allow / Reject**, and
disables after replying; question card renders the question options; neither is
auto-answered; aborting the session expires the card.

## S07 — omo-agents capability surfacing (plain vs OMO)

- [x] Capability tests green (covered by the 676/676 `npx vitest run` this
      todo): `omo-agents` ⇒ `omoDetected === true`, agents non-empty; guard
      helper hides nothing on the omo path.
- [x] Smoke sweep `omo-agents` scenario green (custom agents + custom tool names).

Manual eyeball (user): against the mock `omo-agents` scenario (or a real
OMO install), the agent dropdown lists the custom agents with a “custom”
badge; MCP panel header reads “natively configured MCPs” with the OMO note
(“plugins may inject additional MCPs not listed here”). Without OMO, everything
is identical minus the note.

## S08 — old-server graceful degradation

- [x] `oldServer.test.ts` passes: guarded controls are hidden per posted init
      capabilities (fork/question/todo/shell absent) and the version-warn
      banner path fires.

Manual eyeball (user): against the mock `old-server` scenario, the old-server
banner shows once; fork buttons, question cards, todos/diffs dock, and the
shell modal entry are hidden — no crash, no repeated toasts.

## S09 — Settings round-trip (native + custom page)

- [x] `settingsRoundTrip.test.ts` passes: webview `setSettings` patch writes the
      native configuration and the webview is notified.
- [x] `node scripts/gen-settings-schema.mjs --check` exits 0 (manifest keys and
      generated schema in sync).

Manual eyeball (user): gear icon → custom settings page; toggle
**autoStartServer**, change **port**, Apply → verify in VS Code Settings UI the
same keys changed; dirty-state Revert restores values; test-connection button
shows a live status line; password field round-trips through SecretStorage
(never written to settings JSON).

## S10 — Slash palette, pickers, todos/diffs dock, message ops

- [x] jsdom suites green (covered by the 676/676 `npx vitest run` this todo):
      slash palette lists mock commands incl. custom; agent/model pickers inject
      `body.agent` / `body.model`; todos/diffs dock renders from mock payloads;
      revert→confirm→unrevert op handlers hit the right endpoints.
- [x] Attachment-size contract: an 11 MB image is rejected with a size toast
      before sending (host test evidence, T17 log).
- [x] Token usage strip: `chat/usage` suites green (aggregation math,
      hidden-when-empty, SSR sentinel labels) plus the production-composition
      regression guard inside the full `npx vitest run`; evidence
      `.omo/evidence/fix-wave-composition.log`.

Manual eyeball (user): `/` opens the palette; `@` opens file search; pick a
file → chip; select text in an editor → context menu *Attach selection* →
selection chip; attach a `.env` file → sensitive-path warning banner; open a
todo row / a diff row → native `vscode.diff` opens; hover a message →
*Revert here* asks for confirmation, then *Restore reverted* appears.

## S11 — Status bar, TUI escape hatch, bilingual spot check

- [x] Status-bar state mapping + `openTui` argv tests green (T22 evidence log,
      re-verified inside the 676/676 run this todo).

Manual eyeball (user):

1. Status bar: stopped → probing → managed/attached states render; click →
   quickpick offers Start / Stop / Restart / Open Settings / Open TUI / Open Logs.
2. *Open opencode TUI* opens an integrated terminal running
   `opencode attach <url>` (env injection: `OPENCODE_SERVER_PASSWORD` passed
   through when set).
3. VS Code display language English → all strings en; switch to 繁體中文
   (Display Language) + reload → chat strings are zh-TW (spot-check: Send →
   傳送, Thinking → 思考中). Parity is enforced by
   `node scripts/check-i18n.mjs`.

## S12 — Real-opencode session smoke (MANDATORY)

- [x] Real `opencode serve` started on 127.0.0.1:4199; `GET /global/health`
      returns `{"healthy":true,"version":"1.18.15"}`.
- [x] Extension attaches to the REAL server: the todo-24 activation suite was
      re-run with `OPENCODE_PANEL_TEST_PORT=4199 OPENCODE_PANEL_TEST_SKIP_MOCK=1`
      (one-off activation-only index in `node_modules/.cache`, mirroring
      `src/test/suite/index.ts`); **1/1 passing** in a real VS Code extension
      host — `state=attached`, `baseUrl=http://127.0.0.1:4199`, status text
      `$(plug) OpenCode:4199`. Capability surfaces verified against the real
      `/doc` (JSON form, 162 routes — every route the extension uses present),
      real `/agent` (this host runs oh-my-opencode: Sisyphus/Prometheus/Atlas/
      Metis/Momus etc. ⇒ `omoDetected` agent-name signal), `/command`, `/config`
      (default model `nchc/Kimi-K3`), `/mcp` (plugin MCPs connected).
- [x] Prompt sent to a real session via the composer's exact surface
      (`POST /session` → `POST /session/{sessionID}/prompt_async` → SSE
      `/event`): **204, 7 streamed `message.part.delta` events, assistant
      replied `PANEL-SMOKE-OK`, 1 reasoning part** (Thinking data path against
      a real reasoning-capable model `nchc/Kimi-K3`).
      Full transcript: `.omo/evidence/task-25-real-opencode-smoke.log`.

Execution transcript + captured payloads: `.omo/evidence/task-25-real-opencode-smoke.log`.

Installed-window attempt (documented caveat): a scripted clean profile at
`.omo/qa/vscode-user-data` + `.omo/qa/vscode-extensions` (vsix installed via
CLI, `settings.json` pinned `serverUrl=http://127.0.0.1:4199`, debugLogs on)
launched a window whose main process ran but emitted no window/exthost logs in
this headless shell after ~90s (first-run dialogs are not observable from a
non-interactive session); the process was stopped. Attach to the real server
is instead evidenced by the activation-suite run above — one layer below the
GUI, inside a real extension host. The profile dirs are **left in place** for
the user's own walkthrough:

```sh
CODE=".vscode-test/vscode-darwin-arm64-1.134.0/Visual Studio Code.app/Contents/Resources/app/bin/code"
"$CODE" --user-data-dir .omo/qa/vscode-user-data \
        --extensions-dir .omo/qa/vscode-extensions /path/to/a/project
```

Manual eyeball (user): point `opencodePanel.serverUrl` at your own
`opencode serve` (or leave auto-start on), confirm attach in the status bar,
send a message, watch streaming + any permission cards fire for real.

---

## Sign-off

- Executor: all `[x]` items evidenced under `.omo/evidence/task-25-*` —
  S01 (vsix listing, zero `src/`), S02 (profile-temp install + grep), S03
  (mock sweep 91 checks), S04/S06/S08/S09 (test-electron 5/5), S05 (reasoning
  assertion), S07/S10/S11 (676/676 vitest incl. capability/webview/status
  suites), S12 (real `opencode serve` 1.18.15: capability inventory,
  activation-suite attach 1/1, real prompt round-trip PASS).
- Executor-side extras: `@types/vscode` pinned to `1.99.0` to satisfy vsce's
  engines check (`tsc --noEmit` clean afterwards; no `src` changes).
- No global installs were performed; `scripts/uninstall.sh` gained no entries.
- Manual items: user performs the S03–S12 eyeball steps in the installed
  clean-profile window (left in place per the no-uninstall directive).

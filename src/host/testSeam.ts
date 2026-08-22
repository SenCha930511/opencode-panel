/**
 * Todo-24 env-test seam (additive; the unset path is byte-for-byte the
 * production behavior), extracted from extension.ts so the activation root
 * stays within its size budget. When the @vscode/test-electron harness sets
 * OPENCODE_CHAT_SIDEBAR_TEST_PORT — only it ever does — the effective config pins
 * `serverUrl` at the suite's pre-started loopback mock and forces
 * `autoStartServer` off, so activation ATTACHES to that mock and never spawns
 * a real binary (password-less: the sandbox profile stores no credentials).
 */

import type { PanelConfig, PanelConfigAccessor } from "./config.js";
import type { ServerManager } from "../server/serverManager.js";
import type { PanelViewComposite } from "../providers/registration.js";
import type { ChatViewProvider } from "../providers/chatViewProvider.js";
import type { SessionsViewProvider } from "../providers/sessionsViewProvider.js";

/** Env-gated activation surface consumed by the todo-24 integration suite. */
export interface PanelActivationTestApi {
  readonly manager: ServerManager;
  readonly chat: ChatViewProvider;
  readonly sessions: SessionsViewProvider;
}

export function applyTestServerOverride(
  base: PanelConfigAccessor,
  testPort: string,
): PanelConfigAccessor {
  if (testPort === "") return base;
  const serverUrl = `http://127.0.0.1:${testPort}`;
  return {
    // read() stays dynamic so runtime settings writes still flow through;
    // only the endpoint and the spawn gate are pinned.
    read: (): PanelConfig => ({ ...base.read(), serverUrl, autoStartServer: false }),
    onDidChange: (listener) => base.onDidChange(listener),
    dispose: () => base.dispose(),
  };
}

/** Fire the mock attach and expose the harness API; production returns undefined. */
export function exposeTestAttach(
  testPort: string,
  manager: ServerManager,
  panel: PanelViewComposite,
): PanelActivationTestApi | undefined {
  if (testPort === "") return undefined;
  // start() never throws for lifecycle failures; the harness asserts the
  // resulting managed|attached|error state transitions instead.
  void manager.start();
  return { manager, chat: panel.chat, sessions: panel.sessions };
}

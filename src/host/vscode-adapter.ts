/**
 * Thin seam between the pure host modules (config / secrets / logger) and
 * the real `vscode` API surface. This is the ONLY file under `src/host/`
 * that resolves the extension-host `vscode` module at runtime, so unit
 * tests (which run under node + vitest) never touch it.
 *
 * The factories below are wired by `extension.ts` at activation time.
 */
import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  createConfigAccessor,
  type PanelConfigAccessor,
} from "./config.js";
import { PanelLogger } from "./logger.js";
import { PanelSecrets } from "./secrets.js";

/**
 * Typed config accessor backed by `workspace.getConfiguration("opencodePanel")`
 * and `workspace.onDidChangeConfiguration` (pre-filtered to our section).
 */
export function createVscodeConfigAccessor(): PanelConfigAccessor {
  return createConfigAccessor(
    {
      get: <T>(key: string): T | undefined =>
        vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key),
    },
    {
      onChange: (listener) =>
        vscode.workspace.onDidChangeConfiguration((event) => listener(event)),
    },
  );
}

/** Credential store backed by the extension context's SecretStorage. */
export function createVscodeSecrets(context: vscode.ExtensionContext): PanelSecrets {
  return new PanelSecrets(context.secrets);
}

/**
 * Logger writing to the "OpenCode Panel" output channel. The returned
 * channel must be pushed onto `context.subscriptions` by the caller so it
 * is disposed with the extension.
 */
export function createVscodeLogger(debugEnabled: () => boolean): {
  readonly logger: PanelLogger;
  readonly channel: vscode.OutputChannel;
} {
  const channel = vscode.window.createOutputChannel("OpenCode Panel");
  return { logger: new PanelLogger(channel, debugEnabled), channel };
}

/**
 * Provider composite / registrar (plan todo 10): constructs the chat and
 * sessions view providers on the shared dependencies, registers both
 * WebviewViews with the extension host, and exposes the `registerHandler`
 * passthrough todos 12-21 use to populate the domain handler map.
 *
 * This is the only providers module that resolves the `vscode` runtime (view
 * registration, Uri.joinPath); the providers themselves run on the narrow
 * seams in webviewSeam.ts and stay node-testable.
 */

import * as vscode from "vscode";
import type { PanelConfigAccessor } from "../host/config.js";
import type { PanelLogger } from "../host/logger.js";
import type { Handler } from "../host/messenger.js";
import type { ServerManager } from "../server/ServerManager.js";
import type { FromWebviewProtocol } from "../shared/protocol.js";
import type { ViewProviderDeps } from "./BaseViewProvider.js";
import { ChatViewProvider } from "./ChatViewProvider.js";
import { SessionsViewProvider } from "./SessionsViewProvider.js";
import { HandlerRegistry } from "./handlers.js";
import { createInitPayloadBuilder } from "./initPayload.js";

export const CHAT_VIEW_ID = "opencodePanel.chatView";
export const SESSIONS_VIEW_ID = "opencodePanel.sessionsView";

export interface PanelViewDeps {
  readonly config: PanelConfigAccessor;
  readonly logger: PanelLogger;
  readonly manager: ServerManager;
  /** `vscode.env.language`, read once at activation. */
  readonly envLanguage: string;
}

export interface PanelViewComposite {
  readonly chat: ChatViewProvider;
  readonly sessions: SessionsViewProvider;
  /** Composite-owned domain handler map (todos 12-21 populate it). */
  readonly handlers: HandlerRegistry;
  /**
   * Registers one domain handler everywhere: into the composite map (future
   * view resolves replay it) and into both live view messengers.
   */
  registerHandler<K extends keyof FromWebviewProtocol>(type: K, handler: Handler<K>): void;
}

export function registerPanelViews(
  context: vscode.ExtensionContext,
  deps: PanelViewDeps,
): PanelViewComposite {
  const handlers = new HandlerRegistry();
  const shared: ViewProviderDeps = {
    extensionUri: context.extensionUri,
    joinPath: (base, ...pathSegments) => vscode.Uri.joinPath(base, ...pathSegments),
    handlers,
    buildInitPayload: createInitPayloadBuilder({
      envLanguage: deps.envLanguage,
      config: deps.config,
      manager: deps.manager,
    }),
    onManagerStateChange: deps.manager.onDidChangeState,
    devMode: __DEV__,
    logger: deps.logger,
  };
  const chat = new ChatViewProvider(shared);
  const sessions = new SessionsViewProvider(shared);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, chat),
    vscode.window.registerWebviewViewProvider(SESSIONS_VIEW_ID, sessions),
  );
  return {
    chat,
    sessions,
    handlers,
    registerHandler(type, handler) {
      // Both providers record into the shared registry; overwrite is idempotent.
      chat.registerHandler(type, handler);
      sessions.registerHandler(type, handler);
    },
  };
}

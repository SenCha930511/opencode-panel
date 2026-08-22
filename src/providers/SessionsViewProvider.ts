/**
 * Provider for the todo-1 sessions webview view (`opencodeChatSidebar.sessionsView`).
 * Shell/messenger/handshake plumbing lives in BaseViewProvider; todo 12 wires
 * the sessions domain handlers and `sessionList` sync on top of this shell.
 */

import { BaseViewProvider, type ViewProviderDeps } from "./baseViewProvider.js";
import type { PanelViewKind } from "./html.js";

export class SessionsViewProvider extends BaseViewProvider {
  constructor(deps: ViewProviderDeps) {
    super(deps);
  }

  /** Stamps the shell so the bundle mounts ONLY the sessions panel. */
  protected override viewKind(): PanelViewKind {
    return "sessions";
  }
}

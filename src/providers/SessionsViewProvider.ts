/**
 * Provider for the todo-1 sessions webview view (`opencodePanel.sessionsView`).
 * Shell/messenger/handshake plumbing lives in BaseViewProvider; todo 12 wires
 * the sessions domain handlers and `sessionList` sync on top of this shell.
 */

import { BaseViewProvider, type ViewProviderDeps } from "./BaseViewProvider.js";

export class SessionsViewProvider extends BaseViewProvider {
  constructor(deps: ViewProviderDeps) {
    super(deps);
  }
}

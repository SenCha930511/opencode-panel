/**
 * Provider for the todo-1 chat webview view (`opencodePanel.chatView`).
 * All shell/messenger/handshake plumbing lives in BaseViewProvider; this
 * subclass adds the event surface host commands push into the chat route
 * (todo-14's composer consumes `command.newSession`).
 */

import type { EventPayload, ToastLevel, ToastPayload } from "../shared/protocol.js";
import { BaseViewProvider, type ViewProviderDeps } from "./BaseViewProvider.js";

export class ChatViewProvider extends BaseViewProvider {
  constructor(deps: ViewProviderDeps) {
    super(deps);
  }

  /** Posts a host-side event to the chat webview (todo-3 `event` message). */
  postEvent(type: string, payload: unknown): void {
    const event: EventPayload = { type, payload };
    this.post({ type: "event", payload: event });
  }

  /** Surfaces a host-originated toast in the chat webview's toast viewport. */
  postToast(level: ToastLevel, text: string): void {
    const payload: ToastPayload = { level, text };
    this.post({ type: "toast", payload });
  }
}

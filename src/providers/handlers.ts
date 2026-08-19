/**
 * Domain handler registry owned by the provider composite (plan todo 10).
 *
 * Todos 12-21 register one todo-3 `Handler` per `FromWebviewProtocol` message
 * type through the composite's `registerHandler` passthrough; the registry is
 * the storage seam behind it. Every resolved webview view wires the FULL
 * registry into its per-view HostMessenger, so a handler registered at any
 * time — before or after a view resolves — is live in every view.
 *
 * Entries are stored as typed registration closures (each `set` captures a
 * correctly-typed `messenger.register(type, handler)` call), so replaying the
 * registry into a fresh view needs no payload-erased casts.
 */

import type { Handler, HostMessenger } from "../host/messenger.js";
import type { FromWebviewProtocol } from "../shared/protocol.js";

/** Complete domain handler map; todos 12-21 fill it key by key. */
export type Handlers = {
  readonly [K in keyof FromWebviewProtocol]: Handler<K>;
};

export class HandlerRegistry {
  private readonly appliers = new Map<
    keyof FromWebviewProtocol,
    (messenger: HostMessenger) => void
  >();

  /** Registers (or replaces) the domain handler for one message type. */
  set<K extends keyof FromWebviewProtocol>(type: K, handler: Handler<K>): void {
    this.appliers.set(type, (messenger) => {
      messenger.register(type, handler);
    });
  }

  /** Wires every registered handler into a view's fresh messenger. */
  applyInto(messenger: HostMessenger): void {
    for (const apply of this.appliers.values()) {
      apply(messenger);
    }
  }

  /** Count of registered domain handlers (diagnostics/tests). */
  get size(): number {
    return this.appliers.size;
  }
}

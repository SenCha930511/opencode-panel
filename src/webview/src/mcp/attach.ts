/**
 * One-call attach for the todo-20 MCP stores (McpPopover, the chat header,
 * and todo 21's settings section all self-attach on mount — todo-15
 * precedent). Kept in its own module so the ./index.ts barrel stays a pure
 * re-export surface and never cycles back into the components.
 */

import type { WebviewMessenger } from "../../lib/messenger.js";
import { attachCapabilityFlags } from "./capabilityFlags.js";
import { attachMcpStore } from "./mcpStore.js";

/** Attach both todo-20 stores to one messenger; idempotent per messenger. */
export function attachMcpStores(messenger: WebviewMessenger): void {
  attachMcpStore(messenger);
  attachCapabilityFlags(messenger);
}

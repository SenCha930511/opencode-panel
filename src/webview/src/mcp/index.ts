/**
 * Public surface of the todo-20 MCP panel + capability-flag module. Todo 21
 * (settings capabilities section) and the chat header consume ONLY this
 * barrel: embed `<McpPanel />` (and optionally `<OldServerBanner />`), call
 * `attachMcpStores(messenger)` once per messenger, and read feature
 * visibility through `useCapabilityFlags()`.
 */

export { attachMcpStores } from "./attach.js";
export { MCP_STATUS_EVENT, dotForStatus, parseGuardsOverlay, parseMcpStatusSnapshot } from "./constants.js";
export type { McpDotClass, McpGuards, McpServerEntry, McpStatusSnapshot } from "./constants.js";
export {
  attachCapabilityFlags,
  getCapabilityFlags,
  INACTIVE_FLAGS,
  resetCapabilityFlagsForTest,
  subscribeCapabilityFlags,
  useCapabilityFlags,
} from "./capabilityFlags.js";
export type { CapabilityFlags } from "./capabilityFlags.js";
export {
  attachMcpStore,
  getMcpSnapshot,
  resetMcpStoreForTest,
  subscribeMcpSnapshot,
  useMcpSnapshot,
} from "./mcpStore.js";
export type { McpSnapshot } from "./mcpStore.js";
export { McpPanel } from "./McpPanel.js";
export { McpPopover } from "./McpPopover.js";
export { OldServerBanner } from "./OldServerBanner.js";

/**
 * MCP snapshot store (plan todo 20, webview side): the latest `mcp.status`
 * push's server list + optional error marker, boundary-parsed once at the
 * seam, exposed to components through useSyncExternalStore. Mirrors todo
 * 15's capabilityStore.
 *
 * DATA IN: the host's `mcp.status` event payload (see
 * src/host/handlers/mcpInfo.ts for the push contract and refresh triggers).
 * A malformed push is ignored entirely (the previous snapshot stays — a
 * drifted schema must not blank the panel mid-session). The `guards` block
 * is NOT stored here: todo 18-21's feature flags read it through
 * ./capabilityFlags.ts, which parses the same event.
 *
 * LIFECYCLE: `attachMcpStore(messenger)` subscribes the messenger's `event`
 * channel and is idempotent per messenger instance; the popover/chrome
 * self-attaches on mount (todo-15 precedent: no bootstrap file needs to
 * know about this store). `resetMcpStoreForTest` is the test seam.
 */

import { useSyncExternalStore } from "react";
import type { WebviewMessenger } from "../../lib/messenger.js";
import type { McpServerEntry } from "./constants.js";
import { MCP_STATUS_EVENT, parseMcpStatusSnapshot } from "./constants.js";

/** The panel's data slice of the mcp.status push (guards live elsewhere). */
export interface McpSnapshot {
  readonly servers: readonly McpServerEntry[];
  /** Technical summary set when the host's /mcp probe failed this refresh. */
  readonly error?: string;
}

type Listener = { (): void };

let snapshot: McpSnapshot | undefined;
const listeners = new Set<Listener>();
const attached = new WeakSet<WebviewMessenger>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The latest parsed snapshot; undefined until the host's first push lands. */
export function getMcpSnapshot(): McpSnapshot | undefined {
  return snapshot;
}

export function subscribeMcpSnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe the host event channel; repeats against one messenger no-op. */
export function attachMcpStore(messenger: WebviewMessenger): void {
  if (attached.has(messenger)) return;
  attached.add(messenger);
  messenger.on("event", (event) => {
    if (event.type !== MCP_STATUS_EVENT) return;
    const parsed = parseMcpStatusSnapshot(event.payload);
    if (parsed === undefined) return;
    snapshot = { servers: parsed.servers, ...(parsed.error === undefined ? {} : { error: parsed.error }) };
    emit();
  });
}

/** Test seam: drop the snapshot between suites (attach caches weaken out). */
export function resetMcpStoreForTest(): void {
  snapshot = undefined;
  emit();
}

/** React binding; undefined means "no mcp.status push yet" (zero rows). */
export function useMcpSnapshot(): McpSnapshot | undefined {
  // Third arg = server snapshot: renderToStaticMarkup suites mount hook users.
  return useSyncExternalStore(subscribeMcpSnapshot, getMcpSnapshot, getMcpSnapshot);
}

/**
 * Capability-flag store (plan todo 20, webview side): the visibility map
 * consumed by the todo 18/19/20/21 UI (fork/question/todo/shell +
 * omoMcpNote, plus omoDetected/oldServer), boundary-merged from every wire
 * source that carries guard bits, exposed through useSyncExternalStore.
 *
 * FRESHEST-SOURCE LAYERING (documented carrier decision — see
 * ./constants.ts): a later push overlays the previous one key-by-key, never
 * wholesale, so a partial older source cannot blank a fresher full one.
 *   1. `init`.capabilities — todo-3's minimal boolean matrix (today:
 *      fork/question/todo only); re-posted by the host on reconnect.
 *   2. `capabilities.refresh` — todo 15's picker push; a `guards` block is
 *      accepted here as the documented forward-compat overlay (todo 15's
 *      wire does not carry one today).
 *   3. `mcp.status` — todo 20's push; the AUTHORITATIVE full guard set
 *      (omoDetected/omoMcpNote/oldServer enter the webview only through it).
 *
 * UNSUPPORTED-FEATURE RULE: the default map hides everything — a control may
 * only appear once a wire source has explicitly asserted its bit. DOM-free
 * by construction; `useCapabilityFlags` is exported for the other todos.
 */

import { useSyncExternalStore } from "react";
import type { WebviewMessenger } from "../../lib/messenger.js";
import { isRecord } from "../../../shared/protocol.js";
import { CAPABILITIES_REFRESH_EVENT } from "../chat/pickers/constants.js";
import type { McpGuardsOverlay } from "./constants.js";
import { MCP_STATUS_EVENT, parseGuardsOverlay, parseMcpStatusSnapshot } from "./constants.js";

/** The guard visibility map the todo 18-21 UI consumes. */
export interface CapabilityFlags {
  readonly fork: boolean;
  readonly question: boolean;
  readonly todo: boolean;
  readonly shell: boolean;
  readonly omoMcpNote: boolean;
  readonly omoDetected: boolean;
  readonly oldServer: boolean;
}

/** Hide-everything default (UNSUPPORTED-FEATURE rule). */
export const INACTIVE_FLAGS: CapabilityFlags = {
  fork: false,
  question: false,
  todo: false,
  shell: false,
  omoMcpNote: false,
  omoDetected: false,
  oldServer: false,
};

type Listener = { (): void };

let flags: CapabilityFlags = INACTIVE_FLAGS;
const listeners = new Set<Listener>();
const attached = new WeakSet<WebviewMessenger>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Overlay only the keys the source carried; no key ever reverts implicitly. */
function applyOverlay(overlay: McpGuardsOverlay): void {
  flags = {
    fork: overlay.fork ?? flags.fork,
    question: overlay.question ?? flags.question,
    todo: overlay.todo ?? flags.todo,
    shell: overlay.shell ?? flags.shell,
    omoDetected: overlay.omoDetected ?? flags.omoDetected,
    omoMcpNote: overlay.omoMcpNote ?? flags.omoMcpNote,
    oldServer: overlay.oldServer ?? flags.oldServer,
  };
  emit();
}

/** The latest merged flags (hide-everything until a wire source asserts). */
export function getCapabilityFlags(): CapabilityFlags {
  return flags;
}

export function subscribeCapabilityFlags(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe the messenger's `init` + `event` channels; idempotent per
 * messenger instance. The init overlay reads todo-3's minimal matrix (and
 * any additional boolean bits a later init revision carries); the event
 * overlay parses the todo-20 mcp.status guards (full set — a malformed push
 * is ignored entirely) and todo 15's optional guards block.
 */
export function attachCapabilityFlags(messenger: WebviewMessenger): void {
  if (attached.has(messenger)) return;
  attached.add(messenger);
  messenger.on("init", (payload) => {
    applyOverlay(parseGuardsOverlay(payload.capabilities));
  });
  messenger.on("event", (event) => {
    if (event.type === MCP_STATUS_EVENT) {
      const snapshot = parseMcpStatusSnapshot(event.payload);
      if (snapshot === undefined) return;
      applyOverlay(snapshot.guards);
      return;
    }
    if (event.type === CAPABILITIES_REFRESH_EVENT && isRecord(event.payload)) {
      applyOverlay(parseGuardsOverlay(event.payload.guards));
    }
  });
}

/** Test seam: return to the hide-everything map between suites. */
export function resetCapabilityFlagsForTest(): void {
  flags = INACTIVE_FLAGS;
  emit();
}

/** React binding; defaults to INACTIVE_FLAGS before any wire data lands. */
export function useCapabilityFlags(): CapabilityFlags {
  // Third arg = server snapshot: renderToStaticMarkup suites mount hook users.
  return useSyncExternalStore(subscribeCapabilityFlags, getCapabilityFlags, getCapabilityFlags);
}

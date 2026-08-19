/**
 * Capability snapshot store (plan todo 15, webview side): the latest
 * `capabilities.refresh` push, boundary-parsed once at the seam, exposed to
 * components through useSyncExternalStore.
 *
 * DATA IN: the host's `capabilities.refresh` event payload (see
 * src/host/handlers/capabilityInfo.ts for the push contract and refresh
 * triggers). A malformed push is ignored entirely (the previous snapshot
 * stays — a drifted schema must not blank the pickers mid-session).
 *
 * LIFECYCLE: `attachCapabilityStore(messenger)` subscribes the messenger's
 * `event` channel and is idempotent per messenger instance; the picker
 * components self-attach on mount so no bootstrap file needs to know about
 * this store. `resetCapabilityStoreForTest` is the test seam (production
 * never clears).
 */

import { useSyncExternalStore } from "react";
import type { WebviewMessenger } from "../../../lib/messenger.js";
import {
  CAPABILITIES_REFRESH_EVENT,
  parseCapabilitySnapshot,
  type CapabilitySnapshot,
} from "./constants.js";

type Listener = { (): void };

let snapshot: CapabilitySnapshot | undefined;
const listeners = new Set<Listener>();
const attached = new WeakSet<WebviewMessenger>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The latest parsed snapshot; undefined until the host's first push lands. */
export function getCapabilitySnapshot(): CapabilitySnapshot | undefined {
  return snapshot;
}

export function subscribeCapabilitySnapshot(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe the host event channel; repeats against one messenger no-op. */
export function attachCapabilityStore(messenger: WebviewMessenger): void {
  if (attached.has(messenger)) return;
  attached.add(messenger);
  messenger.on("event", (event) => {
    if (event.type !== CAPABILITIES_REFRESH_EVENT) return;
    const parsed = parseCapabilitySnapshot(event.payload);
    if (parsed === undefined) return;
    snapshot = parsed;
    emit();
  });
}

/** Test seam: drop the snapshot between suites (attach caches weaken out). */
export function resetCapabilityStoreForTest(): void {
  snapshot = undefined;
  emit();
}

/** React binding; undefined means "no capability push yet" (all pickers hide). */
export function useCapabilitySnapshot(): CapabilitySnapshot | undefined {
  // Third arg = server snapshot: renderToStaticMarkup suites mount hook users.
  return useSyncExternalStore(
    subscribeCapabilitySnapshot,
    getCapabilitySnapshot,
    getCapabilitySnapshot,
  );
}

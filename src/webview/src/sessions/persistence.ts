/**
 * Selection + filter persistence for the sessions panel (todo 12).
 *
 * Primary carrier: `vscode.setState` via the todo-3 webview messenger module's
 * single `acquireVsCodeApi()` handle (the runtime allows exactly ONE acquire,
 * so this module never declares/acquires its own).
 *
 * HOST MEMENTO FALLBACK (documented gap): todo 12 also asks for a host
 * Memento fallback over a messenger request. Todo-3's protocol carries no
 * state read/write request type and src/shared is read-only for this todo, so
 * the fallback cannot cross the wire yet; the seam below is the exact shape a
 * future `readState`/`writeState` request would back. The same gap is logged
 * in src/host/handlers/sync.ts for the plan owner.
 */

import { getWebviewState } from "../../lib/messenger.js";

export interface SessionsPersistedShape {
  readonly selectedId: string | null;
  readonly filter: string;
}

/** Sync seam so the store stays node-testable (tests use an in-memory fake). */
export interface SessionsPersistence {
  load(): SessionsPersistedShape | undefined;
  save(shape: SessionsPersistedShape): void;
}

function isShape(value: unknown): value is SessionsPersistedShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.selectedId !== null && typeof record.selectedId !== "string") return false;
  return typeof record.filter === "string";
}

/** Production value: vscode.setState-backed, or undefined outside a webview. */
export function createWebviewPersistence(): SessionsPersistence | undefined {
  const state = getWebviewState();
  return {
    load: () => {
      const value = state.getState();
      return isShape(value) ? value : undefined;
    },
    save: (shape) => {
      state.setState(shape);
    },
  };
}

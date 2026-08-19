/**
 * Active-session contract (todo 12 deliverable for todo 13's chat).
 *
 * The sessions panel owns SELECTION; the chat domain reads it through this
 * minimal surface: `current()` returns the selected session id (`null` when
 * nothing is selected — chat then prompts the user to pick or create one),
 * and `subscribe` fires AFTER every committed change (both user clicks and
 * optimistic-update rollbacks — a consumer never observes an intermediate),
 * returning an unsubscribe function. Emissions are deduped: a listener only
 * fires when the id actually changes.
 *
 * Wiring (todo 13): `store.activeSession` on the shared SessionsStore
 * instance, provided by the app shell (todo 11) mounting the sessions panel.
 */

export interface ActiveSession {
  current(): string | null;
  subscribe(listener: (id: string | null) => void): () => void; // i18n-allow-literal
}

export class ActiveSessionEmitter implements ActiveSession {
  private id: string | null = null;
  private readonly listeners = new Set<(id: string | null) => void>();

  current(): string | null {
    return this.id;
  }

  subscribe(listener: (id: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Commit a new selection; no-op (and no emission) when unchanged. */
  set(id: string | null): void {
    if (this.id === id) return;
    this.id = id;
    for (const listener of [...this.listeners]) {
      listener(id);
    }
  }
}

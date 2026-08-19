import type { SessionEntry } from "./constants.js";
import type { SessionsStore } from "./sessionsStore.js";

/**
 * Share|unshare flow for the sessions rail (todo 12): on share, the server
 * link goes to the clipboard and the row carries a transient copied mark; on
 * unshare, the share is dropped. Bindings are injected so node tests see the
 * copied-mark lifecycle without a DOM clipboard.
 */

const COPIED_MARK_MS = 2_000;

export interface ScheduledRun {
  (): void;
}

export interface ShareLinkBindings {
  writeClipboard(text: string): Promise<void>;
  schedule(run: ScheduledRun, delayMs: number): void;
}

export interface ShareLink {
  (store: SessionsStore, entry: SessionEntry): Promise<void>;
}

const defaultBindings: ShareLinkBindings = {
  writeClipboard: (text) => {
    return navigator.clipboard.writeText(text);
  },
  schedule: (run, delayMs) => {
    setTimeout(run, delayMs);
  },
};

export function createShareLink(bindings: ShareLinkBindings = defaultBindings): ShareLink {
  return async (store, entry) => {
    if (entry.shared) {
      await store.unshareSession(entry.id).catch(() => {
        return undefined;
      });
      return;
    }
    const url = await store.shareSession(entry.id).catch(() => {
      return null;
    });
    if (url === null) return;
    try {
      await bindings.writeClipboard(url);
    } catch {
      // Clipboard blocked (permissions): the server link still exists; no mark.
      return;
    }
    store.markCopied(entry.id);
    bindings.schedule(() => {
      store.clearCopied();
    }, COPIED_MARK_MS);
  };
}

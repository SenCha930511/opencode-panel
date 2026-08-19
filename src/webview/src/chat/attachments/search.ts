// i18n-allow-literal — no display copy in this module.
/**
 * Debounced @-mention search (plan todo 17, webview side): a DOM-free state
 * machine between the composer textarea signal and the host `searchFiles`
 * request. Trailing-edge debounce at {@link MENTION_DEBOUNCE_MS} (the plan's
 * 150ms) — a typing burst issues AT MOST one request; latest-wins, so a
 * stale response can never overwrite newer rows. An absent/empty query
 * cancels any pending call and clears the rows WITHOUT requesting (a bare
 * `@` waits for the first character). Search failures degrade to empty rows
 * quietly: a typeahead never toasts — the composer textarea stays usable.
 */

export const MENTION_DEBOUNCE_MS = 150;

export interface MentionSearchDeps {
  readonly search: { (query: string): Promise<readonly string[]> };
  readonly delayMs?: number;
}

export interface MentionSearch {
  /** Feed the query extracted at the caret; undefined closes the palette. */
  setQuery(query: string | undefined): void;
  readonly rows: readonly string[];
  readonly pending: boolean;
  onChange(listener: { (): void }): { (): void };
  cancel(): void;
}

export function createMentionSearch(deps: MentionSearchDeps): MentionSearch {
  const delay = deps.delayMs ?? MENTION_DEBOUNCE_MS;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let rows: readonly string[] = [];
  let pending = false;

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    setQuery(query) {
      sequence += 1;
      clearTimer();
      if (query === undefined || query.length === 0) {
        if (rows.length > 0 || pending) {
          rows = [];
          pending = false;
          emit();
        }
        return;
      }
      pending = true;
      const snapshot = sequence;
      timer = setTimeout(() => {
        deps.search(query).then(
          (result) => {
            if (snapshot !== sequence) return;
            rows = result;
            pending = false;
            emit();
          },
          () => {
            if (snapshot !== sequence) return;
            rows = [];
            pending = false;
            emit();
          },
        );
      }, delay);
    },
    get rows() {
      return rows;
    },
    get pending() {
      return pending;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel() {
      sequence += 1;
      clearTimer();
      rows = [];
      pending = false;
    },
  };
}

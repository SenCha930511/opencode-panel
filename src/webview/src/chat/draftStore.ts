/**
 * Per-session composer draft persistence (todo 14, webview side).
 *
 * DOM-free (node-testable): the vscode webview state surface is injected as
 * {@link WebviewStateLike}; the production default rides the todo-3
 * messenger module's single `acquireVsCodeApi()` handle (`getWebviewState`,
 * never a second acquire). Drafts are keyed by sessionId inside ONE namespaced
 * key of the top-level state object ({@link DRAFTS_STATE_KEY}) and every
 * write MERGES into the existing top-level state, so the todo-12 selection
 * persistence (`src/webview/src/sessions/persistence.ts`, which merges the
 * same way) and drafts coexist — neither clobbers the other's key.
 *
 * WRITE PATH: every `write()` updates the in-memory map immediately (reads
 * are always synchronous — the session switch can never observe a stale
 * draft) and schedules a debounced state persist (default 150ms, per the
 * todo spec). `flush()` forces an immediate persist: the composer calls it
 * on unmount and after a successful send/clear, collapsing the debounce
 * window so a webview reload within it still survives ("draft survives
 * simulated reload" acceptance). A persist NEVER happens before the first
 * hydrate, so an unparsed/foreign state shape can never be overwritten by
 * an empty drafts map.
 */

import { isRecord } from "../../../shared/protocol.js";
import { getWebviewState } from "../../lib/messenger.js";

export interface WebviewStateLike {
  getState(): unknown;
  setState(state: unknown): void;
}

/** Top-level webview-state key holding `{ [sessionId]: draftText }`. */
export const DRAFTS_STATE_KEY = "composerDrafts";

const DRAFT_PERSIST_DEBOUNCE_MS = 150;

export interface DraftStoreOptions {
  readonly debounceMs?: number;
}

export class DraftStore {
  private readonly state: WebviewStateLike;
  private readonly debounceMs: number;
  private readonly drafts = new Map<string, string>();
  private hydrated = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(state: WebviewStateLike, options: DraftStoreOptions = {}) {
    this.state = state;
    this.debounceMs = options.debounceMs ?? DRAFT_PERSIST_DEBOUNCE_MS;
  }

  /** Current draft for one session ("" when none). Hydrates on first call. */
  read(sessionId: string): string {
    this.hydrate();
    return this.drafts.get(sessionId) ?? "";
  }

  /** Persist-on-change: immediate in-memory swap + debounced state write. */
  write(sessionId: string, text: string): void {
    this.hydrate();
    if (text.length === 0) {
      this.drafts.delete(sessionId);
    } else {
      this.drafts.set(sessionId, text);
    }
    this.schedulePersist();
  }

  /** Successful send: drop the draft and persist immediately. */
  clear(sessionId: string): void {
    this.hydrate();
    if (!this.drafts.has(sessionId)) return;
    this.drafts.delete(sessionId);
    this.flush();
  }

  /** Collapse the pending debounce and persist right now (unmount/switch). */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.persistNow();
  }

  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const value = this.state.getState();
    if (!isRecord(value)) return;
    const stored = value[DRAFTS_STATE_KEY];
    if (!isRecord(stored)) return;
    for (const [key, draft] of Object.entries(stored)) {
      if (typeof draft === "string" && draft.length > 0) this.drafts.set(key, draft);
    }
  }

  private schedulePersist(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.persistNow();
    }, this.debounceMs);
  }

  private persistNow(): void {
    if (!this.hydrated) return;
    const value = this.state.getState();
    const base = isRecord(value) ? value : {};
    const drafts: Record<string, string> = Object.fromEntries(this.drafts);
    this.state.setState({ ...base, [DRAFTS_STATE_KEY]: drafts });
  }
}

/** Production value: vscode webview state behind the shared api handle. */
export function createWebviewDraftStore(options: DraftStoreOptions = {}): DraftStore {
  return new DraftStore(getWebviewState(), options);
}

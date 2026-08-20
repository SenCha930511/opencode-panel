/**
 * MessageStore (todo 13): the chat view-model state container.
 *
 * Pure, framework-free, `useSyncExternalStore`-compatible. Three writers:
 * host poll-sync (`messages.sync` full/delta events), live SSE deltas
 * (`message.part.delta[Batch]`), and completion signals
 * (`message.part.updated`, `session.status`). All merge rules live here so
 * components render the snapshot verbatim.
 *
 * STREAM/TEXT RECONCILIATION: every text-bearing part carries an implicit
 * split — server-authoritative text plus a stream tail of deltas appended
 * since the part's last authoritative replace. A refetch may race live
 * deltas, so replace uses {@link reconcileTail}: if the authoritative text
 * already ends with the tail, the tail is folded; if the tail already
 * extends the authoritative text, the snapshot was stale and the tail
 * stands alone; otherwise both are kept (streamed user content is NEVER
 * dropped — the plan binding for delta handling).
 *
 * ORDERING: server payloads keep their given order; in-flight placeholder
 * parts (deltas seen before any sync named their part) are appended after
 * authoritative parts and sorted among themselves by natural id order, so
 * out-of-order arrival (prt_2's delta before prt_1's) still renders in part
 * order — `message.part.updated` / the next sync then cements server order.
 *
 * VISIBILITY (the raw/visible split): writers merge into the RAW list
 * (`this.messages`); the published state carries only the VISIBLE list
 * derived by `./visibility.js` — OMO/system-injected parts are stripped
 * (synthetic flag + directive patterns) and, when a revert marker is set
 * for the session, every message below the marker is cut. The raw list is
 * never mutated by filtering, so an unrevert restores the tail instantly
 * without a refetch. Markers are per session and survive session switches.
 */

import {
  parseMessageList,
  parsePart,
  type DeltaBatchEntry,
  type MessageVM,
  type PartVM,
} from "./types.js";
import { isRecord } from "../../../shared/protocol.js";
import { visibleMessages } from "./visibility.js";

export type SessionStatus = "idle" | "busy";

export interface ChatStoreState {
  readonly sessionId: string | undefined;
  readonly messages: readonly MessageVM[];
  readonly status: SessionStatus;
}

export type StoreListener = { (): void };

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function reconcileTail(
  authoritative: string,
  tail: string,
): { readonly text: string; readonly tail: string } {
  if (tail.length === 0 || authoritative.endsWith(tail)) {
    return { text: authoritative, tail: "" };
  }
  if (tail.startsWith(authoritative)) {
    // Stale snapshot: the stream is the truth; nothing folded, nothing lost.
    return { text: "", tail };
  }
  return { text: authoritative, tail };
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class MessageStore {
  private state: ChatStoreState = { sessionId: undefined, messages: [], status: "idle" };
  /** Raw merged list — writers build from THIS, never from the visible one. */
  private messages: readonly MessageVM[] = [];
  private sessionId: string | undefined;
  private status: SessionStatus = "idle";
  private readonly listeners = new Set<StoreListener>();
  private readonly streamTails = new Map<string, string>();
  private readonly placeholderPartIds = new Set<string>();
  /** sessionId -> reverted-to message id; survives session switches. */
  private readonly revertedMessageIds = new Map<string, string>();

  readonly subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): ChatStoreState => {
    return this.state;
  };

  /** Publish: the visible list re-derives from raw on EVERY write. */
  private publish(): void {
    const marker =
      this.sessionId === undefined ? undefined : this.revertedMessageIds.get(this.sessionId);
    this.state = {
      sessionId: this.sessionId,
      messages: visibleMessages(this.messages, marker),
      status: this.status,
    };
    for (const listener of this.listeners) listener();
  }

  /** Switch sessions (T12 drives this): state resets; tails are per-session. */
  setSession(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    this.streamTails.clear();
    this.placeholderPartIds.clear();
    this.messages = [];
    this.sessionId = sessionId;
    this.status = "idle";
    this.publish();
  }

  /** Gate: events for other sessions never touch this view's state. */
  targetsSession(sessionId: string | undefined): boolean {
    return sessionId === undefined || sessionId === this.sessionId;
  }

  /**
   * Record the session's revert point: the marked message stays, every
   * message below it drops out of the visible list (raw kept for unrevert).
   */
  applyReverted(messageId: string): void {
    if (this.sessionId === undefined) return;
    this.revertedMessageIds.set(this.sessionId, messageId);
    this.publish();
  }

  /** Clear the session's revert point (unrevert): the tail reappears. */
  clearReverted(): void {
    if (this.sessionId === undefined) return;
    if (!this.revertedMessageIds.delete(this.sessionId)) return;
    this.publish();
  }

  /** `messages.sync` full payload: verbatim replacement + tail reconciliation. */
  applyFullSync(sessionId: string, payload: unknown): void {
    // Full sync is the host's authoritative snapshot for the SELECTED session
    // — always re-bind. (Prev: only bound when sessionless, so any second
    // session's sync was dropped and the chat was stranded on the first one.)
    this.setSession(sessionId);
    if (!this.targetsSession(sessionId)) return;
    this.messages = parseMessageList(payload).map((message) => {
      return this.reconcileMessage(message);
    });
    this.placeholderPartIds.clear();
    this.pruneTails(this.messages);
    this.publish();
  }

  /** `messages.sync` delta payload (>250-merge): keyed upsert + removal. */
  applyDeltaSync(sessionId: string, upsertedPayload: unknown, removed: readonly string[]): void {
    if (!this.targetsSession(sessionId)) return;
    const removedSet = new Set(removed);
    const messages = this.messages.filter((message) => !removedSet.has(message.id));
    const positionOf = new Map(messages.map((message, index) => [message.id, index]));
    for (const raw of parseMessageList(upsertedPayload)) {
      const message = this.reconcileMessage(raw);
      const at = positionOf.get(message.id);
      if (at === undefined) {
        messages.push(message);
      } else {
        messages[at] = message;
      }
    }
    this.messages = messages;
    this.pruneTails(messages);
    this.publish();
  }

  /** One streamed delta: append into the (possibly placeholder) part. */
  applyStreamDelta(entry: DeltaBatchEntry): void {
    if (!this.targetsSession(entry.sessionID)) return;
    const oldTail = this.streamTails.get(entry.partID) ?? "";
    const tail = oldTail + entry.delta;
    this.streamTails.set(entry.partID, tail);
    const messages = this.messages.map((message) => ({ ...message }));
    let message = messages.find((candidate) => {
      return candidate.id === entry.messageID;
    });
    if (message === undefined) {
      message = {
        id: entry.messageID,
        sessionID: entry.sessionID,
        role: "assistant",
        info: {},
        inFlight: true,
        parts: [],
      };
      messages.push(message);
    }
    const at = message.parts.findIndex((part) => {
      return part.id === entry.partID;
    });
    const part = at === -1 ? undefined : message.parts[at];
    if (part === undefined) {
      this.placeholderPartIds.add(entry.partID);
      const placeholder: PartVM = { kind: "text", id: entry.partID, text: tail };
      message.parts = [...message.parts, placeholder].sort(this.partOrder);
    } else if (part.kind === "text" || part.kind === "reasoning") {
      const base = part.text.endsWith(oldTail)
        ? part.text.slice(0, part.text.length - oldTail.length)
        : part.text;
      const parts = [...message.parts];
      parts[at] = { ...part, text: base + tail } as PartVM;
      message.parts = parts;
    }
    // Non-text parts never mutate from deltas; the updated/sync path owns them.
    this.messages = messages;
    this.publish();
  }

  /** `message.part.updated`: authoritative part state (finalizes a part). */
  applyPartUpdated(payload: unknown): void {
    if (!isRecord(payload) || !isRecord(payload.part)) return;
    const raw = payload.part;
    const messageID = stringOr(raw.messageID);
    const sessionID = stringOr(raw.sessionID);
    if (!this.targetsSession(sessionID) || messageID === undefined) return;
    const part = parsePart(raw, `part-${this.streamTails.size}`);
    const messages = this.messages.map((message) => ({ ...message }));
    let message = messages.find((candidate) => {
      return candidate.id === messageID;
    });
    if (message === undefined) {
      message = { id: messageID, sessionID, role: "assistant", info: {}, inFlight: true, parts: [] };
      messages.push(message);
    }
    this.placeholderPartIds.delete(part.id);
    const finalized = this.reconcilePart(part);
    const at = message.parts.findIndex((candidate) => {
      return candidate.id === part.id;
    });
    if (at === -1) {
      message.parts = [...message.parts, finalized];
    } else {
      const parts = [...message.parts];
      parts[at] = finalized;
      message.parts = parts;
    }
    this.messages = messages;
    this.publish();
  }

  /** `session.status` / `session.idle`: busy drives Stop/Regenerate (T14). */
  applySessionStatus(sessionId: string | undefined, type: string | undefined): void {
    if (!this.targetsSession(sessionId)) return;
    const status: SessionStatus = type === "idle" ? "idle" : "busy";
    if (status === this.status) return;
    this.status = status;
    this.publish();
  }

  /** Placeholders always sort after authoritative parts, natural id order. */
  private readonly partOrder = (a: PartVM, b: PartVM): number => {
    const aPlaceholder = this.placeholderPartIds.has(a.id);
    const bPlaceholder = this.placeholderPartIds.has(b.id);
    if (aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;
    if (aPlaceholder) return naturalCompare(a.id, b.id);
    return 0;
  };

  /** Fold a parsed message's parts against any pending stream tails. */
  private reconcileMessage(message: MessageVM): MessageVM {
    return { ...message, parts: message.parts.map((part) => this.reconcilePart(part)) };
  }

  private reconcilePart(part: PartVM): PartVM {
    if (part.kind !== "text" && part.kind !== "reasoning") return part;
    const tail = this.streamTails.get(part.id) ?? "";
    if (tail.length === 0) return part;
    const reconciled = reconcileTail(part.text, tail);
    this.streamTails.set(part.id, reconciled.tail);
    return { ...part, text: reconciled.text + reconciled.tail } as PartVM;
  }

  /** Tails for parts that vanished entirely are dropped with the part. */
  private pruneTails(messages: readonly MessageVM[]): void {
    const alive = new Set<string>();
    for (const message of messages) for (const part of message.parts) alive.add(part.id);
    for (const partID of [...this.streamTails.keys()]) {
      if (!alive.has(partID)) this.streamTails.delete(partID);
    }
    for (const partID of [...this.placeholderPartIds]) {
      if (!alive.has(partID)) this.placeholderPartIds.delete(partID);
    }
  }
}

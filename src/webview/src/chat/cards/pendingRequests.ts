/**
 * Pending permission/question request store (plan todo 16, webview side).
 *
 * Pure, DOM-free, framework-free, `useSyncExternalStore`-compatible — the
 * same posture as todo-13's MessageStore. T9 forwards
 * `permission.asked` / `question.asked` (payload shapes in ./cardTypes.ts;
 * todo-5 mock verbatim); this store turns them into cards keyed by
 * `(sessionId, requestId)` and drives their lifecycle:
 *
 * - asked          -> card created (status "pending"); a repeat ask on the
 *                     same key replaces the card (idempotent adoption).
 * - replied        -> `permission.replied` / `question.replied` /
 *                     `question.rejected` CLEAR the card — answered by
 *                     ANYONE (this panel, another client, or a timeout the
 *                     server settled), so a stale card can never be replied
 *                     to twice.
 * - expiry         -> `session.idle` / `session.status{idle}` / local reply
 *                     failure mark the session's remaining cards "expired";
 *                     the card stays visible with its controls disabled and
 *                     the `permission.expired` note until removed (QA failure
 *                     scenario: reply after abort). "expired" cards never go
 *                     back.
 * - unsupported    -> question replies that 404 mean the endpoint is absent
 *                     or defunct (todo-7 `hasQuestion` / stale request):
 *                     {@link markQuestionUnsupported} drops every question
 *                     card and latches the `questionUnsupported` flag; the
 *                     dock then shows ONE `question.unavailable` toast.
 *
 * NEVER auto-answers anything (todo-16 binding): the store only records;
 * replies are explicit user actions routed through the controller.
 *
 * View-models + event names: ./cardTypes.ts. Boundary parsers: ./cardParsers.ts.
 */

import { isRecord } from "../../../../shared/protocol.js";
import type { ChatEvent } from "../events.js";
import {
  PERMISSION_ASKED_EVENT_TYPE,
  PERMISSION_REPLIED_EVENT_TYPE,
  QUESTION_ASKED_EVENT_TYPE,
  QUESTION_REJECTED_EVENT_TYPE,
  QUESTION_REPLIED_EVENT_TYPE,
  SESSION_IDLE_EVENT_TYPE,
  SESSION_STATUS_EVENT_TYPE,
  type CardStatus,
  type PendingCardVM,
  type PendingRequestsState,
} from "./cardTypes.js";
import {
  parsePermissionCard,
  parseQuestionCard,
  repliedKeyOf,
  sessionIdOf,
} from "./cardParsers.js";

export type PendingRequestsListener = { (): void };

// ---------------------------------------------------------------------------
// Selectors (pure; the dock renders the snapshot verbatim).

/** Cards anchored to one session, insertion order (queue order). */
export function cardsForSession(
  state: PendingRequestsState,
  sessionId: string | undefined,
): readonly PendingCardVM[] {
  if (sessionId === undefined) return [];
  return state.cards.filter((card) => {
    return card.sessionId === sessionId;
  });
}

/**
 * Multi-session queue badge: actionable (pending/replying) cards anchored to
 * sessions OTHER than the viewed one.
 */
export function pendingCountOtherSessions(
  state: PendingRequestsState,
  sessionId: string | undefined,
): number {
  return state.cards.filter((card) => {
    return card.sessionId !== sessionId && card.status !== "expired";
  }).length;
}

export function findCard(
  state: PendingRequestsState,
  sessionId: string,
  requestId: string,
): PendingCardVM | undefined {
  return state.cards.find((card) => {
    return card.sessionId === sessionId && card.requestId === requestId;
  });
}

// ---------------------------------------------------------------------------
// The store.

export class PendingRequestsStore {
  private state: PendingRequestsState = { cards: [], questionUnsupported: false };
  private questionsEnabled = true;
  private readonly listeners = new Set<PendingRequestsListener>();

  readonly subscribe = (listener: PendingRequestsListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): PendingRequestsState => {
    return this.state;
  };

  get questionsSupported(): boolean {
    return this.questionsEnabled && !this.state.questionUnsupported;
  }

  private emit(next: PendingRequestsState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private replaceCard(next: PendingCardVM): void {
    const cards = this.state.cards.filter((card) => {
      return !(card.sessionId === next.sessionId && card.requestId === next.requestId);
    });
    this.emit({ ...this.state, cards: [...cards, next] });
  }

  /**
   * Capability gate (todo-7 `hasQuestion` / todo-16 "hide with toast"): when
   * the connected server cannot answer questions, pending question cards are
   * dropped and future asks are recorded only through the unsupported flag
   * (the dock fires one toast on the transition — see the controller).
   */
  setQuestionsEnabled(enabled: boolean): void {
    if (this.questionsEnabled === enabled) return;
    this.questionsEnabled = enabled;
    if (enabled) return;
    this.markQuestionUnsupported();
  }

  /** A 404 on the question reply folds every question card + latches the flag. */
  markQuestionUnsupported(): void {
    if (this.state.questionUnsupported && !this.state.cards.some((c) => c.kind === "question")) {
      return;
    }
    this.emit({
      questionUnsupported: true,
      cards: this.state.cards.filter((card) => {
        return card.kind !== "question";
      }),
    });
  }

  markReplying(sessionId: string, requestId: string): void {
    this.transition(sessionId, requestId, "pending", "replying");
  }

  /** A transient failure restores the card so the user may retry. */
  markPending(sessionId: string, requestId: string): void {
    this.transition(sessionId, requestId, "replying", "pending");
  }

  markExpired(sessionId: string, requestId: string): void {
    this.transitionAny(sessionId, requestId, "expired");
  }

  remove(sessionId: string, requestId: string): void {
    const cards = this.state.cards.filter((card) => {
      return !(card.sessionId === sessionId && card.requestId === requestId);
    });
    if (cards.length === this.state.cards.length) return;
    this.emit({ ...this.state, cards });
  }

  private transition(
    sessionId: string,
    requestId: string,
    from: CardStatus,
    to: CardStatus,
  ): void {
    const cards = this.state.cards.map((card) => {
      if (card.sessionId !== sessionId || card.requestId !== requestId) return card;
      if (card.status !== from) return card;
      return { ...card, status: to };
    });
    this.emit({ ...this.state, cards });
  }

  private transitionAny(sessionId: string, requestId: string, to: CardStatus): void {
    const cards = this.state.cards.map((card) => {
      if (card.sessionId !== sessionId || card.requestId !== requestId) return card;
      if (card.status === to) return card;
      return { ...card, status: to };
    });
    this.emit({ ...this.state, cards });
  }

  /** Abort / stream end for a session expires every card it still holds. */
  expireSession(sessionId: string): void {
    if (!this.state.cards.some((card) => {
      return card.sessionId === sessionId;
    })) {
      return;
    }
    const cards = this.state.cards.map((card) => {
      if (card.sessionId !== sessionId || card.status === "expired") return card;
      return { ...card, status: "expired" as const };
    });
    this.emit({ ...this.state, cards });
  }

  // -- forwarded-event intake -------------------------------------------------

  /**
   * Route one forwarded chat event. Permission- and question-family events
   * mutate this store; everything else is ignored (other todos' domains).
   * Returns true when the event named a card-affecting transition, so the
   * dock can drive its one-shot unsupported toast without polling state.
   */
  applyEvent(event: ChatEvent): boolean {
    switch (event.type) {
      case PERMISSION_ASKED_EVENT_TYPE: {
        const card = parsePermissionCard(event.payload);
        if (card === undefined) return false;
        this.replaceCard(card);
        return true;
      }
      case QUESTION_ASKED_EVENT_TYPE: {
        const card = parseQuestionCard(event.payload);
        if (card === undefined) return false;
        // Unsupported servers never surface question cards (hidden surface).
        if (!this.questionsEnabled || this.state.questionUnsupported) {
          if (!this.state.questionUnsupported) {
            this.emit({ ...this.state, questionUnsupported: true });
          }
          return true;
        }
        this.replaceCard(card);
        return true;
      }
      case PERMISSION_REPLIED_EVENT_TYPE:
      case QUESTION_REPLIED_EVENT_TYPE:
      case QUESTION_REJECTED_EVENT_TYPE: {
        const key = repliedKeyOf(event.payload);
        if (key === undefined) return false;
        this.remove(key.sessionId, key.requestId);
        return true;
      }
      case SESSION_IDLE_EVENT_TYPE: {
        const sessionId = sessionIdOf(event.payload);
        if (sessionId === undefined) return false;
        this.expireSession(sessionId);
        return true;
      }
      case SESSION_STATUS_EVENT_TYPE: {
        // `session.status {type:"idle"}` is the abort/stream-end signal the
        // todo-16 binding names; busy sessions keep their pending cards.
        if (!isRecord(event.payload)) return false;
        const status = event.payload.status;
        const isIdle = (isRecord(status) && status.type === "idle") || status === "idle";
        if (!isIdle) return false;
        const sessionId = sessionIdOf(event.payload);
        if (sessionId === undefined) return false;
        this.expireSession(sessionId);
        return true;
      }
      default:
        return false;
    }
  }
}

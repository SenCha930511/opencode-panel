/**
 * Dock controller (plan todo 16, webview side): the pure, DOM-free wiring
 * between the {@link PendingRequestsStore}, the frozen todo-3 reply wire
 * calls, and the surface notices. The React dock is a thin shell over this.
 *
 * REPLY LIFECYCLE (binding):
 * - reply      -> markReplying (card disables optimistically) -> wire call.
 * - success    -> the card is REMOVED immediately (the server's
 *                 permission.replied/question.replied SSE is then a no-op).
 * - HTTP 404   -> permission: the request is defunct server-side, the card
 *                 flips to "expired" (QA failure scenario: reply after
 *                 abort). question: ANY 404 means unsupported-or-defunct —
 *                 the controller latches the store's `questionUnsupported`
 *                 and fires ONE `question-unsupported` notice; the dock maps
 *                 that to one `question.unavailable` toast and the store has
 *                 already dropped every question card.
 * - other error -> transient: the card returns to "pending" so the user
 *                 may retry (the todo-3 messenger still carried the detail
 *                 into the error reply; the composition surfaces it).
 *
 * ERROR CLASSIFICATION rides the todo-3 error-reply text (`Error.name:
 * message` — the host wraps remote failure text in a RemoteError whose
 * MESSAGE carries it). Matchers are exported for tests + components.
 *
 * NEVER auto-answers anything: every wire call originates from a user
 * gesture on a card; dismiss is local-hide only and settles nothing.
 */

import type { PermissionResponse } from "../../../../shared/protocol.js";
import { findCard, type PendingRequestsStore } from "./pendingRequests.js";

export interface PermissionReplyInput {
  readonly sessionId: string;
  readonly permissionID: string;
  readonly response: PermissionResponse;
}

export interface QuestionReplyInput {
  readonly sessionId: string;
  readonly questionID: string;
  readonly answers: readonly string[];
}

/** The two frozen todo-3 wire calls the cards fire. */
export interface ReplyActions {
  answerPermission(input: PermissionReplyInput): Promise<void>;
  answerQuestion(input: QuestionReplyInput): Promise<void>;
}

export type AnswerErrorKind = "unsupported" | "expired" | "error";

const QUESTION_UNSUPPORTED_NAME = "QuestionUnsupportedError";

/**
 * Classify a reply failure from its wire text. The host names typed errors
 * (`QuestionUnsupportedError`, `PermissionAnswerError`) and appends
 * `(HTTP <status>)`; transient transport failures have no marker. The todo-3
 * webview messenger wraps host text in a `RemoteError` whose NAME is lost —
 * the typed name then survives only at the START of `error.message`, so both
 * the name and the message head are matched.
 */
export function classifyAnswerError(error: unknown): AnswerErrorKind {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === QUESTION_UNSUPPORTED_NAME || message.startsWith(`${QUESTION_UNSUPPORTED_NAME}:`)) {
    return "unsupported";
  }
  if (message.includes("HTTP 404")) return "expired";
  return "error";
}

export function isQuestionUnsupported(error: unknown): boolean {
  return classifyAnswerError(error) === "unsupported";
}

/** Surface notices the dock maps onto toasts/banners. */
export interface DockNotice {
  readonly kind: "question-unsupported";
}

export interface DockController {
  /** Reply to a permission card; no-op when the card is gone/expired. */
  replyPermission(sessionId: string, requestId: string, response: PermissionResponse): Promise<void>;
  /** Answer a question card; no-op when the card is gone/expired. */
  replyQuestion(sessionId: string, requestId: string, answers: readonly string[]): Promise<void>;
  /** Local-only hide of a question card; NEVER settles the server request. */
  dismissQuestion(sessionId: string, requestId: string): void;
  /** Local-only removal of an EXPIRED card (any kind). */
  dismissCard(sessionId: string, requestId: string): void;
}

export interface DockControllerDeps {
  readonly store: PendingRequestsStore;
  readonly actions: ReplyActions;
  onNotice?(notice: DockNotice): void;
}

export function createDockController(deps: DockControllerDeps): DockController {
  const { store } = deps;
  let unsupportedNotified = false;

  const noticeUnsupported = (): void => {
    const wasUnsupported = store.getState().questionUnsupported;
    store.markQuestionUnsupported();
    if (!wasUnsupported && !unsupportedNotified) {
      unsupportedNotified = true;
      deps.onNotice?.({ kind: "question-unsupported" });
    }
  };

  return {
    async replyPermission(sessionId, requestId, response) {
      const card = findCard(store.getState(), sessionId, requestId);
      // Only a pending card may fire: replying covers the in-flight double
      // click, expired covers answered-elsewhere/abort-expired requests.
      if (card === undefined || card.kind !== "permission" || card.status !== "pending") return;
      store.markReplying(sessionId, requestId);
      try {
        await deps.actions.answerPermission({ sessionId, permissionID: requestId, response });
        store.remove(sessionId, requestId);
      } catch (error) {
        if (classifyAnswerError(error) === "expired") {
          store.markExpired(sessionId, requestId);
        } else {
          store.markPending(sessionId, requestId);
        }
      }
    },

    async replyQuestion(sessionId, requestId, answers) {
      const card = findCard(store.getState(), sessionId, requestId);
      if (card === undefined || card.kind !== "question" || card.status !== "pending") return;
      store.markReplying(sessionId, requestId);
      try {
        await deps.actions.answerQuestion({ sessionId, questionID: requestId, answers });
        store.remove(sessionId, requestId);
      } catch (error) {
        switch (classifyAnswerError(error)) {
          case "unsupported":
            noticeUnsupported();
            return;
          case "expired":
            store.markExpired(sessionId, requestId);
            return;
          case "error":
            store.markPending(sessionId, requestId);
            return;
        }
      }
    },

    dismissQuestion(sessionId, requestId) {
      const card = findCard(store.getState(), sessionId, requestId);
      if (card === undefined || card.kind !== "question") return;
      store.remove(sessionId, requestId);
    },

    dismissCard(sessionId, requestId) {
      const card = findCard(store.getState(), sessionId, requestId);
      if (card === undefined || card.status !== "expired") return;
      store.remove(sessionId, requestId);
    },
  };
}

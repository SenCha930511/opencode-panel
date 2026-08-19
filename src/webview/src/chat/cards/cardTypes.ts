/**
 * Card view-models + forwarded-event names (plan todo 16, webview side).
 * Pure data — no parsing, no store logic (./cardParsers.ts, ./pendingRequests.ts).
 *
 * T9 forwards `permission.asked` / `question.asked` with payloads
 * `{id, sessionID, permission, patterns, metadata, always, tool?}` /
 * `{id, sessionID, questions, tool?}` VERBATIM (mirroring the todo-5 mock);
 * these view-models are what the parsers turn them into.
 */

export type CardStatus = "pending" | "replying" | "expired";

export interface PermissionCardVM {
  readonly kind: "permission";
  readonly sessionId: string;
  readonly requestId: string;
  /** Tool permission name VERBATIM from the payload (e.g. "bash"). */
  readonly permission: string;
  /** Patterns the tool wants to run (verbatim strings). */
  readonly patterns: readonly string[];
  /**
   * One-line purpose: `metadata.description` when the payload carries a
   * string description, else the patterns joined for a single line.
   */
  readonly purpose: string | undefined;
  readonly status: CardStatus;
}

export interface QuestionOptionVM {
  readonly label: string;
  readonly description: string | undefined;
}

export interface QuestionPromptVM {
  readonly question: string;
  readonly header: string | undefined;
  readonly options: readonly QuestionOptionVM[];
  readonly multiple: boolean;
}

export interface QuestionCardVM {
  readonly kind: "question";
  readonly sessionId: string;
  readonly requestId: string;
  readonly questions: readonly QuestionPromptVM[];
  readonly status: CardStatus;
}

export type PendingCardVM = PermissionCardVM | QuestionCardVM;

export interface PendingRequestsState {
  readonly cards: readonly PendingCardVM[];
  readonly questionUnsupported: boolean;
}

export const PERMISSION_ASKED_EVENT_TYPE = "permission.asked";
export const PERMISSION_REPLIED_EVENT_TYPE = "permission.replied";
export const QUESTION_ASKED_EVENT_TYPE = "question.asked";
export const QUESTION_REPLIED_EVENT_TYPE = "question.replied";
export const QUESTION_REJECTED_EVENT_TYPE = "question.rejected";
export const SESSION_IDLE_EVENT_TYPE = "session.idle";
export const SESSION_STATUS_EVENT_TYPE = "session.status";

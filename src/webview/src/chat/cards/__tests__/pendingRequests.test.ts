// i18n-allow-literal — test fixtures carry mock/event payload strings; they
// are wire data, not display copy routed through t().
/**
 * Pending-requests store + dock controller suite (plan todo 16, node env).
 *
 * Covers the binding flows:
 * - permission.asked/question.asked create cards keyed (sessionId, requestId)
 * - reply -> optimistic "replying" disable -> success removes the card
 * - permission.replied/question.replied/question.rejected clears the card
 *   (replied-invalidates-stale-card) — a late reply can never double-fire
 * - session.idle / session.status{idle} expire the session's pending cards
 *   ("must NOT forget to clear card on abort/stream end")
 * - concurrent different-session cards stay independent; the queue badge
 *   counts actionable cross-session requests
 * - wire reply payloads are passed VERBATIM ({sessionId, permissionID,
 *   response} / {sessionId, questionID, answers})
 * - question 404 -> all question cards dropped + ONE question-unsupported
 *   notice; permission 404 -> the card flips to "expired"; other failures
 *   restore "pending" for retry
 * - capability gate off -> question.asked never surfaces a card
 */

import { describe, expect, it } from "vitest";

import {
  cardsForSession,
  findCard,
  PendingRequestsStore,
  pendingCountOtherSessions,
} from "../pendingRequests.js";
import {
  classifyAnswerError,
  createDockController,
  type DockNotice,
  type ReplyActions,
} from "../controller.js";

function permissionAsked(sessionID: string, id: string): {
  readonly type: string;
  readonly payload: unknown;
} {
  return {
    type: "permission.asked",
    payload: {
      id,
      sessionID,
      permission: "bash",
      patterns: ["ls -la"],
      metadata: {},
      always: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    },
  };
}

function questionAsked(sessionID: string, id: string): {
  readonly type: string;
  readonly payload: unknown;
} {
  return {
    type: "question.asked",
    payload: {
      id,
      sessionID,
      questions: [
        {
          question: "Which variant should I build?",
          header: "Variant",
          options: [
            { label: "minimal", description: "Smallest working version" },
            { label: "full", description: "All features" },
          ],
          multiple: false,
        },
      ],
      tool: { messageID: "msg_1", callID: "call_2" },
    },
  };
}

interface RecordedCalls {
  readonly permissions: {
    readonly sessionId: string;
    readonly permissionID: string;
    readonly response: string;
  }[];
  readonly questions: {
    readonly sessionId: string;
    readonly questionID: string;
    readonly answers: readonly string[];
  }[];
}

function recordingActions(overrides?: {
  readonly permissionError?: (call: unknown) => Error;
  readonly questionError?: (call: unknown) => Error;
}): { readonly actions: ReplyActions; readonly calls: RecordedCalls } {
  const calls: RecordedCalls = { permissions: [], questions: [] };
  return {
    calls,
    actions: {
      answerPermission(input) {
        calls.permissions.push(input);
        const failure = overrides?.permissionError?.(input);
        return failure === undefined ? Promise.resolve() : Promise.reject(failure);
      },
      answerQuestion(input) {
        calls.questions.push(input);
        const failure = overrides?.questionError?.(input);
        return failure === undefined ? Promise.resolve() : Promise.reject(failure);
      },
    },
  };
}

/** The todo-3 RemoteError wrapper shape: name lost, typed name in message. */
function remoteError(hostText: string): Error {
  const error = new Error(hostText);
  error.name = "RemoteError";
  return error;
}

describe("PendingRequestsStore", () => {
  it("permission.asked creates a pending card with tool name + purpose verbatim", () => {
    const store = new PendingRequestsStore();
    expect(store.applyEvent(permissionAsked("ses_1", "per_1"))).toBe(true);
    const card = findCard(store.getState(), "ses_1", "per_1");
    expect(card?.kind).toBe("permission");
    if (card === undefined || card.kind !== "permission") throw new Error("wrong card");
    expect(card.permission).toBe("bash");
    expect(card.patterns).toEqual(["ls -la"]);
    expect(card.purpose).toBe("ls -la");
    expect(card.status).toBe("pending");
  });

  it("metadata.description wins over the joined patterns as the purpose line", () => {
    const store = new PendingRequestsStore();
    store.applyEvent({
      type: "permission.asked",
      payload: {
        id: "per_9",
        sessionID: "ses_1",
        permission: "edit",
        patterns: ["src/a.ts"],
        metadata: { description: "edit the source tree" },
        always: [],
      },
    });
    const card = findCard(store.getState(), "ses_1", "per_9");
    if (card === undefined || card.kind !== "permission") throw new Error("wrong card");
    expect(card.purpose).toBe("edit the source tree");
  });

  it("a repeat ask on the same key replaces the card (idempotent adoption)", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent({
      type: "permission.asked",
      payload: { id: "per_1", sessionID: "ses_1", permission: "webfetch", patterns: [], metadata: {} },
    });
    const cards = cardsForSession(store.getState(), "ses_1");
    expect(cards.length).toBe(1);
    const card = cards[0];
    if (card === undefined || card.kind !== "permission") throw new Error("wrong card");
    expect(card.permission).toBe("webfetch");
  });

  it("question.asked parses questions[] with options as data", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    const card = findCard(store.getState(), "ses_1", "qst_1");
    if (card === undefined || card.kind !== "question") throw new Error("wrong card");
    expect(card.questions.length).toBe(1);
    const prompt = card.questions[0];
    expect(prompt?.question).toBe("Which variant should I build?");
    expect(prompt?.header).toBe("Variant");
    expect(prompt?.options.map((option) => option.label)).toEqual(["minimal", "full"]);
    expect(prompt?.multiple).toBe(false);
  });

  it("permission.replied clears the card (replied-invalidates-stale-card)", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent({
      type: "permission.replied",
      payload: { sessionID: "ses_1", permissionID: "per_1", response: "once" },
    });
    expect(findCard(store.getState(), "ses_1", "per_1")).toBeUndefined();
    // A second replied for the (now unknown) request is a silent no-op.
    expect(() =>
      store.applyEvent({
        type: "permission.replied",
        payload: { sessionID: "ses_1", permissionID: "per_1", response: "always" },
      }),
    ).not.toThrow();
    expect(store.getState().cards.length).toBe(0);
  });

  it("question.replied and question.rejected clear the card", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    store.applyEvent({
      type: "question.replied",
      payload: { sessionID: "ses_1", requestID: "qst_1", answers: ["minimal"] },
    });
    expect(findCard(store.getState(), "ses_1", "qst_1")).toBeUndefined();

    store.applyEvent(questionAsked("ses_1", "qst_2"));
    store.applyEvent({
      type: "question.rejected",
      payload: { sessionID: "ses_1", requestID: "qst_2" },
    });
    expect(findCard(store.getState(), "ses_1", "qst_2")).toBeUndefined();
  });

  it("session.idle expires the session's pending cards (abort/stream-end clearing)", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    const changed: number[] = [];
    const unsubscribe = store.subscribe(() => changed.push(store.getState().cards.length));
    store.applyEvent({ type: "session.idle", payload: { sessionID: "ses_1" } });
    unsubscribe();
    expect(changed.length).toBe(1);
    const cards = cardsForSession(store.getState(), "ses_1");
    expect(cards.length).toBe(2);
    expect(cards.every((card) => card.status === "expired")).toBe(true);
    // One expiry only toggles a given session once (no useless notifies).
    store.applyEvent({ type: "session.idle", payload: { sessionID: "ses_1" } });
  });

  it("session.status{idle} expires; session.status{busy} keeps pending cards", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent(permissionAsked("ses_2", "per_2"));
    store.applyEvent({
      type: "session.status",
      payload: { sessionID: "ses_2", status: { type: "busy" } },
    });
    expect(findCard(store.getState(), "ses_2", "per_2")?.status).toBe("pending");
    store.applyEvent({
      type: "session.status",
      payload: { sessionID: "ses_2", status: { type: "idle" } },
    });
    expect(findCard(store.getState(), "ses_2", "per_2")?.status).toBe("expired");
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("pending");
  });

  it("concurrent different-session cards stay independent; the badge counts others", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_a", "per_a"));
    store.applyEvent(questionAsked("ses_b", "qst_b"));
    store.applyEvent(permissionAsked("ses_c", "per_c"));
    const state = store.getState();
    expect(cardsForSession(state, "ses_a").length).toBe(1);
    expect(pendingCountOtherSessions(state, "ses_a")).toBe(2);
    // Expired others never inflate the badge.
    store.applyEvent({ type: "session.idle", payload: { sessionID: "ses_b" } });
    expect(pendingCountOtherSessions(store.getState(), "ses_a")).toBe(1);
    // Unviewed: the badge totals only actionable requests (expired excluded).
    expect(pendingCountOtherSessions(store.getState(), undefined)).toBe(2);
  });

  it("malformed payloads vanish silently instead of creating junk cards", () => {
    const store = new PendingRequestsStore();
    expect(store.applyEvent({ type: "permission.asked", payload: { id: "per_x" } })).toBe(false);
    expect(store.applyEvent({ type: "permission.asked", payload: "garbage" })).toBe(false);
    expect(store.applyEvent({ type: "question.asked", payload: { id: "q", sessionID: "s", questions: [] } })).toBe(false);
    expect(store.applyEvent({ type: "some.other.event", payload: {} })).toBe(false);
    expect(store.getState().cards.length).toBe(0);
  });

  it("capability gate off: question.asked never surfaces a card and latches unsupported", () => {
    const store = new PendingRequestsStore();
    store.setQuestionsEnabled(false);
    expect(store.getState().questionUnsupported).toBe(true);
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    expect(findCard(store.getState(), "ses_1", "qst_1")).toBeUndefined();
    // Permission cards are unaffected by the question gate.
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("pending");
  });
});

describe("DockController", () => {
  it("reply permission: markReplying disables optimistically, success removes; wire payload verbatim", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    const { actions, calls } = recordingActions();
    const controller = createDockController({ store, actions });

    const pending = controller.replyPermission("ses_1", "per_1", "once");
    // The reply is in flight: the card is optimistically disabled.
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("replying");
    // Double-fire while disabled is a no-op (one wire call only).
    await controller.replyPermission("ses_1", "per_1", "always");
    await pending;

    expect(findCard(store.getState(), "ses_1", "per_1")).toBeUndefined();
    expect(calls.permissions).toEqual([
      { sessionId: "ses_1", permissionID: "per_1", response: "once" },
    ]);
  });

  it("reply question: success removes; {sessionId, questionID, answers} verbatim", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(questionAsked("ses_2", "qst_3"));
    const { actions, calls } = recordingActions();
    const controller = createDockController({ store, actions });

    await controller.replyQuestion("ses_2", "qst_3", ["minimal"]);
    expect(findCard(store.getState(), "ses_2", "qst_3")).toBeUndefined();
    expect(calls.questions).toEqual([
      { sessionId: "ses_2", questionID: "qst_3", answers: ["minimal"] },
    ]);
  });

  it("stale reply: a replied card cannot be replied to (no second wire call)", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent({
      type: "permission.replied",
      payload: { sessionID: "ses_1", permissionID: "per_1", response: "once" },
    });
    const { actions, calls } = recordingActions();
    const controller = createDockController({ store, actions });
    await controller.replyPermission("ses_1", "per_1", "always");
    expect(calls.permissions.length).toBe(0);
  });

  it("QA failure path: permission reply 404 flips the card to expired", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    const { actions } = recordingActions({
      permissionError: () =>
        remoteError("PermissionAnswerError: permission not found: per_1 (HTTP 404)"),
    });
    const controller = createDockController({ store, actions });
    await controller.replyPermission("ses_1", "per_1", "once");
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("expired");
    // Expired cards reject further replies without a wire call.
    await controller.replyPermission("ses_1", "per_1", "always");
  });

  it("question 404 drops every question card and notices exactly once", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    store.applyEvent(questionAsked("ses_2", "qst_2"));
    const notices: DockNotice[] = [];
    const { actions } = recordingActions({
      questionError: () =>
        remoteError("QuestionUnsupportedError: question replies unsupported on this server: x (HTTP 404)"),
    });
    const controller = createDockController({
      store,
      actions,
      onNotice: (notice) => notices.push(notice),
    });

    await controller.replyQuestion("ses_1", "qst_1", ["minimal"]);
    expect(store.getState().questionUnsupported).toBe(true);
    // BOTH pending question cards dropped — the whole surface hides.
    expect(store.getState().cards.filter((card) => card.kind === "question").length).toBe(0);
    expect(notices).toEqual([{ kind: "question-unsupported" }]);

    // A second legacy call (another card raced it) never double-toasts.
    await controller.replyQuestion("ses_2", "qst_2", ["full"]);
    expect(notices.length).toBe(1);
  });

  it("transient failure restores the card to pending for a retry", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    const failing = recordingActions({
      permissionError: () => remoteError("Error: fetch failed"),
    });
    const controller = createDockController({ store, actions: failing.actions });
    await controller.replyPermission("ses_1", "per_1", "once");
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("pending");

    // The retry then goes through cleanly against a healthy stub.
    const healthy = recordingActions();
    const controller2 = createDockController({ store, actions: healthy.actions });
    await controller2.replyPermission("ses_1", "per_1", "always");
    expect(findCard(store.getState(), "ses_1", "per_1")).toBeUndefined();
    expect(healthy.calls.permissions).toEqual([
      { sessionId: "ses_1", permissionID: "per_1", response: "always" },
    ]);
  });

  it("expired card born of session.idle also refuses replies (abort then click)", async () => {
    const store = new PendingRequestsStore();
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    store.applyEvent({ type: "session.idle", payload: { sessionID: "ses_1" } });
    const { actions, calls } = recordingActions();
    const controller = createDockController({ store, actions });
    await controller.replyPermission("ses_1", "per_1", "once");
    expect(calls.permissions.length).toBe(0);
  });

  it("dismiss question hides locally only; dismissCard removes expired only", () => {
    const store = new PendingRequestsStore();
    store.applyEvent(questionAsked("ses_1", "qst_1"));
    store.applyEvent(permissionAsked("ses_1", "per_1"));
    const { actions } = recordingActions();
    const controller = createDockController({ store, actions });

    controller.dismissCard("ses_1", "per_1");
    expect(findCard(store.getState(), "ses_1", "per_1")?.status).toBe("pending");

    controller.dismissQuestion("ses_1", "qst_1");
    expect(findCard(store.getState(), "ses_1", "qst_1")).toBeUndefined();

    store.applyEvent({ type: "session.idle", payload: { sessionID: "ses_1" } });
    controller.dismissCard("ses_1", "per_1");
    expect(findCard(store.getState(), "ses_1", "per_1")).toBeUndefined();
  });
});

describe("classifyAnswerError", () => {
  it("maps the host's typed names and HTTP markers onto reply outcomes", () => {
    expect(
      classifyAnswerError(
        remoteError("QuestionUnsupportedError: question replies unsupported on this server: x"),
      ),
    ).toBe("unsupported");
    expect(classifyAnswerError(remoteError("PermissionAnswerError: not found (HTTP 404)"))).toBe(
      "expired",
    );
    expect(classifyAnswerError(remoteError("Error: socket hangup"))).toBe("error");
    expect(classifyAnswerError("plain string failure")).toBe("error");
  });
});

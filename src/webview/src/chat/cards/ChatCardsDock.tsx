/**
 * Chat cards dock (todo 16, EXPORTED mount contract for the shared chat
 * section, sibling seam of T13's MessageList / T14's Composer).
 *
 * MOUNT CONTRACT (binding; no T11/T13/T14 files are edited by this todo):
 * this dock is composed into the chat slot the same way those siblings are —
 * as an exported component the chat-slot composition renders, typically
 * ABOVE the composer and anchored to the active session:
 *
 *   <ChatCardsDock
 *     store={cardsStore}            // optional; share across mounts if needed
 *     questionsEnabled={init.capabilities.question}   // todo-7 capability bit
 *     onNotice={(notice) => toast(t("question.unavailable"))}
 *   />
 *
 * The integration todo (24) owns that composition; every prop is optional —
 * un-propped, the dock binds its own store and the todo-3 webview messenger
 * lazily on first interaction (never at render time), so static rendering
 * and node tests need no VSCode API.
 *
 * Event intake consumes the EXPORTED todo-13 seam (`ChatEventSource` from
 * ../events) directly — permission/question events are deliberately ignored
 * by the message router ("unknown event families are other todos' domains"),
 * so no router edits are needed.
 *
 * Renders: one card per pending/answering/expired request of the ACTIVE
 * session, plus a numeric multi-session queue badge counting actionable
 * requests anchored to OTHER sessions (a bare count carries no copy, so no
 * string id was needed — frozen string tables noted in the report).
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getWebviewMessenger } from "../../../lib/messenger.js";
import { getActiveSession, subscribeActiveSession } from "../activeSession.js";
import { createMessengerEventSource, type ChatEventSource } from "../events.js";
import { createDockController, type DockNotice, type ReplyActions } from "./controller.js";
import { PermissionCard } from "./PermissionCard.js";
import {
  cardsForSession,
  PendingRequestsStore,
  pendingCountOtherSessions,
} from "./pendingRequests.js";
import { QuestionCard } from "./QuestionCard.js";
import { useSessionAutoMode } from "../composerOptions.js";
import { ensureAutoArmed } from "../sessionArming.js";

export interface ChatCardsDockProps {
  readonly store?: PendingRequestsStore;
  readonly source?: ChatEventSource;
  readonly actions?: ReplyActions;
  /** Todo-7 `hasQuestion` bit; hides the whole question surface when false. */
  readonly questionsEnabled?: boolean;
  onNotice?(notice: DockNotice): void;
}

function defaultActions(): ReplyActions {
  return {
    answerPermission: async (input) => {
      await getWebviewMessenger().request("answerPermission", input);
    },
    answerQuestion: async (input) => {
      await getWebviewMessenger().request("answerQuestion", input);
    },
  };
}

export function ChatCardsDock(props: ChatCardsDockProps) {
  const store = useMemo(() => (props.store ?? new PendingRequestsStore()), [props.store]);
  const controller = useMemo(
    () =>
      createDockController({
        store,
        actions: props.actions ?? defaultActions(),
        ...(props.onNotice === undefined ? {} : { onNotice: props.onNotice }),
      }),
    [store, props.actions, props.onNotice],
  );

  // Capability gate: a server without the questions route hides the surface.
  useEffect(() => {
    store.setQuestionsEnabled(props.questionsEnabled ?? true);
  }, [store, props.questionsEnabled]);

  useEffect(() => {
    const source = props.source ?? createMessengerEventSource(getWebviewMessenger());
    return source.subscribeEvent((event) => {
      store.applyEvent(event);
    });
  }, [props.source, store]);

  // getServerSnapshot mirrors the client read so SSR renders never revert to
  // client rendering (node tests render static markup; T13's 2-arg hooks do
  // not SSR, so the exported subscribe/get pair is used directly here).
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const activeSession = useSyncExternalStore(
    subscribeActiveSession,
    getActiveSession,
    getActiveSession,
  );
  const cards = cardsForSession(state, activeSession);
  const othersCount = pendingCountOtherSessions(state, activeSession);
  const autoMode = useSessionAutoMode(activeSession);

  useEffect(() => {
    ensureAutoArmed(activeSession, autoMode);
  }, [activeSession, autoMode]);

  if (cards.length === 0 && othersCount === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4.5 sm:px-5 py-1 z-10 transition-all duration-300 ease-out animate-in fade-in slide-in-from-bottom-2" data-oc-dock="cards">
      {cards.map((card) =>
        card.kind === "permission" ? (
          <PermissionCard
            key={card.requestId}
            card={card}
            onReply={(response) => {
              void controller.replyPermission(card.sessionId, card.requestId, response);
            }}
            onDismiss={() => controller.dismissCard(card.sessionId, card.requestId)}
          />
        ) : (
          <QuestionCard
            key={card.requestId}
            card={card}
            onSubmit={(answers) => {
              void controller.replyQuestion(card.sessionId, card.requestId, answers);
            }}
            onDismiss={() => controller.dismissQuestion(card.sessionId, card.requestId)}
          />
        ),
      )}
      {othersCount > 0 ? (
        <span
          role="status"
          className="self-end rounded-full border border-border px-2 py-0.5 text-[0.85em] leading-none text-muted-fg"
        >
          {String(othersCount)}
        </span>
      ) : null}
    </div>
  );
}

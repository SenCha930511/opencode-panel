/**
 * MessageList (todo 13, EXPORTED mount contract for T11's shell).
 *
 * T11 slots `<MessageList />` into the chat route; everything is optional:
 * - `store` / `source` / `actions` are dependency seams (tests inject fakes);
 *   defaults bind to the todo-3 webview messenger + the T9 `event` channel.
 * - Streaming, poll-sync merge, sanitizer and generic tool cards all live in
 *   `./messageStore`, `./events`, `./parts` — this file is composition only.
 *
 * Also exported for sibling todos: {@link MessageListBody} (virtuoso-free
 * row map, used by the node tests below AND as the item renderer contract),
 * {@link useChatStore} (T14's composer reads `status` for Stop/Regenerate
 * from the same store), plus the store/source/action types via ./types,
 * ./events, ./chatContext. The AutoScrollPark behavior lives in ./autoScroll.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";
import { useStrings } from "../../lib/i18n.js";
import { getWebviewMessenger } from "../../lib/messenger.js";
import { AutoScrollPark } from "./autoScroll.js";
import { ChatActionsProvider, type ChatActions } from "./chatContext.js";
import { createMessengerEventSource, routeChatEvent, type ChatEventSource } from "./events.js";
import { MessageStore, type ChatStoreState } from "./messageStore.js";
import { MessageView } from "./MessageView.js";
import { useActiveSession } from "./activeSession.js";
import type { StringId } from "../../../shared/strings.js";
import type { MessageVM } from "./types.js";

export interface MessageListProps {
  readonly store?: MessageStore;
  readonly source?: ChatEventSource;
  readonly actions?: ChatActions;
}

/**
 * Virtuoso-free row map: the per-item renderer contract + DOM-free tests.
 * FIX-E (additive): threads the store to each MessageView so the todo-19
 * hover menu's Regenerate row can find the last user text (T19 regenerate
 * seam; optional to preserve the documented no-store degradation).
 */
export function MessageListBody(props: {
  readonly messages: readonly MessageVM[];
  readonly store?: MessageStore;
}) {
  return (
    <>
      {props.messages.map((message) => (
        <MessageView
          key={message.id}
          message={message}
          {...(props.store === undefined ? {} : { store: props.store })}
        />
      ))}
    </>
  );
}

/** T14 contract: re-render with each store snapshot (busy state, etc). */
export function useChatStore(store: MessageStore): ChatStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

function SparkleIcon(): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
        fill="url(#sparkle-grad)"
      />
      <defs>
        <linearGradient id="sparkle-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--oc-accent, #3b82f6)" />
          <stop offset="1" stopColor="var(--oc-info, #8b5cf6)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

import { RecentSessionsTop } from "../sessions/SessionList.js";

function OpenCodeWatermark(): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-col items-center gap-3 select-none pointer-events-none opacity-30 hover:opacity-60 transition-opacity duration-300">
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-card-border/60 bg-card-bg/40 p-3 shadow-2xs backdrop-blur-xs">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-fg">
          <path
            d="M5.5 3h13a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H9l-5.2 3.8a.5.5 0 0 1-.8-.4V6a3 3 0 0 1 3-3z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 8l3.5 3-3.5 3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13 14h4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="text-[11px] font-medium text-muted-fg/70 tracking-wider uppercase">{t("app.name")}</span>
    </div>
  );
}

function WelcomeHero(props: { readonly emptyLabel: string }): ReactNode {
  return (
    <div className="flex min-h-full flex-col justify-between py-1 text-fg">
      <span className="sr-only">{props.emptyLabel}</span>
      <RecentSessionsTop />
      <div className="flex flex-1 items-center justify-center py-16">
        <OpenCodeWatermark />
      </div>
    </div>
  );
}

export function MessageList(props: MessageListProps) {
  const { t } = useStrings();
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  const park = useRef(new AutoScrollPark());
  const state = useChatStore(store);
  const activeSessionId = useActiveSession();

  useEffect(() => {
    if (activeSessionId) {
      store.setSession(activeSessionId);
    }
  }, [activeSessionId, store]);

  useEffect(() => {
    const source = props.source ?? createMessengerEventSource(getWebviewMessenger());
    return source.subscribeEvent((event) => {
      routeChatEvent(store, event);
    });
  }, [props.source, store]);

  const body =
    state.messages.length === 0 ? (
      <WelcomeHero emptyLabel={t("messages.empty")} />
    ) : (
      <Virtuoso
        data={state.messages}
        className="h-full"
        followOutput={park.current.followFor}
        atBottomStateChange={(atBottom: boolean) => park.current.onAtBottomChange(atBottom)}
        itemContent={(_index, message) => <MessageView message={message} store={store} />}
      />
    );

  return (
    <ChatActionsProvider actions={props.actions ?? defaultActionsFallback}>
      <div className="flex h-full flex-col overflow-y-auto text-fg">
        {body}
      </div>
    </ChatActionsProvider>
  );
}

/** Provider fallback only; real defaults resolve lazily at click time. */
const defaultActionsFallback: ChatActions = {
  openFile: (path) => {
    void getWebviewMessenger().request("openFile", { path });
  },
  openDiff: ({ sessionId, messageID }) => {
    void getWebviewMessenger().request(
      "openDiff",
      messageID === undefined ? { sessionId } : { sessionId, messageID },
    );
  },
};

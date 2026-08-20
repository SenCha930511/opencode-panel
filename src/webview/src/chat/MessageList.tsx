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

const WELCOME_CARDS: ReadonlyArray<{
  readonly glyph: string;
  readonly title: StringId;
  readonly desc: StringId;
}> = [
  { glyph: "⚡", title: "welcome.explain", desc: "welcome.explainDesc" },
  { glyph: "🐞", title: "welcome.findBugs", desc: "welcome.findBugsDesc" },
  { glyph: "✨", title: "welcome.refactor", desc: "welcome.refactorDesc" },
  { glyph: "📝", title: "welcome.unitTests", desc: "welcome.unitTestsDesc" },
];

function WelcomeHero(props: { readonly emptyLabel: string }): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
      <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-card-border bg-card-bg shadow-md backdrop-blur-md">
        <SparkleIcon />
      </div>
      <h2 className="text-sm font-semibold tracking-tight text-fg">{t("welcome.title")}</h2>
      <p className="mt-1 text-xs text-muted-fg max-w-xs">{props.emptyLabel}</p>

      <div className="mt-6 grid w-full max-w-sm grid-cols-1 gap-2 text-start sm:grid-cols-2">
        {WELCOME_CARDS.map((card) => (
          <div
            key={card.title}
            className="group rounded-lg border border-card-border bg-card-bg/60 p-2.5 shadow-xs transition-all hover:border-focus-ring/60 hover:bg-hover-bg"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
              <span aria-hidden="true">{card.glyph}</span> {t(card.title)}
            </div>
            <p className="mt-0.5 text-[11px] leading-tight text-muted-fg">{t(card.desc)}</p>
          </div>
        ))}
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

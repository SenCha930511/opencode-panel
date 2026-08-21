import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useStrings } from "../../lib/i18n.js";
import { getWebviewMessenger } from "../../lib/messenger.js";
import { AutoScrollPark } from "./autoScroll.js";
import { ChatActionsProvider, type ChatActions } from "./chatContext.js";
import { createMessengerEventSource, routeChatEvent, type ChatEventSource } from "./events.js";
import { MessageStore, type ChatStoreState } from "./messageStore.js";
import { MessageView } from "./MessageView.js";
import { stickyUserMessage, StickyPromptBar } from "./StickyPromptBar.js";
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

function ScrollBottomIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 6.5L8 11L12.5 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function findLatestUserMessageIndex(messages: readonly MessageVM[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg !== undefined && msg.role === "user") return i;
  }
  return -1;
}

export function MessageList(props: MessageListProps) {
  const { t } = useStrings();
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  const park = useRef(new AutoScrollPark());
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const state = useChatStore(store);
  const activeSessionId = useActiveSession();
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });
  const [atBottom, setAtBottom] = useState(true);
  const lastHandledUserMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    store.setSession(activeSessionId);
    const messages = store.getState().messages;
    const lastUserIdx = findLatestUserMessageIndex(messages);
    const lastUser = lastUserIdx >= 0 ? messages[lastUserIdx] : undefined;
    lastHandledUserMessageIdRef.current = lastUser !== undefined ? lastUser.id : null;
    if (messages.length > 0) {
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: "end",
        });
      }, 30);
    }
  }, [activeSessionId, store]);

  useEffect(() => {
    const source = props.source ?? createMessengerEventSource(getWebviewMessenger());
    return source.subscribeEvent((event) => {
      routeChatEvent(store, event);
    });
  }, [props.source, store]);

  // When a NEW user message sent from THIS panel lands, scroll it to the
  // very top. Gated by the store's one-shot markUserSent flag: passive
  // inserts from the debounced sync (and any other client's sends) must
  // never yank the user's scroll position — this was the "Stop jumps to
  // top" bug: the ref-gate was the ONLY discriminator, and any fresh user
  // id seen AFTER the initial sync fired it.
  useEffect(() => {
    if (state.messages.length === 0) return;
    const latestUserIdx = findLatestUserMessageIndex(state.messages);
    if (latestUserIdx === -1) return;
    const latestUserMsg = state.messages[latestUserIdx];
    if (latestUserMsg === undefined) return;
    if (lastHandledUserMessageIdRef.current === latestUserMsg.id) return;
    lastHandledUserMessageIdRef.current = latestUserMsg.id;

    if (!store.takeUserScrollRequest()) return;
    park.current.onAtBottomChange(true);
    setAtBottom(true);

    virtuosoRef.current?.scrollToIndex({
      index: latestUserIdx,
      align: "start",
      behavior: "smooth",
    });

    const timer = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: latestUserIdx,
        align: "start",
        behavior: "smooth",
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [state.messages, store]);

  // Real-time stream follow: during active generation (busy or inFlight) or whenever
  // parts change (tool calls Ran..., reasoning 思考中, text deltas),
  // if the list is pinned, instantly pin to the bottom on every chunk/part
  // so tool cards and reasoning outputs never lag behind or get cut off.
  const lastMsg = state.messages[state.messages.length - 1];
  const lastPartsCount = lastMsg?.parts.length ?? 0;
  const lastPart = lastMsg?.parts[lastPartsCount - 1];
  const lastPartSignature = lastPart
    ? `${lastPart.id}_${lastPart.kind}_${"status" in lastPart ? (lastPart as any).status : ""}_${"text" in lastPart ? (lastPart as any).text.length : ""}`
    : "";

  useEffect(() => {
    if (!park.current.isPinned) return;
    const isBusy = state.status === "busy" || lastMsg?.inFlight === true;
    if (isBusy) {
      virtuosoRef.current?.scrollToIndex({
        index: state.messages.length - 1,
        align: "end",
        behavior: "auto",
      });
    }
  }, [state.messages.length, lastPartsCount, lastPartSignature, state.status, lastMsg?.inFlight]);

  const body =
    state.messages.length === 0 ? (
      <WelcomeHero emptyLabel={t("messages.empty")} />
    ) : (
      <Virtuoso
        ref={virtuosoRef}
        data={state.messages}
        className="h-full"
        // Mount anchored at the bottom: opening view shows the latest conversation
        initialTopMostItemIndex={state.messages.length > 0 ? state.messages.length - 1 : 0}
        atBottomThreshold={120}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        followOutput={(isAtBottom: boolean) => {
          if (!park.current.isPinned) return false;
          const isStreaming = state.status === "busy" || lastMsg?.inFlight === true;
          return isStreaming ? "auto" : park.current.followFor(isAtBottom);
        }}
        atBottomStateChange={(isBottom: boolean) => {
          park.current.onAtBottomChange(isBottom);
          setAtBottom(isBottom);
        }}
        rangeChanged={setVisibleRange}
        components={{
          Footer: () => <div className="h-28 w-full shrink-0" aria-hidden="true" />,
        }}
        itemContent={(_index, message) => (
          <div className="px-4.5 py-1 sm:px-5 min-w-0 max-w-full overflow-hidden">
            <MessageView message={message} store={store} />
          </div>
        )}
      />
    );

  const sticky = stickyUserMessage(state.messages, visibleRange.startIndex);

  return (
    <ChatActionsProvider actions={props.actions ?? defaultActionsFallback}>
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden text-fg">
        {sticky !== undefined && (
          <StickyPromptBar
            anchor={sticky}
            onJump={(index) => {
              virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
            }}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {body}
        </div>
        {!atBottom && state.messages.length > 0 && (
          <button
            type="button"
            data-oc-scroll-bottom
            title={t("chat.scrollBottom")}
            aria-label={t("chat.scrollBottom")}
            className="absolute bottom-3 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-card-border/80 bg-panel-bg text-fg shadow-lg transition-all duration-150 hover:bg-hover-bg hover:scale-105 active:scale-95 cursor-pointer ring-1 ring-black/10"
            onClick={() => {
              park.current.onAtBottomChange(true);
              virtuosoRef.current?.scrollToIndex({
                index: state.messages.length - 1,
                align: "end",
                behavior: "smooth",
              });
            }}
          >
            <ScrollBottomIcon />
          </button>
        )}
      </div>
    </ChatActionsProvider>
  );
}

/** Provider fallback only; real defaults resolve lazily at click time. */
const defaultActionsFallback: ChatActions = {
  openFile: (path) => {
    void getWebviewMessenger().request("openFile", { path });
  },
  openDiff: ({ sessionId, messageID, file }) => {
    void getWebviewMessenger().request("openDiff", {
      sessionId,
      ...(messageID !== undefined ? { messageID } : {}),
      ...(file !== undefined ? { file } : {}),
    });
  },
};

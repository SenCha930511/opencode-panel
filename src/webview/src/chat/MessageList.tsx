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

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Virtuoso } from "react-virtuoso";
import { useStrings } from "../../lib/i18n.js";
import { getWebviewMessenger } from "../../lib/messenger.js";
import { AutoScrollPark } from "./autoScroll.js";
import { ChatActionsProvider, type ChatActions } from "./chatContext.js";
import { createMessengerEventSource, routeChatEvent, type ChatEventSource } from "./events.js";
import { MessageStore, type ChatStoreState } from "./messageStore.js";
import { MessageView } from "./MessageView.js";
import type { MessageVM } from "./types.js";

export interface MessageListProps {
  readonly store?: MessageStore;
  readonly source?: ChatEventSource;
  readonly actions?: ChatActions;
}

/** Virtuoso-free row map: the per-item renderer contract + DOM-free tests. */
export function MessageListBody(props: { readonly messages: readonly MessageVM[] }) {
  return (
    <>
      {props.messages.map((message) => (
        <MessageView key={message.id} message={message} />
      ))}
    </>
  );
}

/** T14 contract: re-render with each store snapshot (busy state, etc). */
export function useChatStore(store: MessageStore): ChatStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function MessageList(props: MessageListProps) {
  const { t } = useStrings();
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  const park = useRef(new AutoScrollPark());
  const state = useChatStore(store);

  useEffect(() => {
    const source = props.source ?? createMessengerEventSource(getWebviewMessenger());
    return source.subscribeEvent((event) => {
      routeChatEvent(store, event);
    });
  }, [props.source, store]);

  const body =
    state.messages.length === 0 ? (
      <div className="px-3 py-6 text-center text-[var(--vscode-descriptionForeground)]">
        {t("messages.empty")}
      </div>
    ) : (
      <Virtuoso
        data={state.messages}
        className="h-full"
        followOutput={park.current.followFor}
        atBottomStateChange={(atBottom: boolean) => park.current.onAtBottomChange(atBottom)}
        itemContent={(_index, message) => <MessageView message={message} />}
      />
    );

  return (
    <ChatActionsProvider actions={props.actions ?? defaultActionsFallback}>
      <div className="flex h-full flex-col overflow-y-auto text-[var(--vscode-foreground)]">
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

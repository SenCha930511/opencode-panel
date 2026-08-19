/**
 * Chat action seams (todo 13): the host-bound requests part renderers fire.
 * Components consume {@link useChatActions}; MessageList provides the default
 * messenger-backed actions, and tests inject fakes through the provider prop.
 * The fallback is LAZY — no VSCode API is touched at render time.
 */

import { createContext, useContext, type ReactNode } from "react";
import { getWebviewMessenger } from "../../lib/messenger.js";

export interface ChatActions {
  openFile(path: string): void;
  openDiff(input: { readonly sessionId: string; readonly messageID?: string }): void;
}

/** Lazy singleton-backed actions: messenger resolves only on first use. */
const defaultActions: ChatActions = {
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

const ChatActionsContext = createContext<ChatActions | null>(null);

export function ChatActionsProvider(props: {
  readonly actions: ChatActions;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ChatActionsContext.Provider value={props.actions}>
      {props.children}
    </ChatActionsContext.Provider>
  );
}

export function useChatActions(): ChatActions {
  return useContext(ChatActionsContext) ?? defaultActions;
}

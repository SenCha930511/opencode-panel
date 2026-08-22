/**
 * Production slot composition (FIX-E): the slots record `app/bootstrap.tsx`
 * mounts — this seam is THE answer to the F-wave finding that the shipped
 * extension fell back to DefaultChatSlot because no `slots.chat` was passed.
 *
 * `createAppSlots()` returns the whole slots record (sessions + chat) so the
 * bootstrap can never again drop one half; the regression guard
 * (./__tests__/chatSlot.ssr.test.tsx) SSR-renders `<App/>` with exactly this
 * record AND statically asserts bootstrap consumes this seam, so deleting
 * `slots.chat` fails the suite twice.
 *
 * COMPOSED CONTRACTS (each documented in its own module; this file only
 * mounts them — no contract file is restructured):
 * - T13 store seam: ONE MessageStore shared by MessageList + Composer (+ the
 *   toolbar usage strip), matching the documented ChatDock internals.
 * - T15 pickers: `useComposerPickers()` prop slice (extras row + controlled
 *   agent/model, forwarded onto the prompt payload verbatim).
 * - T16 cards dock: `<ChatCardsDock>` between the list and the composer
 *   ("typically ABOVE the composer", anchored to the active session);
 *   `onNotice` maps the question-unsupported latch onto ONE
 *   `question.unavailable` toast.
 * - T17 attachments: `useAttachments()` chips -> Composers controlled
 *   `attachments`/`onRemoveAttachment` props, `<AttachmentsExtras>` fused
 *   into the T15 extras row per chat/attachments/index.ts's union recipe.
 * - T18 session dock: right-side rail INSIDE this slot (app.tsx mounts this
 *   slot full-width in the chat-first shell — the dock rides the section's
 *   own row layout). `todosEnabled` folds the todo-20 capability-flag store
 *   (task-pinned carrier) OR-ed with init.capabilities.todo: the flags store
 *   only sees init pushes posted AFTER mount, so the init baseline cannot be
 *   lost to the first-mount race; `onNotice` = ONE `capability.hidden` toast
 *   per latch episode (info level per the T18 contract).
 * - T19 session menu: header row of this section (its documented "chat
 *   header overflow" mount). The per-message hover menu mounts inside
 *   chat/messageView.tsx (the T19 documented site).
 * - FIX-D usage strip: `chat/usage` aggregates assistant `info.tokens` over
 *   the same store and renders in the toolbar; hidden when no usage data.
 * - T20 MCP: already mounted by app/header.tsx (McpPopover + OldServerBanner)
 *   — nothing to do here.
 *
 * Every mount wires the REAL stores/messenger (module singletons the todo-3
 * protocol owns); the only prop is the documented `store` test seam.
 */
import { useMemo, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { useCapabilityFlags } from "../mcp/index.js";
import { SessionsPanel } from "../sessions/sessionsPanel.js";
import { AttachmentsExtras, useAttachments } from "../chat/attachments/index.js";
import { ChatCardsDock } from "../chat/cards/chatCardsDock.js";
import { Composer } from "../chat/composer.js";
import { DockStore } from "../chat/dock/dockStore.js";
import { SessionDock } from "../chat/dock/sessionDock.js";
import { TodoPinnedList } from "../chat/dock/todoPinnedList.js";
import { MessageList, useChatStore } from "../chat/messageList.js";
import { MessageStore } from "../chat/messageStore.js";
import { SessionMenu } from "../chat/messageOps/sessionMenu.js";
import { UsageStrip } from "../chat/usage/usageStrip.js";
import { useActiveSession } from "../chat/activeSession.js";
import { useComposerPickers } from "../chat/pickers/composerIntegration.js";
import { buildPromptExtras } from "../chat/composerState.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";
import { contextWindowForModel, latestContextTokens } from "../chat/usage/usageMath.js";
import { useApp, type AppSlots } from "./context.js";

/** T13 order: list (flex-1) -> cards dock (above composer) -> todo strip -> composer. */
function ProductionChatSection(props: {
  readonly store: MessageStore;
  readonly dockStore: DockStore;
}): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const flags = useCapabilityFlags();
  const pickers = useComposerPickers(props.store);
  const attachments = useAttachments();
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MessageList store={props.store} />
      </div>
      <ChatCardsDock
        questionsEnabled={flags.question || app.init.capabilities.question}
        onNotice={() => {
          app.pushToast("warning", t("question.unavailable"));
        }}
      />
      {/* Todos/diffs rail moved to the bottom: it expands right above the
          pinned todo strip instead of pushing the conversation down. */}
      <SessionDock
        store={props.dockStore}
        todosEnabled={flags.todo || app.init.capabilities.todo}
      />
      <TodoPinnedList store={props.dockStore} />
      <Composer
        store={props.store}
        attachments={attachments.chips}
        onRemoveAttachment={attachments.remove}
        pickers={pickers.extras}
        extras={<AttachmentsExtras controller={attachments} />}
        {...(pickers.agent === undefined ? {} : { agent: pickers.agent })}
        {...(pickers.model === undefined ? {} : { model: pickers.model })}
      />
    </>
  );
}

export interface ChatSlotProps {
  /** Test seam: inject a seeded/observed store; production binds its own. */
  readonly store?: MessageStore;
}

export function ChatSlot(props: ChatSlotProps): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const sessionId = useActiveSession();
  const flags = useCapabilityFlags();
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  // ONE DockStore feeds the rail dock and the inline todo strip alike (the
  // rail keeps consuming the event stream; the strip renders read-only).
  const dockStore = useMemo(
    () =>
      new DockStore({
        onNotice: () => {
          app.pushToast("info", t("capability.hidden"));
        },
      }),
    [app, t],
  );
  // Context strip: latest assistant turn's prompt footprint from the SHARED
  // todo-13 store + the active model's window from the capability snapshot.
  const chatState = useChatStore(store);
  const used = latestContextTokens(chatState.messages);
  const snapshot = useCapabilitySnapshot();
  const contextWindow = snapshot === undefined
    ? undefined
    : contextWindowForModel(buildPromptExtras(sessionId ?? "", snapshot).model, snapshot.providers);
  return (
    <div data-oc-chat className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        data-oc-chat-toolbar
        className={
          used !== null
            ? "flex shrink-0 items-center justify-between gap-2 border-b border-card-border/60 bg-panel-bg/70 px-3.5 py-1 backdrop-blur-md text-xs transition-all"
            : "hidden"
        }
      >
        <span className="flex min-w-0 flex-1 items-center">
          <UsageStrip used={used} {...(contextWindow === undefined ? {} : { contextWindow })} />
        </span>
        <SessionMenu sessionId={sessionId} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ProductionChatSection store={store} dockStore={dockStore} />
      </div>
    </div>
  );
}

/** The whole slots record bootstrap mounts; never a partial record again. */
export function createAppSlots(): AppSlots {
  return { sessions: <SessionsPanel />, chat: <ChatSlot /> };
}

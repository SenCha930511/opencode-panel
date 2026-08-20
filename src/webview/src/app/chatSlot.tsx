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
 * - T18 session dock: right-side rail INSIDE this slot (App.tsx's
 *   aside/section flex split stays untouched — the dock rides the section's
 *   own row layout). `todosEnabled` folds the todo-20 capability-flag store
 *   (task-pinned carrier) OR-ed with init.capabilities.todo: the flags store
 *   only sees init pushes posted AFTER mount, so the init baseline cannot be
 *   lost to the first-mount race; `onNotice` = ONE `capability.hidden` toast
 *   per latch episode (info level per the T18 contract).
 * - T19 session menu: header row of this section (its documented "chat
 *   header overflow" mount). The per-message hover menu mounts inside
 *   chat/MessageView.tsx (the T19 documented site).
 * - T20 MCP: already mounted by app/Header.tsx (McpPopover + OldServerBanner)
 *   — nothing to do here.
 *
 * Every mount wires the REAL stores/messenger (module singletons the todo-3
 * protocol owns); the only prop is the documented `store` test seam.
 */
import { useMemo, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { useCapabilityFlags } from "../mcp/index.js";
import { SessionsPanel } from "../sessions/SessionsPanel.js";
import { AttachmentsExtras, useAttachments } from "../chat/attachments/index.js";
import { ChatCardsDock } from "../chat/cards/ChatCardsDock.js";
import { Composer } from "../chat/Composer.js";
import { SessionDock } from "../chat/dock/SessionDock.js";
import { MessageList } from "../chat/MessageList.js";
import { MessageStore } from "../chat/messageStore.js";
import { SessionMenu } from "../chat/messageOps/SessionMenu.js";
import { useActiveSession } from "../chat/activeSession.js";
import { useComposerPickers } from "../chat/pickers/composerIntegration.js";
import { useApp, type AppSlots } from "./context.js";

/** T13 order: list (flex-1) -> cards dock (above composer) -> composer. */
function ProductionChatSection(props: { readonly store: MessageStore }): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const flags = useCapabilityFlags();
  const pickers = useComposerPickers();
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
      <Composer
        store={props.store}
        attachments={attachments.chips}
        onRemoveAttachment={attachments.remove}
        extras={
          <>
            {pickers.extras}
            <AttachmentsExtras controller={attachments} />
          </>
        }
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
  return (
    <div data-oc-chat className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-oc-chat-toolbar
          className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-0.5"
        >
          <span className="flex-1 truncate">{/* FIX-D: UsageStrip mounts here. */}</span>
          <SessionMenu sessionId={sessionId} />
        </div>
        <ProductionChatSection store={store} />
      </div>
      <SessionDock
        todosEnabled={flags.todo || app.init.capabilities.todo}
        onNotice={() => {
          app.pushToast("info", t("capability.hidden"));
        }}
      />
    </div>
  );
}

/** The whole slots record bootstrap mounts; never a partial record again. */
export function createAppSlots(): AppSlots {
  return { sessions: <SessionsPanel />, chat: <ChatSlot /> };
}

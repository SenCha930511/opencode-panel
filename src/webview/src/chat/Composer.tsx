/**
 * Composer (todo 14): the chat input dock — autosizing textarea, Send/Stop,
 * per-session drafts, attachment-chip area, and the {@link ChatDock} mount
 * T11 slots into `slots.chat`.
 *
 * KEY CONTRACTS (all documented for the parallel workers):
 * - Busy state: read from the todo-13 {@link MessageStore} — pass the SAME
 *   store MessageList uses (ChatDock does this) so `session.status` drives
 *   the busy Stop button + the disabled Send. Standalone `<Composer/>`
 *   falls back to a private store (busy never fires; send still works).
 * - Keyboard: Enter sends, Shift+Enter newlines, Cmd/Ctrl+Enter also sends
 *   ({@link shouldSend} in ./composerLogic).
 * - Server status (todo-11 context): stopped/probing/lost => textarea
 *   disabled with a status-driven t() placeholder; connected => normal.
 * - Drafts: {@link DraftStore} keyed by sessionId, restored on mount AND on
 *   session switch (a non-empty restore raises the `composer.draftRestored`
 *   info toast), flushed on unmount, and cleared ONLY on a proven-successful
 *   send — any failure keeps the text and surfaces an error toast (the
 *   messenger error reply text) via the context `pushToast` seam.
 * - Send: posts the verbatim todo-3 `sendPrompt` payload through
 *   `useApp().messenger` and NEVER blocks the UI on the reply (fire-and-
 *   observe). Abort during busy → the todo-3 `abort` wire.
 *
 * T15 EXTENSION POINT: `extras` (ReactNode row rendered between the chips
 *   area and the input row — mount pickers/palette triggers there) and the
 *   controlled `agent` / `model` props (picker selections, forwarded onto
 *   the prompt payload verbatim). No other coupling is required: T16's
 *   permission/question cards live inside the message list area (chat/cards),
 *   not the composer.
 *
 * T17 EXTENSION POINT: stage chips through the controlled `attachments`
 *   prop (`ComposerAttachment` — defined in ./composerLogic, re-exported
 *   here); optionally customize rendering via `renderAttachment` and wire
 *   removal via `onRemoveAttachment`. The composer owns NO attachment
 *   logic itself: it only renders the chips it is given and forwards them
 *   onto the send payload.
 *
 * MOUNT CONTRACT (T11 bootstrap): `slots.chat = <ChatDock />`. ChatDock
 * composes ONE MessageStore into MessageList + Composer, matching the
 * todo-13 documented seam ("useChatStore — T14's composer reads status").
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useStrings } from "../../lib/i18n.js";
import { useApp } from "../app/context.js";
import { useActiveSession } from "./activeSession.js";
import type { ChatActions } from "./chatContext.js";
import { DefaultAttachmentChip } from "./composerChips.js";
import {
  buildPromptPayload,
  composerDisabled,
  placeholderForStatus,
  requestAbort,
  shouldSend,
  submitPrompt,
  type ComposerAttachment,
} from "./composerLogic.js";
import { createWebviewDraftStore, type DraftStore } from "./draftStore.js";
import type { ChatEventSource } from "./events.js";
import { MessageStore } from "./messageStore.js";
import { MessageList, useChatStore } from "./MessageList.js";

export type { ComposerAttachment } from "./composerLogic.js";
export { DefaultAttachmentChip } from "./composerChips.js";

export interface ComposerProps {
  readonly store?: MessageStore;
  /** T17: staged chips (default []). */
  readonly attachments?: readonly ComposerAttachment[];
  /** T17: custom chip renderer (default: {@link DefaultAttachmentChip}). */
  readonly renderAttachment?: { (attachment: ComposerAttachment): ReactNode };
  /** T17: remove callback; the default chip renders an X only when set. */
  readonly onRemoveAttachment?: { (attachmentId: string): void };
  /** T15: pickers/palette row (rendered verbatim above the input row). */
  readonly extras?: ReactNode;
  /** T15: controlled agent selection, sent onto the payload verbatim. */
  readonly agent?: string;
  /** T15: controlled model selection ("provider/model"), sent verbatim. */
  readonly model?: string;
  /** Test seam; production default is vscode-webview-state-backed. */
  readonly drafts?: DraftStore;
  /** Test seam; production default is the todo-13 active session. */
  readonly sessionId?: string;
}

/** Tailwind max-h-40 (10rem) — the JS-side cap for the autosize math. */
const MAX_TEXTAREA_HEIGHT_PX = 160;

function SendIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 13V3M3.5 7.5L8 3L12.5 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export function Composer(props: ComposerProps): ReactNode {
  const { t } = useStrings();
  const app = useApp();
  const activeSessionId = useActiveSession();
  const sessionId = props.sessionId ?? activeSessionId;
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  const drafts = useMemo(() => (props.drafts ?? createWebviewDraftStore()), [props.drafts]);
  const chips = props.attachments ?? [];
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [text, setText] = useState<string>(() => {
    return sessionId === undefined ? "" : drafts.read(sessionId);
  });
  const status = app.serverStatus;
  const busy = useChatStore(store).status === "busy";

  // Session switch (and initial mount): persist pending text, restore the
  // session's draft, and acknowledge a non-empty restore with the info toast.
  useEffect(() => {
    drafts.flush();
    const restored = sessionId === undefined ? "" : drafts.read(sessionId);
    setText(restored);
    if (restored.length > 0) {
      app.pushToast("info", t("composer.draftRestored"));
    }
    // Deps are session-scoped by design: restore runs on switch only.
  }, [sessionId, drafts]);

  // Webview teardown leaves no pending debounce behind.
  useEffect(() => {
    return () => {
      drafts.flush();
    };
  }, [drafts]);

  // Autosize: grow with content, capped at MAX_TEXTAREA_HEIGHT_PX (CSS
  // max-h-40 + overflow-y-auto is the visual backstop).
  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${String(Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT_PX))}px`;
  }, [text]);

  const reportError = useCallback(
    (message: string) => {
      app.pushToast("error", message);
    },
    [app],
  );

  const inputDisabled = composerDisabled(status);
  const canSend =
    !inputDisabled && !busy && sessionId !== undefined && text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!canSend || sessionId === undefined) return;
    const payload = buildPromptPayload({
      sessionId,
      text,
      attachments: chips,
      ...(props.agent === undefined ? {} : { agent: props.agent }),
      ...(props.model === undefined ? {} : { model: props.model }),
    });
    // Fire-and-observe: the reply only gates the draft clear; streamed state
    // arrives via the todo-9/13 channel, so the UI never blocks here.
    void submitPrompt(app.messenger, payload, reportError).then((ok) => {
      if (ok) {
        setText("");
        drafts.clear(sessionId);
      }
    });
  }, [app.messenger, canSend, chips, drafts, props.agent, props.model, reportError, sessionId, text]);

  const handleAbort = useCallback(() => {
    if (sessionId === undefined) return;
    void requestAbort(app.messenger, { sessionId }, reportError);
  }, [app.messenger, reportError, sessionId]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = event.target.value;
    setText(next);
    if (sessionId !== undefined) {
      drafts.write(sessionId, next);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (!shouldSend(event)) return;
    event.preventDefault();
    handleSend();
  };

  return (
    <div data-oc-composer className="border-t border-border/70 bg-bg/80 p-2.5 backdrop-blur-md">
      <div className="flex flex-col rounded-2xl border border-card-border bg-input-card-bg shadow-sm transition-all focus-within:border-focus-ring/80 focus-within:ring-1 focus-within:ring-focus-ring/25 p-3">
        {chips.length > 0 && (
          <div data-oc-attachments className="mb-2 flex flex-wrap gap-1.5">
            {chips.map((chip) =>
              props.renderAttachment !== undefined ? (
                <span key={chip.id}>{props.renderAttachment(chip)}</span>
              ) : (
                <DefaultAttachmentChip key={chip.id} attachment={chip} onRemove={props.onRemoveAttachment} />
              ),
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-40 min-h-8 flex-1 resize-none overflow-y-auto bg-transparent px-0.5 text-xs sm:text-sm text-fg outline-none placeholder:text-muted-fg/60 disabled:cursor-not-allowed disabled:opacity-50"
          value={text}
          placeholder={t(placeholderForStatus(status))}
          disabled={inputDisabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-card-border/40">
          <div data-oc-composer-extras className="flex flex-1 flex-wrap min-w-0 items-center gap-1.5">
            {props.extras}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {busy && (
              <button
                type="button"
                data-oc-composer-stop
                aria-label={t("composer.abort")}
                className="flex items-center gap-1 rounded-full border border-err/40 bg-err/10 px-3 py-1 text-xs font-medium text-err transition-all hover:bg-err hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sessionId === undefined}
                onClick={handleAbort}
              >
                <StopIcon />
                <span>{t("composer.abort")}</span>
              </button>
            )}
            <button
              type="button"
              data-oc-composer-send
              aria-label={t("composer.send")}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xs transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canSend}
              onClick={handleSend}
            >
              <SendIcon />
              <span className="sr-only">{t("composer.send")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface ChatDockProps {
  readonly store?: MessageStore;
  readonly source?: ChatEventSource;
  readonly actions?: ChatActions;
  /** Forwarded to `<Composer/>` (attachments/extras/agent/model). */
  readonly composer?: Readonly<Omit<ComposerProps, "store">>;
}

/** slots.chat mount: ONE shared store for list + composer (todo-13 seam). */
export function ChatDock(props: ChatDockProps): ReactNode {
  const store = useMemo(() => (props.store ?? new MessageStore()), [props.store]);
  const composer = props.composer ?? {};
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MessageList
          store={store}
          {...(props.source === undefined ? {} : { source: props.source })}
          {...(props.actions === undefined ? {} : { actions: props.actions })}
        />
      </div>
      <Composer {...composer} store={store} />
    </>
  );
}

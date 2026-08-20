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
import { expandMentionPaths } from "./attachments/logic.js";
import {
  buildPromptPayload,
  composerDisabled,
  ensureSessionForSend,
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
import { SlashCommandPalette, type SlashKeyHandler } from "./pickers/CommandPalette.js";

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
  /** T15: pickers row (Agent & Model), rendered in its own line. */
  readonly pickers?: ReactNode;
  /** T15: extra action triggers (e.g. '+' attachment menu). */
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

/** Tailwind max-h-60 (15rem) — the JS-side cap for the autosize math. Keep in sync with the className below. */
const MAX_TEXTAREA_HEIGHT_PX = 240;

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
  // Slash palette seam: the open menu publishes its key handler here and the
  // textarea consults it before its own Enter-send handling.
  const slashKeyRef = useRef<SlashKeyHandler | null>(null);

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

  // Autosize: grow upward with content so every typed line stays visible,
  // capped at MAX_TEXTAREA_HEIGHT_PX (CSS max-h-60 + overflow-y-auto is the
  // visual backstop). The composer is bottom-anchored in the chat column, so
  // growing the textarea pushes the card up over the message list.
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
  const [creating, setCreating] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    text: string;
    chips: readonly ComposerAttachment[];
    agent?: string;
    model?: string;
  } | null>(null);

  // Clear queue on session switch
  useEffect(() => {
    setQueuedPrompt(null);
  }, [sessionId]);

  // When model finishes outputting (busy -> false), automatically send queued prompt
  useEffect(() => {
    if (!busy && queuedPrompt && !inputDisabled) {
      const promptToSend = queuedPrompt;
      setQueuedPrompt(null);
      void (async () => {
        let target = sessionId;
        if (target === undefined) {
          setCreating(true);
          try {
            target = await ensureSessionForSend(app.messenger, sessionId);
          } catch (error) {
            setCreating(false);
            reportError(error instanceof Error ? error.message : String(error));
            return;
          }
          setCreating(false);
        }
        const payload = buildPromptPayload({
          sessionId: target,
          text: promptToSend.text,
          attachments: promptToSend.chips,
          ...(promptToSend.agent === undefined ? {} : { agent: promptToSend.agent }),
          ...(promptToSend.model === undefined ? {} : { model: promptToSend.model }),
        });
        await submitPrompt(app.messenger, payload, reportError);
      })();
    }
  }, [busy, queuedPrompt, inputDisabled, sessionId, app.messenger, reportError]);

  // No active session must not dead-key the send action: the first send from
  // the home screen creates a fresh chat and posts the prompt into it.
  const canSend = !inputDisabled && !creating && text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const effectiveText = expandMentionPaths(text);

    // If model is currently outputting, queue the prompt to send once ready
    if (busy) {
      setQueuedPrompt({
        text: effectiveText,
        chips,
        agent: props.agent,
        model: props.model,
      });
      setText("");
      if (sessionId !== undefined) {
        drafts.clear(sessionId);
      }
      return;
    }

    void (async () => {
      let target = sessionId;
      if (target === undefined) {
        setCreating(true);
        try {
          target = await ensureSessionForSend(app.messenger, sessionId);
        } catch (error) {
          setCreating(false);
          reportError(error instanceof Error ? error.message : String(error));
          return;
        }
        setCreating(false);
      }
      const payload = buildPromptPayload({
        sessionId: target,
        text: effectiveText,
        attachments: chips,
        ...(props.agent === undefined ? {} : { agent: props.agent }),
        ...(props.model === undefined ? {} : { model: props.model }),
      });
      // Fire-and-observe: the reply only gates the draft clear; streamed state
      // arrives via the todo-9/13 channel, so the UI never blocks here.
      const ok = await submitPrompt(app.messenger, payload, reportError);
      if (ok) {
        setText("");
        drafts.clear(target);
      }
    })();
  }, [app.messenger, busy, canSend, chips, drafts, props.agent, props.model, reportError, sessionId, text]);

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

  // Slash-palette accept clears the consumed "/cmd" text (never sent — the
  // command runs through runCommand instead) and drops the session draft.
  const handleSlashAccepted = useCallback(() => {
    setText("");
    if (sessionId !== undefined) {
      drafts.write(sessionId, "");
    }
  }, [drafts, sessionId]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // The open slash menu owns Enter/arrows/Escape before Enter means send.
    if (slashKeyRef.current?.(event) === true) {
      event.preventDefault();
      return;
    }
    if (!shouldSend(event)) return;
    event.preventDefault();
    handleSend();
  };

  const [isDragging, setIsDragging] = useState(false);

  return (
    <div data-oc-composer className="border-t border-border/70 bg-bg/80 px-4.5 py-3 sm:px-5 backdrop-blur-md">
      <div
        className={`flex flex-col rounded-2xl border ${
          isDragging
            ? "border-accent ring-2 ring-accent/30 bg-accent/5"
            : "border-card-border bg-input-card-bg focus-within:border-focus-ring/80 focus-within:ring-1 focus-within:ring-focus-ring/25"
        } shadow-sm transition-all p-3`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => {
          setIsDragging(false);
        }}
        onDrop={() => {
          setIsDragging(false);
        }}
      >
        {queuedPrompt && (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-accent/10 px-2.5 py-1 text-xs text-accent">
            <span className="truncate flex-1">
              排隊等待中：{queuedPrompt.text}
            </span>
            <button
              type="button"
              className="ml-2 text-[11px] opacity-70 hover:opacity-100 hover:underline cursor-pointer"
              onClick={() => {
                setText(queuedPrompt.text);
                setQueuedPrompt(null);
              }}
            >
              取消
            </button>
          </div>
        )}
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
        {/* Slash palette anchor: the menu (absolute bottom-full) opens upward
            over the input; the textarea lives inside the relative wrapper so
            the anchor tracks it. */}
        <div className="relative">
          <SlashCommandPalette text={text} onAccepted={handleSlashAccepted} keyRef={slashKeyRef} />
          <textarea
            ref={textareaRef}
            rows={1}
            className="max-h-60 min-h-8 w-full resize-none overflow-y-auto bg-transparent px-0.5 text-sm sm:text-base text-fg outline-none placeholder:text-muted-fg/60 disabled:cursor-not-allowed disabled:opacity-50"
            value={text}
            placeholder={t(placeholderForStatus(status))}
            disabled={inputDisabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Row 1 (Actions): Attachments '+' on left, Send/Stop morphing button on right */}
        <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t border-card-border/40">
          <div data-oc-composer-extras className="flex flex-1 items-center gap-1.5 min-w-0 overflow-visible py-0.5">
            {props.extras}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {busy && text.trim().length === 0 ? (
              <button
                type="button"
                data-oc-composer-stop
                aria-label={t("composer.abort")}
                title={t("composer.abort")}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-err text-white shadow-xs transition-all hover:bg-err/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                disabled={sessionId === undefined}
                onClick={handleAbort}
              >
                <StopIcon />
                <span className="sr-only">{t("composer.abort")}</span>
              </button>
            ) : (
              <button
                type="button"
                data-oc-composer-send
                aria-label={t("composer.send")}
                title={t("composer.send")}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xs transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                disabled={!canSend}
                onClick={handleSend}
              >
                <SendIcon />
                <span className="sr-only">{t("composer.send")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2 (Pickers): Agent & Model */}
        {props.pickers && (
          <div data-oc-composer-pickers className="mt-1.5 flex items-center gap-1.5 min-w-0 overflow-visible pt-1.5 border-t border-card-border/30">
            {props.pickers}
          </div>
        )}
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

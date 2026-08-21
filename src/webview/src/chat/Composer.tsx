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
import type { StringId } from "../../../shared/strings.js";
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
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SlashCommandPalette, type SlashKeyHandler } from "./pickers/CommandPalette.js";
import {
  useModelEffort,
  setModelEffort,
  useEffort,
  setEffort,
  useSessionAutoMode,
  setSessionAutoMode,
} from "./composerOptions.js";
import { queryAndSyncSessionAuto, requestSessionAuto } from "./sessionArming.js";
import { useCapabilitySnapshot } from "./pickers/capabilityStore.js";
import { usePickerSelection } from "./composerState.js";
import { resolveInitialModel } from "./pickers/logic.js";

const HOME_DRAFT_KEY = "__home__";

function variantStringId(variant: string): StringId | undefined {
  const key = variant.toLowerCase();
  const valid: readonly string[] = ["low", "medium", "high", "max", "fast", "thinking", "off", "on"];
  if (!valid.includes(key)) return undefined;
  return `composer.variant.${key}` as StringId;
}

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

function BrainIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2.5C4 2.5 2.5 4 2.5 6C2.5 7.5 3.5 8.5 4 9C3.5 10 3.5 11.5 4.5 12.5C5.5 13.5 7 13.5 8 13M10 2.5C12 2.5 13.5 4 13.5 6C13.5 7.5 12.5 8.5 12 9C12.5 10 12.5 11.5 11.5 12.5C10.5 13.5 9 13.5 8 13M8 2V14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SlidersIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M3 8h10M3 11.5h10M5.5 3v3M10.5 6.5v3M7.5 10v3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LightningIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 1.5L2.5 9h5L6.5 14.5L13.5 7h-5L9 1.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 1.5h3l.4 1.7.9.4 1.6-.7 2.1 2.1-.7 1.6.4.9 1.7.4v3l-1.7.4-.4.9.7 1.6-2.1 2.1-1.6-.7-.9.4-.4 1.7h-3l-.4-1.7-.9-.4-1.6.7-2.1-2.1.7-1.6-.4-.9-1.7-.4v-3l1.7-.4.4-.9-.7-1.6 2.1-2.1 1.6.7.9-.4.4-1.7z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
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

  const autoMode = useSessionAutoMode(sessionId);

  useEffect(() => {
    if (sessionId) {
      void queryAndSyncSessionAuto(sessionId, app.messenger);
    }
  }, [sessionId, app.messenger]);

  const pickersSnapshot = useCapabilitySnapshot();
  const selection = usePickerSelection(sessionId ?? "");
  const activeModelId = useMemo(() => {
    if (!pickersSnapshot) return undefined;
    return (
      selection.model ??
      resolveInitialModel({
        providers: pickersSnapshot.providers,
        defaultModels: pickersSnapshot.defaultModels,
        ...(pickersSnapshot.defaultModel === undefined ? {} : { defaultModel: pickersSnapshot.defaultModel }),
      })
    );
  }, [selection.model, pickersSnapshot]);

  const selectedModelEntry = useMemo(() => {
    if (!activeModelId || !pickersSnapshot) return undefined;
    for (const prov of pickersSnapshot.providers) {
      for (const m of prov.models) {
        if (m.id === activeModelId || `${prov.id}/${m.id}` === activeModelId) {
          return { provider: prov, model: m };
        }
      }
    }
    return undefined;
  }, [activeModelId, pickersSnapshot]);

  // Model-specific variants from opencode.json / providers probe
  const modelVariants = useMemo(() => {
    if (!selectedModelEntry) return ["low", "medium", "high", "max"];
    const { model } = selectedModelEntry;
    if (model.variants && model.variants.length > 0) {
      return model.variants;
    }
    if (model.reasoning) {
      return ["low", "medium", "high", "max"];
    }
    return [];
  }, [selectedModelEntry]);

  const defaultModelEffort = useMemo(() => {
    if (selectedModelEntry?.model.options && typeof selectedModelEntry.model.options.reasoningEffort === "string") {
      return selectedModelEntry.model.options.reasoningEffort;
    }
    return modelVariants[0] ?? "high";
  }, [selectedModelEntry, modelVariants]);

  const currentEffort = useModelEffort(activeModelId, defaultModelEffort);
  const currentVariant: string | undefined =
    selectedModelEntry !== undefined &&
    selectedModelEntry.model.variants !== undefined &&
    selectedModelEntry.model.variants.includes(currentEffort)
      ? currentEffort
      : undefined;

  const [text, setText] = useState<string>(() => {
    return drafts.read(sessionId ?? HOME_DRAFT_KEY);
  });
  const status = app.serverStatus;
  const busy = useChatStore(store).status === "busy";

  // Session switch (and initial mount): persist pending text, restore the
  // session's draft, and acknowledge a non-empty restore with the info toast.
  useEffect(() => {
    drafts.flush();
    const restored = drafts.read(sessionId ?? HOME_DRAFT_KEY);
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
  // Synchronous double-Enter guard; state settles a render too late.
  const creatingRef = useRef(false);
  // Same for the queued send effect: no re-entry mid-await.
  const queueInFlightRef = useRef(false);
  // And the main path: Enter during `await submitPrompt` must not re-fire.
  const sendInFlightRef = useRef(false);
  const [queuedPrompt, setQueuedPrompt] = useState<{
    text: string;
    chips: readonly ComposerAttachment[];
    agent?: string | undefined;
    model?: string | undefined;
    variant?: string | undefined;
    // The session the prompt was composed for; guards cross-session sends.
    originSession: string | undefined;
  } | null>(null);

  // Clear queue on session switch
  useEffect(() => {
    setQueuedPrompt(null);
  }, [sessionId]);

  // When model finishes outputting (busy -> false), automatically send queued prompt
  useEffect(() => {
    if (!busy && queuedPrompt && !inputDisabled && !queueInFlightRef.current) {
      const promptToSend = queuedPrompt;
      setQueuedPrompt(null);
      if (promptToSend.originSession !== sessionId) {
        // Session switched while queued: this text belongs to the origin —
        // park it back on that draft instead of crossing session boundaries.
        drafts.write(promptToSend.originSession ?? HOME_DRAFT_KEY, promptToSend.text);
        return;
      }
      queueInFlightRef.current = true;
      void (async () => {
        try {
          let target = sessionId;
          if (target === undefined) {
            setCreating(true);
            creatingRef.current = true;
            try {
              target = await ensureSessionForSend(app.messenger, sessionId);
            } catch (error) {
              setCreating(false);
              creatingRef.current = false;
              reportError(error instanceof Error ? error.message : String(error));
              return;
            }
            setCreating(false);
            creatingRef.current = false;
          }
          const payload = buildPromptPayload({
            sessionId: target,
            text: promptToSend.text,
            attachments: promptToSend.chips,
            ...(promptToSend.agent === undefined ? {} : { agent: promptToSend.agent }),
            ...(promptToSend.model === undefined ? {} : { model: promptToSend.model }),
            ...(promptToSend.variant === undefined ? {} : { variant: promptToSend.variant }),
          });
          const ok = await submitPrompt(app.messenger, payload, reportError);
          if (ok) {
            store.markUserSent();
            drafts.clear(target);
            drafts.clear(HOME_DRAFT_KEY);
          } else {
            // The queued path cleared the text up front; a send failure must
            // bring it back so the user's draft is never silently lost.
            setText(promptToSend.text);
            drafts.write(target, promptToSend.text);
          }
        } finally {
          queueInFlightRef.current = false;
        }
      })();
    }
  }, [busy, queuedPrompt, inputDisabled, sessionId, app.messenger, reportError]);

  // No active session must not dead-key the send action: the first send from
  // the home screen creates a fresh chat and posts the prompt into it.
  const canSend = !inputDisabled && !creating && text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const effectiveText = expandMentionPaths(text);

    const effectiveAgent = selection.agent ?? props.agent;
    const effectiveModel = selection.model ?? props.model ?? activeModelId;

    // If model is currently outputting, queue the prompt to send once ready
    if (busy) {
      setQueuedPrompt({
        text: effectiveText,
        chips,
        agent: effectiveAgent,
        model: effectiveModel,
        variant: currentVariant,
        originSession: sessionId,
      });
      setText("");
      if (sessionId !== undefined) {
        drafts.clear(sessionId);
      } else {
        drafts.clear(HOME_DRAFT_KEY);
      }
      return;
    }

    if (creatingRef.current || queueInFlightRef.current || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    void (async () => {
      try {
        let target = sessionId;
        if (target === undefined) {
          setCreating(true);
          creatingRef.current = true;
          try {
            target = await ensureSessionForSend(app.messenger, sessionId);
          } catch (error) {
            setCreating(false);
            creatingRef.current = false;
            reportError(error instanceof Error ? error.message : String(error));
            return;
          }
          setCreating(false);
          creatingRef.current = false;
        }
        const payload = buildPromptPayload({
          sessionId: target,
          text: effectiveText,
          attachments: chips,
          ...(effectiveAgent === undefined ? {} : { agent: effectiveAgent }),
          ...(effectiveModel === undefined ? {} : { model: effectiveModel }),
          ...(currentVariant === undefined ? {} : { variant: currentVariant }),
        });
        // Fire-and-observe: the reply only gates the draft clear; streamed state
        // arrives via the todo-9/13 channel, so the UI never blocks here.
        const ok = await submitPrompt(app.messenger, payload, reportError);
        if (ok) {
          store.markUserSent();
          setText("");
          drafts.clear(target);
          drafts.clear(HOME_DRAFT_KEY);
        }
      } finally {
        sendInFlightRef.current = false;
      }
    })();
  }, [
    activeModelId,
    app.messenger,
    busy,
    canSend,
    chips,
    currentVariant,
    drafts,
    props.agent,
    props.model,
    reportError,
    selection.agent,
    selection.model,
    sessionId,
    text,
    store,
  ]);

  const handleAbort = useCallback(() => {
    if (sessionId === undefined) return;
    void requestAbort(app.messenger, { sessionId }, reportError);
  }, [app.messenger, reportError, sessionId]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = event.target.value;
    setText(next);
    drafts.write(sessionId ?? HOME_DRAFT_KEY, next);
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
              {t("composer.queued").replace("{text}", queuedPrompt.text)}
            </span>
            <button
              type="button"
              className="ml-2 text-[11px] opacity-70 hover:opacity-100 hover:underline cursor-pointer"
              onClick={() => {
                setText(queuedPrompt.text);
                drafts.write(sessionId ?? HOME_DRAFT_KEY, queuedPrompt.text);
                setQueuedPrompt(null);
              }}
            >
              {t("composer.cancel")}
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

        {/* Toolbar: Left [+ / Agent / Model], Right [Advanced Options (Effort & Auto), ⌘↵, Send/Stop] */}
        <div className="mt-2 flex items-center justify-between gap-1.5 pt-2 border-t border-card-border/40 min-w-0">
          <div data-oc-composer-extras className="flex flex-1 items-center gap-1 min-w-0 overflow-visible py-0.5">
            {props.extras}
            {props.pickers}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Options & Functions Dropdown Menu */}
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  title={t("composer.optionsMenu")}
                  aria-label={t("composer.optionsMenu")}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all cursor-pointer shadow-2xs ${
                    autoMode
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/25 ring-1 ring-emerald-400/40"
                      : "border-card-border/80 bg-card-bg/80 text-muted-fg hover:bg-hover-bg hover:text-fg"
                  }`}
                >
                  <SlidersIcon />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="z-50 min-w-60 rounded-xl border border-card-border bg-panel-bg p-1.5 shadow-2xl ring-1 ring-black/20 text-xs"
                >
                  {/* Section: Auto Mode */}
                  <DropdownMenu.Item
                    className="flex items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer outline-none transition-colors hover:bg-hover-bg text-fg select-none"
                    onSelect={() => {
                      const next = !autoMode;
                      setSessionAutoMode(sessionId, next);
                      if (sessionId) {
                        void requestSessionAuto(app.messenger, sessionId, next);
                      }
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className={autoMode ? "text-emerald-400" : "text-muted-fg"}><LightningIcon /></span>
                      <span>{t("composer.autoMode.title")}</span>
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded tracking-wide shrink-0 ${autoMode ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-card-bg text-muted-fg border border-card-border/60"}`}>
                      {autoMode ? t("composer.autoMode.on") : t("composer.autoMode.off")}
                    </span>
                  </DropdownMenu.Item>

                  <DropdownMenu.Separator className="my-1 h-px bg-card-border/40" />

                  {/* Section: Reasoning Effort */}
                  <div className="px-2.5 py-1 text-[10px] font-semibold text-muted-fg/80 uppercase tracking-wider flex items-center justify-between">
                    <span>{t("composer.effort.title")}</span>
                    {selectedModelEntry && (
                      <span className="text-[9px] font-normal text-muted-fg/90 truncate max-w-[90px]" title={selectedModelEntry.model.name}>
                        {selectedModelEntry.model.name}
                      </span>
                    )}
                  </div>
                  {modelVariants.length > 0 ? (
                    modelVariants.map((lvl) => {
                      const isSelected = currentEffort.toLowerCase() === lvl.toLowerCase();
                      return (
                        <DropdownMenu.Item
                          key={lvl}
                          className={`flex items-center justify-between rounded-lg px-2.5 py-1 text-xs cursor-pointer outline-none transition-colors select-none ${
                            isSelected ? "bg-hover-bg text-fg font-medium" : "text-fg/80 hover:bg-hover-bg/70 hover:text-fg"
                          }`}
                          onSelect={() => {
                            if (activeModelId) {
                              setModelEffort(activeModelId, lvl);
                            } else {
                              setEffort(lvl as any);
                            }
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <BrainIcon />
                            <span>{(() => { const id = variantStringId(lvl); return id === undefined ? lvl.toUpperCase() : t(id); })()}</span>
                          </span>
                          {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                        </DropdownMenu.Item>
                      );
                    })
                  ) : (
                    <div className="px-2.5 py-1.5 text-xs text-muted-fg italic">
                      {t("composer.effort.none")}
                    </div>
                  )}

                  <DropdownMenu.Separator className="my-1 h-px bg-card-border/40" />

                  {/* Section: Open Settings */}
                  <DropdownMenu.Item
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer outline-none transition-colors hover:bg-hover-bg text-muted-fg hover:text-fg select-none"
                    onSelect={() => {
                      void app.messenger.request("openSettingsTab", {}).catch(() => {
                        app.navigate("settings");
                      });
                    }}
                  >
                    <GearIcon />
                    <span>{t("composer.openSettings")}</span>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <span className="hidden sm:inline text-[10px] text-muted-fg/60 font-mono tracking-tight select-none px-0.5">
              ⌘↵
            </span>

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

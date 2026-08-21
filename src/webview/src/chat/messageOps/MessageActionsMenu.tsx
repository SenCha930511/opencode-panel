/**
 * Per-message hover menu (plan todo 19): "Revert to here" / "Regenerate"
 * (both confirm-gated — the plan's hard rule is that revert NEVER runs from
 * a bare click; {@link MessageActionsController} records the intent and the
 * wire call happens only through the dialog's confirm) and "Restore reverted
 * messages" (non-destructive, ungated). Rows hide per the resolved
 * {@link MessageOpAvailability} — an explicit capability `false` hides now,
 * and a genuinely-missing route degrades at call time to the
 * `capability.hidden` toast via the todo-3 error reply text.
 *
 * MOUNT CONTRACT (todo 13 left no render-prop seam, so this file ships the
 * component + hook for the integration wave; no T13 file is touched):
 *
 *   <article className="group relative">                 // in MessageView
 *     <MessageActionsMenu message={message} store={store} />
 *
 * with the menu absolutely anchored via {@link MessageActionsMenuProps.className}
 * (e.g. "absolute right-2 top-1 hidden group-hover:flex"). The optional
 * `store` prop feeds regenerate's last-user-text lookup; without it the
 * Regenerate row simply hides (honest degradation, nothing fabricated).
 *
 * The confirm dialog defaults to the Radix Dialog shell todo 12 established
 * (@radix-ui/react-alert-dialog is NOT in the install set and npm installs
 * are out of scope; react-dialog's DialogShell pattern is the landed confirm
 * idiom — see sessions/sessionDialogs.tsx DeleteSessionDialog). Tests inject
 * the {@link ConfirmDialogView} seam to assert the gate in node+SSR.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useStrings } from "../../../lib/i18n.js";
import { useApp } from "../../app/context.js";
import { getActiveSession } from "../activeSession.js";
import type { MessageStore } from "../messageStore.js";
import type { MessageVM } from "../types.js";
import {
  MessageActionsController,
  type MessageOpReporter,
  type PendingConfirmOp,
} from "./actions.js";
import { resolveMessageOpAvailability, type MessageOpAvailability } from "./logic.js";

// ---------------------------------------------------------------------------
// Confirm dialog seam.

export interface ConfirmDialogViewProps {
  readonly copy: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

export type ConfirmDialogView = (props: ConfirmDialogViewProps) => ReactNode; // i18n-allow-literal

const OVERLAY_CLASS = "fixed inset-0 z-40 bg-black/40";
const CONTENT_CLASS =
  "fixed left-1/2 top-1/3 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-panel-bg p-4 shadow-xl";
const CANCEL_BUTTON_CLASS = "rounded-sm px-2.5 py-1 text-xs hover:bg-hover-bg";
const CONFIRM_BUTTON_CLASS =
  "rounded-sm bg-err px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-50";

/** Production confirm: the sessions-rail DialogShell idiom (todo 12). */
export function RevertConfirmDialog(props: ConfirmDialogViewProps): ReactNode {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content className={CONTENT_CLASS}>
          <Dialog.Title className="mb-2 text-sm font-semibold">{props.confirmLabel}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted-fg">
            {props.copy}
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button type="button" className={CANCEL_BUTTON_CLASS} onClick={props.onCancel}>
              {props.cancelLabel}
            </button>
            <button type="button" className={CONFIRM_BUTTON_CLASS} onClick={props.onConfirm}>
              {props.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// The hook (documented mount surface): pending state + intent entry points.

export interface UseMessageActions {
  readonly pending: PendingConfirmOp | null;
  requestRevert(messageId: string): void;
  requestRegenerate(): void;
  unrevert(): void;
  confirm(): void;
  cancel(): void;
}

export function useMessageActions(
  controller: MessageActionsController,
): UseMessageActions {
  const pending = useSyncExternalStore(controller.subscribe, controller.getPending, controller.getPending);
  return {
    pending,
    requestRevert: (messageId) => {
      controller.requestRevert(messageId);
    },
    requestRegenerate: () => {
      controller.requestRegenerate();
    },
    unrevert: () => {
      void controller.unrevert();
    },
    confirm: () => {
      void controller.confirm();
    },
    cancel: () => {
      controller.cancel();
    },
  };
}

// ---------------------------------------------------------------------------
// The menu view (pure props — the node/SSR assertion surface).

export interface MessageActionsMenuViewProps {
  readonly message: MessageVM;
  readonly availability: MessageOpAvailability;
  readonly controller: MessageActionsController;
  readonly className?: string;
  readonly ConfirmDialog?: ConfirmDialogView;
}

export function MessageActionsMenuView(props: MessageActionsMenuViewProps): ReactNode {
  const { t } = useStrings();
  const actions = useMessageActions(props.controller);
  const ConfirmDialog = props.ConfirmDialog ?? RevertConfirmDialog;
  const buttonClass = "rounded px-1.5 py-0.5 text-[0.7em] text-muted-fg hover:bg-hover-bg hover:text-fg";
  return (
    <div
      className={`flex items-center gap-0.5 rounded border border-border bg-panel-bg p-0.5 shadow ${props.className ?? ""}`}
    >
      {props.availability.revert ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={t("messages.revert")}
          onClick={() => {
            actions.requestRevert(props.message.id);
          }}
        >
          {t("messages.revert")}
        </button>
      ) : null}
      {props.availability.unrevert ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={t("messages.unrevert")}
          onClick={actions.unrevert}
        >
          {t("messages.unrevert")}
        </button>
      ) : null}
      {props.availability.revert && props.controller.canRegenerate() ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={t("messages.regenerate")}
          onClick={actions.requestRegenerate}
        >
          {t("messages.regenerate")}
        </button>
      ) : null}
      {actions.pending !== null ? (
        <ConfirmDialog
          copy={t("messages.revertConfirm")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={actions.confirm}
          onCancel={actions.cancel}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Production wrapper: resolves reporter/availability/controller from the app
// context when the caller does not inject them (the one-line mount).

export interface MessageActionsMenuProps {
  readonly message: MessageVM;
  readonly store?: MessageStore;
  readonly availability?: MessageOpAvailability;
  readonly reporter?: MessageOpReporter;
  readonly className?: string;
  readonly ConfirmDialog?: ConfirmDialogView;
}

export function MessageActionsMenu(props: MessageActionsMenuProps): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const reporter =
    props.reporter ??
    ({
      unsupported: () => {
        app.pushToast("warning", t("capability.hidden"));
      },
      error: (message) => {
        app.pushToast("error", message);
      },
    } satisfies MessageOpReporter);
  const availability =
    props.availability ?? resolveMessageOpAvailability(app.init.capabilities);
  const controller = useMemo(
    () =>
      new MessageActionsController({
        sessionId: getActiveSession,
        messages: () => props.store?.getState().messages ?? [], // i18n-allow-literal
        messenger: app.messenger,
        reporter,
        onReverted: (messageId) => {
          props.store?.applyReverted(messageId);
        },
        onUnreverted: () => {
          props.store?.clearReverted();
        },
      }),
    [props.store, app.messenger, reporter],
  );
  return (
    <MessageActionsMenuView
      message={props.message}
      availability={availability}
      controller={controller}
      {...(props.className === undefined ? {} : { className: props.className })}
      {...(props.ConfirmDialog === undefined ? {} : { ConfirmDialog: props.ConfirmDialog })}
    />
  );
}

function UndoCheckpointIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 6.5h6.25a3.25 3.25 0 0 1 3.25 3.25v0a3.25 3.25 0 0 1-3.25 3.25H5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 4L3.5 6.5 6 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UserCheckpointButton(props: {
  readonly message: MessageVM;
  readonly store?: MessageStore;
}): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const reporter: MessageOpReporter = {
    unsupported: () => {
      app.pushToast("warning", t("capability.hidden"));
    },
    error: (message) => {
      app.pushToast("error", message);
    },
  };

  const availability = resolveMessageOpAvailability(app.init.capabilities);
  const controller = useMemo(
    () =>
      new MessageActionsController({
        sessionId: getActiveSession,
        messages: () => props.store?.getState().messages ?? [],
        messenger: app.messenger,
        reporter,
        onReverted: (messageId) => {
          props.store?.applyReverted(messageId);
        },
        onUnreverted: () => {
          props.store?.clearReverted();
        },
      }),
    [props.store, app.messenger],
  );

  const actions = useMessageActions(controller);
  if (!availability.revert) return null;

  return (
    <>
      <button
        type="button"
        title={t("messages.revert")}
        aria-label={t("messages.revert")}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-fg/70 transition-colors hover:bg-hover-bg hover:text-fg cursor-pointer"
        onClick={() => {
          actions.requestRevert(props.message.id);
        }}
      >
        <UndoCheckpointIcon />
      </button>
      {actions.pending !== null ? (
        <RevertConfirmDialog
          copy={t("messages.revertConfirm")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={actions.confirm}
          onCancel={actions.cancel}
        />
      ) : null}
    </>
  );
}

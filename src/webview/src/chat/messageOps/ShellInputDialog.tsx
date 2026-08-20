/**
 * The Run-shell input modal (plan todo 19): a Radix Dialog (the todo-12
 * sessionDialogs idiom — react-alert-dialog is not in the install set) with a
 * single command input. Submitting hands the trimmed input to the caller's
 * runShell flow; the output arrives later as real messages over the SSE
 * stream and is never fabricated into this dialog.
 */

import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export interface ShellInputDialogProps {
  readonly title: string;
  readonly placeholder: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  onSubmit(input: string): void;
  onClose(): void;
}

const OVERLAY_CLASS = "fixed inset-0 z-40 bg-black/40";
const CONTENT_CLASS =
  "fixed left-1/2 top-1/3 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-panel-bg p-4 shadow-xl";
const CANCEL_BUTTON_CLASS = "rounded-sm px-2.5 py-1 text-xs hover:bg-hover-bg";
const CONFIRM_BUTTON_CLASS =
  "rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";

export function ShellInputDialogView(props: ShellInputDialogProps): ReactNode {
  const [input, setInput] = useState("");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content className={CONTENT_CLASS}>
          <Dialog.Title className="mb-2 text-sm font-semibold">{props.title}</Dialog.Title>
          <input
            className="mb-3 w-full rounded-sm border border-border bg-input-bg px-2 py-1 text-sm text-fg outline-none focus:border-focus-ring"
            placeholder={props.placeholder}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={CANCEL_BUTTON_CLASS} onClick={props.onClose}>
              {props.cancelLabel}
            </button>
            <button
              type="button"
              disabled={input.trim().length === 0}
              className={CONFIRM_BUTTON_CLASS}
              onClick={() => {
                props.onSubmit(input.trim());
              }}
            >
              {props.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

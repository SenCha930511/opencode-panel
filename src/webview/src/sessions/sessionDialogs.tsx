import { useId, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useStrings } from "../../lib/i18n.js";
import type { SessionEntry } from "./constants.js";

/** Rename / delete-confirm dialogs for the sessions rail (todo 12). */

const OVERLAY_CLASS = "fixed inset-0 z-40 bg-black/40";
const CONTENT_CLASS =
  "fixed left-1/2 top-1/3 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-panel-bg p-4 shadow-xl";
const CANCEL_BUTTON_CLASS = "rounded-sm px-2.5 py-1 text-xs hover:bg-hover-bg";

function DialogShell(props: {
  readonly title: string;
  readonly children: ReactNode;
  onClose(): void;
}): ReactNode {
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
          {props.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface BusyTask {
  (): Promise<void>;
}

interface BusyDone {
  (): void;
}

function useBusySubmit(run: BusyTask, done: BusyDone): {
  readonly busy: boolean;
  readonly submit: BusyDone;
} {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    submit: () => {
      setBusy(true);
      void run()
        .then(done)
        .finally(() => {
          setBusy(false);
        });
    },
  };
}

export function RenameSessionDialog(props: {
  readonly entry: SessionEntry;
  onSubmit(title: string): Promise<void>;
  onClose(): void;
}): ReactNode {
  const { t } = useStrings();
  const [title, setTitle] = useState(props.entry.title);
  const inputId = useId();
  const { busy, submit } = useBusySubmit(() => {
    return props.onSubmit(title.trim());
  }, props.onClose);
  return (
    <DialogShell title={t("sessions.rename")} onClose={props.onClose}>
      <label htmlFor={inputId} className="mb-1 block text-xs text-muted-fg">
        {t("sessions.renamePrompt")}
      </label>
      <input
        id={inputId}
        className="mb-3 w-full rounded-sm border border-border bg-input-bg px-2 py-1 text-sm text-fg outline-none focus:border-focus-ring"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className={CANCEL_BUTTON_CLASS} onClick={props.onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || title.trim().length === 0}
          className="rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          onClick={submit}
        >
          {t("common.confirm")}
        </button>
      </div>
    </DialogShell>
  );
}

export function DeleteSessionDialog(props: {
  readonly entry: SessionEntry;
  onConfirm(): Promise<void>;
  onClose(): void;
}): ReactNode {
  const { t } = useStrings();
  const { busy, submit } = useBusySubmit(props.onConfirm, props.onClose);
  return (
    <DialogShell title={t("sessions.delete")} onClose={props.onClose}>
      <p className="mb-3 text-xs text-muted-fg">{t("sessions.deleteConfirm")}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={CANCEL_BUTTON_CLASS} onClick={props.onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-sm bg-err px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-50"
          onClick={submit}
        >
          {t("common.confirm")}
        </button>
      </div>
    </DialogShell>
  );
}

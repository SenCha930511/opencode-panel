/** Shared chrome for the collection editors: the add-button style and the
 * small row-removal button (all copy through useStrings). */

import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";

export const ADD_BUTTON_CLASS =
  "shrink-0 cursor-pointer rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

/** Small removal button shared by the collection editors. */
export function RemoveButton(props: { readonly disabled: boolean; readonly onRemove: () => void }): ReactNode {
  const { t } = useStrings();
  return (
    <button
      type="button"
      aria-label={t("cfg.records.remove")}
      className="shrink-0 cursor-pointer rounded-lg border border-card-border bg-card-bg/80 px-2 py-1 text-[11px] text-muted-fg transition-all hover:border-err/50 hover:bg-err/10 hover:text-err disabled:cursor-not-allowed disabled:opacity-40"
      disabled={props.disabled}
      onClick={() => {
        props.onRemove();
      }}
    >
      {"✕"}
    </button>
  );
}

import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";

/** Loading skeleton + error banner for the sessions rail (todo 12). */

export function SessionListSkeleton(): ReactNode {
  return (
    <ul className="flex flex-col gap-1 px-2" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex flex-col gap-1.5 rounded-sm px-3 py-2">
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-hover-bg" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-hover-bg" />
        </li>
      ))}
    </ul>
  );
}

export function SessionErrorBanner(props: {
  readonly message: string;
  onClose(): void;
}): ReactNode {
  const { t } = useStrings();
  return (
    <div
      role="alert"
      className="mx-2 mt-2 flex items-start gap-2 rounded-sm border border-err bg-panel-bg px-2 py-1.5"
    >
      <span className="min-w-0 flex-1 break-words text-xs text-err">{props.message}</span>
      <button
        type="button"
        className="shrink-0 rounded-sm px-1 text-xs text-muted-fg hover:bg-hover-bg"
        aria-label={t("common.close")}
        onClick={props.onClose}
      >
        {t("common.close")}
      </button>
    </div>
  );
}

import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { baseNameOfPath } from "./logic.js";

export interface MentionPaletteProps {
  readonly rows: readonly string[];
  readonly onPick?: { (path: string): void };
}

function FileGlyph(props: { readonly path: string }): ReactNode {
  const ext = props.path.split(".").pop()?.toLowerCase() ?? "";
  let colorClass = "bg-muted-fg/15 text-muted-fg";
  if (["ts", "tsx", "js", "jsx"].includes(ext)) colorClass = "bg-blue-500/15 text-blue-400";
  else if (["py"].includes(ext)) colorClass = "bg-amber-500/15 text-amber-400";
  else if (["json", "yaml", "yml"].includes(ext)) colorClass = "bg-emerald-500/15 text-emerald-400";
  else if (["md", "txt", "doc"].includes(ext)) colorClass = "bg-purple-500/15 text-purple-400";
  else if (["png", "jpg", "jpeg", "svg", "webp"].includes(ext)) colorClass = "bg-pink-500/15 text-pink-400";
  else if (["css", "scss", "html"].includes(ext)) colorClass = "bg-cyan-500/15 text-cyan-400";
  return (
    <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase tracking-tight ${colorClass}`}>
      {ext.slice(0, 3) || "F"}
    </span>
  );
}

export function MentionPalette(props: MentionPaletteProps): ReactNode {
  const { t } = useStrings();
  return (
    <div
      data-oc-mention-palette
      role="listbox"
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-56 overflow-y-auto rounded-2xl border border-card-border bg-panel-bg/95 p-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-black/10 text-xs"
    >
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-muted-fg border-b border-card-border/40 mb-1">
        <span className="flex items-center gap-1.5">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-accent/20 text-accent text-[9px] font-bold">@</span>
          <span>{t("mention.paletteHint")}</span>
        </span>
        <span className="text-[10px] text-muted-fg/60">
          {t("mention.count").replace("{count}", String(props.rows.length))}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {props.rows.map((row) => (
          <li key={row}>
            <button
              type="button"
              role="option"
              aria-selected="false"
              title={row}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-start transition-colors hover:bg-hover-bg cursor-pointer group"
              onClick={() => {
                props.onPick?.(row);
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileGlyph path={row} />
                <span className="shrink-0 font-medium text-fg">{baseNameOfPath(row)}</span>
              </div>
              <span className="truncate text-[11px] text-muted-fg/70 font-mono group-hover:text-muted-fg text-end">{row}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

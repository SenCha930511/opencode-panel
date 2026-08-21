import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { formatContextUsage } from "./usageMath.js";

function MemoryChipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export interface UsageStripProps {
  /** Latest-turn prompt tokens (null = nothing reported yet → strip hides). */
  readonly used: number | null;
  /** The active model's context window in tokens, if the server reported it. */
  readonly contextWindow?: number | undefined;
}

export function UsageStrip(props: UsageStripProps): ReactNode {
  const { t } = useStrings();
  if (props.used === null) return null;

  const used = props.used;
  const contextWindow = props.contextWindow;
  const hasWindow = contextWindow !== undefined && contextWindow > 0;
  const percent = hasWindow ? Math.min(100, Math.max(0, Math.round((used / contextWindow) * 100))) : null;

  const isHigh = percent !== null && percent >= 85;
  const isMed = percent !== null && percent >= 60 && percent < 85;
  const colorClass = isHigh
    ? "text-err border-err/30 bg-err/10"
    : isMed
      ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
      : "text-muted-fg hover:text-fg border-card-border/70 bg-card-bg/60 hover:bg-hover-bg/80";

  const barColor = isHigh ? "bg-err" : isMed ? "bg-amber-400" : "bg-accent";

  return (
    <span
      data-oc-usage
      title={t("chat.usage")}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono shadow-2xs transition-all select-none whitespace-nowrap shrink-0 ${colorClass}`}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center opacity-80">
        <MemoryChipIcon />
      </span>
      {hasWindow && percent !== null ? (
        <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
          <div className="h-1.5 w-8 overflow-hidden rounded-full bg-black/25 dark:bg-white/10 shrink-0">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-medium tracking-tight whitespace-nowrap">{formatContextUsage(used, contextWindow)}</span>
        </div>
      ) : (
        <span className="font-medium tracking-tight whitespace-nowrap">{formatContextUsage(used, undefined)}</span>
      )}
    </span>
  );
}

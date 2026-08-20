/**
 * Usage strip (FIX-D): the per-session assistant token totals rendered in
 * the composed chat section's toolbar (app/chatSlot.tsx mounts it; the
 * toolbar owner subscribes the SHARED todo-13 store and passes the
 * aggregated value down — this component stays a pure props view).
 *
 * Renders `null` when no usage data exists (sumAssistantUsage's absence
 * rule), and never fabricates a field the wire never carried. All copy
 * routes through t(); numbers are data, joined with the middot separator.
 */

import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import type { SessionUsage } from "./usageMath.js";

export interface UsageStripProps {
  readonly usage: SessionUsage | null;
}

export function UsageStrip(props: UsageStripProps): ReactNode {
  const { t } = useStrings();
  const usage = props.usage;
  if (usage === null) return null;
  const segments: string[] = [];
  if (usage.input !== undefined) segments.push(`${t("chat.usage.input")} ${String(usage.input)}`);
  if (usage.output !== undefined) segments.push(`${t("chat.usage.output")} ${String(usage.output)}`);
  if (usage.reasoning !== undefined) {
    segments.push(`${t("chat.usage.reasoning")} ${String(usage.reasoning)}`);
  }
  return (
    <span
      data-oc-usage
      title={t("chat.usage")}
      className="min-w-0 truncate text-[0.7em] text-muted-fg"
    >
      {segments.join(" · ")}
    </span>
  );
}

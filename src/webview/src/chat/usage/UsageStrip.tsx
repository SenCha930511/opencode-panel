/**
 * Usage strip: the CURRENT context-window usage of the active session —
 * the latest assistant turn's prompt footprint (k units) plus a fill ratio
 * when the model's window size is known (`121k / 1049k · 12%`). Renders
 * `null` with no usage data at all, and never fabricates a percentage the
 * server never reported a limit for. All copy routes through t(); numbers
 * are data.
 */

import type { ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { formatContextUsage } from "./usageMath.js";

export interface UsageStripProps {
  /** Latest-turn prompt tokens (null = nothing reported yet → strip hides). */
  readonly used: number | null;
  /** The active model's context window in tokens, if the server reported it. */
  readonly contextWindow?: number | undefined;
}

export function UsageStrip(props: UsageStripProps): ReactNode {
  const { t } = useStrings();
  if (props.used === null) return null;
  return (
    <span
      data-oc-usage
      title={t("chat.usage")}
      className="min-w-0 truncate text-[0.7em] text-muted-fg"
    >
      {formatContextUsage(props.used, props.contextWindow)}
    </span>
  );
}

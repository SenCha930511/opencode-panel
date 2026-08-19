/**
 * Old-server banner (plan todo 20): the passive warning shown while the
 * connected server is below the configured minimum version. Reads the
 * todo-20 flags store only and renders nothing until the mcp.status guards
 * assert oldServer (hide-first default). The banner is app-context-free
 * like McpPanel: whichever chrome embeds it owns the `attachMcpStores`
 * call (the chat header mounts it next to McpPopover, which attaches).
 */

import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { useCapabilityFlags } from "./capabilityFlags.js";

export function OldServerBanner(): ReactNode {
  const { t } = useStrings();
  const flags = useCapabilityFlags();
  if (!flags.oldServer) return null;
  return (
    <div role="status" className="border-b border-border bg-warn/15 px-2 py-1 text-xs text-fg">
      {t("server.oldVersion")}
    </div>
  );
}

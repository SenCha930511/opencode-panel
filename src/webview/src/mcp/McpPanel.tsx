/**
 * MCP status panel (plan todo 20, webview side): the natively-configured
 * server list with connected/disabled/failed dot colors from the todo-11
 * theme tokens, the `mcp.nativeOnly` header honesty line, the OMO
 * under-reporting note, and the localized error state.
 *
 * HEADLESS CONTRACT: this component reads ONLY the todo-20 stores
 * (./mcpStore.ts, ./capabilityFlags.ts) and the i18n binding — no app
 * context, no effects — so todo 21's settings capabilities section embeds
 * it unedited next to its own `attachMcpStores` call (./index.ts), and the
 * SSR suites render it straight to static markup. The chat-header chrome
 * lives in ./McpPopover.tsx.
 *
 * HONESTY RULES (binding): the list is the NATIVELY-CONFIGURED inventory
 * only — under oh-my-opencode the `mcp.omoNote` block renders and the UI
 * never claims a complete inventory; unknown names/statuses render as data
 * (dotForStatus' warn fallback); a failed /mcp probe renders the localized
 * error row from `settings.connectionFailed` (the frozen string table has
 * no mcp-specific error id and src/shared/** is out of bounds — the id was
 * chosen as the closest semantic match and is documented here). An empty
 * list with no error renders zero rows under the header note (the frozen
 * table likewise has no mcp.empty id; no copy is invented).
 */

import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { useCapabilityFlags } from "./capabilityFlags.js";
import { dotForStatus, type McpServerEntry } from "./constants.js";
import { useMcpSnapshot } from "./mcpStore.js";

function McpRow(props: { readonly server: McpServerEntry }): ReactNode {
  const { server } = props;
  return (
    <li
      className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-hover-bg"
      title={server.error ?? server.status}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dotForStatus(server.status)}`}
        aria-hidden="true"
      />
      <span className="flex-1 truncate text-fg">{server.name}</span>
      <span className="text-muted-fg">{server.status}</span>
    </li>
  );
}

export function McpPanel(): ReactNode {
  const { t } = useStrings();
  const snapshot = useMcpSnapshot();
  const flags = useCapabilityFlags();
  const servers = snapshot?.servers ?? [];
  return (
    <section aria-label={t("mcp.title")} className="flex min-w-0 flex-col gap-2 p-2 text-xs">
      <header className="flex items-center">
        <h2 className="text-xs font-semibold text-fg">{t("mcp.title")}</h2>
      </header>
      <p className="text-muted-fg">{t("mcp.nativeOnly")}</p>
      {flags.omoMcpNote ? (
        <p
          role="note"
          className="rounded border border-border bg-panel-bg p-1.5 text-muted-fg"
        >
          {t("mcp.omoNote")}
        </p>
      ) : null}
      {snapshot?.error !== undefined ? (
        <p
          role="alert"
          title={snapshot.error}
          className="rounded border border-border bg-err/10 p-1.5 text-fg"
        >
          {t("settings.connectionFailed")}
        </p>
      ) : null}
      <ul aria-label={t("mcp.title")} className="flex flex-col">
        {servers.map((server) => (
          <McpRow key={server.name} server={server} />
        ))}
      </ul>
    </section>
  );
}

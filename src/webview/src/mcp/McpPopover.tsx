/**
 * Chat-header popover chrome for the MCP panel (plan todo 20): a trigger
 * button with an absolutely anchored panel hosting the headless
 * <McpPanel />. Self-attaches the todo-20 stores on mount (todo-15
 * precedent: the shell never names feature stores). The panel content
 * itself stays app-context-free so todo 21 embeds it unedited.
 *
 * DISMISSAL: toggle on the trigger, Escape, or the close button. The
 * trigger's aria-label is the localized `mcp.title`.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { useApp } from "../app/context.js";
import { attachMcpStores } from "./attach.js";
import { McpPanel } from "./mcpPanel.js";

function PlugIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 14v-3M5.5 5.5V2M10.5 5.5V2M3.5 5.5h9V9a4.5 4.5 0 0 1-9 0V5.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function McpPopover(): ReactNode {
  const { messenger } = useApp();
  const { t } = useStrings();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    attachMcpStores(messenger);
  }, [messenger]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative">
      <button
        type="button"
        aria-label={t("mcp.title")}
        aria-expanded={open}
        className="rounded p-1.5 text-muted-fg hover:bg-hover-bg hover:text-fg"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <PlugIcon />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t("mcp.title")}
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded border border-border bg-panel-bg shadow-lg"
        >
          <div className="flex justify-end border-b border-border px-1 py-0.5">
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded p-1 text-muted-fg hover:bg-hover-bg hover:text-fg"
              onClick={() => {
                setOpen(false);
              }}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <McpPanel />
          </div>
        </div>
      ) : null}
    </span>
  );
}

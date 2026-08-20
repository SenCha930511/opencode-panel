import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { McpPopover, OldServerBanner } from "../mcp/index.js";
import { useApp, type ServerStatus } from "./context";

/**
 * Shell header (plan todo 11): server status badge, new-session / settings /
 * overflow actions. Model+agent chips intentionally render nothing yet — the
 * current init wire carries no model id and no agent list
 * (ServerCapabilities is fork/question/todo booleans; todo 15's pickers own
 * real selection state), so there is no honest value to show.
 */

function PlusIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.8 1.8h2.4l.3 1.7a4.9 4.9 0 0 1 1.4.8l1.6-.8 1.7 1.7-.8 1.6c.3.4.5.9.6 1.4l1.7.3v2.4l-1.7.3a4.9 4.9 0 0 1-.6 1.4l.8 1.6-1.7 1.7-1.6-.8a4.9 4.9 0 0 1-1.4.6l-.3 1.7H6.8l-.3-1.7a4.9 4.9 0 0 1-1.4-.6l-1.6.8-1.7 1.7.8-1.6a4.9 4.9 0 0 1-.6-1.4l-1.7-.3V8.5l1.7-.3c.1-.5.3-1 .6-1.4l-.8-1.6 1.7-1.7 1.6.8c.4-.3.9-.5 1.4-.6l.3-1.7Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function OverflowIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

interface StatusPresentation {
  readonly dotClass: string;
  readonly labelId:
    | "server.status.stopped"
    | "server.status.probing"
    | "server.status.connected"
    | "server.status.lost";
}

function statusPresentation(status: ServerStatus): StatusPresentation {
  switch (status) {
    case "stopped":
      return { dotClass: "bg-off", labelId: "server.status.stopped" };
    case "probing":
      return { dotClass: "bg-warn", labelId: "server.status.probing" };
    case "connected":
      return { dotClass: "bg-ok", labelId: "server.status.connected" };
    case "lost":
      return { dotClass: "bg-err", labelId: "server.status.lost" };
    default: {
      const unreachable: never = status;
      throw new Error(`unreachable status: ${JSON.stringify(unreachable)}`);
    }
  }
}

function ServerStatusBadge(): ReactNode {
  const { init, serverStatus, send } = useApp();
  const { t } = useStrings();
  const presentation = statusPresentation(serverStatus);

  const retry = (): void => {
    // Re-run the handshake: the host answers `ready` with a fresh `init`
    // push, whose identity change clears the lost bit in AppProvider. While
    // the server stays down no push follows and the badge keeps `lost`.
    void send("ready", {});
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="flex cursor-default items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted-fg">
            <span className={`h-2 w-2 rounded-full ${presentation.dotClass}`} />
            <span>{t(presentation.labelId)}</span>
            {serverStatus === "lost" ? (
              <button
                type="button"
                className="rounded bg-accent px-1.5 py-0.5 text-accent-fg hover:bg-accent-hover"
                onClick={retry}
              >
                {t("server.status.retry")}
              </button>
            ) : null}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            className="z-50 max-w-72 rounded border border-border bg-panel-bg px-2 py-1 text-xs text-fg shadow-lg"
          >
            {init.server.url.length > 0 ? init.server.url : t("server.status.stopped")}
            {init.server.version !== null ? ` — ${init.server.version}` : ""}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function OverflowMenu(): ReactNode {
  const { t } = useStrings();
  const itemClass =
    "cursor-default select-none rounded px-2 py-1 text-xs text-fg outline-none data-disabled:text-muted-fg data-highlighted:bg-hover-bg";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("menu.more")}
          className="rounded p-1.5 text-muted-fg hover:bg-hover-bg hover:text-fg"
        >
          <OverflowIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-36 rounded border border-border bg-panel-bg p-1 shadow-lg"
        >
          {/* Disabled placeholders wired in later todos: the wire protocol has
              no Open-TUI request (todo 22 owns the TUI escape hatch host-side)
              and Share needs a selected session id (todo 12). */}
          <DropdownMenu.Item disabled className={itemClass}>
            {t("menu.openTui")}
          </DropdownMenu.Item>
          <DropdownMenu.Item disabled className={itemClass}>
            {t("sessions.share")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Header(): ReactNode {
  const { navigate, send } = useApp();
  const { t } = useStrings();
  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-panel-bg px-2">
        <ServerStatusBadge />
        {/*
          Model/agent chips render here once honest values exist on the wire
          (see module comment); the area stays empty rather than fabricating.
        */}
        <span className="flex-1" />
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-fg hover:bg-hover-bg hover:text-fg"
          onClick={() => {
            // T12 completes the flow (selection + list refresh); the request is
            // the honest first step and failures already surface as toasts.
            void send("createSession", {});
          }}
        >
          <PlusIcon />
          {t("sessions.new")}
        </button>
        {/* Todo-20: MCP status popover (self-attaches its stores on mount). */}
        <McpPopover />
        <button
          type="button"
          aria-label={t("settings.title")}
          className="rounded p-1.5 text-muted-fg hover:bg-hover-bg hover:text-fg"
          onClick={() => {
            navigate("settings");
          }}
        >
          <GearIcon />
        </button>
        <OverflowMenu />
      </header>
      {/* Todo-20: passive below-floor warning; renders null when not flagged. */}
      <OldServerBanner />
    </>
  );
}

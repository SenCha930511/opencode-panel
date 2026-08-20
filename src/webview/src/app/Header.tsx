import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import { McpPopover, OldServerBanner } from "../mcp/index.js";
import { useApp, type ServerStatus } from "./context";

/**
 * Shell header (plan todo 11): sessions-history drawer toggle (chat-first
 * layout), server status badge, new-session / settings / overflow actions.
 * Model+agent chips intentionally render nothing yet — the current init wire
 * carries no model id and no agent list (ServerCapabilities is
 * fork/question/todo booleans; todo 15's pickers own real selection state),
 * so there is no honest value to show.
 */

function PlusIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8a5.5 5.5 0 1 0 1.6-3.89L2.5 5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M2.5 2.5v3h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 4.75V8l2.25 1.25"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GearIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.8 1.8h2.4l.3 1.7a4.9 4.9 0 0 1 1.4.8l1.6-.8 1.7 1.7-.8 1.6c.3.4.5.9.6 1.4l1.7.3v2.4l-1.7.3a4.9 4.9 0 0 1-.6 1.4l.8 1.6-1.7 1.7-1.6-.8a4.9 4.9 0 0 1-1.4.6l-.3 1.7H6.8l-.3-1.7a4.9 4.9 0 0 1-1.4-.6l-1.6.8-1.7 1.7.8-1.6a4.9 4.9 0 0 1-.6-1.4l-1.7-.3V8.5l1.7-.3c.1-.5.3-1 .6-1.4l-.8-1.6 1.7-1.7 1.6.8c.4-.3.9-.5 1.4-.6l.3-1.7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function OverflowIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
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
      return { dotClass: "bg-warn animate-pulse-subtle", labelId: "server.status.probing" };
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
    void send("ready", {});
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="flex cursor-default items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-fg transition-colors hover:text-fg hover:bg-hover-bg">
            <span className={`h-1.5 w-1.5 rounded-full ${presentation.dotClass}`} />
            <span className="truncate max-w-24">{t(presentation.labelId)}</span>
            {serverStatus === "lost" ? (
              <button
                type="button"
                className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-accent-fg hover:bg-accent-hover"
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
            className="z-50 max-w-72 rounded-md border border-card-border bg-panel-bg px-2.5 py-1.5 text-xs text-fg shadow-xl backdrop-blur-md"
          >
            {init.server.url.length > 0 ? init.server.url : t("server.status.stopped")}
            {init.server.version !== null ? ` — ${init.server.version}` : ""}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function SessionsHistoryButton(): ReactNode {
  const { sessionsOpen, toggleSessions } = useApp();
  const { t } = useStrings();
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={t("sessions.history")}
            aria-expanded={sessionsOpen}
            className={`rounded-md p-1.5 transition-colors ${
              sessionsOpen
                ? "bg-active-bg text-fg"
                : "text-muted-fg hover:bg-hover-bg hover:text-fg"
            }`}
            onClick={toggleSessions}
          >
            <HistoryIcon />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            className="z-50 max-w-72 rounded-md border border-card-border bg-panel-bg px-2.5 py-1.5 text-xs text-fg shadow-xl backdrop-blur-md"
          >
            {t("sessions.historyTitle")}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function OverflowMenu(): ReactNode {
  const { t } = useStrings();
  const itemClass =
    "cursor-default select-none rounded-sm px-2.5 py-1.5 text-xs text-fg outline-none transition-colors data-disabled:text-muted-fg data-highlighted:bg-hover-bg";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("menu.more")}
          className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-hover-bg hover:text-fg"
        >
          <OverflowIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-36 rounded-lg border border-card-border bg-panel-bg p-1 shadow-2xl backdrop-blur-md"
        >
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
  const { navigate, send, setSessionsOpen } = useApp();
  const { t } = useStrings();
  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-bg/80 px-2.5 backdrop-blur-md">
        <SessionsHistoryButton />
        <ServerStatusBadge />
        <span className="flex-1" />
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={t("sessions.new")}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-fg transition-colors hover:bg-hover-bg hover:text-fg"
                onClick={() => {
                  void send("createSession", {});
                }}
              >
                <PlusIcon />
                <span className="hidden sm:inline">{t("sessions.new")}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                sideOffset={4}
                className="z-50 rounded-md border border-card-border bg-panel-bg px-2 py-1 text-xs text-fg shadow-xl backdrop-blur-md"
              >
                {t("sessions.new")}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
        <McpPopover />
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={t("settings.title")}
                className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-hover-bg hover:text-fg"
                onClick={() => {
                  setSessionsOpen(false);
                  navigate("settings");
                }}
              >
                <GearIcon />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                sideOffset={4}
                className="z-50 rounded-md border border-card-border bg-panel-bg px-2 py-1 text-xs text-fg shadow-xl backdrop-blur-md"
              >
                {t("settings.title")}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
        <OverflowMenu />
      </header>
      <OldServerBanner />
    </>
  );
}

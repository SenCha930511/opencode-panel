import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useStrings } from "../lib/i18n.js";
import { ToastViewport } from "./app/ErrorBoundary";
import { useApp, type Route } from "./app/context";
import { Header } from "./app/Header";
import { currentViewKind } from "./app/viewKind.js";
import { useActiveSession } from "./chat/activeSession.js";
import { SettingsPage } from "./settings/SettingsPage.js";

/**
 * App shell (plan todo 11): header + state-driven routes + toast viewport.
 *
 * Routes: `chat` (default) | `settings` — a single webview with no router
 * lib; navigation mutates AppProvider state.
 *
 * TWO-VIEW TOPOLOGY (todo-1; fix: duplicated stacked blocks): the extension
 * contributes TWO webview views to one viewsContainer, and both load this
 * same bundle — the host shell's injected `__OPENCODE_PANEL_VIEW__` (read
 * via app/viewKind.ts) picks the surface:
 *  - chat view (kind "chat", the default): the full app below — Header,
 *    chat route, settings route, keep-alive history drawer, toasts.
 *  - sessions view (kind "sessions"): ONLY the slim sessions surface — one
 *    full-area <section data-oc-slot="sessions"> holding the standalone
 *    SessionsPanel. NO React Header, no chat section, no drawer machinery.
 *
 * SLOT CONTRACT (chat-first layout — supersedes the original two-column
 * aside/section split):
 *  - T13 (message list + composer) renders into `slots.chat`, mounted inside
 *    <section data-oc-slot="chat"> as the full-width default surface.
 *  - T12 (sessions domain) renders its SessionsPanel into `slots.sessions`,
 *    mounted inside <aside data-oc-slot="sessions"> in the keep-alive history
 *    drawer below: a floating left overlay, closed by default, toggled from
 *    the Header history button. The drawer is visibility-toggled, NEVER
 *    unmounted, because SessionsPanel owns the only SessionsStore — the
 *    `command.newSession` intake and the header New-Session selection flow
 *    live and die with its effects.
 *  - T21 (settings page) mounts into the `settings` route.
 */

function assertNeverRoute(route: never): never {
  throw new Error(`unreachable route: ${JSON.stringify(route)}`);
}

function DefaultSessionsSlot(): ReactNode {
  const { t } = useStrings();
  return <p className="p-3 text-xs text-muted-fg">{t("sessions.empty")}</p>;
}

function DefaultChatSlot(): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <p className="text-xs text-muted-fg">{t("messages.empty")}</p>
    </div>
  );
}

function CloseIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Floating sessions history drawer (chat-first layout): left slide-in panel
 * over the chat surface. Keep-alive on purpose (see the SLOT CONTRACT) —
 * closed means visibility/aria-hidden, never unmounted. Layers follow the
 * app's dialog convention (backdrop z-40 / panel z-50), scoped to the chat
 * route's relative container so the header stays clear. The open state omits
 * the translate class entirely: an active transform would become the
 * containing block for the panel's fixed-position session dialogs.
 */
function SessionsDrawer(): ReactNode {
  const { slots, sessionsOpen, setSessionsOpen } = useApp();
  const { t } = useStrings();
  return (
    <div
      data-oc-sessions-drawer
      data-state={sessionsOpen ? "open" : "closed"}
      aria-hidden={!sessionsOpen}
      className={`absolute inset-0 z-40 transition-[visibility,opacity] duration-200 ${
        sessionsOpen ? "" : "pointer-events-none invisible"
      }`}
    >
      <button
        type="button"
        aria-label={t("sessions.closeHistory")}
        tabIndex={-1}
        className={`absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-xs transition-opacity duration-200 ${
          sessionsOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setSessionsOpen(false)}
      />
      <aside
        data-oc-slot="sessions"
        role="dialog"
        aria-label={t("sessions.historyTitle")}
        className={`relative z-50 flex h-auto max-h-[82vh] w-full shrink-0 flex-col border-b border-card-border bg-panel-bg shadow-2xl transition-all duration-200 ease-out ${
          sessionsOpen ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">{slots.sessions ?? <DefaultSessionsSlot />}</div>
      </aside>
    </div>
  );
}

function ChatRoute(): ReactNode {
  const { slots, sessionsOpen, setSessionsOpen } = useApp();
  const activeSession = useActiveSession();

  useEffect(() => {
    if (!sessionsOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSessionsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sessionsOpen, setSessionsOpen]);

  // Auto-close on a committed selection change: SessionsPanel bridges its
  // store's applySelection into chat's setActiveSession, the one path both a
  // panel row click and `command.newSession` (create + select) already ride.
  const lastSessionRef = useRef(activeSession);
  useEffect(() => {
    if (lastSessionRef.current === activeSession) return;
    lastSessionRef.current = activeSession;
    setSessionsOpen(false);
  }, [activeSession, setSessionsOpen]);

  return (
    <div className="relative flex min-h-0 flex-1">
      <section data-oc-slot="chat" className="flex min-w-0 flex-1 flex-col">
        {slots.chat ?? <DefaultChatSlot />}
      </section>
      <SessionsDrawer />
    </div>
  );
}

function SettingsRoute(): ReactNode {
  return <SettingsPage />;
}

function renderRoute(route: Route): ReactNode {
  switch (route) {
    case "chat":
      return <ChatRoute />;
    case "settings":
      return <SettingsRoute />;
    default:
      return assertNeverRoute(route);
  }
}

function readFontOverride(settings: Readonly<Record<string, unknown>>): {
  readonly family: string | null;
  readonly size: string | null;
} {
  const family = settings["chatFontFamily"];
  const size = settings["chatFontSize"];
  return {
    family: typeof family === "string" && family.length > 0 ? family : null,
    size: typeof size === "number" && size > 0 ? `${size}px` : null,
  };
}

/**
 * Standalone sessions surface (kind "sessions" only): the contributed
 * sessions view renders this INSTEAD of the app shell — no Header, no chat
 * section, no drawer. SessionsPanel keeps its own store/command intake alive
 * here exactly as it does inside the chat view's history drawer.
 */
function SessionsViewSurface(): ReactNode {
  const { slots } = useApp();
  return (
    <section data-oc-slot="sessions" className="flex min-h-0 flex-1 flex-col">
      {slots.sessions ?? <DefaultSessionsSlot />}
    </section>
  );
}

export function App(): ReactNode {
  const { init, route } = useApp();
  const font = readFontOverride(init.settings);
  const style: CSSProperties & Partial<Record<`--${string}`, string>> = {
    fontFamily: "var(--oc-chat-font-family)",
    fontSize: "var(--oc-chat-font-size)",
  };
  if (font.family !== null) {
    style["--oc-chat-font-family"] = font.family;
  }
  if (font.size !== null) {
    style["--oc-chat-font-size"] = font.size;
  }
  if (currentViewKind() === "sessions") {
    return (
      <div className="flex h-full flex-col bg-bg text-fg" style={style}>
        <SessionsViewSurface />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-bg text-fg" style={style}>
      <Header />
      <main className="flex min-h-0 flex-1 flex-col">{renderRoute(route)}</main>
      <ToastViewport />
    </div>
  );
}

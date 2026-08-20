import type { CSSProperties, ReactNode } from "react";
import { useStrings } from "../lib/i18n.js";
import { ToastViewport } from "./app/ErrorBoundary";
import { useApp, type Route } from "./app/context";
import { Header } from "./app/Header";
import { SettingsPage } from "./settings/SettingsPage.js";

/**
 * App shell (plan todo 11): header + state-driven routes + toast viewport.
 *
 * Routes: `chat` (default) | `settings` — a single webview with no router
 * lib; navigation mutates AppProvider state.
 *
 * SLOT CONTRACT for the parallel workers (do not restructure):
 *  - T12 (sessions domain) renders its SessionList into `slots.sessions`,
 *    mounted inside <aside data-oc-slot="sessions"> below.
 *  - T13 (message list + composer) renders into `slots.chat`, mounted inside
 *    <section data-oc-slot="chat"> below.
 *  - T21 (settings page) mounts into the `settings` route — the placeholder
 *    this file used to ship is replaced by <SettingsPage/> (see that module).
 *  Pass them via <AppProvider slots={{ sessions: <SessionList/>, chat:
 *  <ChatView/> }}> in app/bootstrap.tsx when those todos land. Until then the
 *  honest empty states here stay visible. Panels must keep the aside/section
 *  flex split — the sessions column stays a fixed-width rail.
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

function ChatRoute(): ReactNode {
  const { slots } = useApp();
  return (
    <div className="flex min-h-0 flex-1">
      <aside data-oc-slot="sessions" className="w-52 shrink-0 overflow-y-auto border-e border-border">
        {slots.sessions ?? <DefaultSessionsSlot />}
      </aside>
      <section data-oc-slot="chat" className="flex min-w-0 flex-1 flex-col">
        {slots.chat ?? <DefaultChatSlot />}
      </section>
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
  return (
    <div className="flex h-full flex-col bg-bg text-fg" style={style}>
      <Header />
      <main className="flex min-h-0 flex-1 flex-col">{renderRoute(route)}</main>
      <ToastViewport />
    </div>
  );
}

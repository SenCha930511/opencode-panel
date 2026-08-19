import { useEffect, useState, type ReactNode } from "react";
import type { InitPayload } from "../../../shared/protocol.js";
import { useStrings, StringsProvider } from "../../lib/i18n.js";
import { getWebviewMessenger, type WebviewMessenger } from "../../lib/messenger.js";
import { App } from "../App";
import { AppProvider } from "./context";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Webview root: owns the messenger handshake (plan todo 10/11).
 *
 * Sequence: mount -> create the singleton messenger -> subscribe `init` ->
 * post `ready` -> host answers with an `init` push -> providers compose.
 * While `init` is pending the skeleton below renders; `useStrings()` there
 * uses the bundled English table until the host table arrives.
 */

interface Session {
  readonly init: InitPayload;
  readonly messenger: WebviewMessenger;
}

function LoadingSkeleton(): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-off" />
        <span className="text-xs text-muted-fg">{t("app.loading")}</span>
      </div>
      <div className="h-4 w-2/5 animate-pulse rounded bg-hover-bg" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-hover-bg" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-hover-bg" />
    </div>
  );
}

export function AppRoot(): ReactNode {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const messenger = getWebviewMessenger();
    const offInit = messenger.on("init", (init) => {
      setSession({ init, messenger });
    });
    // The host replies to `ready` with the `init` push above; the request
    // envelope itself resolves to null and carries no data, so a reject here
    // only means the host is not listening yet (the init push simply never
    // follows and the skeleton stays up).
    void messenger.request("ready").catch(() => {
      // Handshake is host-driven; nothing to do on a reject here.
    });
    return offInit;
  }, []);

  return (
    <ErrorBoundary>
      {session === null ? (
        <LoadingSkeleton />
      ) : (
        <StringsProvider init={session.init}>
          <AppProvider init={session.init} messenger={session.messenger}>
            <App />
          </AppProvider>
        </StringsProvider>
      )}
    </ErrorBoundary>
  );
}

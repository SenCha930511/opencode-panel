import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  FromWebviewProtocol,
  FromWebviewResponse,
  InitPayload,
  ServerInfo,
  ToastLevel,
} from "../../../shared/protocol.js";
import type { WebviewMessenger } from "../../lib/messenger.js";

/**
 * App-level context for the webview shell (plan todo 11).
 *
 * Carries everything the header/routes need below the StringsProvider:
 * the host `init` payload, state-driven routing (single webview, no router
 * lib), a `send()` helper that wraps messenger requests with error-toast
 * surfacing, the host toast queue, and the panel slots T12/T13 mount into.
 * No redux/zustand — context + hooks per the plan.
 */

export type Route = "chat" | "settings";

export type ServerStatus = "stopped" | "probing" | "connected" | "lost";

/**
 * Maps the wire `init.server` slice onto the UI status. The wire cannot
 * distinguish managed vs attached (documented deviation in
 * src/providers/initPayload.ts): a live URL + answered version probe means
 * "connected", a live URL without a probe answer means "probing".
 */
export function deriveServerStatus(server: ServerInfo): ServerStatus {
  if (server.url.length === 0) {
    return "stopped";
  }
  return server.version === null ? "probing" : "connected";
}

/**
 * Host event types that mark the connection dead. The eventBridge (todo 9)
 * posts `server-lost`; the disposed/disconnected spellings are accepted so a
 * later host rename cannot silently break the banner. Anything else leaves
 * the status untouched — a fresh `init` push recomputes it.
 */
export function isServerLostEvent(eventType: string): boolean {
  return (
    eventType === "server-lost" ||
    eventType === "server.lost" ||
    eventType === "server_disconnected" ||
    eventType === "server.disposed"
  );
}

export interface ToastItem {
  readonly id: string;
  readonly level: ToastLevel;
  readonly text: string;
}

/**
 * Mount slots owned by the parallel workers: T12 renders its SessionList
 * into `slots.sessions`, T13 renders MessageList/Composer into `slots.chat`.
 * See the SLOT CONTRACT comment in App.tsx. Defaults render honest empty
 * states until those todos land.
 */
export interface AppSlots {
  readonly sessions?: ReactNode;
  readonly chat?: ReactNode;
}

export interface AppContextValue {
  readonly init: InitPayload;
  readonly messenger: WebviewMessenger;
  readonly route: Route;
  navigate(route: Route): void;
  readonly serverStatus: ServerStatus;
  readonly toasts: readonly ToastItem[];
  dismissToast(id: string): void;
  /**
   * Fire a host request; a rejected request becomes an error toast (carrying
   * the host's technical message) and resolves to null instead of throwing,
   * so UI handlers never need their own try/catch.
   */
  send<K extends keyof FromWebviewProtocol>(
    type: K,
    payload: FromWebviewProtocol[K],
  ): Promise<FromWebviewResponse[K] | null>;
  readonly slots: AppSlots;
}

const AppContext = createContext<AppContextValue | null>(null);

const TOAST_TTL_MS = 5000;

export function AppProvider(props: {
  readonly init: InitPayload;
  readonly messenger: WebviewMessenger;
  readonly initialRoute?: Route;
  readonly slots?: AppSlots;
  readonly children: ReactNode;
}): ReactNode {
  const { init, messenger } = props;
  const [route, setRoute] = useState<Route>(props.initialRoute ?? "chat");
  const [serverLost, setServerLost] = useState(false);
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const timersRef = useRef<readonly ReturnType<typeof setTimeout>[]>([]);

  // A refreshed init payload (host reposts on reconnect) clears the lost bit.
  useEffect(() => {
    setServerLost(false);
  }, [init]);

  useEffect(() => {
    const timers = timersRef;
    return () => {
      // Read the ref at unmount: pushToast swaps the array on every toast.
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => { return toast.id !== id; }));
  }, []);

  const pushToast = useCallback(
    (level: ToastLevel, text: string) => {
      const id = globalThis.crypto.randomUUID();
      setToasts((current) => [...current, { id, level, text }]);
      const timer = setTimeout(() => {
        dismissToast(id);
      }, TOAST_TTL_MS);
      timersRef.current = [...timersRef.current, timer];
    },
    [dismissToast],
  );

  useEffect(() => {
    const offToast = messenger.on("toast", (payload) => {
      pushToast(payload.level, payload.text);
    });
    const offEvent = messenger.on("event", (payload) => {
      if (isServerLostEvent(payload.type)) {
        setServerLost(true);
      }
    });
    return () => {
      offToast();
      offEvent();
    };
  }, [messenger, pushToast]);

  const send = useCallback(
    async <K extends keyof FromWebviewProtocol>(
      type: K,
      payload: FromWebviewProtocol[K],
    ): Promise<FromWebviewResponse[K] | null> => {
      try {
        return await messenger.request(type, payload);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [messenger, pushToast],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      init,
      messenger,
      route,
      navigate: setRoute,
      serverStatus: serverLost ? "lost" : deriveServerStatus(init.server),
      toasts,
      dismissToast,
      send,
      slots: props.slots ?? {},
    }),
    [init, messenger, route, serverLost, toasts, dismissToast, send, props.slots],
  );

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) {
    throw new Error("useApp must be used below <AppProvider>");
  }
  return value;
}

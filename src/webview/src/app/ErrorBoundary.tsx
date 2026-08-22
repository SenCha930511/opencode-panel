import { Component, type ReactNode } from "react";
import type { ToastLevel } from "../../../shared/protocol.js";
import { useStrings } from "../../lib/i18n.js";
import { useApp } from "./context";

/**
 * Error boundary + toast viewport for the shell (plan todo 11).
 *
 * `ErrorBoundary` keeps a render crash from white-screening the webview: it
 * swaps in a fallback with the localized app name, the technical error
 * message, and a retry that remounts the subtree. The boundary sits ABOVE the
 * StringsProvider in the root tree, so this fallback can render before any
 * host strings arrive — `useStrings()` then degrades to the bundled English
 * table (lib/i18n fallback value) instead of crashing.
 *
 * `ToastViewport` turns host `toast` messages into transient notices; every
 * user-visible label goes through t().
 */

interface BoundaryProps {
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // Webview runtime failures surface in the devtools console (dev English,
    // per plan logging rules); the host output channel is for host events.
    console.error("opencode-chat-panel webview render crash", error);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return <ErrorBoundaryFallback error={error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorBoundaryFallback(props: {
  readonly error: Error;
  onReset(): void;
}): ReactNode {
  const { t } = useStrings();
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center"
    >
      <p className="text-sm font-semibold">{t("app.name")}</p>
      <p className="max-w-full break-words text-xs text-muted-fg">{props.error.message}</p>
      <button
        type="button"
        className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        onClick={props.onReset}
      >
        {t("server.status.retry")}
      </button>
    </div>
  );
}

const TOAST_ACCENT: Record<ToastLevel, string> = {
  info: "border-accent/40 bg-panel-bg/95",
  warning: "border-amber-400/40 bg-panel-bg/95",
  error: "border-err/40 bg-panel-bg/95",
};

function CloseIcon(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Transient toast stack anchored at top. Mounted below every route so a
 * toast raised in chat stays visible and never blocks the bottom input composer.
 */
export function ToastViewport(): ReactNode {
  const { toasts, dismissToast } = useApp();
  const { t } = useStrings();
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed top-3 end-3 start-3 z-50 flex flex-col items-center gap-2 max-w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex max-w-sm w-full items-start gap-2.5 rounded-2xl border p-3 text-xs shadow-2xl backdrop-blur-xl ring-1 ring-black/10 transition-all duration-200 ${TOAST_ACCENT[toast.level]}`}
        >
          <div className="min-w-0 flex-1 break-words text-fg text-[11px] leading-relaxed">
            {toast.text}
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            className="shrink-0 rounded-lg p-1 text-muted-fg hover:bg-hover-bg hover:text-fg transition-colors cursor-pointer"
            onClick={() => {
              dismissToast(toast.id);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Shared WebviewView plumbing for the two todo-1 sidebar views (chat +
 * sessions). Owns, per resolved view:
 *  - shell assembly: todo-10 strict-CSP HTML via buildWebviewHtml, with
 *    `localResourceRoots` limited to the extension media/ root and
 *    `enableCommandUris` NEVER set;
 *  - the todo-3 HostMessenger bound to the view's postMessage/onMessage pair,
 *    pre-wired with every domain handler in the composite HandlerRegistry;
 *  - the init handshake: the webview's `ready` request is answered by posting
 *    the full `init` payload (locale/strings/settings/server/capabilities),
 *    and an init-refresh is re-posted whenever the todo-8 manager transitions
 *    to managed/attached or signals server loss (error state);
 *  - the `registerHandler` passthrough todos 12-21 use to add domain handlers.
 *
 * REVIEW ADVISORY (binding): `__DEV__`-gated transport recorder. In dev
 * builds every posted message is recorded and exposed through the `_test`
 * property (consumed by todo 24 via {@link getDevPostedMessages}). The
 * recorder, the `_test` property and its literal all live inside `__DEV__`
 * branches only, so production builds tree-shake them out entirely.
 *
 * vscode.Uri values come in through deps; the only vscode-shaped surface is
 * the narrow PanelWebviewView seam (webviewSeam.ts), so this module runs
 * under plain node in unit tests.
 */

import type * as vscode from "vscode";
import type { Disposable, Event } from "../host/config.js";
import type { PanelLogger } from "../host/logger.js";
import { HostMessenger, type Handler, type HostPort } from "../host/messenger.js";
import type { ServerManagerState } from "../server/ServerManager.js";
import type { FromWebviewProtocol, HostMessage, InitPayload } from "../shared/protocol.js";
import { buildWebviewHtml, type PanelViewKind } from "./html.js";
import type { HandlerRegistry } from "./handlers.js";
import type { JoinPath, PanelWebview, PanelWebviewView } from "./webviewSeam.js";

export interface ViewProviderDeps {
  readonly extensionUri: vscode.Uri;
  readonly joinPath: JoinPath;
  readonly handlers: HandlerRegistry;
  readonly buildInitPayload: () => Promise<InitPayload>;
  readonly onManagerStateChange: Event<ServerManagerState>;
  /** True only behind the host `__DEV__` gate (vite dev-server HTML). */
  readonly devMode: boolean;
  readonly logger: PanelLogger;
}

/**
 * Todo-24 transport seam (dev builds only; the `_test` property itself is
 * defined only inside the `__DEV__` branch, so production bundles erase it).
 * `getPostedMessages` replays every host→webview post; `receiveFromWebview`
 * feeds one envelope through the REAL per-view HostMessenger dispatch (see
 * HostMessenger.handleIncoming); `hasResolvedView` reports view resolution
 * so the harness orders focus → ready deterministically.
 */
export interface DevProviderTestHooks {
  getPostedMessages(): readonly HostMessage[];
  hasResolvedView(): boolean;
  receiveFromWebview(message: unknown): void;
}

function assertNever(value: never): never {
  throw new Error(`unreachable server state: ${JSON.stringify(value)}`);
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export abstract class BaseViewProvider implements vscode.WebviewViewProvider {
  private readonly deps: ViewProviderDeps;
  private view: PanelWebviewView | undefined;
  private messenger: HostMessenger | undefined;
  private subscriptions: Disposable[] = [];
  private readonly posted: HostMessage[] = [];
  /**
   * Post gating: events fire-and-forget into a loading webview evaporate
   * (the iframe runs no message listeners until React mounts). Posts are
   * queued until the view's SECOND `ready` — the warm one the webview sends
   * after its AppProvider subscriptions attach — then flushed in FIFO order.
   * The `init` handshake bypasses the gate (it IS the handshake).
   */
  private readyPhase: "cold" | "warming" | "warm" = "cold";
  private readonly pendingPosts: HostMessage[] = [];

  protected constructor(deps: ViewProviderDeps) {
    this.deps = deps;
    if (__DEV__) {
      // REVIEW ADVISORY (binding): todo-24 transport inspector; production
      // builds erase this whole branch, so no `_test` literal survives.
      const hooks: DevProviderTestHooks = {
        getPostedMessages: (): readonly HostMessage[] => [...this.posted],
        hasResolvedView: (): boolean => this.view !== undefined,
        receiveFromWebview: (message: unknown): void => {
          const messenger = this.messenger;
          if (messenger === undefined) {
            throw new Error("todo-24 harness: no resolved webview view to receive through");
          }
          messenger.handleIncoming(message);
        },
      };
      Object.defineProperty(this, "_test", {
        configurable: true,
        value: hooks,
      });
    }
  }

  /** Every message this provider posted to its webview (dev builds only). */
  getDevPostedMessages(): readonly HostMessage[] {
    return [...this.posted];
  }

  /**
   * Todo-10 handler seam: records the domain handler in the composite
   * registry (so future view resolves pick it up) and registers it into this
   * view's live messenger when one exists.
   */
  registerHandler<K extends keyof FromWebviewProtocol>(type: K, handler: Handler<K>): void {
    this.deps.handlers.set(type, handler);
    this.messenger?.register(type, handler);
  }

  resolveWebviewView(view: PanelWebviewView, _context: unknown, _token: unknown): void {
    this.view = view;
    this.readyPhase = "cold";
    this.pendingPosts.length = 0;
    const mediaRoot = this.deps.joinPath(this.deps.extensionUri, "media");
    // enableCommandUris stays UNSET (plan todo 10 MUST-NOT); roots = media/.
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    view.webview.html = this.buildShell(view.webview, mediaRoot);

    const port: HostPort = {
      postMessage: (message) => {
        this.post(message);
      },
      onMessage: (listener) => {
        this.track(view.webview.onDidReceiveMessage(listener));
      },
    };
    const messenger = new HostMessenger(port);
    this.messenger = messenger;
    this.deps.handlers.applyInto(messenger);
    // `ready` is protocol substrate owned here, not a domain handler. The
    // webview's FIRST ready triggers the init handshake; its SECOND (warm)
    // confirms the provider listeners attached and flushes the event queue.
    messenger.register("ready", async () => {
      if (this.readyPhase === "cold") {
        this.readyPhase = "warming";
        const payload = await this.deps.buildInitPayload();
        this.post({ type: "init", payload });
        this.deps.logger.debug("posted init payload to webview view");
      } else {
        this.readyPhase = "warm";
        for (const queued of this.pendingPosts.splice(0)) {
          this.post(queued);
        }
      }
      return null;
    });

    this.track(
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          void this.postInitRefresh();
        }
      }),
    );
    this.track(
      this.deps.onManagerStateChange((state) => {
        if (this.view !== view) return;
        switch (state.kind) {
          case "managed":
          case "attached":
          case "error":
            void this.postInitRefresh();
            return;
          case "stopped":
          case "probing":
          case "stopping":
            return;
          default:
            assertNever(state);
        }
      }),
    );
    this.track(
      view.onDidDispose(() => {
        messenger.dispose();
        for (const sub of this.subscriptions.splice(0)) {
          sub.dispose();
        }
        if (this.view === view) {
          this.view = undefined;
          this.messenger = undefined;
          this.readyPhase = "cold";
          this.pendingPosts.length = 0;
        }
      }),
    );
  }

  /**
   * Two-view topology seam (fix: duplicated stacked blocks): which of the
   * contributed views this provider serves — stamped into the resolved
   * shell's `globalThis.__OPENCODE_PANEL_VIEW__` so the shared webview
   * bundle renders the full chat app or the slim sessions panel. The chat
   * provider keeps this default; SessionsViewProvider overrides it.
   */
  protected viewKind(): PanelViewKind {
    return "chat";
  }

  /** Posts a typed host message; recorded in dev, dropped when no view. */
  protected post(message: HostMessage): void {
    if (__DEV__) {
      this.posted.push(message);
    }
    const view = this.view;
    if (view === undefined) return;
    if (message.type !== "init" && message.type !== "streamChunk" && this.readyPhase !== "warm") {
      // Cap: a flood pre-boot keeps only the tail (drop-oldest, FIFO intact).
      if (this.pendingPosts.length >= 25) {
        this.pendingPosts.shift();
        this.deps.logger.debug("view post queue full: dropped the oldest pending message");
      }
      this.pendingPosts.push(message);
      return;
    }
    void view.webview.postMessage(message);
  }

  private track(subscription: Disposable): void {
    this.subscriptions.push(subscription);
  }

  private buildShell(webview: PanelWebview, mediaRoot: vscode.Uri): string {
    const { joinPath, devMode } = this.deps;
    // Compile-time gate: production bundles erase the dev branch entirely.
    if (__DEV__ && devMode) {
      return buildWebviewHtml({
        cspSource: webview.cspSource,
        scriptUri: "http://localhost:5173/src/main.tsx",
        dev: true,
        viewKind: this.viewKind(),
      });
    }
    return buildWebviewHtml({
      cspSource: webview.cspSource,
      scriptUri: webview.asWebviewUri(joinPath(mediaRoot, "webview", "main.js")).toString(),
      styleUri: webview.asWebviewUri(joinPath(mediaRoot, "webview", "main.css")).toString(),
      dev: false,
      viewKind: this.viewKind(),
    });
  }

  /**
   * Public refresh seam: callers that mutate any init slice (e.g. the
   * opencodePanel.language override on config change) re-post the full
   * payload through the exact path the visibility/manager transitions use.
   */
  async refreshInit(): Promise<void> {
    await this.postInitRefresh();
  }

  /**
   * Init refresh on connection/server-lost transitions (todo 10): the
   * payload's `server` slice doubles as the visible server-status affordance
   * this milestone.
   */
  private async postInitRefresh(): Promise<void> {
    if (this.view === undefined) return;
    try {
      const payload = await this.deps.buildInitPayload();
      // The view may have been disposed while detection was in flight.
      if (this.view === undefined) return;
      this.post({ type: "init", payload });
      this.deps.logger.debug("posted init refresh to webview view");
    } catch (error) {
      this.deps.logger.warn(`init refresh failed: ${errorSummary(error)}`);
    }
  }
}

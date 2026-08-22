/**
 * Node-side fakes for the provider suites: vscode.Uri stand-ins, a fake
 * PanelWebviewView (the narrow webviewSeam surface), and init-payload sample
 * builders. No `vscode` runtime resolution happens anywhere in here.
 */

import type * as vscode from "vscode";
import { DEFAULT_PANEL_CONFIG } from "../../host/config.js";
import type { Event, Listener } from "../../host/config.js";
import { buildInitStrings } from "../../host/locale.js";
import type { ServerManagerState } from "../../server/serverManager.js";
import type { InitPayload } from "../../shared/protocol.js";
import type {
  PanelWebview,
  PanelWebviewOptions,
  PanelWebviewView,
} from "../webviewSeam.js";

/** Uri-shaped value satisfying vscode.Uri structurally under node. */
export function fakeUri(path: string): vscode.Uri {
  return {
    scheme: "test-file",
    authority: "",
    path,
    query: "",
    fragment: "",
    fsPath: path,
    with: () => fakeUri(path),
    toJSON: () => ({}),
    toString: () => `test-uri:${path}`,
  };
}

export const joinPathFake = (base: vscode.Uri, ...pathSegments: string[]): vscode.Uri =>
  fakeUri([base.path, ...pathSegments].join("/"));

export class FakeEventSource<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export class FakeWebview implements PanelWebview {
  readonly cspSource = "test-vscode-resource:";
  options: PanelWebviewOptions = {};
  html = "";
  /** Raw messages the provider posted through this webview. */
  readonly posted: unknown[] = [];
  readonly incoming = new FakeEventSource<unknown>();

  postMessage(message: unknown): Thenable<boolean> {
    this.posted.push(message);
    return Promise.resolve(true);
  }

  asWebviewUri(localResource: vscode.Uri): vscode.Uri {
    return fakeUri(`/as-webview${localResource.path}`);
  }

  get onDidReceiveMessage(): Event<unknown> {
    return this.incoming.event;
  }
}

export class FakeWebviewView implements PanelWebviewView {
  readonly webview = new FakeWebview();
  readonly visibility = new FakeEventSource<void>();
  readonly disposal = new FakeEventSource<void>();
  visible = true;

  get onDidChangeVisibility(): Event<void> {
    return this.visibility.event;
  }

  get onDidDispose(): Event<void> {
    return this.disposal.event;
  }

  show(_preserveFocus?: boolean): void {}

  /** Simulates VSCode disposing the view. */
  dispose(): void {
    this.disposal.fire();
  }
}

export function sampleInitPayload(overrides: Partial<InitPayload> = {}): InitPayload {
  const { locale, strings } = buildInitStrings("en");
  return {
    locale,
    strings,
    settings: { ...DEFAULT_PANEL_CONFIG },
    server: { url: "", version: null },
    capabilities: { fork: false, question: false, todo: false },
    ...overrides,
  };
}

export const STOPPED_STATE: ServerManagerState = { kind: "stopped" };

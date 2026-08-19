/**
 * Minimal vscode webview seam (mirrors the todo-6 ConfigAdapter pattern):
 * the providers only touch these narrow surfaces, so unit tests construct
 * plain-object fakes under node + vitest while `vscode.WebviewView` stays
 * structurally assignable to them at the activation boundary.
 *
 * `vscode.Uri` itself is kept as the value type for resource locations —
 * providers receive `joinPath` injected (vscode.Uri.joinPath at runtime,
 * a string concat in tests) rather than importing the vscode runtime.
 */

import type * as vscode from "vscode";
import type { Event } from "../host/config.js";

/**
 * Subset of `vscode.WebviewOptions` the providers set. `enableCommandUris` is
 * NEVER enabled (plan todo 10 MUST-NOT: no command: link handling).
 */
export interface PanelWebviewOptions {
  enableScripts?: boolean;
  enableCommandUris?: boolean | readonly string[];
  localResourceRoots?: readonly vscode.Uri[];
}

/** Subset of `vscode.Webview` the shell build + messenger wiring use. */
export interface PanelWebview {
  readonly cspSource: string;
  options: PanelWebviewOptions;
  html: string;
  postMessage(message: unknown): Thenable<boolean>;
  asWebviewUri(localResource: vscode.Uri): vscode.Uri;
  readonly onDidReceiveMessage: Event<unknown>;
}

/** Subset of `vscode.WebviewView` the providers consume. */
export interface PanelWebviewView {
  readonly webview: PanelWebview;
  readonly visible: boolean;
  readonly onDidChangeVisibility: Event<void>;
  readonly onDidDispose: Event<void>;
  show(preserveFocus?: boolean): void;
}

/** Resource joiner mirroring `vscode.Uri.joinPath`, injected per environment. */
export type JoinPath = (base: vscode.Uri, ...pathSegments: string[]) => vscode.Uri;

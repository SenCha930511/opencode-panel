/**
 * Message-ops wire verbs + revert-confirm controller (todo 19, webview
 * side). Every verb follows composerLogic.ts's folding rule: a rejected
 * todo-3 request is reported and folded into false, never thrown at the UI.
 *
 * CONFIRM GATE (plan hard rule): {@link MessageActionsController} NEVER runs
 * revert at click time — `requestRevert` / `requestRegenerate` only record
 * the intent (the component opens the Radix confirm dialog off this state)
 * and the wire call happens exclusively inside {@link confirm}, when the
 * dialog's confirm action fires. Regenerate rides the same gate: its
 * revert+resend composition also undoes file changes.
 *
 * Regenerate composition: revert at the target user message, then resend its
 * text through the todo-14 `sendPrompt` wire ({@link buildPromptPayload} /
 * {@link submitPrompt}) — NOT raw client calls. Resend runs ONLY on a
 * successful revert (the QA failure shape: revert fails -> report -> nothing
 * resent, no local removal).
 */

import type { WebviewMessenger } from "../../../lib/messenger.js";
import type { FromWebviewProtocol } from "../../../../shared/protocol.js";
import { buildPromptPayload, submitPrompt } from "../composerLogic.js";
import type { MessageVM } from "../types.js";
import { classifyMessageOpError, findLastUserText } from "./logic.js";

// ---------------------------------------------------------------------------
// Reporter seam: the component maps these onto toasts (StringIds live at the
// component layer — unsupported -> capability.hidden, error -> raw text).

export interface MessageOpReporter {
  unsupported(): void;
  error(message: string): void;
}

function fold(report: MessageOpReporter, error: unknown): false {
  const text = error instanceof Error ? error.message : String(error);
  if (classifyMessageOpError(text) === "unsupported") {
    report.unsupported();
  } else {
    report.error(text);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Verbs.

export async function requestRevert(
  messenger: WebviewMessenger,
  payload: FromWebviewProtocol["revert"],
  report: MessageOpReporter,
): Promise<boolean> {
  try {
    await messenger.request("revert", payload);
    return true;
  } catch (error) {
    return fold(report, error);
  }
}

export async function requestUnrevert(
  messenger: WebviewMessenger,
  payload: FromWebviewProtocol["unrevert"],
  report: MessageOpReporter,
): Promise<boolean> {
  try {
    await messenger.request("unrevert", payload);
    return true;
  } catch (error) {
    return fold(report, error);
  }
}

export async function requestSummarize(
  messenger: WebviewMessenger,
  payload: FromWebviewProtocol["summarize"],
  report: MessageOpReporter,
): Promise<boolean> {
  try {
    await messenger.request("summarize", payload);
    return true;
  } catch (error) {
    return fold(report, error);
  }
}

export async function requestRunShell(
  messenger: WebviewMessenger,
  payload: FromWebviewProtocol["runShell"],
  report: MessageOpReporter,
): Promise<boolean> {
  try {
    await messenger.request("runShell", payload);
    return true;
  } catch (error) {
    return fold(report, error);
  }
}

// ---------------------------------------------------------------------------
// Share copy: the todo-12 share wire + an injected clipboard seam (mirrors
// sessions/sessionOps.ts — navigator.clipboard in production, stubbed here;
// a blocked clipboard stays silent exactly like T12's copied-mark flow).

export type ShareCopyOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "share-failed"; readonly message: string }
  | { readonly kind: "clipboard-failed" };

export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export async function copyShareLink(
  messenger: WebviewMessenger,
  sessionId: string,
  clipboard: ClipboardLike,
): Promise<ShareCopyOutcome> {
  try {
    const { url } = await messenger.request("share", { id: sessionId });
    try {
      await clipboard.writeText(url);
      return { kind: "copied" };
    } catch {
      return { kind: "clipboard-failed" };
    }
  } catch (error) {
    return { kind: "share-failed", message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Regenerate composition (spied by tests at each step).

export interface RegenerateVerbs {
  revert(payload: FromWebviewProtocol["revert"]): Promise<boolean>;
  sendText(sessionId: string, text: string): Promise<boolean>;
}

/** Production verbs: menu verbs above + the todo-14 sendPrompt wire call. */
export function createRegenerateVerbs(
  messenger: WebviewMessenger,
  report: MessageOpReporter,
): RegenerateVerbs {
  return {
    revert: (payload) => requestRevert(messenger, payload, report), // i18n-allow-literal
    sendText: (sessionId, text) =>
      submitPrompt(
        messenger,
        buildPromptPayload({ sessionId, text, attachments: [] }),
        report.error,
      ),
  };
}

/** revert-at-target THEN resend; resend only on a successful revert. */
export async function runRegenerate(
  verbs: RegenerateVerbs,
  input: { readonly sessionId: string; readonly messageId: string; readonly text: string },
): Promise<boolean> {
  const reverted = await verbs.revert({ id: input.sessionId, messageID: input.messageId });
  if (!reverted) return false;
  return verbs.sendText(input.sessionId, input.text);
}

// ---------------------------------------------------------------------------
// The confirm-gated controller (framework-free, useSyncExternalStore-shaped,
// matching the todo-13 MessageStore/AutoScrollPark idiom).

export type PendingConfirmOp =
  | { readonly kind: "revert"; readonly messageId: string }
  | { readonly kind: "regenerate"; readonly messageId: string; readonly text: string };

export interface MessageActionsControllerDeps {
  readonly sessionId: () => string | undefined; // i18n-allow-literal
  readonly messages: () => readonly MessageVM[]; // i18n-allow-literal
  readonly messenger: WebviewMessenger;
  readonly reporter: MessageOpReporter;
  readonly regenerateVerbs?: RegenerateVerbs;
  /**
   * Fires after a PROVEN-successful revert (or regenerate, whose first step
   * is a revert): the caller mirrors the marker into the MessageStore so the
   * messages below the point leave the visible list immediately.
   */
  readonly onReverted?: { (messageId: string): void };
  /** Fires after a proven-successful unrevert (restores the visible tail). */
  readonly onUnreverted?: { (): void };
}

export class MessageActionsController {
  private readonly deps: MessageActionsControllerDeps;
  private pending: PendingConfirmOp | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(deps: MessageActionsControllerDeps) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getPending = (): PendingConfirmOp | null => this.pending; // i18n-allow-literal

  /** True when the current list carries a resendable user message. */
  canRegenerate(): boolean {
    return findLastUserText(this.deps.messages()) !== undefined;
  }

  /** Gate entry: records intent; NO wire call (dialog opens off getPending). */
  requestRevert(messageId: string): void {
    this.setPending({ kind: "revert", messageId });
  }

  /** Gate entry for regenerate; false when no user message carries text. */
  requestRegenerate(): boolean {
    const target = findLastUserText(this.deps.messages());
    if (target === undefined) return false;
    this.setPending({ kind: "regenerate", messageId: target.messageId, text: target.text });
    return true;
  }

  cancel(): void {
    this.setPending(null);
  }

  /** The ONLY place revert/regenerate reach the wire. Clears the dialog always. */
  async confirm(): Promise<boolean> {
    const pending = this.pending;
    this.setPending(null);
    if (pending === null) return false;
    const sessionId = this.deps.sessionId();
    if (sessionId === undefined) return false;
    switch (pending.kind) {
      case "revert": {
        const ok = await requestRevert(
          this.deps.messenger,
          { id: sessionId, messageID: pending.messageId },
          this.deps.reporter,
        );
        if (ok) this.deps.onReverted?.(pending.messageId);
        return ok;
      }
      case "regenerate": {
        const ok = await runRegenerate(
          this.defaultedRegenerateVerbs(),
          { sessionId, messageId: pending.messageId, text: pending.text },
        );
        if (ok) this.deps.onReverted?.(pending.messageId);
        return ok;
      }
      default: {
        const exhaustive: never = pending;
        return exhaustive;
      }
    }
  }

  /** Restore reverted messages — non-destructive, runs without the gate. */
  async unrevert(): Promise<boolean> {
    const sessionId = this.deps.sessionId();
    if (sessionId === undefined) return false;
    const ok = await requestUnrevert(this.deps.messenger, { id: sessionId }, this.deps.reporter);
    if (ok) this.deps.onUnreverted?.();
    return ok;
  }

  private defaultedRegenerateVerbs(): RegenerateVerbs {
    return (
      this.deps.regenerateVerbs ?? createRegenerateVerbs(this.deps.messenger, this.deps.reporter)
    );
  }

  private setPending(next: PendingConfirmOp | null): void {
    if (this.pending === next) return;
    this.pending = next;
    for (const listener of [...this.listeners]) listener();
  }
}

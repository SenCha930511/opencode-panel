/**
 * Composer pure logic (todo 14, webview side): every DOM/wire decision the
 * Composer makes, frozen into node-testable functions. No React, no DOM.
 *
 * - {@link shouldSend}: Enter sends, Shift+Enter is a newline, Cmd/Ctrl+Enter
 *   also sends (with or without Shift — the modifier IS the send intent).
 * - {@link buildPromptPayload}: the verbatim todo-3 `sendPrompt` envelope;
 *   `ComposerAttachment` chips map onto wire `Attachment`s.
 * - {@link placeholderForStatus} / {@link composerDisabled}: server status
 *   drives the disabled + placeholder states (StringIds only — display copy
 *   stays behind t()).
 * - {@link submitPrompt} / {@link requestAbort}: the wire calls, taking the
 *   todo-3 messenger directly so the wire stays typed; failures are
 *   reported to the caller (toast seam) and folded into `false`, so the
 *   composer keeps the draft on ANY failure (QA failure contract).
 */

import type { FromWebviewProtocol } from "../../../shared/protocol.js";
import type { StringId } from "../../../shared/strings.js";
import type { WebviewMessenger } from "../../lib/messenger.js";
import type { ServerStatus } from "../app/context.js";
import { setActiveSession } from "./activeSession.js";

/**
 * Resolve the session a send targets: the active one, or — on the home
 * screen where none exists — a freshly created chat that gets pinned as the
 * active session so the composer, message list, and host sync all follow it.
 */
export async function ensureSessionForSend(
  messenger: WebviewMessenger,
  sessionId: string | undefined,
): Promise<string> {
  if (sessionId !== undefined) return sessionId;
  const created = await messenger.request("createSession", {});
  setActiveSession(created.id);
  return created.id;
}

/** One attachment chip staged in the composer (todo-17 fills this in). */
export interface ComposerAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** data: URL or absolute file path (mirrors todo-3 `Attachment.url`). */
  readonly url: string;
}

/** Structural subset of a key event the send decision consumes. */
export interface KeyEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

/**
 * Enter = send; Shift+Enter = newline; Cmd/Ctrl+Enter = send (modifier beats
 * Shift per the plan's "also send"). Everything else is plain editing.
 * During IME composition (e.g. Zhuyin/Pinyin candidate confirmation), do NOT send.
 */
export function shouldSend(event: KeyEventLike): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key !== "Enter") return false;
  if (event.metaKey || event.ctrlKey) return true;
  return !event.shiftKey;
}

export type SendPromptPayload = FromWebviewProtocol["sendPrompt"];

/** Compose the exact wire payload; agent/model only when the pickers set them. */
export function buildPromptPayload(input: {
  readonly sessionId: string;
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly agent?: string;
  readonly model?: string;
  readonly variant?: string;
}): SendPromptPayload {
  return {
    text: input.text,
    sessionId: input.sessionId,
    attachments: input.attachments.map((attachment) => {
      const wire: { readonly name: string; readonly mimeType: string; readonly url: string } = {
        name: attachment.name,
        mimeType: attachment.mimeType,
        url: attachment.url,
      };
      return wire;
    }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.variant === undefined ? {} : { variant: input.variant }),
  };
}

/** Placeholder StringId per server status (copy stays behind t()). */
export function placeholderForStatus(status: ServerStatus): StringId {
  switch (status) {
    case "connected":
      return "composer.placeholder";
    case "probing":
      return "server.status.probing";
    case "stopped":
      return "server.status.stopped";
    case "lost":
      return "server.status.lost";
    default:
      return assertNever(status);
  }
}

/** Only a connected server accepts input; everything else disables the composer. */
export function composerDisabled(status: ServerStatus): boolean {
  return status !== "connected";
}

/** One sendPrompt round-trip. true on success; false + report on ANY failure. */
export async function submitPrompt(
  messenger: WebviewMessenger,
  payload: SendPromptPayload,
  reportError: { (message: string): void },
): Promise<boolean> {
  try {
    await messenger.request("sendPrompt", payload);
    return true;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** One abort round-trip (Stop button). Same failure folding as submitPrompt. */
export async function requestAbort(
  messenger: WebviewMessenger,
  payload: FromWebviewProtocol["abort"],
  reportError: { (message: string): void },
): Promise<boolean> {
  try {
    await messenger.request("abort", payload);
    return true;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable server status: ${JSON.stringify(value)}`);
}

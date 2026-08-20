/**
 * Sticky user-prompt bar: while the reader has scrolled past a user message,
 * that prompt floats at the top of the chat list (same card treatment as a
 * user bubble so it reads as the same row). The bar's anchor is fully
 * data-driven — {@link stickyUserMessage} picks the LATEST real user
 * message strictly above the first visible index, so:
 * - at the bottom of a growing reply the just-sent prompt pins itself as it
 *   leaves the viewport;
 * - scrolling back UP until the inline message reaches the top makes the
 *   bar vanish — visually merging back into the row at that spot;
 * - scrolling further up flips the anchor to the previous user message.
 * Clicking the bar jumps the list so the anchored message lands at the top
 * (the bar then merges, per the rule above).
 */

import type { ReactNode } from "react";
import type { MessageVM } from "./types.js";

export interface StickyAnchor {
  readonly index: number;
  readonly messageId: string;
  readonly text: string;
}

function visibleUserText(message: MessageVM): string {
  let text = "";
  for (const part of message.parts) {
    if (part.kind === "text") text += part.text;
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The bar's anchor, or undefined (nothing to pin): the last user message
 * with real text ABOVE the first visible row. In-flight placeholder
 * messages never anchor.
 */
export function stickyUserMessage(
  messages: readonly MessageVM[],
  firstVisibleIndex: number,
): StickyAnchor | undefined {
  if (firstVisibleIndex <= 1) return undefined;
  const end = Math.min(firstVisibleIndex, messages.length) - 1;
  for (let index = end; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user" || message.inFlight) continue;
    const text = visibleUserText(message);
    if (text.length > 0) {
      return { index, messageId: message.id, text };
    }
  }
  return undefined;
}

function ReturnIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted-fg">
      <path
        d="M9.5 12.5L4.5 7.5L9.5 2.5M5 7.5H13.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StickyPromptBar(props: {
  readonly anchor: StickyAnchor;
  onJump(index: number): void;
}): ReactNode {
  return (
    <div data-oc-sticky-prompt className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4.5 sm:px-5 pt-1.5">
      <button
        type="button"
        title={props.anchor.text}
        className="pointer-events-auto flex w-full items-center gap-2 rounded-2xl border border-card-border/80 bg-card-bg/90 p-3 text-left shadow-lg backdrop-blur-md transition-colors hover:border-focus-ring/60 cursor-pointer"
        onClick={() => {
          props.onJump(props.anchor.index);
        }}
      >
        <ReturnIcon />
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg/90">{props.anchor.text}</span>
      </button>
    </div>
  );
}

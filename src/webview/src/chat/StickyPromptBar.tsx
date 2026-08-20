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
  return text.trim();
}

/**
 * The bar's anchor, or undefined:
 * - If the top visible row is already a user message, return undefined so the
 *   original text in the chat list is shown naturally.
 * - Otherwise (reading an assistant reply/tool), pin the closest user prompt above.
 * - When scrolling further up past a user prompt, it switches to the prompt above it.
 */
export function stickyUserMessage(
  messages: readonly MessageVM[],
  firstVisibleIndex: number,
): StickyAnchor | undefined {
  if (firstVisibleIndex < 0) return undefined;
  
  // If the top visible message is a real user prompt itself, we're looking directly at it
  const topMsg = messages[firstVisibleIndex];
  if (topMsg !== undefined && topMsg.role === "user" && visibleUserText(topMsg).length > 0) {
    return undefined;
  }

  const end = Math.min(firstVisibleIndex, messages.length) - 1;
  // Find the closest real user prompt above firstVisibleIndex
  for (let index = end; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "user") continue;
    const text = visibleUserText(message);
    if (text.length > 0) {
      return { index, messageId: message.id, text };
    }
  }
  return undefined;
}

function ReturnIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    <div
      data-oc-sticky-prompt
      className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-bg px-4.5 sm:px-5 pt-2 pb-2 transition-all duration-200 ease-out"
    >
      <button
        type="button"
        title="回到此處 (Jump to prompt)"
        className="pointer-events-auto group flex w-full items-start justify-between gap-2.5 rounded-2xl border border-card-border/80 bg-panel-bg p-3 text-left shadow-md transition-all duration-150 hover:border-focus-ring/60 active:scale-[0.99] cursor-pointer"
        onClick={() => {
          props.onJump(props.anchor.index);
        }}
      >
        <div className="min-w-0 flex-1 line-clamp-3 overflow-hidden break-words [overflow-wrap:anywhere] text-[13px] leading-relaxed text-fg font-normal">
          {props.anchor.text}
        </div>
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors group-hover:text-accent group-hover:bg-accent/10 mt-0.5">
          <ReturnIcon />
        </div>
      </button>
    </div>
  );
}

// i18n-allow-literal — strings.ts is frozen for todo 17, so the palette's
// hint copy lives behind this pragma (the todo-11 SETTINGS_PLACEHOLDER_NOTE
// precedent); it MUST move into STRING_IDS when the table opens.
/**
 * @-mention palette (plan todo 17, webview side): the rows the debounced
 * `searchFiles` flow produced. SSR-safe (no effects, no DOM reads at render)
 * so node tests assert the row markup directly — every row carries its full
 * path in `title` per the acceptance contract. Keyboard handling belongs to
 * the textarea's own editing (the composer owns Enter); a pick delivers the
 * path to the consumer's `onPick`.
 */

import type { ReactNode } from "react";
import { baseNameOfPath } from "./logic.js";

export interface MentionPaletteProps {
  readonly rows: readonly string[];
  readonly onPick?: { (path: string): void };
}

export function MentionPalette(props: MentionPaletteProps): ReactNode {
  return (
    <ul
      data-oc-mention-palette
      role="listbox"
      className="mb-1 max-h-44 overflow-y-auto rounded-sm border border-border bg-panel-bg text-xs"
    >
      {props.rows.map((row) => (
        <li key={row}>
          <button
            type="button"
            role="option"
            aria-selected="false"
            title={row}
            className="flex w-full items-baseline gap-2 px-2 py-1 text-start hover:bg-hover-bg"
            onClick={() => {
              props.onPick?.(row);
            }}
          >
            <span className="shrink-0 font-medium text-fg">{baseNameOfPath(row)}</span>
            <span className="truncate text-muted-fg">{row}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

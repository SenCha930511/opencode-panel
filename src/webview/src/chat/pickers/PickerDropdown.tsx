/**
 * Shared presentational dropdown for the chat pickers (plan todo 15):
 * trigger button + an upward-opening listbox with optional labelled groups,
 * rows carrying primary/secondary text and an optional badge. Pure props
 * (open state included) so SSR suites render every permutation through
 * renderToStaticMarkup; pointer dismissal + Escape live here too.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export interface PickerRow {
  readonly key: string;
  readonly primary: string;
  readonly secondary?: string;
  readonly badge?: string;
  readonly selected: boolean;
}

export interface PickerGroup {
  readonly label?: string;
  readonly rows: readonly PickerRow[];
}

export interface PickerDropdownProps {
  /** Localized aria label / placeholder (t() result from the caller). */
  readonly title: string;
  /** Trigger text when a selection (or resolved default) exists. */
  readonly currentLabel?: string;
  /** Abbreviated display label on the button. */
  readonly displayLabel?: string;
  /** Full text for tooltip on mouse hover. */
  readonly tooltip?: string;
  readonly groups: readonly PickerGroup[];
  readonly open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(key: string): void;
}

const TRIGGER_CLASS =
  "flex max-w-32 sm:max-w-44 items-center gap-1 truncate rounded-full border border-card-border bg-card-bg/90 px-2.5 py-1 text-[11px] font-medium text-fg/90 transition-all hover:bg-hover-bg hover:text-fg hover:border-focus-ring/60 shadow-2xs cursor-pointer shrink min-w-0";
const MENU_CLASS =
  "absolute bottom-full left-0 z-50 mb-2 max-h-64 min-w-56 max-w-72 overflow-y-auto rounded-xl border border-card-border bg-panel-bg p-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-black/10";
const ROW_CLASS =
  "flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg data-[selected=true]:bg-accent/15 data-[selected=true]:text-accent font-medium";

function ChevronIcon(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="m2 3.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type DismissHandler = { (): void };

function useDismissOnOutsideDown(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: DismissHandler,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [rootRef, open, onClose]);
}

export function PickerDropdown(props: PickerDropdownProps): ReactNode {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  useDismissOnOutsideDown(rootRef, props.open, props.onClose);
  const textToShow = props.displayLabel ?? props.currentLabel ?? props.title;
  const hoverTooltip = props.tooltip ?? props.currentLabel ?? props.title;
  return (
    <span
      ref={rootRef}
      className="relative inline-flex min-w-0 shrink"
      onKeyDown={(event) => {
        if (event.key === "Escape" && props.open) {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        aria-label={props.title}
        title={hoverTooltip}
        className={TRIGGER_CLASS}
        onClick={props.onToggle}
      >
        <span className="truncate min-w-0 flex-1">{textToShow}</span>
        <span className="shrink-0 text-muted-fg"><ChevronIcon /></span>
      </button>
      {props.open ? (
        <div role="listbox" aria-label={props.title} className={MENU_CLASS}>
          {props.groups.map((group, groupIndex) => (
            <div
              key={group.label ?? `g-${groupIndex}`}
              {...(group.label === undefined ? {} : { role: "group", "aria-label": group.label })}
            >
              {group.label === undefined ? null : (
                <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
                  {group.label}
                </div>
              )}
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  role="option"
                  aria-selected={row.selected}
                  data-selected={row.selected}
                  className={ROW_CLASS}
                  onMouseDown={(event) => {
                    // mousedown (not click) so the textarea blur race cannot eat it.
                    event.preventDefault();
                    props.onPick(row.key);
                  }}
                >
                  <span className="shrink-0">{row.primary}</span>
                  {row.badge === undefined ? null : (
                    <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted-fg">
                      {row.badge}
                    </span>
                  )}
                  {row.secondary === undefined ? null : (
                    <span className="min-w-0 truncate text-muted-fg">{row.secondary}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

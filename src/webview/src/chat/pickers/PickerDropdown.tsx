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
  /** Leading icon for the button. */
  readonly icon?: ReactNode;
  /** Alignment of popup menu ("start" for left-aligned, "end" for right-aligned). */
  readonly align?: "start" | "end";
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
        className="flex max-w-[110px] sm:max-w-[160px] items-center gap-1 rounded-full border border-card-border/80 bg-card-bg/80 px-2 py-0.5 text-[11px] font-medium text-fg/90 transition-all hover:bg-hover-bg hover:text-fg hover:border-focus-ring/60 shadow-2xs cursor-pointer shrink min-w-0"
        onClick={props.onToggle}
      >
        {props.icon && <span className="shrink-0 text-muted-fg">{props.icon}</span>}
        <span className="truncate min-w-0 flex-1 text-left">{textToShow}</span>
        <span className="shrink-0 text-muted-fg/80"><ChevronIcon /></span>
      </button>
      {props.open ? (
        <div
          role="listbox"
          aria-label={props.title}
          className={`absolute bottom-full ${
            props.align === "end" ? "right-0" : "left-0"
          } z-50 mb-2 max-h-64 w-60 sm:w-64 max-w-[calc(100vw-36px)] overflow-y-auto rounded-2xl border border-card-border bg-panel-bg/95 p-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-black/10 text-xs`}
        >
          {props.groups.map((group, groupIndex) => (
            <div
              key={group.label ?? `g-${groupIndex}`}
              className="flex flex-col gap-0.5"
              {...(group.label === undefined ? {} : { role: "group", "aria-label": group.label })}
            >
              {group.label === undefined ? null : (
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-fg border-b border-card-border/30 mb-0.5">
                  {group.label}
                </div>
              )}
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  role="option"
                  aria-selected={row.selected}
                  data-selected={row.selected}
                  className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg data-[selected=true]:bg-accent/15 data-[selected=true]:text-accent"
                  onMouseDown={(event) => {
                    // mousedown (not click) so the textarea blur race cannot eat it.
                    event.preventDefault();
                    props.onPick(row.key);
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="font-medium text-fg truncate">{row.primary}</span>
                      {row.selected ? (
                        <span className="shrink-0 text-accent text-[11px] font-bold">✓</span>
                      ) : null}
                      {row.badge !== undefined ? (
                        <span className="shrink-0 rounded border border-border/80 bg-card-bg px-1 py-0.2 text-[9px] uppercase tracking-wide text-muted-fg font-medium">
                          {row.badge}
                        </span>
                      ) : null}
                    </div>
                    {row.secondary !== undefined ? (
                      <span className="w-full truncate text-[10px] text-muted-fg/70 font-mono text-start">
                        {row.secondary}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

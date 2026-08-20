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
  readonly groups: readonly PickerGroup[];
  readonly open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(key: string): void;
}

const TRIGGER_CLASS =
  "flex max-w-44 items-center gap-1.5 truncate rounded-full border border-card-border bg-card-bg/80 px-2.5 py-1 text-[11px] font-medium text-muted-fg transition-all hover:bg-hover-bg hover:text-fg hover:border-focus-ring/50 shadow-2xs";
const MENU_CLASS =
  "absolute bottom-full left-0 z-50 mb-1.5 max-h-60 min-w-48 overflow-y-auto rounded-xl border border-card-border bg-panel-bg p-1.5 shadow-2xl backdrop-blur-md";
const ROW_CLASS =
  "flex cursor-default select-none items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg data-[selected=true]:bg-active-bg data-[selected=true]:text-fg font-medium";

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
  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
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
        className={TRIGGER_CLASS}
        onClick={props.onToggle}
      >
        <span className="truncate">{props.currentLabel ?? props.title}</span>
        <ChevronIcon />
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

/**
 * Config-file form atoms (plan T3): the Section / AdvancedSection shells,
 * the FieldRow label wrapper, the scalar controls (text, number with the
 * control-local raw-text pattern from fields.tsx, toggle, select) and the
 * secret MaskedInput (untouched → mask + isSet chip, NEVER calls onCommit;
 * focus clears into an editing lane; commits carry only the typed value).
 *
 * All display copy arrives through useStrings or as pre-translated props —
 * no display literals. Styling mirrors fields.tsx / settingsPage.tsx;
 * INPUT_CLASS is a local re-declaration by contract (fields.tsx untouched).
 */

import { useEffect, useState, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import type { StringId } from "../../../shared/strings.js";

export const INPUT_CLASS =
  "w-full rounded-xl border border-card-border/80 bg-input-card-bg/90 px-3 py-1.5 text-xs text-fg transition-all placeholder:text-muted-fg/45 hover:border-card-border focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none disabled:opacity-50 shadow-2xs";

/** Tier-1 spec section: a bordered card with a translated heading. */
export function Section(props: { readonly titleId: StringId; readonly children: ReactNode }): ReactNode {
  const { t } = useStrings();
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
      <h3 className="border-b border-card-border/50 pb-2 text-xs font-semibold text-fg/90">
        {t(props.titleId)}
      </h3>
      <div className="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

/** Tier-2 spec section: same card chrome behind a collapsed disclosure. */
export function AdvancedSection(props: { readonly titleId: StringId; readonly children: ReactNode }): ReactNode {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
      <button
        type="button"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 border-b border-card-border/50 pb-2 text-left hover:text-fg transition-colors"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <span aria-hidden="true" className="text-muted-fg text-[11px] transition-transform">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-xs font-semibold text-fg/90">{t(props.titleId)}</span>
      </button>
      {open ? <div className="flex flex-col gap-3">{props.children}</div> : null}
    </section>
  );
}

/** One labeled config row: translated label above the control. */
export function FieldRow(props: { readonly labelId: StringId; readonly children: ReactNode }): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <label className="text-xs font-medium text-fg/90">{t(props.labelId)}</label>
      {props.children}
    </div>
  );
}

export interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  onCommit(value: string): void;
}

export function TextInput(props: TextInputProps): ReactNode {
  return (
    <input
      type="text"
      aria-label={props.label}
      className={INPUT_CLASS}
      disabled={props.disabled}
      value={props.value}
      spellCheck={false}
      onChange={(event) => {
        props.onCommit(event.target.value);
      }}
    />
  );
}

export interface NumberInputProps {
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  onCommit(value: number): void;
}

/**
 * Number editing keeps the raw text control-local (fields.tsx pattern):
 * intermediate text lives here, only well-formed decimals commit (config
 * values like temperature are not integers). External resets (revert/
 * reload) arrive as a changed value prop and are re-adopted without a
 * remount; text that already parses to the incoming prop is left alone so
 * an in-flight "1.0"-style typing lane is never clobbered.
 */
export function NumberInput(props: NumberInputProps): ReactNode {
  const [text, setText] = useState(String(props.value));
  useEffect(() => {
    if (Number(text) === props.value) return;
    setText(String(props.value));
  }, [props.value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={props.label}
      className={INPUT_CLASS}
      disabled={props.disabled}
      value={text}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (/^-?\d+(\.\d+)?$/.test(next.trim())) {
          props.onCommit(Number(next.trim()));
        }
      }}
    />
  );
}

export interface ToggleProps {
  readonly label: string;
  readonly value: boolean;
  readonly disabled: boolean;
  onCommit(value: boolean): void;
}

export function Toggle(props: ToggleProps): ReactNode {
  return (
    <label className="relative inline-flex cursor-pointer items-center gap-2 select-none">
      <input
        type="checkbox"
        aria-label={props.label}
        className="sr-only peer"
        disabled={props.disabled}
        checked={props.value}
        onChange={(event) => {
          props.onCommit(event.target.checked);
        }}
      />
      <div className="relative h-5 w-9 rounded-full bg-card-border/80 peer-checked:bg-accent peer-focus:ring-2 peer-focus:ring-accent/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow-xs peer-checked:after:translate-x-4" />
    </label>
  );
}

export interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly disabled: boolean;
  onCommit(value: string): void;
}

/** Enum select; an out-of-enum config value stays selectable. */
export function Select(props: SelectProps): ReactNode {
  const known = props.options.includes(props.value);
  return (
    <select
      aria-label={props.label}
      className={`${INPUT_CLASS} cursor-pointer`}
      disabled={props.disabled}
      value={props.value}
      onChange={(event) => {
        props.onCommit(event.target.value);
      }}
    >
      {props.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      {known || props.value.length === 0 ? null : (
        <option value={props.value}>{props.value}</option>
      )}
    </select>
  );
}

const MASK_PLACEHOLDER = "••••••••";

export interface MaskedInputProps {
  readonly label: string;
  /** Whether the underlying config value is set (controls the untouched lane). */
  readonly isSet: boolean;
  readonly disabled: boolean;
  onCommit(value: string): void;
}

/**
 * Secret input: untouched (isSet, never focused) it renders only the mask
 * and the isSet chip and NEVER fires onCommit — so an untouched secret
 * survives a save byte-identical. Focus clears into an editing lane where
 * commits carry the typed value; blur on empty text falls back untouched.
 */
export function MaskedInput(props: MaskedInputProps): ReactNode {
  const { t } = useStrings();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const untouched = props.isSet && !editing;
  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        aria-label={props.label}
        className={INPUT_CLASS}
        disabled={props.disabled}
        value={untouched ? MASK_PLACEHOLDER : text}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          setEditing(true);
          setText("");
        }}
        onChange={(event) => {
          setText(event.target.value);
          props.onCommit(event.target.value);
        }}
        onBlur={() => {
          if (text.length === 0) setEditing(false);
        }}
      />
      {untouched ? (
        <span className="shrink-0 rounded-full border border-card-border bg-card-bg/80 px-2 py-0.5 text-[10px] font-medium text-muted-fg">
          {t("cfg.masked.isSet")}
        </span>
      ) : null}
    </div>
  );
}

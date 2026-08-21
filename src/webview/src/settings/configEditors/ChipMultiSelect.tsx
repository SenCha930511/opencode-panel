/** Chip multi-select (plan T3): known-enum chips toggle membership; free
 * text joins through the add lane (e.g. disabled_* lists with custom
 * entries). Commits WHOLE replacement arrays; all copy through useStrings. */

import { useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { INPUT_CLASS } from "../configFields.js";
import { ADD_BUTTON_CLASS } from "./common.js";

export interface ChipMultiSelectProps {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: readonly string[];
  readonly disabled: boolean;
  onCommit(next: readonly string[]): void;
}

/** Known-enum chips (click toggles membership) plus a free-text add lane. */
export function ChipMultiSelect(props: ChipMultiSelectProps): ReactNode {
  const { t } = useStrings();
  const [draft, setDraft] = useState("");
  const choices = [...new Set([...props.options, ...props.value])];
  const toggle = (choice: string): void => {
    props.onCommit(
      props.value.includes(choice)
        ? props.value.filter((entry) => entry !== choice) // i18n-allow-literal — code-only expression, no display copy
        : [...props.value, choice],
    );
  };
  const stage = (): void => {
    const item = draft.trim();
    if (item.length === 0 || props.value.includes(item)) return;
    props.onCommit([...props.value, item]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const selected = props.value.includes(choice);
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={selected}
              aria-label={choice}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                selected
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-card-border bg-card-bg/80 text-muted-fg hover:border-focus-ring/60 hover:text-fg"
              }`}
              disabled={props.disabled}
              onClick={() => {
                toggle(choice);
              }}
            >
              {choice}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={props.label}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") stage();
          }}
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || draft.trim().length === 0 || props.value.includes(draft.trim())}
          onClick={() => {
            stage();
          }}
        >
          {t("cfg.records.add")}
        </button>
      </div>
    </div>
  );
}

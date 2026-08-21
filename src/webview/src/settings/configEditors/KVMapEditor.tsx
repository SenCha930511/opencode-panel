/** Key/value map editor (plan T3): string records with per-row remove and a
 * staged key+value add lane. `masked` routes row values through MaskedInput
 * (secrets — an untouched row never fires a commit). Commits WHOLE
 * replacement records; all copy through useStrings. */

import { useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { INPUT_CLASS, MaskedInput, TextInput } from "../configFields.js";
import { ADD_BUTTON_CLASS, RemoveButton } from "./common.js";

export interface KVMapEditorProps {
  readonly label: string;
  readonly value: Readonly<Record<string, string>>;
  /** When set, EVERY row value edits through MaskedInput (all-secrets map). */
  readonly masked?: boolean;
  /** Per-key secret decision (renderer: isSecretPath); OR-ed with `masked`. */
  readonly maskEntry?: (key: string) => boolean; // i18n-allow-literal
  readonly disabled: boolean;
  onCommit(next: Readonly<Record<string, string>>): void;
}

export function KVMapEditor(props: KVMapEditorProps): ReactNode {
  const { t } = useStrings();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const entries = Object.entries(props.value);
  const commitEntry = (key: string, value: string): void => {
    props.onCommit({ ...props.value, [key]: value });
  };
  const removeEntry = (key: string): void => {
    const { [key]: _removed, ...rest } = props.value;
    props.onCommit(rest);
  };
  const add = (): void => {
    const key = newKey.trim();
    if (key.length === 0) return;
    commitEntry(key, newValue);
    setNewKey("");
    setNewValue("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      {entries.length === 0 ? null : (
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">
          <span className="flex-1">{t("cfg.kv.key")}</span>
          <span className="flex-1">{t("cfg.kv.value")}</span>
          <span className="w-7" aria-hidden="true" />
        </div>
      )}
      {entries.map(([key, value]) => {
        const rowMasked = props.masked === true || props.maskEntry?.(key) === true;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span className="flex-1 truncate rounded-xl border border-card-border/60 bg-card-bg/60 px-3 py-1.5 font-mono text-xs text-fg/90">
              {key}
            </span>
            <div className="flex-1">
              {rowMasked ? (
                <MaskedInput
                  label={key}
                  disabled={props.disabled}
                  isSet={value.length > 0}
                  onCommit={(next) => {
                    commitEntry(key, next);
                  }}
                />
              ) : (
                <TextInput
                  label={key}
                  disabled={props.disabled}
                  value={value}
                  onCommit={(next) => {
                    commitEntry(key, next);
                  }}
                />
              )}
            </div>
            <RemoveButton
              disabled={props.disabled}
              onRemove={() => {
                removeEntry(key);
              }}
            />
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={t("cfg.kv.key")}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={newKey}
          spellCheck={false}
          onChange={(event) => {
            setNewKey(event.target.value);
          }}
        />
        <input
          type="text"
          aria-label={t("cfg.kv.value")}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={newValue}
          spellCheck={false}
          onChange={(event) => {
            setNewValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || newKey.trim().length === 0}
          onClick={() => {
            add();
          }}
        >
          {t("cfg.kv.add")}
        </button>
      </div>
    </div>
  );
}

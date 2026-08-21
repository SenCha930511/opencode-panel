/** String-list editor (plan T3): one text control per row with remove, plus
 * a staged add lane. Commits WHOLE replacement arrays; the store patches the
 * draft at the field path. All copy through useStrings. */

import { useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { INPUT_CLASS, TextInput } from "../configFields.js";
import { ADD_BUTTON_CLASS, RemoveButton } from "./common.js";

export interface StringListEditorProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly disabled: boolean;
  onCommit(next: readonly string[]): void;
}

export function StringListEditor(props: StringListEditorProps): ReactNode {
  const { t } = useStrings();
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const item = draft.trim();
    if (item.length === 0) return;
    props.onCommit([...props.value, item]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      {props.value.map((item, index) => (
        <div key={`${String(index)}:${item}`} className="flex items-center gap-1.5">
          <TextInput
            label={props.label}
            disabled={props.disabled}
            value={item}
            onCommit={(next) => {
              const copy = [...props.value];
              copy[index] = next;
              props.onCommit(copy);
            }}
          />
          <RemoveButton
            disabled={props.disabled}
            onRemove={() => {
              props.onCommit(props.value.filter((_, entry) => entry !== index)); // i18n-allow-literal
            }}
          />
        </div>
      ))}
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
            if (event.key === "Enter") add();
          }}
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || draft.trim().length === 0}
          onClick={() => {
            add();
          }}
        >
          {t("cfg.list.add")}
        </button>
      </div>
    </div>
  );
}

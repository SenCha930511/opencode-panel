/** Model combobox (plan T3): flattens the capability snapshot providers to
 * "provider/model" strings (the salvage pattern from the old
 * OpenCodeConfigTab), offered as a datalist behind a free-text input. */

import { useId, type ReactNode } from "react";
import { useCapabilitySnapshot } from "../../chat/pickers/capabilityStore.js";
import { INPUT_CLASS } from "../configFields.js";

export interface ModelComboboxProps {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  onCommit(value: string): void;
}

/** "provider/model" combobox over the capability snapshot; free text allowed. */
export function ModelCombobox(props: ModelComboboxProps): ReactNode {
  const snapshot = useCapabilitySnapshot();
  const listId = useId();
  const models: string[] = [];
  for (const provider of snapshot?.providers ?? []) {
    for (const model of provider.models) {
      models.push(`${provider.id}/${model.id}`);
    }
  }
  return (
    <>
      <input
        type="text"
        aria-label={props.label}
        className={INPUT_CLASS}
        list={listId}
        disabled={props.disabled}
        value={props.value}
        spellCheck={false}
        onChange={(event) => {
          props.onCommit(event.target.value);
        }}
      />
      <datalist id={listId}>
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </>
  );
}

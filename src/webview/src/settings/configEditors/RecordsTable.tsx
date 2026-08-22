/** Record-collection editor (plan T3): keyed config maps (agents, mcp,
 * commands, tool records) rendered one card per entry — the entry name
 * heads the card, spec columns are the labeled cells, nested objects live
 * behind the expandable detail slot. Commits WHOLE replacement maps. */

import { useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import type { StringId } from "../../../../shared/strings.js";
import { INPUT_CLASS, MaskedInput, NumberInput, Select, TextInput, Toggle } from "../configFields.js";
import { ADD_BUTTON_CLASS, RemoveButton } from "./common.js";
import { ModelCombobox } from "./modelCombobox.js";

export type RecordsColumnKind = "text" | "number" | "toggle" | "select" | "model" | "masked";

/** One RecordsTable column: which entry key, its translated label, its widget. */
export interface RecordsColumn {
  readonly key: string;
  readonly label: StringId;
  readonly kind: RecordsColumnKind;
  readonly options?: readonly string[];
}

export interface RecordsTableProps<T extends Record<string, unknown>> {
  readonly label: string;
  readonly columns: readonly RecordsColumn[];
  /** Keyed config map: entry name -> record object. */
  readonly entries: Readonly<Record<string, T>>;
  readonly disabled: boolean;
  /** Factory for the record added under a fresh name (callers own defaults). */
  readonly buildRow: () => T; // i18n-allow-literal
  /** Expandable per-entry detail for nested objects; rendered when expanded. */
  readonly renderDetail?: (name: string, row: T, commitPatch: (patch: Partial<T>) => void) => ReactNode; // i18n-allow-literal
  onCommit(next: Readonly<Record<string, T>>): void;
}

function CellEditor(props: {
  readonly column: RecordsColumn;
  readonly row: Record<string, unknown>;
  readonly disabled: boolean;
  onCommit(value: unknown): void;
}): ReactNode {
  const { t } = useStrings();
  const raw = props.row[props.column.key];
  const label = t(props.column.label);
  switch (props.column.kind) {
    case "text":
      return <TextInput label={label} disabled={props.disabled} value={typeof raw === "string" ? raw : ""} onCommit={props.onCommit} />;
    case "number":
      return <NumberInput label={label} disabled={props.disabled} value={typeof raw === "number" ? raw : 0} onCommit={props.onCommit} />;
    case "toggle":
      return <Toggle label={label} disabled={props.disabled} value={raw === true} onCommit={props.onCommit} />;
    case "select":
      return (
        <Select
          label={label}
          disabled={props.disabled}
          value={typeof raw === "string" ? raw : ""}
          options={props.column.options ?? []}
          onCommit={props.onCommit}
        />
      );
    case "model":
      return <ModelCombobox label={label} disabled={props.disabled} value={typeof raw === "string" ? raw : ""} onCommit={props.onCommit} />;
    case "masked":
      return (
        <MaskedInput
          label={label}
          disabled={props.disabled}
          isSet={typeof raw === "string" && raw.length > 0}
          onCommit={props.onCommit}
        />
      );
  }
}

/** One card per map entry: name chip header, column cells, expand/remove lane. */
export function RecordsTable<T extends Record<string, unknown>>(props: RecordsTableProps<T>): ReactNode {
  const { t } = useStrings();
  const [newName, setNewName] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);
  const commitEntry = (name: string, patch: Partial<T>): void => {
    const current = props.entries[name];
    if (current === undefined) return;
    props.onCommit({ ...props.entries, [name]: { ...current, ...patch } });
  };
  const commitCell = (name: string, key: string, value: unknown): void => {
    const current = props.entries[name];
    if (current === undefined) return;
    props.onCommit({ ...props.entries, [name]: { ...current, [key]: value } });
  };
  const removeEntry = (name: string): void => {
    const { [name]: _removed, ...rest } = props.entries;
    props.onCommit(rest);
  };
  const renameEntry = (name: string, next: string): void => {
    const trimmed = next.trim();
    if (trimmed.length === 0 || trimmed === name || trimmed in props.entries) return;
    const renamed: Record<string, T> = {};
    for (const [key, value] of Object.entries(props.entries)) {
      renamed[key === name ? trimmed : key] = value;
    }
    props.onCommit(renamed);
  };
  const addEntry = (): void => {
    const name = newName.trim();
    if (name.length === 0 || name in props.entries) return;
    props.onCommit({ ...props.entries, [name]: props.buildRow() });
    setNewName("");
  };
  return (
    <div className="flex flex-col gap-2">
      {Object.keys(props.entries).map((name) => {
        const row = props.entries[name];
        if (row === undefined) return null;
        const expanded = openName === name;
        return (
          <div key={name} className="flex flex-col gap-2 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 font-mono">
                <TextInput
                  label={props.label}
                  disabled={props.disabled}
                  value={name}
                  onCommit={(next) => {
                    renameEntry(name, next);
                  }}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {props.renderDetail === undefined ? null : (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={props.label}
                    className="cursor-pointer rounded-lg border border-card-border bg-card-bg/80 px-2 py-1 text-[11px] text-muted-fg transition-all hover:bg-hover-bg hover:text-fg"
                    disabled={props.disabled}
                    onClick={() => {
                      setOpenName((current) => (current === name ? null : name));
                    }}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                )}
                <RemoveButton
                  disabled={props.disabled}
                  onRemove={() => {
                    removeEntry(name);
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {props.columns.map((column) => (
                <div key={column.key} className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">
                    {t(column.label)}
                  </span>
                  <CellEditor
                    column={column}
                    row={row}
                    disabled={props.disabled}
                    onCommit={(value) => {
                      commitCell(name, column.key, value);
                    }}
                  />
                </div>
              ))}
            </div>
            {props.renderDetail !== undefined && expanded
              ? props.renderDetail(name, row, (patch) => {
                  commitEntry(name, patch);
                })
              : null}
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={props.label}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={newName}
          spellCheck={false}
          onChange={(event) => {
            setNewName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") addEntry();
          }}
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || newName.trim().length === 0 || newName.trim() in props.entries}
          onClick={() => {
            addEntry();
          }}
        >
          {t("cfg.records.add")}
        </button>
      </div>
    </div>
  );
}

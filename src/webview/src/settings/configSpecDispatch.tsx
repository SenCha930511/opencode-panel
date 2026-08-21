/**
 * Spec-field dispatch layer (plan T3): the typed coercions from the raw
 * draft tree into per-kind widget values, the buildRow defaults for record
 * fields, and the widget-per-kind control. Kept apart from the renderer
 * shell so both halves stay review-sized. All labels arrive through t().
 */

import type { ReactNode } from "react";
import { isRecord } from "../../../shared/protocol.js";
import { isSecretPath } from "../../../shared/configJsonc.js";
import type { StringId } from "../../../shared/strings.js";
import { useStrings } from "../../lib/i18n.js";
import {
  ChipMultiSelect,
  KVMapEditor,
  ModelCombobox,
  RecordsTable,
  StringListEditor,
  type RecordsColumn,
  type RecordsColumnKind,
} from "./configEditors/index.js";
import { MaskedInput, NumberInput, Select, TextInput, Toggle } from "./configFields.js";

/** RecordsTable column kinds (re-exported for spec authors). */
export type SpecColumnKind = RecordsColumnKind;

export type SpecColumn = RecordsColumn;

export type SpecFieldKind = SpecColumnKind | "list" | "kv" | "chips" | "records";

export interface SpecField {
  /** Field label id (cfg.f.*). */
  readonly id: StringId;
  /** JSONC path this field edits. */
  readonly path: readonly string[];
  readonly kind: SpecFieldKind;
  readonly options?: readonly string[];
  readonly columns?: readonly SpecColumn[];
  /**
   * Scalar text and kv values edit through MaskedInput when flagged —
   * scalar text also auto-masks whenever isSecretPath matches, so a spec
   * can never render a live secret in clear text by omission.
   */
  readonly masked?: boolean;
}

/** Read one path out of the untyped draft tree; undefined when absent. */
export function valueAt(tree: unknown, path: readonly string[]): unknown {
  let cursor: unknown = tree;
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function asStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string"); // i18n-allow-literal
}

function asStringRecord(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") entries[key] = value;
  }
  return entries;
}

function asRecordEntries(raw: unknown): Readonly<Record<string, Record<string, unknown>>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value)) entries[key] = value;
  }
  return entries;
}

function defaultRecordValue(columns: readonly SpecColumn[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    switch (column.kind) {
      case "number":
        row[column.key] = 0;
        break;
      case "toggle":
        row[column.key] = false;
        break;
      case "select":
        row[column.key] = column.options?.[0] ?? "";
        break;
      case "text":
      case "model":
      case "masked":
        row[column.key] = "";
        break;
    }
  }
  return row;
}

export function SpecFieldControl(props: {
  readonly field: SpecField;
  readonly raw: unknown;
  readonly disabled: boolean;
  onCommit(value: unknown): void;
}): ReactNode {
  const { t } = useStrings();
  const label = t(props.field.id);
  switch (props.field.kind) {
    case "text":
      if (props.field.masked === true || isSecretPath(props.field.path)) {
        return (
          <MaskedInput
            label={label}
            disabled={props.disabled}
            isSet={typeof props.raw === "string" && props.raw.length > 0}
            onCommit={props.onCommit}
          />
        );
      }
      return (
        <TextInput
          label={label}
          disabled={props.disabled}
          value={typeof props.raw === "string" ? props.raw : ""}
          onCommit={props.onCommit}
        />
      );
    case "number":
      return (
        <NumberInput
          label={label}
          disabled={props.disabled}
          value={typeof props.raw === "number" ? props.raw : 0}
          onCommit={props.onCommit}
        />
      );
    case "toggle":
      return <Toggle label={label} disabled={props.disabled} value={props.raw === true} onCommit={props.onCommit} />;
    case "select":
      return (
        <Select
          label={label}
          disabled={props.disabled}
          value={typeof props.raw === "string" ? props.raw : ""}
          options={props.field.options ?? []}
          onCommit={props.onCommit}
        />
      );
    case "model":
      return (
        <ModelCombobox
          label={label}
          disabled={props.disabled}
          value={typeof props.raw === "string" ? props.raw : ""}
          onCommit={props.onCommit}
        />
      );
    case "masked":
      return (
        <MaskedInput
          label={label}
          disabled={props.disabled}
          isSet={typeof props.raw === "string" && props.raw.length > 0}
          onCommit={props.onCommit}
        />
      );
    case "list":
      return (
        <StringListEditor label={label} disabled={props.disabled} value={asStringArray(props.raw)} onCommit={props.onCommit} />
      );
    case "kv":
      return (
        <KVMapEditor
          label={label}
          disabled={props.disabled}
          value={asStringRecord(props.raw)}
          masked={props.field.masked === true}
          maskEntry={(key) => isSecretPath([...props.field.path, key])}
          onCommit={props.onCommit}
        />
      );
    case "chips":
      return (
        <ChipMultiSelect
          label={label}
          disabled={props.disabled}
          options={props.field.options ?? []}
          value={asStringArray(props.raw)}
          onCommit={props.onCommit}
        />
      );
    case "records": {
      const columns: readonly SpecColumn[] = props.field.columns ?? [];
      return (
        <RecordsTable<Record<string, unknown>>
          label={label}
          disabled={props.disabled}
          columns={columns}
          entries={asRecordEntries(props.raw)}
          buildRow={() => defaultRecordValue(columns)}
          onCommit={props.onCommit}
        />
      );
    }
  }
}

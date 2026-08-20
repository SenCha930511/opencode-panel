/**
 * Data-driven field controls for the settings page (plan todo 21): every
 * control renders FROM the generated schema row — label via the provisioned
 * settings.field.* StringId, description via the manifest-localized text
 * baked into the schema, input kind by field.type, bounds from the field's
 * generated min/max. No per-field hand-written JSX.
 *
 * Number editing keeps the raw text control-local: integer-format slips
 * show inline immediately without touching draft state, while committed
 * numbers flow through the store (bounds errors surface from
 * validateFieldValue there). Controls remount on external value change via
 * the parent's key prop, which is also how Revert resets local text.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useStrings } from "../../lib/i18n.js";
import type { StringId } from "../../../shared/strings.js";
import {
  fieldLabelId,
  type SettingField,
  type SettingScopeChoice,
  type SettingValue,
} from "../../../shared/settingsSchema.js";

const INPUT_CLASS =
  "w-full rounded-xl border border-card-border bg-input-card-bg px-3 py-1.5 text-xs text-fg transition-all placeholder:text-muted-fg/60 focus:border-focus-ring/80 focus:ring-1 focus:ring-focus-ring/25 outline-none disabled:opacity-50";

export interface FieldRowProps {
  readonly field: SettingField;
  readonly value: SettingValue;
  readonly error: string | null;
  readonly scope: SettingScopeChoice;
  readonly disabled: boolean;
  readonly locale: string;
  onValueChange(value: SettingValue): void;
  onScopeChange(choice: SettingScopeChoice): void;
}

/** The per-field User/Workspace chip (documented default: User/global). */
function ScopeChip(props: {
  readonly labelId: StringId;
  readonly scope: SettingScopeChoice;
  readonly disabled: boolean;
  onChange(choice: SettingScopeChoice): void;
}): ReactNode {
  const { t } = useStrings();
  return (
    <select
      aria-label={t(props.labelId)}
      className="cursor-pointer rounded-lg border border-card-border bg-card-bg/80 px-2 py-0.5 text-[10px] text-muted-fg font-medium outline-none transition-colors hover:border-focus-ring/60 hover:text-fg focus:border-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      disabled={props.disabled}
      value={props.scope}
      onChange={(event) => {
        props.onChange(event.target.value === "workspace" ? "workspace" : "global");
      }}
    >
      <option value="global">{t("settings.scope.user")}</option>
      <option value="workspace">{t("settings.scope.workspace")}</option>
    </select>
  );
}

function StringInput(props: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  onCommit(value: string): void;
}): ReactNode {
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

function NumberInput(props: {
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  onCommit(value: number): void;
  onTextError(reason: string | null): void;
}): ReactNode {
  const [text, setText] = useState(String(props.value));
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
        if (/^-?\d+$/.test(next.trim())) {
          props.onTextError(null);
          props.onCommit(Number(next.trim()));
        } else {
          props.onTextError(`${next.trim().length === 0 ? "blank" : next}: not an integer`);
        }
      }}
    />
  );
}

function BooleanInput(props: {
  readonly labelId: StringId;
  readonly value: boolean;
  readonly disabled: boolean;
  onCommit(value: boolean): void;
}): ReactNode {
  const { t } = useStrings();
  return (
    <input
      type="checkbox"
      aria-label={t(props.labelId)}
      className="h-3.5 w-3.5 accent-[var(--oc-accent)] disabled:opacity-50"
      disabled={props.disabled}
      checked={props.value}
      onChange={(event) => {
        props.onCommit(event.target.checked);
      }}
    />
  );
}

function StringArrayInput(props: {
  readonly labelId: StringId;
  readonly value: readonly string[];
  readonly disabled: boolean;
  onCommit(value: readonly string[]): void;
}): ReactNode {
  const { t } = useStrings();
  return (
    <textarea
      aria-label={t(props.labelId)}
      className={`${INPUT_CLASS} min-h-16 resize-y font-mono`}
      disabled={props.disabled}
      value={props.value.join("\n")}
      spellCheck={false}
      onChange={(event) => {
        props.onCommit(event.target.value.split("\n").filter((line) => line.trim().length > 0));
      }}
    />
  );
}

function FieldControl(props: FieldRowProps & { onTextError(reason: string | null): void }): ReactNode {
  const { t } = useStrings();
  const { field, value } = props;
  const label = t(fieldLabelId(field));
  switch (field.type) {
    case "string":
      return (
        <StringInput
          label={label}
          disabled={props.disabled}
          value={typeof value === "string" ? value : ""}
          onCommit={props.onValueChange}
        />
      );
    case "number":
      return (
        <NumberInput
          label={label}
          disabled={props.disabled}
          value={typeof value === "number" ? value : 0}
          onCommit={props.onValueChange}
          onTextError={props.onTextError}
        />
      );
    case "boolean":
      return (
        <BooleanInput
          labelId={fieldLabelId(field)}
          disabled={props.disabled}
          value={typeof value === "boolean" ? value : false}
          onCommit={props.onValueChange}
        />
      );
    case "string-array":
      return (
        <StringArrayInput
          labelId={fieldLabelId(field)}
          disabled={props.disabled}
          value={Array.isArray(value) ? value : []}
          onCommit={props.onValueChange}
        />
      );
  }
}

/** One labeled settings row: label + scope chip, control, description, error. */
export function SettingFieldRow(props: FieldRowProps): ReactNode {
  const { t } = useStrings();
  const [textError, setTextError] = useState<string | null>(null);
  const labelId = fieldLabelId(props.field);
  const description =
    props.locale === "zh-TW" ? props.field.description.zhTW : props.field.description.en;
  const error = textError ?? props.error;
  return (
    <div className="flex flex-col gap-1.5 py-1" data-oc-setting={props.field.shortKey}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-fg/90">{t(labelId)}</label>
        <ScopeChip
          labelId={labelId}
          scope={props.scope}
          disabled={props.disabled}
          onChange={props.onScopeChange}
        />
      </div>
      <FieldControl
        {...props}
        onTextError={(reason) => {
          setTextError(reason);
        }}
      />
      <p className="text-[11px] leading-relaxed text-muted-fg/80">{description}</p>
      {error === null ? null : (
        <p role="alert" className="text-[11px] text-err font-medium">
          {t("settings.validationFailed")}: {error}
        </p>
      )}
    </div>
  );
}

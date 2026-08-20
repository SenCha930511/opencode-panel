/**
 * Secrets sub-section of the settings page (plan todo 21): server password
 * (masked) + optional username. The wire contract is isSet-only — the stored
 * VALUE never comes back to the webview, so inputs always start empty and
 * the chip announces only "Saved"/"Not set". Saving sends setSecret, success
 * moves the chip (the write itself is the proof — no read-back), failure
 * toasts and keeps the input so the user can retry.
 */

import { useState, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import type { StringId } from "../../../shared/strings.js";
import type { SettingsSecretsWire } from "./settingsWire.js";

const SECRET_INPUT_CLASS =
  "w-full rounded-xl border border-card-border bg-input-card-bg px-3 py-1.5 text-xs text-fg transition-all focus:border-focus-ring/80 focus:ring-1 focus:ring-focus-ring/25 outline-none disabled:opacity-50";

export interface SecretRowProps {
  readonly kind: "password" | "username";
  readonly labelId: StringId;
  readonly isSet: boolean;
  readonly disabled: boolean;
  onSave(value: string): Promise<boolean>;
  onClear(): Promise<boolean>;
}

function SecretRow(props: SecretRowProps): ReactNode {
  const { t } = useStrings();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = (): void => {
    if (value.length === 0 || busy) return;
    setBusy(true);
    void props.onSave(value).then((ok) => {
      setBusy(false);
      if (ok) setValue("");
    });
  };

  const clear = (): void => {
    if (busy) return;
    setBusy(true);
    void props.onClear().then(() => {
      setBusy(false);
    });
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" data-oc-secret={props.kind}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg/90">{t(props.labelId)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            props.isSet ? "bg-ok/15 text-ok" : "bg-card-bg text-muted-fg/80 border border-card-border"
          }`}
        >
          {props.isSet ? t("settings.secret.isSet") : t("settings.secret.notSet")}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type={props.kind === "password" ? "password" : "text"}
          aria-label={t(props.labelId)}
          className={SECRET_INPUT_CLASS}
          autoComplete="off"
          disabled={props.disabled || busy}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          disabled={props.disabled || busy || value.length === 0}
          onClick={save}
        >
          {t("settings.apply")}
        </button>
        {props.isSet ? (
          <button
            type="button"
            className="shrink-0 rounded-xl border border-card-border bg-card-bg/80 px-2.5 py-1.5 text-xs text-muted-fg transition-all hover:bg-hover-bg hover:text-fg disabled:opacity-40 cursor-pointer"
            disabled={props.disabled || busy}
            onClick={clear}
          >
            {t("settings.secret.clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsSecretsPanel(props: {
  readonly secrets: SettingsSecretsWire;
  readonly disabled: boolean;
  onSave(kind: "password" | "username", value: string): Promise<boolean>;
  onClear(kind: "password" | "username"): Promise<boolean>;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2 border-t border-card-border/60 pt-3 mt-1">
      <SecretRow
        kind="password"
        labelId="settings.field.serverPassword"
        isSet={props.secrets.password.isSet}
        disabled={props.disabled}
        onSave={(value) => props.onSave("password", value)}
        onClear={() => props.onClear("password")}
      />
      <SecretRow
        kind="username"
        labelId="settings.field.serverUsername"
        isSet={props.secrets.username.isSet}
        disabled={props.disabled}
        onSave={(value) => props.onSave("username", value)}
        onClear={() => props.onClear("username")}
      />
    </div>
  );
}

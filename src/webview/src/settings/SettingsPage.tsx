/**
 * Settings page (plan todo 21): the `settings` route content mounted by the
 * todo-11 shell. All field rows are generated FROM the manifest-derived
 * schema (src/shared/settingsSchema.ts) — adding a key to package.json and
 * re-running the generator grows this page without a JSX edit. Sections:
 * Server (schema fields + secrets sub-panel + Test Connection), Appearance,
 * Diagnostics (debugLogs field + server status + command-palette hint),
 * Capabilities (init bit matrix + the todo-15 capability push counts).
 *
 * WIRE DISCIPLINE: getSettings fires once on mount and builds the store;
 * Apply posts ONE setSettings patch; the Test Connection posts the
 * documented empty patch (the host's setSettings reply carries serverHealth
 * of the applied config — not the draft); secrets move only through
 * setSecret and the page never sees their values.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n.js";
import type { StringId } from "../../../shared/strings.js";
import {
  settingFieldsForSection,
  settingFieldValue,
  type SettingSectionId,
} from "../../../shared/settingsSchema.js";
import { useApp } from "../app/context";
import { attachCapabilityStore, useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";
import { SettingFieldRow } from "./fields.js";
import { SettingsFormStore } from "./settingsStore.js";
import { parseSettingsSnapshotWire } from "./settingsWire.js";
import { SettingsSecretsPanel } from "./SettingsSecrets.js";

const SECTION_ORDER: readonly SettingSectionId[] = ["server", "appearance", "diagnostics"];

const SECTION_TITLE: Readonly<Record<SettingSectionId, StringId>> = {
  server: "settings.section.server",
  appearance: "settings.section.appearance",
  diagnostics: "settings.section.diagnostics",
};

export function SettingsPage(props: { readonly store?: SettingsFormStore }): ReactNode {
  const { send } = useApp();
  const { t } = useStrings();
  const [ownedStore, setOwnedStore] = useState<SettingsFormStore | null>(props.store ?? null);

  useEffect(() => {
    if (props.store !== undefined) return;
    let cancelled = false;
    void send("getSettings", {}).then((raw) => {
      if (cancelled) return;
      const snapshot = parseSettingsSnapshotWire(raw);
      if (snapshot !== undefined) setOwnedStore(new SettingsFormStore(snapshot));
    });
    return () => {
      cancelled = true;
    };
  }, [send, props.store]);

  if (ownedStore === null) {
    return (
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
        <p className="text-xs text-muted-fg">{t("app.loading")}</p>
      </div>
    );
  }
  return <SettingsForm store={ownedStore} />;
}

function SettingsForm(props: { readonly store: SettingsFormStore }): ReactNode {
  const { init, messenger, send, pushToast, navigate } = useApp();
  const { t, locale } = useStrings();
  const { store } = props;
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const capabilities = useCapabilitySnapshot();
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  const dirty = store.dirtyKeys().length > 0;
  const disabled = view.applying;

  const runSecret = async (kind: "password" | "username", value: string): Promise<boolean> => {
    try {
      await messenger.request("setSecret", { key: kind, value });
      store.markSecret(kind, value.length > 0);
      return true;
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
            disabled={!dirty || store.hasErrors() || disabled}
            onClick={() => {
              void store.apply(send).then((ok) => {
                if (ok) pushToast("info", t("settings.saved"));
              });
            }}
          >
            {t("settings.apply")}
          </button>
          <button
            type="button"
            className="rounded border border-border px-2.5 py-1 text-xs text-muted-fg hover:bg-hover-bg hover:text-fg disabled:opacity-50"
            disabled={!dirty || disabled}
            onClick={() => {
              store.revert();
              setResetSignal((value) => {
                return value + 1;
              });
            }}
          >
            {t("settings.revert")}
          </button>
          <button
            type="button"
            className="rounded border border-border px-2.5 py-1 text-xs text-muted-fg hover:bg-hover-bg hover:text-fg"
            onClick={() => {
              navigate("chat");
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
      {view.saveFailed ? (
        <p role="alert" className="border-b border-border px-3 py-1.5 text-[10px] text-err">
          {t("settings.saveFailed")}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {SECTION_ORDER.map((section) => (
          <section key={section} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-muted-fg">{t(SECTION_TITLE[section])}</h3>
            {settingFieldsForSection(section).map((field) => (
              <SettingFieldRow
                key={`${field.shortKey}:${String(resetSignal)}`}
                field={field}
                value={settingFieldValue(view.draft, field)}
                error={store.fieldError(field.shortKey)}
                scope={view.scope[field.shortKey] ?? "global"}
                disabled={disabled}
                locale={locale}
                onValueChange={(next) => {
                  store.setValue(field.shortKey, next);
                }}
                onScopeChange={(choice) => {
                  store.setScopeChoice(field.shortKey, choice);
                }}
              />
            ))}
            {section === "server" ? (
              <>
                <SettingsSecretsPanel
                  secrets={view.secrets}
                  disabled={disabled}
                  onSave={(kind, value) => runSecret(kind, value)}
                  onClear={(kind) => runSecret(kind, "")}
                />
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-border px-2.5 py-1 text-xs text-muted-fg hover:bg-hover-bg hover:text-fg disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => {
                        void store.testConnection(send);
                      }}
                    >
                      {t("settings.testConnection")}
                    </button>
                    {view.serverHealth === null ? null : (
                      <span
                        className={`text-[10px] ${view.serverHealth.status === "ok" ? "text-ok" : "text-err"}`}
                      >
                        {view.serverHealth.status === "ok"
                          ? t("settings.connectionOk")
                          : t("settings.connectionFailed")}
                        {view.serverHealth.version === null ? "" : ` — ${view.serverHealth.version}`}
                        {view.serverHealth.detail === undefined ? "" : `: ${view.serverHealth.detail}`}
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : null}
            {section === "diagnostics" ? (
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <p className="text-[10px] leading-snug text-muted-fg">
                  {init.server.url.length > 0 ? init.server.url : t("server.status.stopped")}
                  {init.server.version === null ? "" : ` — ${init.server.version}`}
                </p>
                <p className="text-[10px] leading-snug text-muted-fg">{t("settings.serverActionsHint")}</p>
              </div>
            ) : null}
          </section>
        ))}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-fg">{t("settings.section.capabilities")}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(init.capabilities).map(([name, enabled]) => (
              <span key={name} className="flex items-center gap-1 text-[10px] text-muted-fg">
                <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-ok" : "bg-off"}`} />
                {name}
              </span>
            ))}
          </div>
          {capabilities === undefined ? null : (
            <p className="text-[10px] leading-snug text-muted-fg">
              {`${capabilities.agents.length} agents / ${capabilities.commands.length} commands / ${capabilities.providers.length} providers`}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

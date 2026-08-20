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

function ServerIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="8.5" width="12" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4.5" cy="5.2" r="0.6" fill="currentColor" />
      <circle cx="4.5" cy="10.7" r="0.6" fill="currentColor" />
    </svg>
  );
}

function PaletteIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2a6 6 0 0 0 0 12V2z" fill="currentColor" />
    </svg>
  );
}

function PulseIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8h3l2-4 3 8 2-4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZapIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.5 1.5L3 9h5l-1 5.5 6.5-7.5h-5l1-5.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
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

  const getSectionIcon = (section: SettingSectionId): ReactNode => {
    switch (section) {
      case "server":
        return <ServerIcon />;
      case "appearance":
        return <PaletteIcon />;
      case "diagnostics":
        return <PulseIcon />;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-card-border/70 bg-panel-bg/90 px-3.5 py-2.5 backdrop-blur-md">
        <h2 className="text-xs font-semibold text-fg tracking-tight">{t("settings.title")}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
            className="rounded-xl border border-card-border bg-card-bg/80 px-2.5 py-1.5 text-xs text-muted-fg transition-all hover:bg-hover-bg hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
            className="rounded-xl border border-card-border bg-card-bg/80 px-2.5 py-1.5 text-xs text-muted-fg transition-all hover:bg-hover-bg hover:text-fg cursor-pointer"
            onClick={() => {
              navigate("chat");
            }}
          >
            {t("common.close")}
          </button>
        </div>
      </div>
      {view.saveFailed ? (
        <p role="alert" className="border-b border-err/30 bg-err/10 px-3.5 py-2 text-xs text-err font-medium">
          {t("settings.saveFailed")}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5">
        {SECTION_ORDER.map((section) => (
          <section key={section} className="flex flex-col gap-3.5 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
            <div className="flex items-center gap-1.5 border-b border-card-border/50 pb-2">
              <span className="text-muted-fg">{getSectionIcon(section)}</span>
              <h3 className="text-xs font-semibold text-fg/90">{t(SECTION_TITLE[section])}</h3>
            </div>
            <div className="flex flex-col gap-3">
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
            </div>
            {section === "server" ? (
              <>
                <SettingsSecretsPanel
                  secrets={view.secrets}
                  disabled={disabled}
                  onSave={(kind, value) => runSecret(kind, value)}
                  onClear={(kind) => runSecret(kind, "")}
                />
                <div className="flex flex-col gap-2 border-t border-card-border/50 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-card-border bg-card-bg/80 px-3 py-1.5 text-xs font-medium text-fg/90 transition-all hover:bg-hover-bg hover:text-fg disabled:opacity-40 cursor-pointer shadow-2xs"
                      disabled={disabled}
                      onClick={() => {
                        void store.testConnection(send);
                      }}
                    >
                      {t("settings.testConnection")}
                    </button>
                    {view.serverHealth === null ? null : (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          view.serverHealth.status === "ok" ? "bg-ok/15 text-ok border border-ok/30" : "bg-err/15 text-err border border-err/30"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${view.serverHealth.status === "ok" ? "bg-ok" : "bg-err"}`} />
                        <span>
                          {view.serverHealth.status === "ok"
                            ? t("settings.connectionOk")
                            : t("settings.connectionFailed")}
                          {view.serverHealth.version === null ? "" : ` — ${view.serverHealth.version}`}
                          {view.serverHealth.detail === undefined ? "" : `: ${view.serverHealth.detail}`}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : null}
            {section === "diagnostics" ? (
              <div className="flex flex-col gap-1.5 border-t border-card-border/50 pt-3">
                <div className="flex items-center gap-2 text-xs font-medium text-fg/80">
                  <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
                  <span className="font-mono text-[11px]">
                    {init.server.url.length > 0 ? init.server.url : t("server.status.stopped")}
                    {init.server.version === null ? "" : ` — ${init.server.version}`}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-fg">{t("settings.serverActionsHint")}</p>
              </div>
            ) : null}
          </section>
        ))}
        <section className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
          <div className="flex items-center gap-1.5 border-b border-card-border/50 pb-2">
            <span className="text-accent"><ZapIcon /></span>
            <h3 className="text-xs font-semibold text-fg/90">{t("settings.section.capabilities")}</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(init.capabilities).map(([name, enabled]) => (
              <span
                key={name}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all ${
                  enabled
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-card-border/60 bg-card-bg/60 text-muted-fg/60"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-ok" : "bg-off"}`} />
                <span>{name}</span>
              </span>
            ))}
          </div>
          {capabilities === undefined ? null : (
            <p className="text-[11px] font-medium leading-relaxed text-muted-fg/80 pt-1 border-t border-card-border/30">
              {`${capabilities.agents.length} agents / ${capabilities.commands.length} commands / ${capabilities.providers.length} providers`}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

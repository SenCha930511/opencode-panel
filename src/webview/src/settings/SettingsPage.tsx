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
import type { ConfigScope } from "../../../shared/protocol.js";
import { useStrings } from "../../lib/i18n.js";
import type { StringId } from "../../../shared/strings.js";
import {
  fieldLabelId,
  settingFieldsForSection,
  settingFieldValue,
  type SettingSectionId,
} from "../../../shared/settingsSchema.js";
import { useApp } from "../app/context";
import { attachCapabilityStore, useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";
import { SettingFieldRow } from "./fields.js";
import { ConfigFilesStore, slotKeyOf } from "./configFilesStore.js";
import { SettingsFormStore } from "./settingsStore.js";
import { parseSettingsSnapshotWire } from "./settingsWire.js";
import { SettingsSecretsPanel } from "./settingsSecrets.js";

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

import { OpenCodeConfigTab } from "./openCodeConfigTab.js";
import { OmoConfigTab } from "./omoConfigTab.js";

type SettingsTab = "general" | "opencode" | "omo";

function SettingsForm(props: { readonly store: SettingsFormStore }): ReactNode {
  const { init, messenger, send, pushToast, navigate } = useApp();
  const { t, locale } = useStrings();
  const { store } = props;
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const capabilities = useCapabilitySnapshot();
  const [resetSignal, setResetSignal] = useState(0);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [configScope, setConfigScope] = useState<ConfigScope>("global");
  const [cfgStore] = useState(() => new ConfigFilesStore((type, payload) => messenger.request(type, payload))); // i18n-allow-literal — code-only expression, no display copy
  const cfgView = useSyncExternalStore(cfgStore.subscribe, cfgStore.getSnapshot, cfgStore.getSnapshot);
  const cfgSlot = activeTab === "general" ? null : cfgView.slots[slotKeyOf(activeTab, configScope)];
  const cfgDirty = cfgSlot?.dirty ?? false;
  const cfgBlocked = cfgSlot === null || cfgSlot.saving || cfgSlot.readOnly;

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  const dirty = store.dirtyKeys().length > 0;
  const disabled = view.applying;

  /** Config-tab (opencode/omo) Apply/Revert wires (plan W5). */
  const onConfigApply = (): void => {
    if (activeTab === "general") return;
    void cfgStore.save(activeTab, configScope).then((ok) => {
      if (ok) pushToast("info", t("cfg.file.saved"));
    });
  };
  const onConfigRevert = (): void => {
    if (activeTab === "general") return;
    cfgStore.revert(activeTab, configScope);
  };
  const cfgLoadFailed =
    activeTab !== "general" && cfgSlot !== null && !cfgSlot.loaded && cfgSlot.saveError !== null;

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

  const [searchQuery, setSearchQuery] = useState("");
  const isDirtyOverall = activeTab === "general" ? dirty : cfgDirty;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg text-fg">
      {/* Sleek Unified Header Bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-card-border/60 bg-panel-bg/95 px-4 py-2.5 backdrop-blur-md">
        {/* Left: Title + Segmented Tabs */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-fg tracking-wide uppercase">{t("settings.title")}</span>
          <div className="h-3.5 w-px bg-card-border/60" />
          <nav className="inline-flex items-center rounded-lg bg-card-bg/80 p-0.5 border border-card-border/60">
            {(["general", "opencode", "omo"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                  activeTab === tab
                    ? "bg-accent text-accent-fg font-semibold shadow-xs"
                    : "text-muted-fg hover:text-fg hover:bg-hover-bg/40"
                }`}
              >
                {tab === "general" ? t("cfg.tab.general") : tab === "opencode" ? t("cfg.tab.opencode") : t("cfg.tab.omo")}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: Search / Scope + Action Buttons */}
        <div className="flex items-center gap-2">
          {/* If General: Search Input */}
          {activeTab === "general" ? (
            <div className="relative flex items-center w-36 sm:w-44">
              <span className="absolute left-2.5 text-muted-fg/60 text-[11px] pointer-events-none">🔍</span>
              <input
                type="text"
                placeholder="搜尋設定..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-card-border/60 bg-card-bg/60 pl-6.5 pr-5 py-1 text-xs text-fg placeholder:text-muted-fg/40 focus:border-accent focus:outline-none transition-colors"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 text-[10px] text-muted-fg hover:text-fg cursor-pointer"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ) : (
            /* If Config File: Scope Switcher */
            <div className="inline-flex items-center rounded-lg bg-card-bg/80 p-0.5 border border-card-border/60">
              {(["global", "project"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setConfigScope(choice)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    configScope === choice
                      ? "bg-accent text-accent-fg font-semibold shadow-xs"
                      : "text-muted-fg hover:text-fg hover:bg-hover-bg/40"
                  }`}
                >
                  {t(choice === "global" ? "cfg.scope.global" : "cfg.scope.project")}
                </button>
              ))}
            </div>
          )}

          {isDirtyOverall ? (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-warn/15 border border-warn/30 px-2 py-0.5 text-[10px] font-medium text-warn animate-pulse shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" />
              <span>未儲存</span>
            </span>
          ) : null}

          <div className="h-3.5 w-px bg-card-border/60" />

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {activeTab === "general" ? (
              <>
                <button
                  type="button"
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
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
                  className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2.5 py-1 text-xs text-muted-fg transition-all hover:border-card-border hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!dirty || disabled}
                  onClick={() => {
                    store.revert();
                    setResetSignal((value) => value + 1); // i18n-allow-literal — code-only expression, no display copy
                  }}
                >
                  {t("settings.revert")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
                  disabled={!cfgDirty || cfgBlocked}
                  onClick={() => {
                    void cfgStore.save(activeTab, configScope).then((ok) => {
                      if (ok) pushToast("info", t("cfg.file.saved"));
                    });
                  }}
                >
                  {t("settings.apply")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2.5 py-1 text-xs text-muted-fg transition-all hover:border-card-border hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!cfgDirty || cfgSlot?.saving === true}
                  onClick={() => {
                    cfgStore.revert(activeTab, configScope);
                  }}
                >
                  {t("settings.revert")}
                </button>
              </>
            )}
            <button
              type="button"
              className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2.5 py-1 text-xs text-muted-fg transition-all hover:border-card-border hover:text-fg cursor-pointer"
              onClick={() => {
                void send("closeSettingsTab" as any, {}).catch(() => {});
                navigate("chat");
              }}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>

      {view.saveFailed ? (
        <p role="alert" className="border-b border-err/30 bg-err/10 px-3.5 py-1.5 text-xs text-err font-medium">
          {t("settings.saveFailed")}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
        {activeTab === "opencode" && <OpenCodeConfigTab store={cfgStore} scope={configScope} />}
        {activeTab === "omo" && <OmoConfigTab store={cfgStore} scope={configScope} />}
        {activeTab === "general" && (
          <>
            {SECTION_ORDER.map((section) => {
              const allFields = settingFieldsForSection(section);
              const filteredFields = searchQuery.trim()
                ? allFields.filter((f) => {
                    const q = searchQuery.toLowerCase();
                    const label = t(fieldLabelId(f)).toLowerCase();
                    const desc = (locale === "zh-TW" ? f.description.zhTW : f.description.en).toLowerCase();
                    return label.includes(q) || desc.includes(q) || f.shortKey.toLowerCase().includes(q);
                  })
                : allFields;

              if (searchQuery.trim() && filteredFields.length === 0) {
                return null;
              }

              return (
                <section key={section} className="flex flex-col gap-3 rounded-xl border border-card-border/60 bg-card-bg/30 p-3.5">
                  <div className="flex items-center gap-2 border-b border-card-border/40 pb-2">
                    <span className="text-muted-fg text-xs">{getSectionIcon(section)}</span>
                    <h3 className="text-xs font-semibold text-fg/90">{t(SECTION_TITLE[section])}</h3>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {filteredFields.map((field) => (
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
                      <div className="flex flex-col gap-2 border-t border-card-border/40 pt-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2.5 py-1 text-xs font-medium text-fg/90 transition-all hover:bg-hover-bg hover:text-fg disabled:opacity-40 cursor-pointer"
                            disabled={disabled}
                            onClick={() => {
                              void store.testConnection(send);
                            }}
                          >
                            {t("settings.testConnection")}
                          </button>
                          {view.serverHealth === null ? null : (
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
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
                    <div className="flex flex-col gap-1.5 border-t border-card-border/40 pt-2.5">
                      <div className="flex items-center gap-2 text-xs font-medium text-fg/80">
                        <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                        <span className="font-mono text-[11px]">
                          {init.server.url.length > 0 ? init.server.url : t("server.status.stopped")}
                          {init.server.version === null ? "" : ` — ${init.server.version}`}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-fg/70">{t("settings.serverActionsHint")}</p>
                    </div>
                  ) : null}
                </section>
              );
            })}
            <section className="flex flex-col gap-3 rounded-xl border border-card-border/60 bg-card-bg/30 p-3.5">
              <div className="flex items-center gap-2 border-b border-card-border/40 pb-2">
                <span className="text-accent text-xs"><ZapIcon /></span>
                <h3 className="text-xs font-semibold text-fg/90">{t("settings.section.capabilities")}</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(init.capabilities).map(([name, enabled]) => (
                  <span
                    key={name}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] font-medium transition-all ${
                      enabled
                        ? "border-ok/30 bg-ok/10 text-ok"
                        : "border-card-border/40 bg-card-bg/40 text-muted-fg/60"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-ok" : "bg-off"}`} />
                    <span>{name}</span>
                  </span>
                ))}
              </div>
              {capabilities === undefined ? null : (
                <p className="text-[10px] font-medium leading-relaxed text-muted-fg/70 pt-1 border-t border-card-border/20">
                  {`${capabilities.agents.length} agents / ${capabilities.commands.length} commands / ${capabilities.providers.length} providers`}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

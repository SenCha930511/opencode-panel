/**
 * opencode.json editor tab (plan T4a): the REAL config-file surface — every
 * key of the verified spec inventory editable through the ConfigFilesStore
 * draft lane (file "opencode"), tier-1 sections open, tier-2 behind the
 * Advanced disclosure, bespoke record blocks via opencodeSections, all other
 * fields declarative via opencodeSpec.
 *
 * Chrome per plan item 12: file path + missing-file create CTA
 * (store.beginCreate), parse-error banner (renderer stays silent then and
 * the slot is read-only), save-error + mtime-conflict lanes (Reload /
 * Force), a deprecated-keys read-only notice (schema-deprecated top-level
 * keys plus agent.*.tools / agent.*.maxSteps), an unknown-keys collapsible
 * (topLevelKeys vs the spec-known set — unknown keys survive saves by
 * construction), and the view-only live JSON preview (no copy affordance).
 *
 * CALL CONTRACT: usable with NO props until W5 lands (SettingsPage still
 * renders `<OpenCodeConfigTab />`) — the tab then builds its own store on
 * the app messenger at scope "global". W5 passes {store, scope}.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { isRecord, type ConfigScope } from "../../../shared/protocol.js";
import { parseJsonc, topLevelKeys } from "../../../shared/configJsonc.js";
import { useStrings } from "../../lib/i18n.js";
import { useApp } from "../app/context.js";
import { ConfigFilesStore, slotKeyOf } from "./configFilesStore.js";
import { ConfigFormRenderer } from "./ConfigFormRenderer.js";
import { redactPreviewText } from "./configPreview.js";
import {
  OPENCODE_DEPRECATED_TOP_LEVEL,
  OPENCODE_KNOWN_TOP_LEVEL,
  OPENCODE_SPEC,
} from "./opencodeSpec.js";

/** Detected deprecated keys: top-level set plus agent.tools / agent.maxSteps. */
function detectDeprecatedKeys(draftText: string): readonly string[] {
  const top = topLevelKeys(draftText);
  const found: string[] = top.filter((key) => OPENCODE_DEPRECATED_TOP_LEVEL.includes(key)); // i18n-allow-literal — code-only expression, no display copy
  const tree = parseJsonc(draftText).value;
  if (isRecord(tree) && isRecord(tree["agent"])) {
    for (const [name, agentConfig] of Object.entries(tree["agent"])) {
      if (!isRecord(agentConfig)) continue;
      if ("tools" in agentConfig) found.push(`agent.${name}.tools`);
      if ("maxSteps" in agentConfig) found.push(`agent.${name}.maxSteps`);
    }
  }
  return found;
}

/** Top-level keys neither in the spec inventory nor in the deprecated set. */
function detectUnknownKeys(draftText: string): readonly string[] {
  return topLevelKeys(draftText).filter(
    (key) => !OPENCODE_KNOWN_TOP_LEVEL.has(key) && !OPENCODE_DEPRECATED_TOP_LEVEL.includes(key),
  );
}

export function OpenCodeConfigTab(props: {
  readonly store?: ConfigFilesStore;
  readonly scope?: ConfigScope;
}): ReactNode {
  const { messenger } = useApp();
  const { t } = useStrings();
  const [fallbackStore] = useState(
    () => new ConfigFilesStore((type, payload) => messenger.request(type, payload)), // i18n-allow-literal — code-only expression, no display copy
  );
  const store = props.store ?? fallbackStore;
  const scope = props.scope ?? "global";
  useEffect(() => {
    void store.load("opencode", scope);
  }, [store, scope]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const slot = view.slots[slotKeyOf("opencode", scope)];
  const deprecatedKeys = useMemo(() => detectDeprecatedKeys(slot.draftText), [slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
  const unknownKeys = useMemo(() => detectUnknownKeys(slot.draftText), [slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
  const previewText = useMemo(() => redactPreviewText(slot.draftText), [slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
  const [previewOpen, setPreviewOpen] = useState(true);
  const [unknownOpen, setUnknownOpen] = useState(false);

  if (!slot.loaded) {
    return (
      <div className="flex flex-col gap-4 p-3">
        <p className="text-xs text-muted-fg">{t("app.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* File chrome: path, state chips, create CTA, error lanes. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-fg/90">{t("cfg.file.path")}</span>
          <code className="min-w-0 flex-1 break-all rounded-lg border border-card-border/60 bg-card-bg/60 px-2 py-1 font-mono text-[11px] text-fg/90">
            {slot.path}
          </code>
          {slot.readOnly ? (
            <span className="shrink-0 rounded-full border border-card-border bg-card-bg/80 px-2 py-0.5 text-[10px] font-medium text-muted-fg">
              {t("cfg.file.readOnly")}
            </span>
          ) : null}
        </div>
        {!slot.exists ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-fg">{t("cfg.file.missing")}</p>
            <button
              type="button"
              className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 cursor-pointer"
              onClick={() => {
                store.beginCreate("opencode", scope);
              }}
            >
              {t("cfg.file.create")}
            </button>
          </div>
        ) : null}
        {slot.parseError !== null ? (
          <p role="alert" className="rounded-xl border border-err/30 bg-err/10 px-3 py-2 text-xs font-medium text-err">
            {t("cfg.file.parseError")}
          </p>
        ) : null}
        {slot.conflict ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2">
            <p className="text-xs font-medium text-warn">{t("cfg.file.conflict")}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-card-border bg-card-bg/80 px-3 py-1.5 text-xs text-muted-fg transition-all hover:bg-hover-bg hover:text-fg cursor-pointer"
                onClick={() => {
                  void store.reload("opencode", scope);
                }}
              >
                {t("cfg.action.reload")}
              </button>
              <button
                type="button"
                className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 cursor-pointer"
                onClick={() => {
                  void store.save("opencode", scope, { force: true });
                }}
              >
                {t("cfg.action.force")}
              </button>
            </div>
          </div>
        ) : null}
        {slot.saveError !== null && !slot.conflict ? (
          <p role="alert" className="rounded-xl border border-err/30 bg-err/10 px-3 py-2 text-xs font-medium text-err">
            {slot.saveError}
          </p>
        ) : null}
      </section>

      {/* Spec-driven form (silent while the slot is unparseable). */}
      <ConfigFormRenderer store={store} file="opencode" scope={scope} sections={OPENCODE_SPEC} />

      {/* Deprecated-keys read-only notice. */}
      {deprecatedKeys.length > 0 ? (
        <section className="flex flex-col gap-1.5 rounded-2xl border border-warn/30 bg-warn/10 p-3.5">
          <p className="text-xs font-medium text-warn">
            {t("cfg.notice.deprecated").replace("{keys}", deprecatedKeys.join(", "))}
          </p>
        </section>
      ) : null}

      {/* Unknown-keys collapsible read-only notice. */}
      {unknownKeys.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
          <button
            type="button"
            aria-expanded={unknownOpen}
            className="flex cursor-pointer items-center gap-2 text-left"
            onClick={() => {
              setUnknownOpen((current) => !current);
            }}
          >
            <span aria-hidden="true" className="text-muted-fg">
              {unknownOpen ? "▾" : "▸"}
            </span>
            <span className="text-xs font-medium text-fg/90">
              {t("cfg.notice.unknown").replace("{keys}", unknownKeys.join(", "))}
            </span>
          </button>
          {unknownOpen ? (
            <ul className="flex flex-col gap-1">
              {unknownKeys.map((key) => (
                <li key={key} className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2 py-1 font-mono text-[11px] text-fg/90">
                  {key}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* Live JSON preview — view-only, secret values masked. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
        <button
          type="button"
          aria-expanded={previewOpen}
          className="flex cursor-pointer items-center gap-2 text-left"
          onClick={() => {
            setPreviewOpen((current) => !current);
          }}
        >
          <span aria-hidden="true" className="text-muted-fg">
            {previewOpen ? "▾" : "▸"}
          </span>
          <span className="text-xs font-semibold text-fg/90">{t("cfg.preview.title")}</span>
        </button>
        {previewOpen ? (
          <pre className="max-h-72 overflow-auto rounded-xl border border-card-border/60 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-fg/90">
            {previewText}
          </pre>
        ) : null}
      </section>
    </div>
  );
}

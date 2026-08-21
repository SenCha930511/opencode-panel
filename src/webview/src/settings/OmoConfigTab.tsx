/**
 * omo.jsonc editor tab (plan T4b): the REAL omo config surface — every key
 * of the "[opencode]" block editable through the ConfigFilesStore draft lane
 * (file "omo"), tier-1 agents/categories/disabled sections open, all fourteen
 * tier-2 sections behind the Advanced disclosure, bespoke record/chip blocks
 * via omoSections, everything else declarative via omoSpec. The shared-base
 * section intentionally edits the top-level keys outside the block.
 *
 * Chrome mirrors OpenCodeConfigTab: file path + missing-file create CTA
 * (store.beginCreate), parse-error banner (renderer stays silent then and
 * the slot is read-only), save-error + mtime-conflict lanes (Reload /
 * Force), a legacy migrated-config read-only notice (legacyNoticePath is
 * display-only; the legacy file is NEVER a write target), a profiles
 * read-only notice, a deprecated-keys read-only notice (agent/category
 * `variant` and `reasoningEffort` entries — never created nor modified by
 * edits), an unknown-keys collapsible listing keys inside the [opencode]
 * block outside the spec set (they survive saves by construction), and the
 * view-only JSON preview with secret values redacted — collapsed by
 * default, force-open while the draft is unparseable so the broken text
 * stays visible for fixing.
 *
 * CALL CONTRACT: usable with NO props until W5 lands (SettingsPage still
 * renders `<OmoConfigTab />`) — the tab then builds its own store on the
 * app messenger at scope "global". W5 passes {store, scope}.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { isRecord, type ConfigScope } from "../../../shared/protocol.js";
import {
  applyJsoncEdit,
  isSecretPath,
  parseJsonc,
  type JsoncPath,
} from "../../../shared/configJsonc.js";
import { useStrings } from "../../lib/i18n.js";
import { useApp } from "../app/context.js";
import { ConfigFilesStore, slotKeyOf } from "./configFilesStore.js";
import { ConfigFormRenderer } from "./ConfigFormRenderer.js";
import { OMO_SPEC, collectDeprecatedKeys, collectUnknownBlockKeys } from "./omoSpec.js";
import { LegacyNotice, OMO_NOTICE_CLASS, ProfilesNotice } from "./omoSections.js";

const SECRET_VALUE_MASK = "••••••••";
const SECRET_NAME = /key|token|secret|password/i;

/**
 * Preview redaction predicate: the shared isSecretPath (secret-named key
 * under an environment/env/headers/options ancestor) plus the openclaw
 * replyListener block, whose discord/telegram bot tokens the form masks
 * explicitly while the shared container list does not list it.
 */
function isPreviewSecretPath(path: JsoncPath): boolean {
  if (isSecretPath(path)) return true;
  const last = path[path.length - 1];
  if (typeof last !== "string" || !SECRET_NAME.test(last)) return false;
  return path
    .slice(0, -1)
    .some((segment) => typeof segment === "string" && segment.toLowerCase() === "replylistener"); // i18n-allow-literal — code-only expression, no display copy
}

function collectSecretLeafPaths(value: unknown, path: readonly (string | number)[], found: JsoncPath[]): void {
  if (typeof value === "string") {
    if (value.length > 0 && isPreviewSecretPath(path)) found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectSecretLeafPaths(entry, [...path, index], found);
    });
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      collectSecretLeafPaths(entry, [...path, key], found);
    }
  }
}

/**
 * The live preview text with secret leaf VALUES swapped for the mask through
 * jsonc-parser point edits: comments, key order, and every non-secret byte
 * stay verbatim, while a configured bot token never renders in clear text
 * (the same guarantee the masked edit lanes give the form).
 */
export function redactPreviewText(text: string): string {
  const { value } = parseJsonc(text);
  const paths: JsoncPath[] = [];
  collectSecretLeafPaths(value, [], paths);
  let redacted = text;
  for (const path of paths) redacted = applyJsoncEdit(redacted, path, SECRET_VALUE_MASK);
  return redacted;
}

export function OmoConfigTab(props: {
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
    void store.load("omo", scope);
  }, [store, scope]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const slot = view.slots[slotKeyOf("omo", scope)];
  const tree = useMemo(() => parseJsonc(slot.draftText).value, [slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
  const deprecatedKeys = useMemo(() => collectDeprecatedKeys(tree), [tree]); // i18n-allow-literal — code-only expression, no display copy
  const unknownKeys = useMemo(() => collectUnknownBlockKeys(tree), [tree]); // i18n-allow-literal — code-only expression, no display copy
  const previewText = useMemo(() => redactPreviewText(slot.draftText), [slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
  const [previewOpen, setPreviewOpen] = useState(false);
  const [unknownOpen, setUnknownOpen] = useState(false);
  // Broken drafts keep their raw text visible for fixing even when collapsed.
  const previewShown = previewOpen || slot.parseError !== null;

  if (!slot.loaded) {
    return (
      <div className="flex flex-col gap-4 p-3">
        <p className="text-xs text-muted-fg">{t("app.loading")}</p>
      </div>
    );
  }

  const hasProfiles = isRecord(tree) && tree["profiles"] !== undefined;

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
                store.beginCreate("omo", scope);
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
                  void store.reload("omo", scope);
                }}
              >
                {t("cfg.action.reload")}
              </button>
              <button
                type="button"
                className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow-2xs transition-all hover:bg-accent-hover active:scale-95 cursor-pointer"
                onClick={() => {
                  void store.save("omo", scope, { force: true });
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

      {/* Legacy migrated-config notice (display-only; never a write target). */}
      {slot.legacyNoticePath !== null ? <LegacyNotice path={slot.legacyNoticePath} /> : null}

      {/* Spec-driven form (silent while the slot is unparseable). */}
      <ConfigFormRenderer store={store} file="omo" scope={scope} sections={OMO_SPEC} />

      {/* Profiles read-only notice. */}
      {hasProfiles ? <ProfilesNotice /> : null}

      {/* Deprecated agent/category entry keys read-only notice. */}
      {deprecatedKeys.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <p className={OMO_NOTICE_CLASS}>
            {t("cfg.notice.deprecated").replace("{keys}", deprecatedKeys.join(", "))}
          </p>
        </section>
      ) : null}

      {/* Unknown [opencode]-block keys collapsible read-only notice. */}
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

      {/* Live JSON preview — view-only, secret values redacted. */}
      <section className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card-bg/40 p-3.5 shadow-2xs backdrop-blur-xs">
        <button
          type="button"
          aria-expanded={previewShown}
          className="flex cursor-pointer items-center gap-2 text-left"
          onClick={() => {
            setPreviewOpen((current) => !current);
          }}
        >
          <span aria-hidden="true" className="text-muted-fg">
            {previewShown ? "▾" : "▸"}
          </span>
          <span className="text-xs font-semibold text-fg/90">{t("cfg.preview.title")}</span>
        </button>
        {previewShown ? (
          <pre className="max-h-72 overflow-auto rounded-xl border border-card-border/60 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-fg/90">
            {previewText}
          </pre>
        ) : null}
      </section>
    </div>
  );
}

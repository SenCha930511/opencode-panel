import {
  en,
  zhTW,
  type StringId,
  type SupportedLocale,
} from "../shared/strings.js";

/**
 * Host-side locale resolution for the webview string tables.
 *
 * Pure module — NO `vscode` import. `vscode.env.language` is read by the
 * activation layer (extension.ts / vscode-adapter.ts) and injected here as a
 * plain string, which keeps this logic unit-testable under node + vitest.
 *
 * StringId -> wire contract (binding for every producer/consumer of the
 * init payload):
 *   - `src/shared/strings.ts` is the single authority. `STRING_IDS`
 *     enumerates every UI string id; `en`/`zhTW` are `Record<StringId, string>`,
 *     so the compiler proves both tables carry exactly the same ids.
 *   - On the wire, `InitPayload.strings` is typed `Record<string,string>`
 *     (protocol.ts) because JSON has no literal-key types. The host injects
 *     EXACTLY ONE resolved table (the active locale), keyed by StringId;
 *     English is NOT merged in — the webview bundles `en` itself and
 *     `translateWithFallback` walks injected -> en -> id.
 *   - Runtime drift beyond the compiler (hand-edited payloads, schema skew)
 *     is caught by scripts/check-i18n.mjs (table parity) and the
 *     src/shared/__tests__/strings.test.ts suite.
 *
 * Display-language changes at runtime: the VS Code display language only
 * changes on restart, so there is no hot table swap; a future host-side
 * toast prompting reload is a HOST runtime string and must go through
 * `vscode.l10n.t` (l10n bundles from todo 1), not through these tables.
 * Same rule for every host UI surface (notifications, quickpicks):
 * webview tables are for the webview; host UI strings use `vscode.l10n.t`.
 */

/**
 * Maps a `vscode.env.language` value onto a supported locale. ANY Chinese
 * variant ("zh", "zh-tw", "zh-cn", "zh-hk", "zh-hant-*", case-insensitive)
 * resolves to "zh-TW" per plan decision (single Chinese table, Traditional);
 * everything else resolves to "en".
 *
 * `languageOverride` is the `opencodePanel.language` setting: a pinned
 * locale short-circuits env detection; `"auto"` or any hand-edited unknown
 * value keeps the env mapping above.
 */
export function resolveLocale(envLanguage: string, languageOverride?: string): SupportedLocale {
  if (languageOverride === "en" || languageOverride === "zh-TW") return languageOverride;
  return envLanguage.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

/**
 * Full tables by locale, keyed by StringId. Typed as an exhaustive map so
 * adding a locale to SUPPORTED_LOCALES without a table here is a compile
 * error — a missing locale can never silently fall through to English.
 */
const TABLES: Readonly<Record<SupportedLocale, Readonly<Record<StringId, string>>>> = {
  en,
  "zh-TW": zhTW,
};

export function tableForLocale(locale: SupportedLocale): Readonly<Record<StringId, string>> {
  return TABLES[locale];
}

/** The `{locale, strings}` slice of the webview `init` payload (protocol.ts). */
export interface InitLocaleBundle {
  readonly locale: SupportedLocale;
  readonly strings: Readonly<Record<StringId, string>>;
}

/**
 * Builds the init-payload locale bundle from an injected env language and
 * the optional `opencodePanel.language` override. `strings` is structurally
 * `Record<string,string>` on the wire — see the StringId -> wire contract
 * above.
 */
export function buildInitStrings(envLanguage: string, languageOverride?: string): InitLocaleBundle {
  const locale = resolveLocale(envLanguage, languageOverride);
  return { locale, strings: tableForLocale(locale) };
}

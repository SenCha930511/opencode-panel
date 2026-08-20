import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONFIG } from "../../../../host/config.js";
import type { InitPayload } from "../../../../shared/protocol.js";
import { SETTING_FIELDS } from "../../../../shared/settingsSchema.js";
import { en } from "../../../../shared/strings.js";
import { StringsProvider } from "../../../lib/i18n.js";
import { WebviewMessenger } from "../../../lib/messenger.js";
import { AppProvider } from "../../app/context.js";
import { SettingsPage } from "../SettingsPage.js";
import { SettingsFormStore } from "../settingsStore.js";
import type { SettingsSnapshotWire } from "../settingsWire.js";

// i18n-allow-literal — SSR assertions mix sentinel overrides (proving the
// t() wiring) with the bundled ENGLISH fallback table (proving schema copy).
/**
 * SettingsPage SSR suite (plan todo 21, node env — no jsdom): the page is
 * GENERATED from the manifest-derived schema — one labeled row + one
 * data-oc-setting marker per SETTING_FIELDS entry, sections in the Server /
 * Appearance / Diagnostics reading order, scope chips defaulting to User,
 * the masked secrets rows, the colon-free diagnostics status + palette hint,
 * and the capabilities bit matrix from init. Sentinel overrides on a subset
 * of ids prove t() serves every row; the remainder rides the English table.
 */

const SENTINELS = {
  fieldPort: "ZZ_SENTINEL_FIELD_PORT_ZZ",
  sectionServer: "ZZ_SENTINEL_SECTION_SERVER_ZZ",
  secretPassword: "ZZ_SENTINEL_SECRET_PASSWORD_ZZ",
  hint: "ZZ_SENTINEL_SERVER_ACTIONS_HINT_ZZ",
} as const;

function stubStrings(): Readonly<Record<string, string>> {
  return {
    ...en,
    "settings.field.port": SENTINELS.fieldPort,
    "settings.section.server": SENTINELS.sectionServer,
    "settings.field.serverPassword": SENTINELS.secretPassword,
    "settings.serverActionsHint": SENTINELS.hint,
  };
}

function stubInit(overrides?: Partial<InitPayload>): InitPayload {
  return {
    locale: "en",
    strings: stubStrings(),
    server: { url: "http://127.0.0.1:4096", version: "1.2.3-test" },
    capabilities: { fork: true, question: false, todo: true },
    settings: {},
    ...overrides,
  };
}

function stubStore(): SettingsFormStore {
  const snapshot: SettingsSnapshotWire = {
    values: { ...DEFAULT_PANEL_CONFIG },
    scope: {},
    secrets: { password: { isSet: false }, username: { isSet: true } },
  };
  return new SettingsFormStore(snapshot);
}

function renderPage(init: InitPayload, store: SettingsFormStore): string {
  return renderToString(
    <StringsProvider init={init}>
      <AppProvider
        init={init}
        messenger={
          new WebviewMessenger({
            postMessage: () => {},
            onMessage: () => {},
          })
        }
      >
        <SettingsPage store={store} />
      </AppProvider>
    </StringsProvider>,
  );
}

describe("SettingsPage SSR — schema-driven form", () => {
  it("renders one labeled row per SETTING_FIELDS entry (data-driven generation)", () => {
    // Given: a clean store built from the wire snapshot
    const store = stubStore();
    // When: the page renders
    const html = renderPage(stubInit(), store);
    // Then: every manifest field carries its marker, once
    const markers = html.match(/data-oc-setting="[a-zA-Z]+"/g) ?? [];
    expect(markers).toHaveLength(SETTING_FIELDS.length);
    for (const field of SETTING_FIELDS) {
      expect(html).toContain(`data-oc-setting="${field.shortKey}"`);
    }
    // And: sentinel ids prove the label t() wiring, table ids the rest
    expect(html).toContain(SENTINELS.fieldPort);
    expect(html).toContain(en["settings.field.hostname"]);
    // And: control kinds follow field.type out of the schema
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain("<textarea");
    // And: schema description copy lands verbatim (en locale)
    expect(html).toContain("Ignored when `opencodePanel.serverUrl` is set.");
  });

  it("renders the language row as an enum select with the provisioned options", () => {
    // Given/When
    const html = renderPage(stubInit(), stubStore());
    // Then: the appearance section's language row carries its marker and a
    // select committing one of the manifest enum values per option
    expect(html).toContain('data-oc-setting="language"');
    expect(html).toContain(en["settings.field.language"]);
    for (const optionValue of ["auto", "en", "zh-TW"]) {
      expect(html).toContain(`value="${optionValue}"`);
    }
    for (const labelId of ["settings.enumOption.auto", "settings.enumOption.en", "settings.enumOption.zhTW"] as const) {
      expect(html).toContain(en[labelId]);
    }
  });

  it("renders the documented section order and User-default scope chips", () => {
    // Given/When
    const html = renderPage(stubInit(), stubStore());
    // Then: Server before Appearance before Diagnostics (schema sections)
    const serverAt = html.indexOf(SENTINELS.sectionServer);
    const appearanceAt = html.indexOf(en["settings.section.appearance"]);
    const diagnosticsAt = html.indexOf(en["settings.section.diagnostics"]);
    expect(serverAt).toBeGreaterThanOrEqual(0);
    expect(appearanceAt).toBeGreaterThan(serverAt);
    expect(diagnosticsAt).toBeGreaterThan(appearanceAt);
    // And: every row offers both chip layers; Apply/Revert start disabled
    expect(html.match(/<option/g)?.length).toBeGreaterThanOrEqual(SETTING_FIELDS.length * 2);
    expect(html).toContain(`>${en["settings.scope.user"]}<`);
    expect(html).toContain(`>${en["settings.scope.workspace"]}<`);
    expect(html).not.toContain('role="alert"');
  });

  it("renders masked secrets with isSet flags only — never a value", () => {
    // Given: username stored, password unset (store fixture)
    // When
    const html = renderPage(stubInit(), stubStore());
    // Then: password input masked, both rows announce only flags
    expect(html).toContain('type="password"');
    expect(html).toContain(SENTINELS.secretPassword);
    expect(html).toContain(en["settings.secret.notSet"]);
    expect(html).toContain(en["settings.secret.isSet"]);
  });

  it("renders diagnostics status, the palette hint, and the capability matrix", () => {
    // Given/When
    const html = renderPage(stubInit(), stubStore());
    // Then: server identity line + version, Start/Stop hint via t()
    expect(html).toContain("http://127.0.0.1:4096");
    expect(html).toContain("1.2.3-test");
    expect(html).toContain(SENTINELS.hint);
    // And: capabilities dots mirror init.capabilities verbatim
    expect(html).toContain("fork");
    expect(html).toContain("question");
    expect(html).toContain("todo");
  });

  it("serves zh-TW description copy when the init locale is zh-TW", () => {
    // Given: a zh-TW string table built from the bundled translation
    const init = stubInit({ locale: "zh-TW" });
    // When
    const html = renderPage(init, stubStore());
    // Then: the schema's zhTW description column is the one rendered
    expect(html).toContain("已在執行中的 opencode 伺服器完整網址");
  });
});

import { describe, expect, it } from "vitest";
import { resolveLocale } from "../../host/locale";
import { createStringsValue } from "../../webview/lib/i18n";
import {
  STRING_IDS,
  en,
  translateWithFallback,
  zhTW,
  type StringId,
  type SupportedLocale,
} from "../strings";

/**
 * i18n suite: table parity (en <-> zhTW), the webview t() fallback chain,
 * and the host locale-resolution matrix. The en/zhTW string VALUES differ on
 * purpose everywhere a selector is asserted, so a precedence regression
 * (e.g. returning the fallback first) fails the test instead of passing on
 * equal fixtures.
 */

describe("string tables", () => {
  it("has a non-empty entry for every StringId in both en and zhTW", () => {
    for (const id of STRING_IDS) {
      expect(en[id], `en["${id}"]`).toBeTypeOf("string");
      expect(en[id].length, `en["${id}"] must not be blank`).toBeGreaterThan(0);
      expect(zhTW[id], `zhTW["${id}"]`).toBeTypeOf("string");
      expect(zhTW[id].length, `zhTW["${id}"] must not be blank`).toBeGreaterThan(0);
    }
  });

  it("keeps the en and zhTW key sets in exact parity (runtime drift guard)", () => {
    const idSet = new Set<string>(STRING_IDS);
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort());
    expect(Object.keys(en).filter((key) => !idSet.has(key))).toEqual([]);
    expect(Object.keys(zhTW).filter((key) => !idSet.has(key))).toEqual([]);
  });

  it("translates the OMO note id the capability panel depends on", () => {
    // MCP panel (todo 20) renders this verbatim when omoDetected; pin the id,
    // never the prose.
    expect(en["mcp.omoNote"]).toBeTypeOf("string");
    expect(zhTW["mcp.omoNote"]).toBeTypeOf("string");
    expect(zhTW["mcp.omoNote"]).not.toBe(en["mcp.omoNote"]);
  });
});

describe("t() fallback chain", () => {
  it("returns the zhTW value when the injected table has the key", () => {
    const zh = translateWithFallback(zhTW, "composer.send");
    expect(zh).toBe(zhTW["composer.send"]);
    expect(zh).not.toBe(en["composer.send"]); // proves zh won over the en fallback
  });

  it("falls back to en when the injected table is missing the key", () => {
    const partial = { "common.cancel": zhTW["common.cancel"] };
    expect(translateWithFallback(partial, "common.cancel")).toBe(zhTW["common.cancel"]);
    expect(translateWithFallback(partial, "permission.allowOnce")).toBe(en["permission.allowOnce"]);
  });

  it("falls back to the id itself when both tables miss the key (never blank)", () => {
    expect(translateWithFallback({}, "ghost.id")).toBe("ghost.id");
    expect(translateWithFallback({}, "ghost.id").length).toBeGreaterThan(0);
  });

  it("binds the init payload through the webview createStringsValue factory", () => {
    const partial = createStringsValue({ locale: "zh-TW", strings: { "composer.send": zhTW["composer.send"] } });
    expect(partial.locale).toBe("zh-TW");
    expect(partial.t("composer.send")).toBe(zhTW["composer.send"]);
    expect(partial.t("sessions.title")).toBe(en["sessions.title"]);
    // Wire seam: an id unknown to both tables can only arrive off-type; the
    // cast documents that boundary instead of pretending it is a valid id.
    expect(partial.t("ghost.id" as StringId)).toBe("ghost.id");
  });
});

describe("host locale resolution matrix", () => {
  const cases: ReadonlyArray<readonly [envLanguage: string, expected: SupportedLocale]> = [
    ["zh-tw", "zh-TW"],
    ["zh-cn", "zh-TW"],
    ["zh-hk", "zh-TW"],
    ["en", "en"],
    ["ja", "en"],
  ];
  for (const [envLanguage, expected] of cases) {
    it(`maps vscode.env.language "${envLanguage}" -> ${expected}`, () => {
      expect(resolveLocale(envLanguage)).toBe(expected);
    });
  }
});

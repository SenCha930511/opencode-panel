import { describe, expect, it } from "vitest";
import { STRING_IDS, en, zhTW, type SupportedLocale } from "../../shared/strings";
import { buildInitStrings, resolveLocale, tableForLocale } from "../locale";

/**
 * Pure unit tests for the host locale resolver — no `vscode` import anywhere
 * in this module chain, so the suite runs under plain node + vitest.
 */

describe("resolveLocale edge cases", () => {
  const cases: ReadonlyArray<readonly [envLanguage: string, expected: SupportedLocale]> = [
    ["zh", "zh-TW"], // bare family tag
    ["zh-Hant-TW", "zh-TW"], // any zh variant resolves to the single zh-TW table
    ["ZH-TW", "zh-TW"], // case-insensitive
    ["en-US", "en"],
    ["en-GB", "en"],
    ["fr", "en"],
    ["ja-JP", "en"],
    ["", "en"], // unset env language falls back to English
  ];
  for (const [envLanguage, expected] of cases) {
    it(`maps "${envLanguage}" -> ${expected}`, () => {
      expect(resolveLocale(envLanguage)).toBe(expected);
    });
  }
});

describe("tableForLocale", () => {
  it("returns the canonical table objects by reference", () => {
    expect(tableForLocale("en")).toBe(en);
    expect(tableForLocale("zh-TW")).toBe(zhTW);
  });
});

describe("buildInitStrings", () => {
  it("builds a zh-TW init bundle for a Chinese display language", () => {
    const bundle = buildInitStrings("zh-tw");
    expect(bundle.locale).toBe("zh-TW");
    expect(bundle.strings).toBe(zhTW);
  });

  it("builds an en init bundle otherwise", () => {
    const bundle = buildInitStrings("en-US");
    expect(bundle.locale).toBe("en");
    expect(bundle.strings).toBe(en);
  });

  it("covers every StringId on the wire regardless of resolved locale", () => {
    for (const envLanguage of ["en", "zh-tw"]) {
      const { strings } = buildInitStrings(envLanguage);
      for (const id of STRING_IDS) {
        expect(strings[id], `${envLanguage} -> strings["${id}"]`).toBeTypeOf("string");
      }
    }
  });

  it("emits locale-different strings for a translated id (precedence is exercised)", () => {
    expect(buildInitStrings("zh-tw").strings["composer.send"]).not.toBe(
      buildInitStrings("en").strings["composer.send"],
    );
  });
});

#!/usr/bin/env node
// check-i18n.mjs — i18n guard suite. Exits 1 on any failure.
//
//  1. manifest <-> l10n bundle parity (todo 1): every `%opencodePanel...%`
//     placeholder in package.json exists, non-empty, in BOTH
//     l10n/bundle.l10n.json and l10n/bundle.l10n.zh-tw.json, with no drift
//     between the bundles.
//  2. webview string-table parity (todo 4): src/shared/strings.ts is loaded
//     through esbuild + a data: URL (no build step) and en/zhTW must carry
//     exactly the same keys, all non-empty strings.
//  3. webview literal guard (todo 4): src/webview/src/**/*.{ts,tsx} is
//     scanned for raw display literals — CJK characters, JSX text nodes, and
//     human-facing prop strings (placeholder/title/alt/label/caption/heading/
//     tooltip). Display copy must go through t(). Exemptions: comment lines,
//     lines carrying an inline `// i18n-allow-literal` pragma, and files with
//     a standalone `// i18n-allow-literal` comment line (file-level pragma).
//
// Pure check functions are exported so QA scratch runs (temp mutated tables,
// temp webview trees) can exercise them without duplicating logic.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Check 1: manifest <-> l10n bundle parity.
// ---------------------------------------------------------------------------

const KEY_PATTERN = /%(opencodePanel(?:\.[A-Za-z0-9_-]+)+)%/g;

export function collectManifestPlaceholders(manifest) {
  const referenced = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(KEY_PATTERN)) referenced.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(manifest);
  return referenced;
}

/** bundles: Array<[relPath, table]>; the first two are compared for drift. */
export function checkManifestBundles(referenced, bundles) {
  const failures = [];
  const keys = [...referenced].sort();
  for (const [rel, bundle] of bundles) {
    for (const key of keys) {
      if (!(key in bundle)) {
        failures.push(`MISSING ${rel} <- ${key}`);
      } else if (typeof bundle[key] !== "string" || bundle[key].length === 0) {
        failures.push(`EMPTY/INVALID ${rel} <- ${key}`);
      }
    }
  }
  const [enRel, en] = bundles[0];
  const [zhRel, zh] = bundles[1];
  for (const key of Object.keys(en)) {
    if (!(key in zh)) failures.push(`key in ${enRel} but not ${zhRel}: ${key}`);
  }
  for (const key of Object.keys(zh)) {
    if (!(key in en)) failures.push(`key in ${zhRel} but not ${enRel}: ${key}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Check 2: en/zhTW string-table parity from src/shared/strings.ts.
// ---------------------------------------------------------------------------

/**
 * Loads src/shared/strings.ts without a build step: esbuild (already the
 * host bundler) strips the types and the self-contained module is imported
 * through a data: URL.
 */
export async function loadStringTables(stringsPath = join(root, "src/shared/strings.ts")) {
  const { transformSync } = await import("esbuild");
  const source = readFileSync(stringsPath, "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
  return import(dataUrl);
}

/** Returns failure strings; empty array means en/zhTW are in exact parity. */
export function checkStringTableParity(en, zhTW) {
  const failures = [];
  for (const [tableName, table, other, otherName] of [
    ["en", en, zhTW, "zhTW"],
    ["zhTW", zhTW, en, "en"],
  ]) {
    for (const key of Object.keys(table)) {
      if (!(key in other)) {
        failures.push(`STRINGS key in ${tableName} but not ${otherName}: ${key}`);
      } else if (typeof table[key] !== "string" || table[key].length === 0) {
        failures.push(`STRINGS EMPTY/INVALID ${tableName}["${key}"]`);
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Check 3: webview literal guard.
// ---------------------------------------------------------------------------

const WEBVIEW_SRC = join(root, "src/webview/src");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

// Kana, CJK ext-A/unified ideographs, compatibility ideographs/forms, fullwidth.
const CJK_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF65]/u;

// A standalone comment line whose text is the pragma -> whole file exempt.
const FILE_PRAGMA = /^\s*\/\/\s*i18n-allow-literal\b/;
// Trailing pragma on a code line -> that line exempt.
const INLINE_PRAGMA = /\/\/\s*i18n-allow-literal/;

// `>Some copy<` on a single line (e.g. <button>Send</button>).
const JSX_TEXT_INLINE = />\s*[A-Za-z][^<>{}]*</;
// `>Some copy` starting after an open tag at end of line (multiline JSX text).
const JSX_TEXT_TRAILING = />\s+[A-Za-z][^<>{}]*$/;
// Human-facing attribute strings; className/id/key/aria-*/data-* are allowed.
const DISPLAY_PROP =
  /\b(?:placeholder|title|alt|label|caption|heading|tooltip)\s*=\s*"[^"]*[A-Za-z][^"]*"/;
// A prose-only line sitting directly after an open tag: starts with a letter
// and carries no code operators/quotes/braces.
const PROSE_LINE = /^[A-Za-z][A-Za-z0-9 .,;:!?'&%$#@…—–/-]*$/;

function isCommentOnlyLine(trimmed, inBlockComment) {
  return inBlockComment || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

export function scanFileForLiterals(source, relPath) {
  const lines = source.split("\n");
  if (lines.some((line) => FILE_PRAGMA.test(line))) return [];

  const hits = [];
  let inBlockComment = false;
  let prevCodeEndsWithOpenTag = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) continue;
    if (INLINE_PRAGMA.test(line)) continue;

    if (isCommentOnlyLine(trimmed, inBlockComment)) {
      if (trimmed.includes("*/")) inBlockComment = false;
      else if (trimmed.startsWith("/*") && !trimmed.includes("*/")) inBlockComment = true;
      continue;
    }

    if (trimmed.startsWith("import ") || trimmed.startsWith("export * from")) continue;

    if (CJK_PATTERN.test(line)) {
      hits.push({ file: relPath, line: index + 1, rule: "cjk", text: trimmed });
    } else if (DISPLAY_PROP.test(line)) {
      hits.push({ file: relPath, line: index + 1, rule: "display-prop", text: trimmed });
    } else if (JSX_TEXT_INLINE.test(line) || JSX_TEXT_TRAILING.test(line)) {
      hits.push({ file: relPath, line: index + 1, rule: "jsx-text", text: trimmed });
    } else if (prevCodeEndsWithOpenTag && PROSE_LINE.test(trimmed) && /\s/.test(trimmed)) {
      hits.push({ file: relPath, line: index + 1, rule: "jsx-text-multiline", text: trimmed });
    }

    if (trimmed.includes("/*") && !trimmed.includes("*/")) inBlockComment = true;
    prevCodeEndsWithOpenTag = trimmed.endsWith(">") && !trimmed.endsWith("=>");
  }
  return hits;
}

export function scanWebviewForLiterals(webviewSrcRoot = WEBVIEW_SRC) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (SCANNED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        files.push(path);
      }
    }
  };
  walk(webviewSrcRoot);
  return files.flatMap((file) =>
    scanFileForLiterals(readFileSync(file, "utf8"), relative(webviewSrcRoot, file)),
  );
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

async function main() {
  let failures = 0;

  // Check 1
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const bundlePaths = ["l10n/bundle.l10n.json", "l10n/bundle.l10n.zh-tw.json"];
  const bundles = bundlePaths.map((rel) => [rel, JSON.parse(readFileSync(join(root, rel), "utf8"))]);
  const referenced = collectManifestPlaceholders(manifest);
  if (referenced.size === 0) {
    console.error("check-i18n: FAIL — no %opencodePanel...% keys found in package.json");
    process.exit(1);
  }
  const manifestFailures = checkManifestBundles(referenced, bundles);
  for (const failure of manifestFailures) console.error(`check-i18n: ${failure}`);
  failures += manifestFailures.length;

  // Check 2
  const { en, zhTW, STRING_IDS } = await loadStringTables();
  const tableFailures = checkStringTableParity(en, zhTW);
  for (const failure of tableFailures) console.error(`check-i18n: ${failure}`);
  failures += tableFailures.length;

  // Check 3
  const literalHits = scanWebviewForLiterals();
  for (const hit of literalHits) {
    console.error(`check-i18n: LITERAL ${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`);
  }
  failures += literalHits.length;

  if (failures > 0) {
    console.error(`check-i18n: FAIL — ${failures} drift(s)/literal(s) found`);
    process.exit(1);
  }

  console.log(
    `check-i18n: OK — ${referenced.size} manifest key(s) present and non-empty in ` +
      `${bundlePaths.join(" and ")}; bundles in parity (${Object.keys(bundles[0][1]).length} keys each); ` +
      `string tables in parity (${STRING_IDS.length} StringIds); no raw display literals in src/webview/src`,
  );
}

const invokedAsScript = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`check-i18n: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

#!/usr/bin/env node
// check-i18n.mjs — manifest <-> l10n bundle parity check.
// Asserts every `%opencodePanel...%` placeholder referenced anywhere in
// package.json exists in BOTH l10n/bundle.l10n.json (en, source of truth)
// and l10n/bundle.l10n.zh-tw.json. Exits 1 on drift. Bare-bones for todo 1;
// todo 4 extends this with webview literal scanning.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bundlePaths = ["l10n/bundle.l10n.json", "l10n/bundle.l10n.zh-tw.json"];
const bundles = bundlePaths.map((rel) => [
  rel,
  JSON.parse(readFileSync(join(root, rel), "utf8")),
]);

const keyPattern = /%(opencodePanel(?:\.[A-Za-z0-9_-]+)+)%/g;
const referenced = new Set();

const walk = (value) => {
  if (typeof value === "string") {
    for (const match of value.matchAll(keyPattern)) referenced.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(walk);
    return;
  }
  if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
};

walk(manifest);

if (referenced.size === 0) {
  console.error("check-i18n: FAIL — no %opencodePanel...% keys found in package.json");
  process.exit(1);
}

let failures = 0;
const keys = [...referenced].sort();
for (const [rel, bundle] of bundles) {
  for (const key of keys) {
    if (!(key in bundle)) {
      console.error(`check-i18n: MISSING ${rel} <- ${key}`);
      failures += 1;
    } else if (typeof bundle[key] !== "string" || bundle[key].length === 0) {
      console.error(`check-i18n: EMPTY/INVALID ${rel} <- ${key}`);
      failures += 1;
    }
  }
}

const [enRel, en] = bundles[0];
const [zhRel, zh] = bundles[1];
for (const key of Object.keys(en)) {
  if (!(key in zh)) {
    console.error(`check-i18n: key in ${enRel} but not ${zhRel}: ${key}`);
    failures += 1;
  }
}
for (const key of Object.keys(zh)) {
  if (!(key in en)) {
    console.error(`check-i18n: key in ${zhRel} but not ${enRel}: ${key}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`check-i18n: FAIL — ${failures} drift(s) across ${keys.length} referenced key(s)`);
  process.exit(1);
}

console.log(
  `check-i18n: OK — ${keys.length} manifest key(s) present and non-empty in ` +
    `${bundlePaths.join(" and ")}; bundles in parity (${Object.keys(en).length} keys each)`,
);

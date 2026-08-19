#!/usr/bin/env node
// check-webview-clean.mjs — network-seam guard (plan todo 11). Exits 1 when
// any webview source file touches the network directly. Every webview↔server
// byte must cross the host proxy via the typed messenger; the ONLY file
// allowed to carry a request primitive is lib/messenger.ts itself.
//
// Scans src/webview/**/*.{ts,tsx,mts,cts} for:
//   - fetch(            (bare call, any binding name ending in fetch)
//   - new EventSource
//   - XMLHttpRequest
// Comment lines are NOT exempt: the seam rule is absolute, so even a comment
// suggesting a direct call is treated as drift.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEBVIEW_ROOT = join(root, "src", "webview");
const ALLOWLIST = new Set([join(WEBVIEW_ROOT, "lib", "messenger.ts")]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const PATTERNS = [
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "new EventSource", re: /\bnew\s+EventSource\b/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
];

export function scanSourceForNetworkCalls(source, relPath) {
  const hits = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of PATTERNS) {
      if (pattern.re.test(lines[index])) {
        hits.push({ file: relPath, line: index + 1, rule: pattern.name });
      }
    }
  }
  return hits;
}

export function scanWebviewForNetworkCalls(webviewRoot = WEBVIEW_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        SCANNED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf("."))) &&
        !ALLOWLIST.has(path)
      ) {
        files.push(path);
      }
    }
  };
  walk(webviewRoot);
  return files.flatMap((file) =>
    scanSourceForNetworkCalls(readFileSync(file, "utf8"), relative(webviewRoot, file)),
  );
}

function main() {
  const hits = scanWebviewForNetworkCalls();
  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`check-webview-clean: ${hit.file}:${hit.line} contains ${hit.rule}`);
    }
    console.error(
      `check-webview-clean: FAIL — ${hits.length} direct network call(s) in src/webview; ` +
        "route all traffic through lib/messenger.ts (the host proxy seam)",
    );
    process.exit(1);
  }
  console.log("check-webview-clean: OK — no direct network calls outside lib/messenger.ts");
}

const invokedAsScript = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  main();
}

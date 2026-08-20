#!/usr/bin/env node
/**
 * check-coverage.mjs — coverage-by-file gate (static import-graph walk).
 *
 * Strategy (no V8 instrumentation, no network, fully deterministic):
 *   1. Seeds  = every `src/**​/__tests__/*.test.ts(x)` file in the tree.
 *   2. Walk   = follow each seed's RELATIVE import graph (extensionless or
 *      `.js`-suffixed specifiers resolve to the TS module; also `export … from`,
 *      `import(…)` and `require(…)`). Every resolved module under src/ is a
 *      "covered" module.
 *   3. Enumerate = every module under src/host/**, src/server/**, src/shared/**
 *      EXCLUDING `**​/__tests__/**` and `*.d.ts`.
 *   4. Report  = text report to stdout; exit 1 listing any uncovered module.
 *
 * MINIMAL BARREL EXEMPTION RULE:
 *   A module whose executable content consists solely of re-export statements
 *   (`export … from "…"` / `export * from "…"`) is a pure barrel. A barrel is
 *   considered covered when at least one of its direct re-export targets is
 *   covered. Single pass — a barrel re-exporting only uncovered modules (or
 *   only other barrels) is reported as uncovered. This prevents a leaf-ward
 *   `index.ts` from failing the gate when its real modules are all tested,
 *   without letting an untested barrel hide untested leaves.
 *
 * DOCUMENTED EXEMPTIONS (see EXEMPTIONS below):
 *   Each entry names the file and the reason it cannot be covered by a specs
 *   import-graph without a production refactor. Keep this list EMPTY unless a
 *   module is genuinely untestable as-is; add an entry + flag it in the task
 *   report rather than weakening the gate.
 *
 * Usage:  node scripts/check-coverage.mjs
 * Exit:   0 = every in-scope module covered (or exempted); 1 = gaps printed.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/** Scopes the gate enforces (repo-relative). */
const SCOPES = ["src/host", "src/server", "src/shared"];

/**
 * Documented exemptions — repo-relative path → reason.
 * Empty by policy; an entry here must be justified in the task evidence log.
 */
const EXEMPTIONS = new Map([
  // ["src/host/example.ts", "why this cannot be covered without a refactor"],
]);

const IMPORT_PATTERNS = [
  // static: import ... from "spec" | export ... from "spec" | export * from "spec"
  /(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // side-effect: import "spec"
  /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g,
  // dynamic: import("spec")
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require("spec")
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Recursive fs walk — includes files not yet staged, no glob-magic edge cases. */
function walk(dirAbs, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs, predicate, out);
    } else if (predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function listSpecs() {
  const re = new RegExp(`${path.sep}__tests__${path.sep}[^${path.sep}]+\\.test\\.tsx?$`);
  return walk(SRC, (abs) => re.test(abs)).sort();
}

function listScopeModules(scopeRel) {
  return walk(path.join(ROOT, scopeRel), (abs) => /\.tsx?$/.test(abs)).map((abs) =>
    path.relative(ROOT, abs),
  );
}

function extractSpecifiers(source) {
  const specs = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specs.add(match[1]);
    }
  }
  return specs;
}

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

function resolveSpecifier(importerAbs, spec) {
  let base;
  if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(importerAbs), spec);
  } else if (spec.startsWith("src/")) {
    base = path.join(ROOT, spec);
  } else if (spec.startsWith("@/")) {
    base = path.join(SRC, spec.slice(2));
  } else {
    return null; // package specifier — outside the gate
  }

  // ".js suffix ⇢ TS module": prefer the TS twin of an ESM-style specifier.
  const candidates = [base];
  if (/\.jsx?$/.test(base)) {
    const stem = base.replace(/\.jsx?$/, "");
    candidates.unshift(...RESOLVE_EXTENSIONS.map((ext) => stem + ext));
  } else if (!/\.\w+$/.test(base)) {
    candidates.push(...RESOLVE_EXTENSIONS.map((ext) => base + ext));
    candidates.push(...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)));
  }

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function isPureBarrel(source) {
  const lines = stripComments(source)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  return lines.every((line) => /^export\s+.*\bfrom\s*['"]/.test(line) || /^export\s*\*/.test(line));
}

function main() {
  const seeds = listSpecs();

  const covered = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop();
    if (covered.has(current)) continue;
    covered.add(current);
    let source;
    try {
      source = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    for (const spec of extractSpecifiers(source)) {
      const resolved = resolveSpecifier(current, spec);
      if (resolved !== null && resolved.startsWith(SRC) && !covered.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  const enumerated = SCOPES.flatMap(listScopeModules)
    .filter((rel) => !rel.includes(`__tests__${path.sep}`))
    .filter((rel) => !rel.endsWith(".d.ts"))
    .sort();

  const uncovered = [];
  const exempted = [];
  for (const rel of enumerated) {
    const abs = path.join(ROOT, rel);
    if (covered.has(abs)) continue;
    if (EXEMPTIONS.has(rel)) {
      exempted.push(rel);
      continue;
    }
    // Barrel exemption: pure barrel with at least one covered direct target.
    let barrelCovered = false;
    try {
      const source = readFileSync(abs, "utf8");
      if (isPureBarrel(source)) {
        for (const spec of extractSpecifiers(source)) {
          const target = resolveSpecifier(abs, spec);
          if (target !== null && covered.has(target)) {
            barrelCovered = true;
            break;
          }
        }
      }
    } catch {
      // unreadable files fall through to uncovered
    }
    if (!barrelCovered) uncovered.push(rel);
  }

  const report = [];
  report.push("coverage-by-file gate (static import-graph walk)");
  report.push(`seeds:     ${seeds.length} spec files under src/**/__tests__`);
  report.push(`walk:      ${covered.size} reachable modules (incl. specs + out-of-scope)`);
  report.push(`enforced:  ${enumerated.length} modules under ${SCOPES.join(", ")}`);
  report.push(`exempted:  ${exempted.length} (documented in EXEMPTIONS)`);
  for (const rel of exempted) {
    report.push(`  ~ ${rel} — ${EXEMPTIONS.get(rel)}`);
  }
  report.push(`uncovered: ${uncovered.length}`);
  for (const rel of uncovered) {
    report.push(`  - ${rel}`);
  }
  console.log(report.join("\n"));

  if (uncovered.length > 0) {
    console.error(`\ncheck-coverage: FAIL — ${uncovered.length} module(s) lack a covering spec`);
    process.exit(1);
  }
  console.log("\ncheck-coverage: OK — every in-scope module is covered");
}

main();

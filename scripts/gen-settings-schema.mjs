#!/usr/bin/env node
// gen-settings-schema.mjs — single source of truth for settings-page keys
// (plan todo 21). Generates src/shared/settingsSchema.ts FROM
// package.json `contributes.configuration.properties` (keys, types, defaults,
// description refs) + the sibling l10n bundles (localized description text
// resolved from each key's "%opencodePanel.config.*.markdownDescription%").
//
//   node scripts/gen-settings-schema.mjs           # regenerate (default)
//   node scripts/gen-settings-schema.mjs --check   # exit 1 on drift (CI/QA)
//   node scripts/gen-settings-schema.mjs --manifest <path>  # alt manifest (QA)
//
// DRIFT INPUTS (all fail the run, exit 1):
//   - a manifest key missing from FIELD_UI below (classify it here), or a
//     FIELD_UI entry with no manifest key (a renamed/removed setting);
//   - a --check byte mismatch between the regenerated text and the on-disk
//     schema (forgot to re-run after editing package.json / the bundles).
// UI-only metadata (section grouping, numeric bounds, text format rules) is
// held in FIELD_UI because the manifest declares none of it; adding a key to
// package.json without classifying it here is a hard failure, never a silent
// default — that is the drift contract.
// allow: SIZE_OK — code generator: most lines are the emitted artifact's
// template literal (data), and splitting the emitter adds no review surface.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = join(root, "src/shared/settingsSchema.ts");

// ---------------------------------------------------------------------------
// Per-key UI metadata (the ONLY hand-maintained table; see drift contract).
// format: text (any, "" ok) | non-blank | endpoint ("" or whitespace-free) |
// hostname (non-blank, no whitespace, no "/") | semver (X.Y.Z).
// ---------------------------------------------------------------------------
const FIELD_UI = {
  serverUrl: { section: "server", format: "endpoint" },
  port: { section: "server", min: 1, max: 65535, integer: true },
  hostname: { section: "server", format: "hostname" },
  binaryPath: { section: "server", format: "non-blank" },
  serverArgs: { section: "server" },
  autoStartServer: { section: "server" },
  minimumServerVersion: { section: "server", format: "semver" },
  debugLogs: { section: "diagnostics" },
  chatFontFamily: { section: "appearance" },
  chatFontSize: { section: "appearance", min: 0, max: 72, integer: true },
};

const TYPE_MAP = { string: "string", number: "number", boolean: "boolean" };
const TS_TYPE = { string: "string", number: "number", boolean: "boolean", "string-array": "readonly string[]" };

function fail(message) {
  console.error(`gen-settings-schema: FAIL — ${message}`);
  process.exit(1);
}

function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const properties = manifest.contributes?.configuration?.properties;
  if (properties === null || typeof properties !== "object") {
    fail("manifest carries no contributes.configuration.properties");
  }
  return properties;
}

function fieldType(shortKey, entry) {
  const mapped = TYPE_MAP[entry.type];
  if (mapped !== undefined) return mapped;
  if (entry.type === "array" && entry.items?.type === "string") return "string-array";
  return fail(`unsupported type for opencodePanel.${shortKey}: ${JSON.stringify(entry.type)}`);
}

function descriptionText(shortKey, entry, bundles) {
  const ref = entry.markdownDescription;
  const match = /^%(opencodePanel\.config\..+\.markdownDescription)%$/.exec(typeof ref === "string" ? ref : "");
  if (match === null) {
    fail(`opencodePanel.${shortKey}: markdownDescription must be a %opencodePanel.config.*% ref`);
  }
  const key = match[1];
  const text = {};
  for (const [locale, bundle] of Object.entries(bundles)) {
    const value = bundle[key];
    if (typeof value !== "string" || value.length === 0) {
      fail(`bundle l10n/bundle.l10n${locale === "en" ? "" : `.${locale.toLowerCase()}`}.json lacks "${key}"`);
    }
    text[locale] = value;
  }
  return text;
}

function collectFields(manifestPath) {
  const properties = loadManifest(manifestPath);
  const bundles = {
    en: JSON.parse(readFileSync(join(root, "l10n/bundle.l10n.json"), "utf8")),
    zhTW: JSON.parse(readFileSync(join(root, "l10n/bundle.l10n.zh-tw.json"), "utf8")),
  };
  const manifestKeys = Object.keys(properties);
  const uiKeys = Object.keys(FIELD_UI);
  for (const key of manifestKeys) {
    const shortKey = key.replace(/^opencodePanel\./, "");
    if (!(shortKey in FIELD_UI)) {
      fail(`manifest key "${key}" is not classified in FIELD_UI — add its section/bounds to scripts/gen-settings-schema.mjs`);
    }
  }
  for (const key of uiKeys) {
    if (`opencodePanel.${key}` in properties === false) {
      fail(`FIELD_UI entry "${key}" has no matching opencodePanel.${key} key in the manifest — remove it or restore the setting`);
    }
  }
  return manifestKeys.map((key) => {
    const shortKey = key.replace(/^opencodePanel\./, "");
    const entry = properties[key];
    const ui = FIELD_UI[shortKey];
    if ("default" in entry === false) fail(`opencodePanel.${shortKey}: manifest key has no default`);
    return {
      key,
      shortKey,
      type: fieldType(shortKey, entry),
      defaultValue: entry.default,
      section: ui.section,
      ...(ui.min === undefined ? {} : { min: ui.min }),
      ...(ui.max === undefined ? {} : { max: ui.max }),
      ...(ui.integer === true ? { integer: true } : {}),
      ...(ui.format === undefined ? {} : { format: ui.format }),
      description: descriptionText(shortKey, entry, bundles),
    };
  });
}

// ---------------------------------------------------------------------------
// Emitters (deterministic — same manifest always yields the same bytes).
// ---------------------------------------------------------------------------

function emitField(field) {
  const lines = [
    `    key: ${JSON.stringify(field.key)},`,
    `    shortKey: ${JSON.stringify(field.shortKey)},`,
    `    type: ${JSON.stringify(field.type)},`,
    `    defaultValue: ${JSON.stringify(field.defaultValue)},`,
    `    section: ${JSON.stringify(field.section)},`,
  ];
  if (field.min !== undefined) lines.push(`    min: ${field.min},`);
  if (field.max !== undefined) lines.push(`    max: ${field.max},`);
  if (field.integer === true) lines.push(`    integer: true,`);
  if (field.format !== undefined) lines.push(`    format: ${JSON.stringify(field.format)},`);
  lines.push(
    `    description: {`,
    `      en: ${JSON.stringify(field.description.en)},`,
    `      zhTW: ${JSON.stringify(field.description.zhTW)},`,
    `    },`,
  );
  return `  {\n${lines.join("\n")}\n  },`;
}

function emitSchema(fields) {
  const sections = [...new Set(fields.map((field) => field.section))];
  const valueLines = fields.map((f) => `  readonly ${f.shortKey}: ${TS_TYPE[f.type]};`).join("\n");
  const defaultLines = fields
    .map((f) => `    ${f.shortKey}: ${JSON.stringify(f.defaultValue)},`)
    .join("\n");
  const COERCE_HELPER = { string: "coerceString", number: "coerceNumber", boolean: "coerceBoolean", "string-array": "coerceStringArray" };
  const coerceLines = fields
    .map((f) => `    ${f.shortKey}: ${COERCE_HELPER[f.type]}(record, ${JSON.stringify(f.shortKey)}, defaults.${f.shortKey}),`)
    .join("\n");
  const accessorLines = fields
    .map((f) => `  [${JSON.stringify(f.shortKey)}, (values: SettingsValues): SettingValue => values.${f.shortKey}],`)
    .join("\n");
  return `/**
 * GENERATED FILE — do not edit by hand (plan todo 21). Source of truth:
 * package.json \`contributes.configuration.properties\` (+ l10n bundles for
 * descriptions). Regenerate with \`node scripts/gen-settings-schema.mjs\`;
 * \`--check\` exits 1 when this file drifts from the manifest.
 */
// allow: SIZE_OK — generated data artifact; review the generator, not this file.
import type { StringId } from "./strings.js";

export const SETTING_SECTIONS = ${JSON.stringify(sections)} as const;
export type SettingSectionId = (typeof SETTING_SECTIONS)[number];

export type SettingValueType = "string" | "number" | "boolean" | "string-array";
export type SettingValue = string | number | boolean | readonly string[];
export type SettingTextFormat = "text" | "non-blank" | "endpoint" | "hostname" | "semver";
export type SettingScopeChoice = "global" | "workspace";

export interface SettingField {
  readonly key: string;
  readonly shortKey: string;
  readonly type: SettingValueType;
  readonly defaultValue: SettingValue;
  readonly section: SettingSectionId;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly format?: SettingTextFormat;
  readonly description: { readonly en: string; readonly zhTW: string };
}

/** One row per manifest key, in manifest order (single source of truth). */
export const SETTING_FIELDS: readonly SettingField[] = [
${fields.map(emitField).join("\n")}
];

/** Typed settings values; keys mirror the manifest short keys 1:1. */
export interface SettingsValues {
${valueLines}
}

export function defaultSettingsValues(): SettingsValues {
  return {
${defaultLines}
  };
}

export function settingFieldsForSection(section: SettingSectionId): readonly SettingField[] {
  return SETTING_FIELDS.filter((field) => field.section === section);
}

const FIELD_BY_SHORT_KEY: ReadonlyMap<string, SettingField> = new Map(
  SETTING_FIELDS.map((field) => [field.shortKey, field]),
);

export function fieldByShortKey(shortKey: string): SettingField | undefined {
  return FIELD_BY_SHORT_KEY.get(shortKey);
}

const VALUE_ACCESSORS: ReadonlyMap<string, (values: SettingsValues) => SettingValue> = new Map([
${accessorLines}
]);

/** Typed per-field read over a SettingsValues record (generated accessors). */
export function settingFieldValue(values: SettingsValues, field: SettingField): SettingValue {
  const accessor = VALUE_ACCESSORS.get(field.shortKey);
  return accessor === undefined ? field.defaultValue : accessor(values);
}

/** Label id for a field (settings.field.<shortKey>, provisioned in strings.ts). */
export function fieldLabelId(field: SettingField): StringId {
  return \`settings.field.\${field.shortKey}\` as StringId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(record: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function coerceNumber(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(record: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function coerceStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Boundary parse for the plain-record settings slices crossing the wire
 * (init.settings / getSettings.values): per manifest type, fallback to the
 * manifest default. Mirrors the todo-6 readPanelConfig semantics.
 */
export function coerceSettingsValues(raw: unknown): SettingsValues {
  const record: Readonly<Record<string, unknown>> = isRecord(raw) ? raw : {};
  const defaults = defaultSettingsValues();
  return {
${coerceLines}
  };
}

/**
 * Semantic validation for an already-typed value (both the host patch
 * validator and the webview draft store run this one rule source). Returns a
 * technical reason string, or null when the value is acceptable.
 */
export function validateFieldValue(field: SettingField, value: SettingValue): string | null {
  switch (field.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return \`\${field.shortKey}: must be a number\`;
      if (field.integer === true && !Number.isInteger(value)) return \`\${field.shortKey}: must be an integer\`;
      if (field.min !== undefined && value < field.min) return \`\${field.shortKey}: must be an integer between \${field.min} and \${field.max}\`;
      if (field.max !== undefined && value > field.max) return \`\${field.shortKey}: must be an integer between \${field.min} and \${field.max}\`;
      return null;
    }
    case "string": {
      if (typeof value !== "string") return \`\${field.shortKey}: must be a string\`;
      switch (field.format ?? "text") {
        case "text":
          return null;
        case "non-blank":
          return value.trim().length > 0 ? null : \`\${field.shortKey}: must not be blank\`;
        case "endpoint":
          return value.trim().length === 0 || !/\\s/.test(value)
            ? null
            : \`\${field.shortKey}: must be a URL without whitespace (credentials go to the password field)\`;
        case "hostname":
          return value.trim().length > 0 && !/[\\s/]/.test(value)
            ? null
            : \`\${field.shortKey}: must be a host name without whitespace or slashes\`;
        case "semver":
          return /^\\d+\\.\\d+\\.\\d+$/.test(value)
            ? null
            : \`\${field.shortKey}: must look like MAJOR.MINOR.PATCH (e.g. 1.2.3)\`;
      }
    }
    case "boolean":
      return typeof value === "boolean" ? null : \`\${field.shortKey}: must be a boolean\`;
    case "string-array":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? null
        : \`\${field.shortKey}: must be an array of strings\`;
  }
}
`;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const manifestFlag = args.indexOf("--manifest");
  const manifestPath = manifestFlag >= 0 ? resolve(args[manifestFlag + 1]) : join(root, "package.json");
  const fields = collectFields(manifestPath);
  const generated = emitSchema(fields);

  if (check) {
    const existing = readFileSync(SCHEMA_PATH, "utf8");
    if (existing === generated) {
      console.log(
        `gen-settings-schema: OK — src/shared/settingsSchema.ts matches ` +
          `${manifestPath === join(root, "package.json") ? "package.json" : manifestPath} (${fields.length} fields)`,
      );
      return;
    }
    const existingKeys = [...existing.matchAll(/    shortKey: "([^"]+)"/g)].map((m) => m[1]);
    const generatedKeys = fields.map((field) => field.shortKey);
    console.error("gen-settings-schema: FAIL — schema drift detected");
    console.error(`  on-disk shortKeys:    ${JSON.stringify(existingKeys)}`);
    console.error(`  regenerated shortKeys: ${JSON.stringify(generatedKeys)}`);
    const oldLines = existing.split("\n");
    const newLines = generated.split("\n");
    const firstDiff = newLines.findIndex((line, index) => line !== oldLines[index]);
    if (firstDiff >= 0) {
      console.error(`  first divergence at line ${firstDiff + 1}:`);
      console.error(`    on-disk:     ${oldLines[firstDiff] ?? "<missing>"}`);
      console.error(`    regenerated: ${newLines[firstDiff] ?? "<missing>"}`);
    }
    console.error("  re-run: node scripts/gen-settings-schema.mjs");
    process.exit(1);
  }

  writeFileSync(SCHEMA_PATH, generated);
  console.log(`gen-settings-schema: wrote src/shared/settingsSchema.ts (${fields.length} fields)`);
}

main();

/**
 * Declarative spec for the opencode.json tab (plan T4a): the tier-1 / tier-2
 * section mapping over the full verified config inventory (36 top-level keys,
 * cross-checked against https://opencode.ai/config.json — 32 inventory keys
 * plus the 4 schema-deprecated ones `reference` / `autoshare` / `mode` /
 * `layout`). Purely data except for the bespoke-section component refs from
 * opencodeSections.tsx (the deferred-use import cycle documented there).
 * Tier-1 sections render open; tier-2 behind the Advanced disclosure.
 */

import type { SpecSection } from "./configFormRenderer.js";
import type { SpecField } from "./configSpecDispatch.js";
import {
  AgentsRecords,
  CommandRecords,
  ExperimentalSection,
  FormatterSection,
  GeneralSection,
  LspSection,
  McpRecords,
  PermissionSection,
  ProviderRecords,
  ReferencesRecords,
  SchemaMetaSection,
  ToolsSection,
} from "./opencodeSections.js";

/** General-section fields before the bespoke autoupdate control. */
export const GENERAL_FIELDS_HEAD: readonly SpecField[] = [
  { id: "cfg.f.model", path: ["model"], kind: "model" },
  { id: "cfg.f.smallModel", path: ["small_model"], kind: "model" },
  { id: "cfg.f.defaultAgent", path: ["default_agent"], kind: "text" },
];

/** General-section fields after the autoupdate control (chips follow). */
export const GENERAL_FIELDS_TAIL: readonly SpecField[] = [
  { id: "cfg.f.share", path: ["share"], kind: "select", options: ["manual", "auto", "disabled"] },
  { id: "cfg.f.snapshot", path: ["snapshot"], kind: "toggle" },
  { id: "cfg.f.instructions", path: ["instructions"], kind: "list" },
];

/** tool_output bounds rendered inside the tools section. */
export const TOOLS_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.maxLines", path: ["tool_output", "max_lines"], kind: "number" },
  { id: "cfg.f.maxBytes", path: ["tool_output", "max_bytes"], kind: "number" },
];

/** Scalar experimental toggles/bounds (policies is bespoke — an array). */
export const EXPERIMENTAL_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.disablePasteSummary", path: ["experimental", "disable_paste_summary"], kind: "toggle" },
  { id: "cfg.f.batchTool", path: ["experimental", "batch_tool"], kind: "toggle" },
  { id: "cfg.f.openTelemetry", path: ["experimental", "openTelemetry"], kind: "toggle" },
  { id: "cfg.f.primaryTools", path: ["experimental", "primary_tools"], kind: "list" },
  { id: "cfg.f.continueLoopOnDeny", path: ["experimental", "continue_loop_on_deny"], kind: "toggle" },
  { id: "cfg.f.mcpTimeout", path: ["experimental", "mcp_timeout"], kind: "number" },
];

export const OPENCODE_SPEC: readonly SpecSection[] = [
  // --- Tier 1: always visible ------------------------------------------------
  { id: "cfg.sec.oc.general", tier: 1, component: GeneralSection },
  {
    id: "cfg.sec.oc.plugins",
    tier: 1,
    fields: [{ id: "cfg.f.plugin", path: ["plugin"], kind: "list" }],
  },
  { id: "cfg.sec.oc.permission", tier: 1, component: PermissionSection },
  { id: "cfg.sec.oc.agents", tier: 1, component: AgentsRecords },
  { id: "cfg.sec.oc.mcp", tier: 1, component: McpRecords },
  { id: "cfg.sec.oc.providers", tier: 1, component: ProviderRecords },
  // --- Tier 2: behind the Advanced disclosure ---------------------------------
  {
    id: "cfg.sec.oc.runtime",
    tier: 2,
    fields: [
      { id: "cfg.f.shell", path: ["shell"], kind: "text" },
      { id: "cfg.f.logLevel", path: ["logLevel"], kind: "select", options: ["DEBUG", "INFO", "WARN", "ERROR"] },
      { id: "cfg.f.username", path: ["username"], kind: "text" },
      { id: "cfg.f.subagentDepth", path: ["subagent_depth"], kind: "number" },
    ],
  },
  {
    id: "cfg.sec.oc.server",
    tier: 2,
    fields: [
      { id: "cfg.f.port", path: ["server", "port"], kind: "number" },
      { id: "cfg.f.hostname", path: ["server", "hostname"], kind: "text" },
      { id: "cfg.f.mdns", path: ["server", "mdns"], kind: "toggle" },
      { id: "cfg.f.mdnsDomain", path: ["server", "mdnsDomain"], kind: "text" },
      { id: "cfg.f.cors", path: ["server", "cors"], kind: "list" },
    ],
  },
  { id: "cfg.sec.oc.commands", tier: 2, component: CommandRecords },
  { id: "cfg.sec.oc.formatter", tier: 2, component: FormatterSection },
  { id: "cfg.sec.oc.lsp", tier: 2, component: LspSection },
  {
    id: "cfg.sec.oc.watcher",
    tier: 2,
    fields: [{ id: "cfg.f.ignore", path: ["watcher", "ignore"], kind: "list" }],
  },
  { id: "cfg.sec.oc.tools", tier: 2, component: ToolsSection },
  {
    id: "cfg.sec.oc.compaction",
    tier: 2,
    fields: [
      { id: "cfg.f.auto", path: ["compaction", "auto"], kind: "toggle" },
      { id: "cfg.f.prune", path: ["compaction", "prune"], kind: "toggle" },
      { id: "cfg.f.tailTurns", path: ["compaction", "tail_turns"], kind: "number" },
      { id: "cfg.f.preserveRecentTokens", path: ["compaction", "preserve_recent_tokens"], kind: "number" },
      { id: "cfg.f.reserved", path: ["compaction", "reserved"], kind: "number" },
    ],
  },
  {
    id: "cfg.sec.oc.attachment",
    tier: 2,
    fields: [
      { id: "cfg.f.autoResize", path: ["attachment", "image", "auto_resize"], kind: "toggle" },
      { id: "cfg.f.maxWidth", path: ["attachment", "image", "max_width"], kind: "number" },
      { id: "cfg.f.maxHeight", path: ["attachment", "image", "max_height"], kind: "number" },
      { id: "cfg.f.maxBase64Bytes", path: ["attachment", "image", "max_base64_bytes"], kind: "number" },
    ],
  },
  { id: "cfg.sec.oc.experimental", tier: 2, component: ExperimentalSection },
  {
    id: "cfg.sec.oc.enterprise",
    tier: 2,
    fields: [{ id: "cfg.f.url", path: ["enterprise", "url"], kind: "text" }],
  },
  {
    id: "cfg.sec.oc.skills",
    tier: 2,
    fields: [
      { id: "cfg.f.paths", path: ["skills", "paths"], kind: "list" },
      { id: "cfg.f.urls", path: ["skills", "urls"], kind: "list" },
    ],
  },
  { id: "cfg.sec.oc.references", tier: 2, component: ReferencesRecords },
  { id: "cfg.sec.oc.schema", tier: 2, component: SchemaMetaSection },
];

/**
 * Every spec-known top-level key (inventory-verified). Drives the tab's
 * unknown-keys read-only notice: topLevelKeys(draft) minus this set minus
 * the deprecated set. The invented old-tab keys (temperature, limit.context,
 * researchDepth, orchestrationMode, autoVerify) are deliberately absent.
 */
export const OPENCODE_KNOWN_TOP_LEVEL: ReadonlySet<string> = new Set([
  "$schema",
  "_migrations",
  "model",
  "small_model",
  "default_agent",
  "autoupdate",
  "share",
  "snapshot",
  "plugin",
  "enabled_providers",
  "disabled_providers",
  "instructions",
  "permission",
  "agent",
  "mcp",
  "provider",
  "command",
  "formatter",
  "lsp",
  "references",
  "shell",
  "logLevel",
  "username",
  "subagent_depth",
  "server",
  "watcher",
  "tools",
  "compaction",
  "tool_output",
  "attachment",
  "experimental",
  "enterprise",
  "skills",
]);

/**
 * Deprecated top-level keys surfaced by the read-only deprecated notice —
 * never editable here, never created by edits. `reference` / `autoshare` /
 * `mode` / `layout` exist in the schema as @deprecated; `theme` / `keybinds`
 * / `tui` are gone from the schema entirely (legacy TUI configs).
 */
export const OPENCODE_DEPRECATED_TOP_LEVEL: readonly string[] = [
  "reference",
  "autoshare",
  "mode",
  "layout",
  "theme",
  "keybinds",
  "tui",
];

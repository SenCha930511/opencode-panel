// i18n-allow-literal — data module: option/enumeration strings and block key
// names are machine data rendered through {value} expressions, never JSX copy.
/**
 * omo.jsonc form spec (plan T4b): the full two-tier inventory for the
 * OpenCode-plugin HALF of omo.jsonc. Every edit path inside the form is
 * rooted at the LITERAL "[opencode]" block key (the real ~/.omo/omo.jsonc
 * shape) — the only exceptions live inside the shared-base bespoke section,
 * which edits top-level keys OUTSIDE the block by design.
 *
 * Tier 1 (visible): agents / categories / disabled_* chips.
 * Tier 2 (one advanced disclosure): every remaining documented block key —
 * typed objects declaratively; freeform/union subtrees ride the bespoke
 * component sections in omoSections.tsx. Facts verified against the live omo
 * schema enumeration (omo-config-core config.ts + configuration.md, dev
 * branch, 2026-08-21).
 */

import { isRecord } from "../../../shared/protocol.js";
import type { StringId } from "../../../shared/strings.js";
import type { SpecSection } from "./configFormRenderer.js";
import {
  AgentsRecords,
  BackgroundTaskFields,
  CategoriesRecords,
  ClaudeCodeFields,
  DisabledChips,
  OtherAdvancedFields,
  RuntimeFallbackFields,
  SharedBaseSection,
} from "./omoSections.js";

/** The literal root key omo.jsonc nests all OpenCode-plugin keys under. */
export const OMO_BLOCK_KEY = "[opencode]";

const B: readonly [string] = [OMO_BLOCK_KEY];

/** Built-in hooks (disabled_hooks enum; configuration.md#hooks). */
export const OMO_HOOKS: readonly string[] = [
  "todo-continuation-enforcer", "session-notification", "comment-checker", "tool-output-truncator",
  "question-label-truncator", "directory-agents-injector", "directory-readme-injector",
  "empty-task-response-detector", "think-mode", "model-fallback", "anthropic-context-window-limit-recovery",
  "preemptive-compaction", "rules-injector", "background-notification", "auto-update-checker",
  "codegraph-bootstrap", "ast-grep-sg-provision", "startup-toast", "keyword-detector",
  "agent-usage-reminder", "non-interactive-env", "interactive-bash-session", "tool-pair-validator",
  "monitor-status-injector", "goal", "category-skill-reminder", "compaction-context-injector",
  "compaction-todo-preserver", "claude-code-hooks", "auto-slash-command", "edit-error-recovery",
  "json-error-recovery", "delegate-task-retry", "prometheus-md-only", "sisyphus-junior-notepad",
  "team-tool-gating", "no-sisyphus-gpt", "no-hephaestus-non-gpt", "hephaestus-agents-md-injector",
  "start-work", "atlas", "unstable-agent-babysitter", "task-resume-info", "stop-continuation-guard",
  "tasks-todowrite-disabler", "runtime-fallback", "write-existing-file-guard", "notepad-write-guard",
  "bash-file-read-guard", "hashline-read-enhancer", "read-image-resizer", "todo-description-override",
  "webfetch-redirect-guard", "fsync-skip-warning", "plan-format-validator", "legacy-plugin-toast",
];

/** disabled_commands enum (handoff intentionally NOT in the omo enum). */
export const OMO_COMMANDS: readonly string[] = [
  "goal", "refactor", "start-work", "stop-continuation", "remove-ai-slops", "hyperplan",
];

/** Built-in MCPs (disabled_mcps enum). */
export const OMO_MCPS: readonly string[] = ["websearch", "context7", "grep_app", "lsp", "codegraph"];

/** Built-in agent names (disabled_agents chips baseline). */
export const OMO_AGENTS: readonly string[] = [
  "sisyphus", "hephaestus", "prometheus", "oracle", "librarian", "explore",
  "multimodal-looker", "metis", "momus", "atlas", "sisyphus-junior",
];

/** Built-in skills (disabled_skills chips baseline). */
export const OMO_SKILLS: readonly string[] = [
  "playwright", "playwright-cli", "agent-browser", "dev-browser", "git-master", "frontend",
  "review-work", "remove-ai-slops", "init-deep", "debugging", "security-research",
  "security-review", "visual-qa", "team-mode",
];

export interface OmoDisabledField {
  readonly key: string;
  readonly label: StringId;
  readonly options: readonly string[];
}

/** The seven disabled_* lists of the disabled tier-1 section. */
export const OMO_DISABLED_FIELDS: readonly OmoDisabledField[] = [
  { key: "disabled_hooks", label: "cfg.f.disabledHooks", options: OMO_HOOKS },
  { key: "disabled_commands", label: "cfg.f.disabledCommands", options: OMO_COMMANDS },
  { key: "disabled_agents", label: "cfg.f.disabledAgents", options: OMO_AGENTS },
  { key: "disabled_skills", label: "cfg.f.disabledSkills", options: OMO_SKILLS },
  { key: "disabled_mcps", label: "cfg.f.disabledMcps", options: OMO_MCPS },
  { key: "disabled_providers", label: "cfg.f.disabledProviders", options: [] },
  { key: "disabled_tools", label: "cfg.f.disabledTools", options: [] },
];

/**
 * Every key the form knows inside the [opencode] block — the unknown-keys
 * notice diffs the live block keys against this set. Includes keys edited
 * only inside bespoke component sections and the in-block $schema.
 */
export const OMO_KNOWN_BLOCK_KEYS: readonly string[] = [
  "$schema",
  "agents", "agent_definitions", "agent_order", "categories",
  "background_task", "sisyphus_agent", "sisyphus", "skills", "memory",
  "disabled_hooks", "disabled_commands", "disabled_agents", "disabled_skills",
  "disabled_mcps", "disabled_providers", "disabled_tools",
  "browser_automation_engine", "tmux", "git_master", "comment_checker", "notification",
  "codegraph", "runtime_fallback", "model_capabilities", "hashline_edit", "experimental",
  "telemetry", "mcp_env_allowlist", "ralph_loop", "team_mode", "monitor", "start_work",
  "goal", "openclaw", "babysitting", "i18n", "keyword_detector", "claude_code",
  "websearch", "tui", "new_task_system_enabled", "default_mode", "default_run_agent",
  "model_fallback", "auto_update", "models", "task", "teams",
];

/** Top-level keys that form the shared base (outside the [opencode] block). */
export const OMO_SHARED_BASE_KEYS: readonly string[] = [
  "agents", "categories", "codegraph", "git_master", "task", "teams", "models", "memory", "telemetry",
];

export const OMO_SPEC: readonly SpecSection[] = [
  // -- Tier 1 --------------------------------------------------------------
  { id: "cfg.sec.omo.agents", tier: 1, component: AgentsRecords },
  { id: "cfg.sec.omo.categories", tier: 1, component: CategoriesRecords },
  { id: "cfg.sec.omo.disabled", tier: 1, component: DisabledChips },
  // -- Tier 2 --------------------------------------------------------------
  { id: "cfg.sec.omo.backgroundTask", tier: 2, component: BackgroundTaskFields },
  {
    id: "cfg.sec.omo.sisyphus",
    tier: 2,
    fields: [
      { id: "cfg.f.disabled", path: [...B, "sisyphus_agent", "disabled"], kind: "toggle" },
      { id: "cfg.f.tdd", path: [...B, "sisyphus_agent", "tdd"], kind: "toggle" },
      { id: "cfg.f.defaultBuilderEnabled", path: [...B, "sisyphus_agent", "default_builder_enabled"], kind: "toggle" },
      { id: "cfg.f.plannerEnabled", path: [...B, "sisyphus_agent", "planner_enabled"], kind: "toggle" },
      { id: "cfg.f.replacePlan", path: [...B, "sisyphus_agent", "replace_plan"], kind: "toggle" },
      { id: "cfg.f.storagePath", path: [...B, "sisyphus", "tasks", "storage_path"], kind: "text" },
      { id: "cfg.f.taskListId", path: [...B, "sisyphus", "tasks", "task_list_id"], kind: "text" },
      { id: "cfg.f.claudeCodeCompat", path: [...B, "sisyphus", "tasks", "claude_code_compat"], kind: "toggle" },
    ],
  },
  {
    id: "cfg.sec.omo.memory",
    tier: 2,
    fields: [
      { id: "cfg.f.enabled", path: [...B, "memory", "enabled"], kind: "toggle" },
      { id: "cfg.f.agent", path: [...B, "memory", "agent"], kind: "text" },
      { id: "cfg.f.toolExposure", path: [...B, "memory", "tool_exposure"], kind: "select", options: ["direct", "search"] },
      { id: "cfg.f.compileWarnTokens", path: [...B, "memory", "compile_warn_tokens"], kind: "number" },
      { id: "cfg.f.enabled", path: [...B, "memory", "reflection", "enabled"], kind: "toggle" },
      { id: "cfg.f.stepCount", path: [...B, "memory", "reflection", "trigger", "step_count"], kind: "number" },
      { id: "cfg.f.onCompaction", path: [...B, "memory", "reflection", "trigger", "on_compaction"], kind: "toggle" },
      { id: "cfg.f.merge", path: [...B, "memory", "reflection", "merge"], kind: "select", options: ["auto", "integration"] },
      { id: "cfg.f.category", path: [...B, "memory", "reflection", "category"], kind: "text" },
      { id: "cfg.f.timeoutMinutes", path: [...B, "memory", "reflection", "timeout_minutes"], kind: "number" },
      { id: "cfg.f.sandbox", path: [...B, "memory", "reflection", "sandbox"], kind: "select", options: ["auto", "required", "off"] },
      { id: "cfg.f.enabled", path: [...B, "memory", "nudge", "enabled"], kind: "toggle" },
      { id: "cfg.f.everyUserTurns", path: [...B, "memory", "nudge", "every_user_turns"], kind: "number" },
      { id: "cfg.f.enabled", path: [...B, "memory", "facts", "enabled"], kind: "toggle" },
      { id: "cfg.f.debounceSettles", path: [...B, "memory", "facts", "debounce_settles"], kind: "number" },
      { id: "cfg.f.enabled", path: [...B, "memory", "dream", "enabled"], kind: "toggle" },
      { id: "cfg.f.idleMinutes", path: [...B, "memory", "dream", "idle_minutes"], kind: "number" },
      { id: "cfg.f.minHoursBetween", path: [...B, "memory", "dream", "min_hours_between"], kind: "number" },
      { id: "cfg.f.shutdownLaunch", path: [...B, "memory", "dream", "shutdown_launch"], kind: "toggle" },
      { id: "cfg.f.autoSelectMax", path: [...B, "memory", "dream", "auto_select_max"], kind: "number" },
      { id: "cfg.f.autoSelectMaxChars", path: [...B, "memory", "dream", "auto_select_max_chars"], kind: "number" },
      { id: "cfg.f.enabled", path: [...B, "memory", "people", "enabled"], kind: "toggle" },
      { id: "cfg.f.maxEntries", path: [...B, "memory", "people", "max_entries"], kind: "number" },
      { id: "cfg.f.maxEntryChars", path: [...B, "memory", "people", "max_entry_chars"], kind: "number" },
      { id: "cfg.f.editNotice", path: [...B, "memory", "soul", "edit_notice"], kind: "toggle" },
      { id: "cfg.f.enabled", path: [...B, "memory", "write_notice", "enabled"], kind: "toggle" },
      { id: "cfg.f.enabled", path: [...B, "memory", "sync", "enabled"], kind: "toggle" },
      { id: "cfg.f.remote", path: [...B, "memory", "sync", "remote"], kind: "text" },
      { id: "cfg.f.enabled", path: [...B, "memory", "search", "enabled"], kind: "toggle" },
    ],
  },
  { id: "cfg.sec.omo.runtimeFallback", tier: 2, component: RuntimeFallbackFields },
  {
    id: "cfg.sec.omo.modelCapabilities",
    tier: 2,
    fields: [
      { id: "cfg.f.enabled", path: [...B, "model_capabilities", "enabled"], kind: "toggle" },
      { id: "cfg.f.autoRefreshOnStart", path: [...B, "model_capabilities", "auto_refresh_on_start"], kind: "toggle" },
      { id: "cfg.f.refreshTimeoutMs", path: [...B, "model_capabilities", "refresh_timeout_ms"], kind: "number" },
      { id: "cfg.f.sourceUrl", path: [...B, "model_capabilities", "source_url"], kind: "text" },
    ],
  },
  {
    id: "cfg.sec.omo.tmux",
    tier: 2,
    fields: [
      { id: "cfg.f.enabled", path: [...B, "tmux", "enabled"], kind: "toggle" },
      {
        id: "cfg.f.layout",
        path: [...B, "tmux", "layout"],
        kind: "select",
        options: ["main-vertical", "main-horizontal", "tiled", "even-horizontal", "even-vertical"],
      },
      { id: "cfg.f.mainPaneSize", path: [...B, "tmux", "main_pane_size"], kind: "number" },
      { id: "cfg.f.mainPaneMinWidth", path: [...B, "tmux", "main_pane_min_width"], kind: "number" },
      { id: "cfg.f.agentPaneMinWidth", path: [...B, "tmux", "agent_pane_min_width"], kind: "number" },
      { id: "cfg.f.isolation", path: [...B, "tmux", "isolation"], kind: "select", options: ["inline", "window", "session"] },
    ],
  },
  {
    id: "cfg.sec.omo.gitMaster",
    tier: 2,
    fields: [
      { id: "cfg.f.commitFooter", path: [...B, "git_master", "commit_footer"], kind: "text" },
      { id: "cfg.f.includeCoAuthoredBy", path: [...B, "git_master", "include_co_authored_by"], kind: "toggle" },
      { id: "cfg.f.gitEnvPrefix", path: [...B, "git_master", "git_env_prefix"], kind: "text" },
    ],
  },
  {
    id: "cfg.sec.omo.browserAutomation",
    tier: 2,
    fields: [
      {
        id: "cfg.f.provider",
        path: [...B, "browser_automation_engine", "provider"],
        kind: "select",
        options: ["playwright", "agent-browser", "dev-browser", "playwright-cli"],
      },
      { id: "cfg.f.playwrightMcpArgs", path: [...B, "browser_automation_engine", "playwright_mcp_args"], kind: "list" },
    ],
  },
  {
    id: "cfg.sec.omo.codegraph",
    tier: 2,
    fields: [
      { id: "cfg.f.enabled", path: [...B, "codegraph", "enabled"], kind: "toggle" },
      { id: "cfg.f.autoInit", path: [...B, "codegraph", "auto_init"], kind: "toggle" },
      { id: "cfg.f.autoProvision", path: [...B, "codegraph", "auto_provision"], kind: "toggle" },
      { id: "cfg.f.daemon", path: [...B, "codegraph", "daemon"], kind: "toggle" },
      { id: "cfg.f.telemetry", path: [...B, "codegraph", "telemetry"], kind: "toggle" },
      { id: "cfg.f.installDir", path: [...B, "codegraph", "install_dir"], kind: "text" },
      { id: "cfg.f.watchDebounceMs", path: [...B, "codegraph", "watch_debounce_ms"], kind: "number" },
      { id: "cfg.f.excludedRoots", path: [...B, "codegraph", "excluded_roots"], kind: "list" },
    ],
  },
  { id: "cfg.sec.omo.claudeCode", tier: 2, component: ClaudeCodeFields },
  {
    id: "cfg.sec.omo.integrations",
    tier: 2,
    fields: [
      { id: "cfg.f.customPrompt", path: [...B, "comment_checker", "custom_prompt"], kind: "text" },
      { id: "cfg.f.forceEnable", path: [...B, "notification", "force_enable"], kind: "toggle" },
      { id: "cfg.f.mcpEnvAllowlist", path: [...B, "mcp_env_allowlist"], kind: "list" },
      { id: "cfg.f.hashlineEdit", path: [...B, "hashline_edit"], kind: "toggle" },
      { id: "cfg.f.telemetry", path: [...B, "telemetry"], kind: "toggle" },
    ],
  },
  {
    id: "cfg.sec.omo.experimental",
    tier: 2,
    fields: [
      { id: "cfg.f.truncateAllToolOutputs", path: [...B, "experimental", "truncate_all_tool_outputs"], kind: "toggle" },
      { id: "cfg.f.aggressiveTruncation", path: [...B, "experimental", "aggressive_truncation"], kind: "toggle" },
      { id: "cfg.f.disableOmoEnv", path: [...B, "experimental", "disable_omo_env"], kind: "toggle" },
      { id: "cfg.f.taskSystem", path: [...B, "experimental", "task_system"], kind: "toggle" },
      { id: "cfg.f.enabled", path: [...B, "experimental", "dynamic_context_pruning", "enabled"], kind: "toggle" },
      {
        id: "cfg.f.notification",
        path: [...B, "experimental", "dynamic_context_pruning", "notification"],
        kind: "select",
        options: ["off", "minimal", "detailed"],
      },
      {
        id: "cfg.f.enabled",
        path: [...B, "experimental", "dynamic_context_pruning", "turn_protection", "enabled"],
        kind: "toggle",
      },
      {
        id: "cfg.f.turns",
        path: [...B, "experimental", "dynamic_context_pruning", "turn_protection", "turns"],
        kind: "number",
      },
      {
        id: "cfg.f.protectedTools",
        path: [...B, "experimental", "dynamic_context_pruning", "protected_tools"],
        kind: "list",
      },
      {
        id: "cfg.f.enabled",
        path: [...B, "experimental", "dynamic_context_pruning", "strategies", "deduplication", "enabled"],
        kind: "toggle",
      },
      {
        id: "cfg.f.enabled",
        path: [...B, "experimental", "dynamic_context_pruning", "strategies", "supersede_writes", "enabled"],
        kind: "toggle",
      },
      {
        id: "cfg.f.aggressive",
        path: [...B, "experimental", "dynamic_context_pruning", "strategies", "supersede_writes", "aggressive"],
        kind: "toggle",
      },
      {
        id: "cfg.f.enabled",
        path: [...B, "experimental", "dynamic_context_pruning", "strategies", "purge_errors", "enabled"],
        kind: "toggle",
      },
      {
        id: "cfg.f.turns",
        path: [...B, "experimental", "dynamic_context_pruning", "strategies", "purge_errors", "turns"],
        kind: "number",
      },
      { id: "cfg.f.preemptiveCompaction", path: [...B, "experimental", "preemptive_compaction"], kind: "toggle" },
      { id: "cfg.f.pluginLoadTimeoutMs", path: [...B, "experimental", "plugin_load_timeout_ms"], kind: "number" },
      { id: "cfg.f.safeHookCreation", path: [...B, "experimental", "safe_hook_creation"], kind: "toggle" },
      { id: "cfg.f.modelFallbackTitle", path: [...B, "experimental", "model_fallback_title"], kind: "toggle" },
      { id: "cfg.f.maxTools", path: [...B, "experimental", "max_tools"], kind: "number" },
      {
        id: "cfg.f.disableLiveParentWakeRouting",
        path: [...B, "experimental", "disable_live_parent_wake_routing"],
        kind: "toggle",
      },
    ],
  },
  { id: "cfg.sec.omo.other", tier: 2, component: OtherAdvancedFields },
  { id: "cfg.sec.omo.shared", tier: 2, component: SharedBaseSection },
];

const DEPRECATED_ENTRY_KEYS: readonly string[] = ["variant", "reasoningEffort"];
const DEPRECATED_MAP_KEYS: readonly string[] = ["agents", "categories"];

/**
 * Deprecated agent/category entry keys under the [opencode] block, rendered
 * as `agents.<name>.variant`-style paths. Display-only — edits never create
 * or remove them; unknown entry shapes survive by construction.
 */
export function collectDeprecatedKeys(tree: unknown): readonly string[] {
  if (!isRecord(tree)) return [];
  const block = tree[OMO_BLOCK_KEY];
  if (!isRecord(block)) return [];
  const hits: string[] = [];
  for (const mapKey of DEPRECATED_MAP_KEYS) {
    const entries = block[mapKey];
    if (!isRecord(entries)) continue;
    for (const [name, entry] of Object.entries(entries)) {
      if (!isRecord(entry)) continue;
      for (const key of DEPRECATED_ENTRY_KEYS) {
        if (key in entry) hits.push(`${mapKey}.${name}.${key}`);
      }
    }
  }
  return hits;
}

/** Keys inside the [opencode] block the spec does not edit (preserved untouched). */
export function collectUnknownBlockKeys(tree: unknown): readonly string[] {
  if (!isRecord(tree)) return [];
  const block = tree[OMO_BLOCK_KEY];
  if (!isRecord(block)) return [];
  return Object.keys(block).filter((key) => !OMO_KNOWN_BLOCK_KEYS.includes(key));
}

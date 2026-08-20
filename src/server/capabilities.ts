/**
 * Capability model for a connected opencode server (plan todo 7).
 *
 * Pure data: the {@link Capabilities} record, the deterministic
 * {@link guard} visibility map consumed by UI todos 18-20, and the
 * {@link toWire} mapping into the todo-3 wire shape. Detection itself lives
 * in `CapabilityDetector.ts`; the ONLY hardcoded enumeration permitted by
 * the plan (first-party agent names) lives here with its citation.
 */

import type { AgentSummary, CommandSummary } from "../shared/protocol.js";
export type { AgentSummary, CommandSummary } from "../shared/protocol.js";

/** One natively-configured MCP server from GET /mcp (key → status entry). */
export interface McpNativeStatus {
  readonly name: string;
  readonly status: string;
}

/**
 * What this opencode server can do, probed read-only at connect time.
 *
 * Wire aliases (todo-3 `ServerCapabilities` is `Record<string, boolean>`):
 * fork → {@link hasFork}, question → {@link hasQuestion}, todo → {@link hasTodo};
 * see {@link toWire} for the full key set.
 */
export interface Capabilities {
  /** Server-reported version from GET /global/health; "" when the probe failed. */
  readonly version: string;
  readonly hasFork: boolean;
  readonly hasQuestion: boolean;
  readonly hasTodo: boolean;
  readonly hasShell: boolean;
  readonly agents: readonly AgentSummary[];
  readonly commands: readonly CommandSummary[];
  readonly mcpNative: readonly McpNativeStatus[];
  /** True when ANY deterministic OMO signal fired (see CapabilityDetector). */
  readonly omoDetected: boolean;
  /**
   * When true the UI shows the localized `mcp.omoNote` string alongside the
   * MCP list (todos 4/20 own the text): plugins may inject additional MCPs
   * beyond {@link mcpNative}. Currently equals {@link omoDetected}; kept as
   * its own bit so the wire contract survives a future gate change.
   */
  readonly omoMcpNote: boolean;
  /** Set when the server version is below the configured floor; UI shows one warn toast. */
  readonly oldServer?: boolean;
}

/**
 * Feature visibility map consumed by todos 18-20. Every bit answers "may the
 * UI offer this feature for the connected server?" — the UNSUPPORTED-FEATURE
 * entry point: a `false` bit means hide the control and, if a runtime call
 * still answers 404 / schema-mismatch, toast + stay hidden (never crash).
 */
export interface FeatureVisibility {
  readonly fork: boolean;
  readonly question: boolean;
  readonly todo: boolean;
  readonly shell: boolean;
  readonly omoMcpNote: boolean;
}

/** Project probe outcomes onto per-feature visibility. */
export function guard(capabilities: Capabilities): FeatureVisibility {
  return {
    fork: capabilities.hasFork,
    question: capabilities.hasQuestion,
    todo: capabilities.hasTodo,
    shell: capabilities.hasShell,
    omoMcpNote: capabilities.omoMcpNote,
  };
}

/**
 * Wire form for the todo-3 `init.capabilities` payload
 * (`Record<string, boolean>`): feature bits under their protocol aliases.
 * T3's fixed `ServerCapabilities` interface currently names fork/question/
 * todo; the remaining keys ride the same record for todos 18-20.
 */
export function toWire(capabilities: Capabilities): Record<string, boolean> {
  return {
    fork: capabilities.hasFork,
    question: capabilities.hasQuestion,
    todo: capabilities.hasTodo,
    shell: capabilities.hasShell,
    omo: capabilities.omoDetected,
    omoMcpNote: capabilities.omoMcpNote,
    oldServer: capabilities.oldServer ?? false,
  };
}

/**
 * First-party agent names a plain opencode server can enumerate — the ONLY
 * hardcoded list this package may carry (plan todo 7); everything else about
 * OMO is data-driven.
 *
 * Source + verification date: https://opencode.ai/docs/agents fetched
 * 2026-08-20 (page footer "Last updated: Aug 19, 2026") lists built-ins
 * build + plan (primary), general + explore + scout (subagents), and
 * compaction + title + summary (hidden system agents).
 *
 * Diff found vs the plan's draft list (`build,plan,general,explore,
 * compaction,title,summary`): the docs page adds `scout`. Resolution —
 * trust the server SOURCE over the (stale) docs page and INCLUDE `scout`:
 * the opencode agent registry marks scout `native: true` but gates its
 * registration behind an experimental flag (OPENCODE_EXPERIMENTAL_SCOUT,
 * refactored to `flags.experimentalScout` in anomalyco/opencode PR #27318;
 * the CLI docs' env table documents the flag), and PR #30435 later deleted
 * the agent outright with docs cleanup pending in PR #32123. A first-party
 * native name belongs in the core set either way: including it can never
 * false-flag OMO on a plain install running with the experimental flag or an
 * older binary, while excluding it would (signal 3 would fire on a native
 * name). Genuine OMO installs are still caught by signals 1 and 2.
 */
export const CORE_AGENT_NAMES = [
  "build",
  "plan",
  "general",
  "explore",
  "scout",
  "compaction",
  "title",
  "summary",
] as const;

export type CoreAgentName = (typeof CORE_AGENT_NAMES)[number];

/** True when `name` is a first-party opencode agent (see CORE_AGENT_NAMES). */
export function isCoreAgentName(name: string): boolean {
  return (CORE_AGENT_NAMES as readonly string[]).includes(name);
}

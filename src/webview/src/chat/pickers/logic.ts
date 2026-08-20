/**
 * Pure picker logic (plan todo 15): slash-query detection, command ranking,
 * the custom-agent badge heuristic, and initial-model resolution.
 *
 * `CORE_AGENT_NAMES` MIRRORS src/server/capabilities.ts — the ONLY hardcoded
 * first-party enumeration the codebase may carry; the webview bundle cannot
 * import the server tree, so the list is duplicated here with a test pinning
 * both copies to the documented literal set (citation: opencode agent docs,
 * fetched 2026-08-20; see the server module for the full provenance). It is
 * used ONLY as the picker "custom" badge heuristic, never as a rendering
 * switch — unknown names render identically, badged custom.
 */

import type { AgentEntry, CommandEntry, ProviderEntry } from "./constants.js";

/** First-party agent names (mirror of the server-side core set — see header). */
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

/** Badge heuristic: agents outside the first-party core set badge "custom". */
export function isCustomAgent(name: string): boolean {
  return !(CORE_AGENT_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Slash palette: "/" detection at message START only, and ranking.

const SLASH_QUERY_PATTERN = /^\/(\S*)$/;

/**
 * The active palette query, or null when the palette stays closed: the text
 * must start with "/" and still be inside the first token (no whitespace
 * yet — once arguments begin, the row list would filter on noise). "/" alone
 * opens with an empty query (every command listed).
 */
export function detectSlashQuery(text: string): string | null {
  const match = SLASH_QUERY_PATTERN.exec(text);
  return match === null ? null : (match[1] ?? "");
}

/**
 * Keyboard decision for the open slash palette, kept pure so the container
 * stays a thin state shell (and SSR tests can pin every branch):
 * - ArrowDown / ArrowUp  -> move (the container clamps into [0, matches-1])
 * - Enter (no shift)     -> accept the active row — consumed so the composer
 *   NEVER sends the raw "/..." text as a prompt; no matches = pass through
 *   so "/zzz" can still be edited/sent as plain text
 * - Escape               -> dismiss (the palette hides until the query
 *   changes) — the text itself is untouched
 * Anything else is null: the composer's normal key handling proceeds.
 */
export type SlashKeyAction =
  | { readonly type: "move"; readonly delta: 1 | -1 }
  | { readonly type: "accept" }
  | { readonly type: "dismiss" };

export function slashKeyAction(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  /** Only consume keys while the palette is actually showing rows. */
  readonly open: boolean;
  readonly matchCount: number;
}): SlashKeyAction | null {
  if (!input.open) return null;
  if (input.key === "Escape") return { type: "dismiss" };
  if (input.key === "ArrowDown" && input.matchCount > 0) return { type: "move", delta: 1 };
  if (input.key === "ArrowUp" && input.matchCount > 0) return { type: "move", delta: -1 };
  if (input.key === "Enter" && !input.shiftKey && input.matchCount > 0) {
    return { type: "accept" };
  }
  return null;
}

/**
 * Name matching, case-insensitive: prefix matches rank before contains
 * matches; order within each tier is the server's own (stable). An empty
 * query returns every command. Descriptions are display data, not match keys.
 */
export function filterCommands(
  commands: readonly CommandEntry[],
  query: string,
): readonly CommandEntry[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return commands;
  const prefix: CommandEntry[] = [];
  const contains: CommandEntry[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) {
      prefix.push(command);
    } else if (name.includes(needle)) {
      contains.push(command);
    }
  }
  return [...prefix, ...contains];
}

// ---------------------------------------------------------------------------
// Initial model resolution (before any per-session selection exists).

export interface InitialModelInput {
  readonly providers: readonly ProviderEntry[];
  /** Server-reported /config `model` ("provider/model"), when present. */
  readonly defaultModel?: string;
  /** /config/providers `default` map (providerId -> modelId). */
  readonly defaultModels: Readonly<Record<string, string>>;
}

/**
 * The model id ("provider/model") a fresh session should show, or undefined
 * when the server reported nothing. Resolution order (render what's there;
 * never invent): the /config default string when it verifies against a known
 * provider — or NO providers were reported at all (nothing to verify
 * against) — otherwise the first defaultModels entry naming a known provider
 * (or any entry when providers are unlisted).
 */
export function resolveInitialModel(input: InitialModelInput): string | undefined {
  const { providers, defaultModels } = input;
  const defaultModel = input.defaultModel;
  if (defaultModel !== undefined) {
    if (providers.length === 0) return defaultModel;
    for (const provider of providers) {
      if (provider.models.some((model) => `${provider.id}/${model.id}` === defaultModel)) {
        return defaultModel;
      }
    }
    if (providers.some((provider) => defaultModel.startsWith(`${provider.id}/`))) {
      return defaultModel;
    }
  }
  for (const [providerId, modelId] of Object.entries(defaultModels)) {
    if (providers.length === 0 || providers.some((provider) => provider.id === providerId)) {
      return `${providerId}/${modelId}`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Agent entries as picker rows: current selection first? NO — server order
// is authoritative (primary agents before subagents as advertised); the UI
// only marks the selected row.

export interface AgentRow {
  readonly entry: AgentEntry;
  readonly custom: boolean;
}

/** Agents in advertised order with the badge bit computed as data. */
export function agentRows(agents: readonly AgentEntry[]): readonly AgentRow[] {
  return agents.map((entry) => ({ entry, custom: isCustomAgent(entry.name) }));
}

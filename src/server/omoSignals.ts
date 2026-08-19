/**
 * OMO (oh-my-opencode / oh-my-openagent) detection for the capability
 * pipeline — the three deterministic signals from plan todo 7, in strict
 * priority order. Nothing about OMO is hardcoded here beyond the plan's
 * config-file names; the agent-name comparison set lives in
 * `capabilities.ts` (`CORE_AGENT_NAMES`) with its citation.
 */
import { join } from "node:path";
import { isCoreAgentName } from "./capabilities.js";

/** Host-fs seam for the config-file signal; injectable for tests. */
export interface DetectorFs {
  exists(path: string): boolean;
}

export type OmoSignal = "config-file" | "plugin-routes" | "custom-agents" | "none";

export interface OmoSignalInput {
  readonly fs: DetectorFs;
  readonly workspaceDir?: string;
  readonly homeDir: string;
  /** Spec paths from the /doc probe; `undefined` when detection ran on fallback probes. */
  readonly specPaths: readonly string[] | undefined;
  readonly agentNames: readonly string[];
}

/** Signal-1 candidates relative to the workspace root (todo-7 spec list). */
const WORKSPACE_OMO_FILES = [
  "omo.jsonc",
  "oh-my-opencode.json",
  "oh-my-opencode.jsonc",
  "oh-my-openagent.json",
  "oh-my-openagent.jsonc",
] as const;

/**
 * Deterministic OMO detection, FIRST MATCH WINS:
 * 1. OMO config file on the host fs (workspace `omo.jsonc` /
 *    `oh-my-opencode.json(c)` / `oh-my-openagent.json(c)` or user-level
 *    `~/.config/opencode/omo.jsonc`);
 * 2. any `/doc` path whose first segment is `/plugin`;
 * 3. an advertised agent outside the CORE_AGENT_NAMES first-party set.
 */
export function resolveOmoSignal(input: OmoSignalInput): OmoSignal {
  const workspaceHits = (input.workspaceDir === undefined ? [] : WORKSPACE_OMO_FILES).map((name) =>
    join(input.workspaceDir ?? "", name),
  );
  const candidates = [...workspaceHits, join(input.homeDir, ".config", "opencode", "omo.jsonc")];
  if (candidates.some((path) => input.fs.exists(path))) return "config-file";
  const paths = input.specPaths ?? [];
  if (paths.some((path) => path === "/plugin" || path.startsWith("/plugin/"))) {
    return "plugin-routes";
  }
  if (input.agentNames.some((name) => !isCoreAgentName(name))) return "custom-agents";
  return "none";
}

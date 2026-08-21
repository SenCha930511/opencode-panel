/**
 * Runtime capability detection for a connected opencode server (plan todo 7),
 * plus the public API map for its consumers.
 *
 * PUBLIC API SURFACE (module map):
 * - `./clientFactory.js`: `createPanelClient(baseUrl, deps)` →
 *   `{ client, probeFetch }`, `AuthRequiredError`, `ProbeFetch` — todo 8
 *   (ServerManager) creates clients; todo 9 (SSE bridge) reuses `probeFetch`.
 * - `./capabilities.js` (re-exported below): `Capabilities`, `AgentSummary`,
 *   `CommandSummary`, `McpNativeStatus`, `FeatureVisibility`, `guard()`,
 *   `toWire()` (todo-3 init payload mapping), `CORE_AGENT_NAMES`.
 * - this module: `createCapabilityDetector(options)` → `detect(client,
 *   baseUrl)` (cached per baseUrl) + `invalidate(baseUrl)` — todo 9 calls
 *   `invalidate` on `server.connected`, then re-detects.
 * - `./docProbe.js`: `probeDoc()`, `probeHealth()`, `extractSpecPaths()` —
 *   the raw read-only probes; `extractSpecPaths` is re-exported here for the
 *   capability-matrix tests (todo 23), along with `isBelowMinimumVersion()`
 *   (`./versionFloor.js`) and the pure `resolveOmoSignal()` (`./omoSignals.js`).
 *
 * PRODUCTION WIRING (todo 8): pass `panel.probeFetch` as `probeFetch` so the
 * health/doc probes share the client's auth recovery; the default
 * `globalThis.fetch` only fits unauthenticated servers.
 *
 * Detection contract (UNSUPPORTED-FEATURE RULE): `detect` NEVER throws and
 * NEVER POSTs. Every probe degrades independently — a 404 or schema mismatch
 * just drops the matching bit, and callers hide features via `guard()`
 * (todo 20) + one toast instead of crashing.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../host/logger.js";
import type { ProbeFetch } from "./clientFactory.js";
import type {
  AgentSummary,
  Capabilities,
  CommandSummary,
  McpNativeStatus,
} from "./capabilities.js";
import { probeDoc, probeHealth, type DocProbeResult } from "./docProbe.js";
import { resolveOmoSignal, type DetectorFs } from "./omoSignals.js";
import { isBelowMinimumVersion } from "./versionFloor.js";

export {
  CORE_AGENT_NAMES,
  guard,
  isCoreAgentName,
  toWire,
} from "./capabilities.js";
export type {
  AgentSummary,
  Capabilities,
  CommandSummary,
  FeatureVisibility,
  McpNativeStatus,
} from "./capabilities.js";
export { extractSpecPaths } from "./docProbe.js";
export type { DocProbeResult } from "./docProbe.js";
export { resolveOmoSignal } from "./omoSignals.js";
export type { DetectorFs, OmoSignal, OmoSignalInput } from "./omoSignals.js";
export { isBelowMinimumVersion } from "./versionFloor.js";

const nodeFs: DetectorFs = { exists: (path) => existsSync(path) };

export interface CapabilityDetectorOptions {
  readonly logger: PanelLogger;
  /** From todo-6 config `opencodePanel.minimumServerVersion` ("0.0.0" = warn-only). */
  readonly minimumServerVersion: string;
  /**
   * Fetch for the raw /global/health and /doc probes. Pass the panel
   * client's `probeFetch` so authed servers probe correctly; defaults to
   * `globalThis.fetch`.
   */
  readonly probeFetch?: ProbeFetch;
  /** Workspace root for the OMO config-file signal (todo 8 passes the folder). */
  readonly workspaceDir?: string;
  /** Home directory for `~/.config/opencode/omo.jsonc`; defaults to `os.homedir()`. */
  readonly homeDir?: string;
  readonly fs?: DetectorFs;
  /** Test seam: appended to `/doc` as query (the todo-5 mock's `raw=1` JSON mode). */
  readonly docQuery?: string;
}

export interface CapabilityDetector {
  /** Best-effort probe of one server; cached per baseUrl until invalidated. */
  detect(client: OpencodeClient, baseUrl: string): Promise<Capabilities>;
  /** Drop the cached result (todo 9 calls this on `server.connected`). */
  invalidate(baseUrl: string): void;
}

export function createCapabilityDetector(options: CapabilityDetectorOptions): CapabilityDetector {
  const cache = new Map<string, Promise<Capabilities>>();
  return {
    detect(client, baseUrl) {
      const cached = cache.get(baseUrl);
      if (cached !== undefined) return cached;
      const pending = runDetection(client, baseUrl, options);
      cache.set(baseUrl, pending);
      return pending;
    },
    invalidate(baseUrl) {
      cache.delete(baseUrl);
    },
  };
}

// ---------------------------------------------------------------------------
// Route-presence → feature flags. Tolerant to the template style (`{id}`
// vs `:id`) by matching a single non-slash segment between `session` and the
// leaf. The question reply route shape is the mock's documented assumption.

// Route families serve under BOTH the unprefixed and the `/api`-prefixed
// mount (live 1.18.15 doc evidence); question additionally exposes global
// routes (`/question/{requestID}/reply`) per the official server source.
const FORK_PATH = /^\/(?:api\/)?session\/[^/]+\/fork$/;
const TODO_PATH = /^\/(?:api\/)?session\/[^/]+\/todo$/;
const SHELL_PATH = /^\/(?:api\/)?session\/[^/]+\/shell$/;
const QUESTION_PATH = /^\/(?:api\/)?(?:session\/[^/]+\/)?questions?(?:\/|$)/;

interface RouteFlags {
  readonly hasFork: boolean;
  readonly hasQuestion: boolean;
  readonly hasTodo: boolean;
  readonly hasShell: boolean;
}

function assertNever(value: never): never {
  throw new Error(`unreachable doc probe kind: ${String(value)}`);
}

/**
 * Map a doc probe outcome onto route flags. Fallback GET probes cannot prove
 * POST-only routes (fork/question/shell) — those stay hidden per the
 * ambiguity rule (see docProbe.ts).
 */
function routeFlags(doc: DocProbeResult): RouteFlags {
  switch (doc.kind) {
    case "spec":
      return {
        hasFork: doc.paths.some((path) => FORK_PATH.test(path)),
        hasQuestion: doc.paths.some((path) => QUESTION_PATH.test(path)),
        hasTodo: doc.paths.some((path) => TODO_PATH.test(path)),
        hasShell: doc.paths.some((path) => SHELL_PATH.test(path)),
      };
    case "fallback":
      return { hasFork: false, hasQuestion: false, hasTodo: doc.todoPresent, hasShell: false };
    default:
      return assertNever(doc);
  }
}

// ---------------------------------------------------------------------------
// Boundary parsers (unknown → typed summaries; unknown shapes just drop entries).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAgentModel(model: unknown): string | undefined {
  if (typeof model === "string" && model.length > 0) return model;
  if (isRecord(model)) {
    const provider =
      typeof model.providerID === "string"
        ? model.providerID
        : typeof model.provider === "string"
          ? model.provider
          : "";
    const id =
      typeof model.modelID === "string"
        ? model.modelID
        : typeof model.model === "string"
          ? model.model
          : typeof model.id === "string"
            ? model.id
            : "";
    if (provider && id) return `${provider}/${id}`;
    if (id) return id;
  }
  return undefined;
}

function toAgentSummaries(payload: unknown): AgentSummary[] {
  if (!Array.isArray(payload)) return [];
  const agents: AgentSummary[] = [];
  for (const item of payload) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name.length === 0) continue;
    const model = parseAgentModel(item.model);
    agents.push({
      name: item.name,
      ...(typeof item.mode === "string" ? { mode: item.mode } : {}),
      ...(model !== undefined ? { model } : {}),
      builtIn: item.builtIn === true,
    });
  }
  return agents;
}

function toCommandSummaries(payload: unknown): CommandSummary[] {
  if (!Array.isArray(payload)) return [];
  const commands: CommandSummary[] = [];
  for (const item of payload) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name.length === 0) continue;
    commands.push({
      name: item.name,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
    });
  }
  return commands;
}

function toMcpNativeStatus(payload: unknown): McpNativeStatus[] {
  if (!isRecord(payload)) return [];
  const entries: McpNativeStatus[] = [];
  for (const [name, value] of Object.entries(payload)) {
    const status = isRecord(value) && typeof value.status === "string" ? value.status : "unknown";
    entries.push({ name, status });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Detection pipeline.

async function runDetection(
  client: OpencodeClient,
  baseUrl: string,
  options: CapabilityDetectorOptions,
): Promise<Capabilities> {
  const { logger } = options;
  const fetchImpl = options.probeFetch ?? ((request: Request) => globalThis.fetch(request));

  const health = await probeHealth(fetchImpl, baseUrl);
  const doc = await probeDoc(fetchImpl, baseUrl, options.docQuery);
  const flags = routeFlags(doc);

  // Ancillary read-only GETs; each degrades to empty independently (a 404 on
  // an old server or an unexpected payload must not sink detection).
  const empty = <T>(label: string) => (error: unknown): readonly T[] => {
    logger.debug(`capability probe '${label}' failed: ${errorSummary(error)}`);
    return [];
  };
  // Structural SDK probe: finds `target.method` when the SDK surface exposes
  // it (names drift across versions), calls it, unwraps `{data}`; any miss or
  // failure degrades to undefined so that section simply hides.
  const callData = async (target: unknown, method: string): Promise<unknown> => {
    if (!isRecord(target)) return undefined;
    const candidate = target[method];
    if (typeof candidate !== "function") return undefined;
    try {
      const result = await (
        candidate as (this: unknown) => Promise<{ readonly data?: unknown }>
      ).call(target);
      return result?.data;
    } catch (error) {
      logger.debug(`capability probe '${method}' failed: ${errorSummary(error)}`);
      return undefined;
    }
  };
  const [agents, commands, mcpNative] = await Promise.all([
    // SDK naming drifted across versions: `app.agents()` on older bundles,
    // `agent.list()` on newer ones — probe both, drop when neither exists.
    callData(client.app, "agents").then(async (data) =>
      data !== undefined
        ? data
        : callData((client as { agent?: unknown }).agent, "list"),
    ).then(toAgentSummaries),
    callData(client.command, "list").then(toCommandSummaries),
    client.mcp
      .status()
      .then((result) => toMcpNativeStatus(result.data))
      .catch(empty<McpNativeStatus>("mcp")),
  ]);
  // The plan requires a /config probe; its payload belongs to todo 13's model
  // dropdown, so detection only records that the route answered.
  await client.config
    .get()
    .then(() => logger.debug("capability probe 'config' ok"))
    .catch((error: unknown) => logger.debug(`capability probe 'config' failed: ${errorSummary(error)}`));

  const omoSignal = resolveOmoSignal({
    fs: options.fs ?? nodeFs,
    ...(options.workspaceDir === undefined ? {} : { workspaceDir: options.workspaceDir }),
    homeDir: options.homeDir ?? homedir(),
    specPaths: doc.kind === "spec" ? doc.paths : undefined,
    agentNames: agents.map((agent) => agent.name),
  });
  const omoDetected = omoSignal !== "none";

  const belowFloor =
    health.version !== "" && isBelowMinimumVersion(health.version, options.minimumServerVersion);
  if (belowFloor) {
    logger.warn(
      `opencode server version ${health.version} is below minimumServerVersion ` +
        `${options.minimumServerVersion}; running with best-effort capabilities`,
    );
  }

  const docSource = doc.kind === "spec" ? `spec-${doc.source}` : "fallback";
  logger.info(
    `capabilities for ${baseUrl}: version=${health.version || "?"} ` +
      `floor=${options.minimumServerVersion} oldServer=${belowFloor} fork=${flags.hasFork} ` +
      `question=${flags.hasQuestion} todo=${flags.hasTodo} shell=${flags.hasShell} ` +
      `agents=${agents.length} commands=${commands.length} mcp=${mcpNative.length} ` +
      `omoDetected=${omoDetected} (signal=${omoSignal}, doc=${docSource})`,
  );

  return {
    version: health.version,
    ...flags,
    agents,
    commands,
    mcpNative,
    omoDetected,
    omoMcpNote: omoDetected,
    ...(belowFloor ? { oldServer: true } : {}),
  };
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

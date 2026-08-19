/**
 * MCP-status push (plan todo 20, host side): the natively-configured MCP
 * server inventory from GET /mcp plus the todo-7 capability GUARDS, pushed
 * to the webview over the event channel, mirroring todo 15's
 * ./capabilityInfo.ts composition.
 *
 * WHY THE EVENT CHANNEL: todo-3's typed protocol is frozen (src/shared/**
 * out of bounds) and names no MCP or feature-flag request/response pair;
 * the `event` passthrough is the only open host->webview channel
 * (precedent: capabilities.refresh / sessions.list / messages.sync).
 *
 * WIRE CONTRACT (webview consumes; ForwardedEvent over ToWebview `event`):
 * - type = "mcp.status", payload = {@link McpStatusPayload}:
 *   - `servers` — boundary-parsed GET /mcp entries `{name, status, error?}`:
 *     the NATIVELY-CONFIGURED inventory only. Under oh-my-opencode the list
 *     may under-report (plugins inject additional MCPs) — the webview shows
 *     the localized `mcp.omoNote` beside the list and this host module never
 *     claims completeness; it also never calls plugin internals. Unknown or
 *     future status strings pass through as DATA (never special-cased).
 *   - `guards` — the todo-7 {@link FeatureVisibility} map ({@link guard})
 *     plus omoDetected/oldServer. This push is THE flag carrier for todos
 *     18-21: todo-3's minimal `init.capabilities` names only
 *     fork/question/todo, and todo 15's capabilities.refresh carries picker
 *     data, not flags (documented there) — so the webview
 *     `useCapabilityFlags()` overlays this block onto the init baseline.
 *   - `error` (optional) — short technical summary when the /mcp probe
 *     failed this refresh (todo-20 QA failure rule): the panel renders its
 *     localized error row from `servers: []` + this field and never crashes.
 *
 * REFRESH TRIGGERS mirror todo 15 (see capabilityInfo.ts for the
 * resync-equivalent rationale): `manager.onDidChangeState` transitions into
 * managed|attached invalidate the todo-7 detector cache for that baseUrl,
 * then re-push; a wiring performed while a server is already live fires one
 * immediate refresh. The same LATE-VIEW GAP applies (posts are dropped
 * while no view is resolved; the todo-10 visibility seam in src/providers
 * is the named fix point, out of bounds here).
 *
 * FETCH PATH (binding): the onboard connection's SDK client is used when it
 * exposes `mcp.status()` (verified present in @opencode-ai/sdk ^1.18.18,
 * sdk.gen.d.ts class Mcp); otherwise the todo-7 `probeFetch` (auth-
 * injecting) GETs {baseUrl}/mcp directly — the route exists on every server
 * the panel targets (the todo-5 mock spec pins it). NEVER POSTs; per-route
 * drift degrades to the error payload, never to a crash.
 */

import type { PanelLogger } from "../logger.js";
import type { Capabilities } from "../../server/capabilities.js";
import { guard } from "../../server/capabilities.js";
import type { CapabilityDetector } from "../../server/CapabilityDetector.js";
import type { ProbeFetch } from "../../server/clientFactory.js";
import type { ServerManagerState } from "../../server/ServerManager.js";
import type { Disposable } from "../config.js";
import type { SessionClientSource } from "./sessions.js";
import type { ViewEventSink } from "./sync.js";

/** Event-channel type carrying {@link McpStatusPayload}. */
export const MCP_STATUS_EVENT = "mcp.status";

/** One natively-configured MCP server entry (status verbatim, error when set). */
export interface McpServerEntry {
  readonly name: string;
  readonly status: string;
  readonly error?: string;
}

/** Feature-visibility carrier for todos 18-21 (todo-7 guard() + OMO/version bits). */
export interface McpGuards {
  readonly fork: boolean;
  readonly question: boolean;
  readonly todo: boolean;
  readonly shell: boolean;
  readonly omoDetected: boolean;
  readonly omoMcpNote: boolean;
  readonly oldServer: boolean;
}

/** The `mcp.status` push payload (see the module header for the contract). */
export interface McpStatusPayload {
  readonly servers: readonly McpServerEntry[];
  readonly guards: McpGuards;
  readonly error?: string;
}

/** Project the todo-7 capabilities onto the wire guard set. */
export function guardsFromCapabilities(capabilities: Capabilities): McpGuards {
  const visibility = guard(capabilities);
  return {
    ...visibility,
    omoDetected: capabilities.omoDetected,
    oldServer: capabilities.oldServer ?? false,
  };
}

/**
 * The /mcp probe failed. Carries the HTTP {@link status} when the server
 * answered (absent on transport/parse failures); NEVER carries credentials.
 */
export class McpStatusFetchError extends Error {
  readonly baseUrl: string;
  readonly status: number | undefined;

  constructor(baseUrl: string, detail: string, status?: number) {
    super(`GET ${baseUrl}/mcp failed: ${detail}`);
    this.name = "McpStatusFetchError";
    this.baseUrl = baseUrl;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Boundary parse of the GET /mcp `{name: {status, error?}}` map. Entries keep
 * unknown names/statuses as data; a missing status degrades entry-locally to
 * "unknown" (the todo-7 `toMcpNativeStatus` convention never drops a server).
 */
export function toMcpServerEntries(payload: unknown): McpServerEntry[] {
  if (!isRecord(payload)) return [];
  const entries: McpServerEntry[] = [];
  for (const [name, value] of Object.entries(payload)) {
    if (name.length === 0) continue;
    const status =
      isRecord(value) && typeof value.status === "string" && value.status.length > 0
        ? value.status
        : "unknown";
    const error =
      isRecord(value) && typeof value.error === "string" && value.error.length > 0
        ? value.error
        : undefined;
    entries.push({ name, status, ...(error === undefined ? {} : { error }) });
  }
  return entries;
}

/**
 * The minimal SDK-client slice this module reads. `OpencodeClient` is
 * structurally assignable; tests pass `{}` to force the probeFetch fallback
 * without cast lies.
 */
export interface McpClientLike {
  readonly mcp?: {
    readonly status?: () => Promise<{ readonly data: unknown; readonly error: unknown }>;
  };
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Fetch + boundary-parse the /mcp inventory. SDK `mcp.status()` when the
 * client exposes it, else the raw GET via `probeFetch` (same auth injection).
 * Rejects only with {@link McpStatusFetchError}.
 */
export async function readMcpStatus(
  client: McpClientLike,
  probeFetch: ProbeFetch,
  baseUrl: string,
): Promise<McpServerEntry[]> {
  const mcp = client.mcp;
  if (mcp !== undefined && typeof mcp.status === "function") {
    let result: { readonly data: unknown; readonly error: unknown };
    try {
      result = await mcp.status();
    } catch (error) {
      throw new McpStatusFetchError(baseUrl, errorSummary(error));
    }
    if (result.error !== undefined) {
      throw new McpStatusFetchError(baseUrl, `server answered an error: ${errorSummary(result.error)}`);
    }
    return toMcpServerEntries(result.data);
  }

  let response: Response;
  try {
    response = await probeFetch(new Request(`${baseUrl}/mcp`));
  } catch (error) {
    throw new McpStatusFetchError(baseUrl, errorSummary(error));
  }
  if (!response.ok) {
    throw new McpStatusFetchError(baseUrl, `HTTP ${String(response.status)}`, response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new McpStatusFetchError(baseUrl, `malformed JSON body: ${errorSummary(error)}`);
  }
  return toMcpServerEntries(payload);
}

// ---------------------------------------------------------------------------
// McpInfoSync: connect -> read -> broadcast, deduped; NEVER rejects (a lost
// server yields a debug log; a failed /mcp probe yields the error payload —
// the todo-20 QA "assert + log" lives in runRefresh).

export interface McpInfoSyncDeps {
  readonly source: SessionClientSource;
  readonly sink: ViewEventSink;
  readonly logger: PanelLogger;
}

export class McpInfoSync {
  private readonly deps: McpInfoSyncDeps;
  private inflight: Promise<void> | undefined;

  constructor(deps: McpInfoSyncDeps) {
    this.deps = deps;
  }

  /** Refetch + push, collapsing concurrent triggers into one pipeline. */
  refresh(): Promise<void> {
    this.inflight ??= this.run();
    return this.inflight;
  }

  private async run(): Promise<void> {
    try {
      await this.runRefresh();
    } catch (error) {
      this.deps.logger.debug(`mcp-info refresh skipped: ${String(error)}`);
    } finally {
      this.inflight = undefined;
    }
  }

  private async runRefresh(): Promise<void> {
    const connection = await this.deps.source.connect();
    const guards = guardsFromCapabilities(connection.capabilities);
    try {
      const servers = await readMcpStatus(
        connection.client,
        connection.probeFetch,
        connection.baseUrl,
      );
      const payload: McpStatusPayload = { servers, guards };
      this.deps.sink.postEvent(MCP_STATUS_EVENT, payload);
    } catch (error) {
      const detail = errorSummary(error);
      // QA failure path (todo 20): the panel's error state is this payload;
      // the host-side half of "assert + log" is the warn line plus the push.
      this.deps.logger.warn(`mcp.status: /mcp probe failed for ${connection.baseUrl}: ${detail}`);
      const payload: McpStatusPayload = { servers: [], guards, error: detail };
      this.deps.sink.postEvent(MCP_STATUS_EVENT, payload);
    }
  }
}

// ---------------------------------------------------------------------------
// wireMcpInfo: the production composition extension.ts activates, mirroring
// todo 15's wireCapabilityInfo call site (same accessors, same subscription).

export interface McpInfoWiringDeps {
  readonly source: SessionClientSource;
  readonly detector: CapabilityDetector;
  readonly getState: () => ServerManagerState;
  readonly onDidChangeState: (
    listener: (state: ServerManagerState) => void,
  ) => Disposable;
  readonly logger: PanelLogger;
  /** Chat view's public event push (todo 10), same sink todos 12/15 use. */
  readonly events: ViewEventSink;
}

export interface McpInfoWiring {
  readonly deps: McpInfoSyncDeps;
  readonly sync: McpInfoSync;
  dispose(): void;
}

function aliveBaseUrl(state: ServerManagerState): string | undefined {
  return state.kind === "managed" || state.kind === "attached" ? state.baseUrl : undefined;
}

/**
 * Compose the mcp.status push: on every transition into a live server state
 * (the resync equivalent — see the module header) the todo-7 detector cache
 * for that baseUrl is invalidated, then the fresh inventory + guards push to
 * the chat view. When wired while a server is already live, one refresh
 * fires immediately so a late activation still seeds the panel.
 */
export function wireMcpInfo(deps: McpInfoWiringDeps): McpInfoWiring {
  const syncDeps: McpInfoSyncDeps = {
    source: deps.source,
    sink: deps.events,
    logger: deps.logger,
  };
  const sync = new McpInfoSync(syncDeps);

  const subscription = deps.onDidChangeState((state) => {
    const baseUrl = aliveBaseUrl(state);
    if (baseUrl === undefined) return;
    deps.detector.invalidate(baseUrl);
    void sync.refresh();
  });
  if (aliveBaseUrl(deps.getState()) !== undefined) {
    void sync.refresh();
  }

  return {
    deps: syncDeps,
    sync,
    dispose: () => {
      subscription.dispose();
    },
  };
}

/**
 * Capability-info push (plan todo 15, host side): agents / slash-commands /
 * provider-model lists from the todo-8 onboard connection, pushed to the
 * webview over the event channel. Slash-command EXECUTION lives in
 * ./commands.ts; wire shapes and the defensive parsers live in
 * ./capabilityWire.ts.
 *
 * WHY THE EVENT CHANNEL (binding): todo-3's typed protocol is frozen
 * (src/shared/** out of bounds) and names no request/response pair for
 * fetching agent/command/provider lists — `init.capabilities` is the minimal
 * boolean matrix (todo-3 ServerCapabilities) and src/providers (which owns
 * the init builder) is likewise out of bounds. The `event` passthrough is
 * the only open host->webview channel, so this module mirrors the todo-12
 * `sessions.list` / todo-13 `messages.sync` precedent: the HOST pushes
 * {@link CAPABILITIES_REFRESH_EVENT} carrying the picker data and the
 * webview pickers store boundary-parses it.
 *
 * WIRE CONTRACT (webview consumes; ForwardedEvent over ToWebview `event`):
 * - type = "capabilities.refresh", payload = {@link CapabilitiesRefreshPayload}:
 *   - `agents`    — todo-7 AgentSummary verbatim from the detector (custom /
 *     OMO names included unchanged; may be EMPTY on old servers: the webview
 *     then hides the agent picker and omits `agent` from prompts — QA failure
 *     scenario; the host logs the fact once per push, see {@link runRefresh}).
 *   - `commands`  — todo-7 CommandSummary verbatim (builtins + custom names
 *     as DATA — the slash palette never special-cases names).
 *   - `providers` — /config/providers payload parsed defensively into
 *     `{id, name, models: [{id, name}]}` groups; a schema-drifted or failed
 *     probe degrades to [] (the model dropdown hides; never an invented
 *     provider).
 *   - `defaultModels` — /config/providers `default` map (providerId ->
 *     modelId), best-effort; {} on drift.
 *   - `defaultModel` (optional) — /config `model` string ("provider/model"),
 *     only present when the server reports one. Selection semantics live
 *     webview-side (chat/composerState.ts); this module is the honest data
 *     carrier — it never picks a model on the server's behalf.
 *
 * REFRESH TRIGGERS (documented resync story): todo 9's EventBridge exposes a
 * single-slot `resync` callback fired once per `server.connected`; that slot
 * is consumed by todo-12's composition (src/host/handlers/sync.ts), another
 * worker's file, and stays untouched. The SAME connection event transitions
 * ServerManager to managed|attached, so this module subscribes
 * `manager.onDidChangeState` — the observable equivalent of the resync hook
 * within this todo's file ownership — and, per the todo-9 contract
 * ("detector.invalidate(baseUrl) on server.connected, then re-detect"),
 * invalidates the todo-7 detector cache before refreshing, so the pushed
 * lists are re-detected per connection, never stale. A mid-session
 * capability change (e.g. installing OMO while connected) produces no
 * connection event and is not announced by the server; it surfaces on the
 * next connect/restart. LATE-VIEW GAP (documented): posts are dropped while
 * no view is resolved (BaseViewProvider.post), so a webview first opened
 * long after a settled server shows empty pickers until the next state
 * transition. The named fix point is the todo-10 seam
 * `webviewSeam.onDidChangeVisibility`, owned by src/providers (out of
 * bounds here); in practice auto-start takes seconds after activation, so
 * the managed|attached transition lands after the view resolves, and
 * BaseViewProvider re-posts `init` on the same transitions this push rides.
 *
 * MODEL IDS: picker selection travels the frozen protocol as ONE string
 * "provider/model" (todo-3 `sendPrompt.model`). The canonical first-"/"
 * splitter is todo-14's `parseModelString`, re-exported from
 * ./capabilityWire.ts as `splitModelId` (see its comment): "a/b/c" =>
 * {providerID:"a", modelID:"b/c"} — the FIRST "/" wins per the plan's
 * binding ruling (NOT last), so a provider id containing "/" is not
 * representable through this wire shape; documented edge, asserted by
 * tests. T14's sendPrompt pipeline already consumes that same helper when
 * building `session.prompt`'s `body.model` ({providerID, modelID}).
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../logger.js";
import type { Capabilities, CapabilityDetector } from "../../server/CapabilityDetector.js";
import type { ServerManagerState } from "../../server/ServerManager.js";
import type { Disposable } from "../config.js";
import type { SessionClientSource } from "./sessions.js";
import type { ViewEventSink } from "./sync.js";
import {
  CAPABILITIES_REFRESH_EVENT,
  toDefaultModel,
  toDefaultModels,
  toProviderEntries,
  type CapabilitiesRefreshPayload,
} from "./capabilityWire.js";

export { CAPABILITIES_REFRESH_EVENT, splitModelId } from "./capabilityWire.js";
export type {
  CapabilitiesRefreshPayload,
  CapabilityModelEntry,
  CapabilityProviderEntry,
  ModelIdParts,
} from "./capabilityWire.js";

// ---------------------------------------------------------------------------
// CapabilityInfoSync: connect -> read -> broadcast, deduped; NEVER rejects
// (a lost server or drifted payload yields a debug log, mirroring
// SessionSync). The QA "assert + log" for the empty-agent case lives here.

interface SdkResultLike {
  readonly data: unknown;
  readonly error: unknown;
}

export interface CapabilityInfoSyncDeps {
  readonly source: SessionClientSource;
  readonly sink: ViewEventSink;
  readonly logger: PanelLogger;
  /**
   * Fresh detection override (invalidate + re-detect). The baked
   * `connection.capabilities` snapshot is frozen at connect time — a
   * mid-session change (user added a custom command) only surfaces through
   * a live probe. When unset, the baked snapshot stands alone.
   */
  readonly detect?: { (baseUrl: string): Promise<Capabilities> };
  /** The live baseUrl to probe, mirroring the manager's current state. */
  readonly baseUrl?: { (): string | undefined };
}

export class CapabilityInfoSync {
  private readonly deps: CapabilityInfoSyncDeps;
  private inflight: Promise<void> | undefined;

  constructor(deps: CapabilityInfoSyncDeps) {
    this.deps = deps;
  }

  /** Refetch + push, collapsing concurrent triggers into one pipeline. */
  refresh(): Promise<void> {
    this.inflight ??= this.run();
    return this.inflight;
  }

  /** Live-detected agent/command lists; null when no probe is wired/fails. */
  private async freshLists(): Promise<Capabilities | null> {
    if (this.deps.detect === undefined || this.deps.baseUrl === undefined) return null;
    const baseUrl = this.deps.baseUrl();
    if (baseUrl === undefined) return null;
    try {
      return await this.deps.detect(baseUrl);
    } catch {
      return null;
    }
  }

  async fetchPayload(): Promise<CapabilitiesRefreshPayload | undefined> {
    try {
      const [connection, fresh] = await Promise.all([
        this.deps.source.connect(),
        this.freshLists(),
      ]);
      const [providersResult, configResult] = await Promise.all([
        readConfigProbe(connection.client, "providers"),
        readConfigProbe(connection.client, "get"),
      ]);
      const defaultModel = toDefaultModel(configResult);
      return {
        agents: fresh?.agents ?? connection.capabilities.agents,
        commands: fresh?.commands ?? connection.capabilities.commands,
        providers: toProviderEntries(providersResult),
        defaultModels: toDefaultModels(providersResult),
        ...(defaultModel === undefined ? {} : { defaultModel }),
      };
    } catch {
      // Probe reads are best-effort: any failure degrades to "no payload"
      // (the periodic push paths keep the webview honest on their own).
      return undefined;
    }
  }

  private async run(): Promise<void> {
    try {
      await this.runRefresh();
    } catch (error) {
      this.deps.logger.debug(`capability-info refresh skipped: ${String(error)}`);
    } finally {
      this.inflight = undefined;
    }
  }

  private async runRefresh(): Promise<void> {
    const [connection, fresh] = await Promise.all([
      this.deps.source.connect(),
      this.freshLists(),
    ]);
    const [providersResult, configResult] = await Promise.all([
      readConfigProbe(connection.client, "providers"),
      readConfigProbe(connection.client, "get"),
    ]);
    const defaultModel = toDefaultModel(configResult);
    const payload: CapabilitiesRefreshPayload = {
      agents: fresh?.agents ?? connection.capabilities.agents,
      commands: fresh?.commands ?? connection.capabilities.commands,
      providers: toProviderEntries(providersResult),
      defaultModels: toDefaultModels(providersResult),
      ...(defaultModel === undefined ? {} : { defaultModel }),
    };
    if (payload.agents.length === 0) {
      this.deps.logger.info(
        "capabilities: server advertised no agents — agent picker hidden, prompts omit agent",
      );
    }
    this.deps.sink.postEvent(CAPABILITIES_REFRESH_EVENT, payload);
  }
}

/** One ancillary config probe; failures degrade to undefined + debug log. */
async function readConfigProbe(
  client: OpencodeClient,
  kind: "providers" | "get",
): Promise<unknown> {
  try {
    if (kind === "providers") {
      let result: SdkResultLike | undefined;
      try {
        result = await client.config.providers();
      } catch {
        result = undefined;
      }
      if (result === undefined || result.error !== undefined || !result.data) {
        if ("provider" in client && typeof (client.provider as { list?: () => Promise<SdkResultLike> }).list === "function") {
          try {
            const providerResult = await (client.provider as { list: () => Promise<SdkResultLike> }).list();
            if (providerResult.error === undefined && providerResult.data) {
              return providerResult.data;
            }
          } catch {
            // Best effort
          }
        }
      }
      if (result !== undefined && result.error === undefined) return result.data;
      return undefined;
    }
    const result: SdkResultLike = await client.config.get();
    if (result.error !== undefined) return undefined;
    return result.data;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// wireCapabilityInfo: the production composition extension.ts activates.

/**
 * The composition facts this module needs, expressed as accessors so tests
 * can fake the manager without touching ServerManager's concrete class (and
 * without cast lies). Production values come straight off the manager:
 * `managerSessionSource(manager)`, `manager.detector`, `() => manager.state`,
 * `manager.onDidChangeState`.
 */
export interface CapabilityInfoWiringDeps {
  readonly source: SessionClientSource;
  readonly detector: CapabilityDetector;
  readonly getState: () => ServerManagerState;
  readonly onDidChangeState: (
    listener: (state: ServerManagerState) => void,
  ) => Disposable;
  readonly logger: PanelLogger;
  /** Chat view's public event push (todo 10), same sink todo 12 uses. */
  readonly events: ViewEventSink;
}

export interface CapabilityInfoWiring {
  /** Feed into `registerCommandHandlers`(panel.registerHandler, deps) (commands.ts). */
  readonly deps: CapabilityInfoSyncDeps;
  readonly sync: CapabilityInfoSync;
  dispose(): void;
}

function aliveBaseUrl(state: ServerManagerState): string | undefined {
  return state.kind === "managed" || state.kind === "attached" ? state.baseUrl : undefined;
}

/**
 * Compose the capability-info push: on every transition into a live server
 * state (the resync equivalent — see the module header) the todo-7 detector
 * cache for that baseUrl is invalidated, then the fresh lists push to the
 * chat view. When wired while a server is already live, one refresh fires
 * immediately so a late activation still seeds the pickers.
 */
export function wireCapabilityInfo(deps: CapabilityInfoWiringDeps): CapabilityInfoWiring {
  const syncDeps: CapabilityInfoSyncDeps = {
    source: deps.source,
    sink: deps.events,
    logger: deps.logger,
    detect: async (baseUrl) => {
      // Fresh probe: the connect-time snapshot misses mid-session changes
      // (custom agents/commands added while the server runs).
      const connection = await deps.source.connect();
      return deps.detector.detect(connection.client, baseUrl);
    },
    baseUrl: () => aliveBaseUrl(deps.getState()),
  };
  const sync = new CapabilityInfoSync(syncDeps);

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

/**
 * Wire literals + boundary parsers for the chat pickers' capability feed
 * (plan todo 15, webview side).
 *
 * `CAPABILITIES_REFRESH_EVENT` mirrors src/host/handlers/capabilityInfo.ts —
 * the host pushes the picker data over the todo-3 `event` channel under this
 * type (the frozen protocol names no list-requests; see that module's header
 * for the full push contract). The two copies are pinned by tests on both
 * sides because the host and webview bundles never import each other
 * (precedent: todo-12's SESSIONS_LIST_EVENT mirror).
 *
 * Everything here is the parse-don't-validate boundary: the event payload
 * arrives as unknown and is checked into typed entries ONCE; malformed
 * entries are dropped, never invented (a schema-drifted server degrades to
 * fewer rows, and an empty agents/providers list hides the matching picker
 * per the todo-15 QA rule).
 */

/** Event-channel type carrying the host's capabilities.refresh payload. */
export const CAPABILITIES_REFRESH_EVENT = "capabilities.refresh";

/** One agent the server advertises (custom/OMO names included verbatim). */
export interface AgentEntry {
  readonly name: string;
  /** Agent mode as reported (`primary` | `subagent` | `all`); absent when omitted. */
  readonly mode?: string;
  readonly model?: string;
  readonly builtIn: boolean;
}

/** One slash command the server advertises; description optional. */
export interface CommandEntry {
  readonly name: string;
  readonly description?: string;
}

export interface ProviderModelEntry {
  readonly id: string;
  readonly name: string;
  /** Context-window size in tokens when the server reports `limit.context`. */
  readonly contextWindow?: number;
  readonly reasoning?: boolean;
  readonly variants?: readonly string[];
  readonly options?: Record<string, unknown>;
}

/** Provider group for the model dropdown; `models` may be empty. */
export interface ProviderEntry {
  readonly id: string;
  readonly name: string;
  readonly models: readonly ProviderModelEntry[];
}

/** Parsed `capabilities.refresh` payload (see capabilityInfo.ts header). */
export interface CapabilitySnapshot {
  readonly agents: readonly AgentEntry[];
  readonly commands: readonly CommandEntry[];
  readonly providers: readonly ProviderEntry[];
  readonly defaultModels: Readonly<Record<string, string>>;
  readonly defaultModel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAgentEntry(value: unknown): AgentEntry | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return undefined;
  }
  return {
    name: value.name,
    ...(typeof value.mode === "string" ? { mode: value.mode } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    builtIn: value.builtIn === true,
  };
}

function toCommandEntry(value: unknown): CommandEntry | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return undefined;
  }
  return {
    name: value.name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  };
}

function toModelEntry(value: unknown): ProviderModelEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return undefined;
  const contextWindow =
    typeof value.contextWindow === "number" && Number.isFinite(value.contextWindow)
      ? value.contextWindow
      : undefined;
  const reasoning = typeof value.reasoning === "boolean" ? value.reasoning : undefined;
  const variants = Array.isArray(value.variants)
    ? value.variants.filter((v): v is string => typeof v === "string" && v.length > 0)
    : undefined;
  const options = isRecord(value.options) ? value.options : undefined;
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.length > 0 ? value.name : value.id,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(variants === undefined ? {} : { variants }),
    ...(options === undefined ? {} : { options }),
  };
}

function toProviderEntry(value: unknown): ProviderEntry | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return undefined;
  const models: ProviderModelEntry[] = [];
  if (Array.isArray(value.models)) {
    for (const item of value.models) {
      const entry = toModelEntry(item);
      if (entry !== undefined) models.push(entry);
    }
  }
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.length > 0 ? value.name : value.id,
    models,
  };
}

function toDefaultModels(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [providerId, modelId] of Object.entries(value)) {
    if (providerId.length > 0 && typeof modelId === "string" && modelId.length > 0) {
      result[providerId] = modelId;
    }
  }
  return result;
}

/** Boundary parse of the event payload; undefined = ignore the push. */
export function parseCapabilitySnapshot(value: unknown): CapabilitySnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const agents: AgentEntry[] = [];
  if (Array.isArray(value.agents)) {
    for (const item of value.agents) {
      const entry = toAgentEntry(item);
      if (entry !== undefined) agents.push(entry);
    }
  }
  const commands: CommandEntry[] = [];
  if (Array.isArray(value.commands)) {
    for (const item of value.commands) {
      const entry = toCommandEntry(item);
      if (entry !== undefined) commands.push(entry);
    }
  }
  const providers: ProviderEntry[] = [];
  if (Array.isArray(value.providers)) {
    for (const item of value.providers) {
      const entry = toProviderEntry(item);
      if (entry !== undefined) providers.push(entry);
    }
  }
  const defaultModel =
    typeof value.defaultModel === "string" && value.defaultModel.length > 0
      ? value.defaultModel
      : undefined;
  return {
    agents,
    commands,
    providers,
    defaultModels: toDefaultModels(value.defaultModels),
    ...(defaultModel === undefined ? {} : { defaultModel }),
  };
}

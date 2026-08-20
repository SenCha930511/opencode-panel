/**
 * Wire shapes + defensive parsers for the todo-15 `capabilities.refresh`
 * push (host side). Pure data module — the push contract itself is
 * documented in ./capabilityInfo.ts; this module IS the todo-12
 * sessions/constants.ts-style authority both the sync and the tests read.
 *
 * `CAPABILITIES_REFRESH_EVENT` is mirrored in
 * src/webview/src/chat/pickers/constants.ts and pinned by tests on both
 * sides (host and webview bundles never import each other).
 *
 * The boundary parsers exist because a server may expose partial data or a
 * drifted schema (old opencode, or an endpoint that answers with a subset):
 * every malformed entry is DROPPED and nothing is ever invented — an empty
 * section simply hides its picker webview-side (todo-15 QA rule).
 */

import { isRecord } from "../../shared/protocol.js";
import type {
  AgentSummary,
  CommandSummary,
  CapabilityModelEntry,
  CapabilityProviderEntry,
  CapabilitiesRefreshPayload,
} from "../../shared/protocol.js";

export type {
  CapabilityModelEntry,
  CapabilityProviderEntry,
  CapabilitiesRefreshPayload,
} from "../../shared/protocol.js";

/** Event-channel type carrying {@link CapabilitiesRefreshPayload}. */
export const CAPABILITIES_REFRESH_EVENT = "capabilities.refresh";

/** `limit.context` when the server reports it as a finite number. */
function contextWindowOf(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.limit)) return undefined;
  const context = value.limit.context;
  return typeof context === "number" && Number.isFinite(context) && context > 0 ? context : undefined;
}

export function toModelEntries(payload: unknown): readonly CapabilityModelEntry[] {
  if (Array.isArray(payload)) {
    const models: CapabilityModelEntry[] = [];
    for (const item of payload) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id : "";
      if (id.length === 0) continue;
      const name = typeof item.name === "string" && item.name.length > 0 ? item.name : id;
      const contextWindow = contextWindowOf(item);
      models.push({ id, name, ...(contextWindow === undefined ? {} : { contextWindow }) });
    }
    return models;
  }
  if (!isRecord(payload)) return [];
  const models: CapabilityModelEntry[] = [];
  for (const [id, value] of Object.entries(payload)) {
    if (id.length === 0) continue;
    const name =
      isRecord(value) && typeof value.name === "string" && value.name.length > 0
        ? value.name
        : id;
    const contextWindow = contextWindowOf(value);
    models.push({ id, name, ...(contextWindow === undefined ? {} : { contextWindow }) });
  }
  return models;
}

export function toProviderEntries(payload: unknown): readonly CapabilityProviderEntry[] {
  if (!isRecord(payload) && !Array.isArray(payload)) return [];
  const rawList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.providers)
      ? payload.providers
      : Array.isArray(payload.all)
        ? payload.all
        : [];
  const providers: CapabilityProviderEntry[] = [];
  for (const item of rawList) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) continue;
    providers.push({
      id: item.id,
      name: typeof item.name === "string" && item.name.length > 0 ? item.name : item.id,
      models: toModelEntries(item.models),
    });
  }
  return providers;
}

export function toDefaultModels(payload: unknown): Readonly<Record<string, string>> {
  if (!isRecord(payload)) return {};
  const map = isRecord(payload.default)
    ? payload.default
    : isRecord(payload.defaultModels)
      ? payload.defaultModels
      : isRecord(payload.defaults)
        ? payload.defaults
        : payload;
  if (!isRecord(map)) return {};
  const result: Record<string, string> = {};
  for (const [providerId, modelId] of Object.entries(map)) {
    if (providerId.length > 0 && typeof modelId === "string" && modelId.length > 0) {
      result[providerId] = modelId;
    }
  }
  return result;
}

export function toDefaultModel(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.model === "string" && payload.model.length > 0) return payload.model;
  if (typeof payload.defaultModel === "string" && payload.defaultModel.length > 0) return payload.defaultModel;
  return undefined;
}

// ---------------------------------------------------------------------------
// splitModelId — the FIRST-"/" rule for the todo-3 `sendPrompt.model` string
// (plan binding; see capabilityInfo.ts header). The single implementation
// lives in todo-14's prompt pipeline; this alias keeps the pickers' contract
// readable at one import site shared by this package's consumers.

export { parseModelString as splitModelId } from "./promptPipeline.js";
export type { PromptModelRef as ModelIdParts } from "./promptPipeline.js";

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
import type { AgentSummary, CommandSummary } from "../../server/capabilities.js";

/** Event-channel type carrying {@link CapabilitiesRefreshPayload}. */
export const CAPABILITIES_REFRESH_EVENT = "capabilities.refresh";

/** One model inside a provider group (defensive parse of /config/providers). */
export interface CapabilityModelEntry {
  readonly id: string;
  readonly name: string;
}

/** One provider group; `models` may be empty (the webview hides the group). */
export interface CapabilityProviderEntry {
  readonly id: string;
  readonly name: string;
  readonly models: readonly CapabilityModelEntry[];
}

/** The `capabilities.refresh` payload (see capabilityInfo.ts for the contract). */
export interface CapabilitiesRefreshPayload {
  readonly agents: readonly AgentSummary[];
  readonly commands: readonly CommandSummary[];
  readonly providers: readonly CapabilityProviderEntry[];
  readonly defaultModels: Readonly<Record<string, string>>;
  readonly defaultModel?: string;
}

export function toModelEntries(payload: unknown): readonly CapabilityModelEntry[] {
  if (!isRecord(payload)) return [];
  const models: CapabilityModelEntry[] = [];
  for (const [id, value] of Object.entries(payload)) {
    if (id.length === 0) continue;
    const name =
      isRecord(value) && typeof value.name === "string" && value.name.length > 0
        ? value.name
        : id;
    models.push({ id, name });
  }
  return models;
}

export function toProviderEntries(payload: unknown): readonly CapabilityProviderEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.providers)) return [];
  const providers: CapabilityProviderEntry[] = [];
  for (const item of payload.providers) {
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
  if (!isRecord(payload) || !isRecord(payload.default)) return {};
  const result: Record<string, string> = {};
  for (const [providerId, modelId] of Object.entries(payload.default)) {
    if (providerId.length > 0 && typeof modelId === "string" && modelId.length > 0) {
      result[providerId] = modelId;
    }
  }
  return result;
}

export function toDefaultModel(payload: unknown): string | undefined {
  if (!isRecord(payload) || typeof payload.model !== "string") return undefined;
  return payload.model.length > 0 ? payload.model : undefined;
}

// ---------------------------------------------------------------------------
// splitModelId — the FIRST-"/" rule for the todo-3 `sendPrompt.model` string
// (plan binding; see capabilityInfo.ts header). The single implementation
// lives in todo-14's prompt pipeline; this alias keeps the pickers' contract
// readable at one import site shared by this package's consumers.

export { parseModelString as splitModelId } from "./promptPipeline.js";
export type { PromptModelRef as ModelIdParts } from "./promptPipeline.js";

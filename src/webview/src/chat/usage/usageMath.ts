// i18n-allow-literal — no display copy in this module.
/**
 * Token-usage aggregation (FIX-D, plan must-have 23): DOM-free math behind
 * the chat toolbar's usage strip.
 *
 * DATA SOURCE: assistant messages carry `info.tokens` as a record with
 * `{input, output, reasoning}` counters (todo-5 mock shape, mirrored in
 * chat/__tests__ fixtures; `cache` sub-counters exist on the wire but are
 * not part of the strip's scope). The message store already gates events to
 * the ACTIVE session, so summing its assistant rows IS the per-session
 * aggregate.
 *
 * ABSENCE RULE (binding): a message without a tokens record — user rows,
 * in-flight placeholders, old servers that never reported usage —
 * contributes nothing; a field that never carries a finite number across
 * the whole session renders as ABSENT (never as a fabricated 0), and when
 * NO usage data exists at all the strip hides (`null`).
 */

import { isRecord } from "../../../../shared/protocol.js";
import type { MessageVM } from "../types.js";

/** Per-session assistant token totals; undefined = the field never reported. */
export interface SessionUsage {
  readonly input: number | undefined;
  readonly output: number | undefined;
  readonly reasoning: number | undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Sum assistant `info.tokens` over the (active-session) message view. */
export function sumAssistantUsage(messages: readonly MessageVM[]): SessionUsage | null {
  let input: number | undefined;
  let output: number | undefined;
  let reasoning: number | undefined;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (!isRecord(message.info.tokens)) continue;
    const tokens = message.info.tokens;
    const inPart = finiteNumber(tokens.input);
    if (inPart !== undefined) input = (input ?? 0) + inPart;
    const outPart = finiteNumber(tokens.output);
    if (outPart !== undefined) output = (output ?? 0) + outPart;
    const reasoningPart = finiteNumber(tokens.reasoning);
    if (reasoningPart !== undefined) reasoning = (reasoning ?? 0) + reasoningPart;
  }
  if (input === undefined && output === undefined && reasoning === undefined) return null;
  return { input, output, reasoning };
}

// ---------------------------------------------------------------------------
// Context-window usage: prompt-side footprint of the LATEST assistant turn.

/**
 * The current context size per the LAST assistant message that reported
 * tokens: `input + cache.read` (prompt-side window, matching opencode's own
 * context accounting; `output`/`reasoning` are generated AFTER the prompt
 * and `cache.write` is one-time). `null` when nothing reported usage yet.
 */
export function latestContextTokens(messages: readonly MessageVM[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant" || message.inFlight) continue;
    if (!isRecord(message.info.tokens)) continue;
    const tokens = message.info.tokens;
    const input = finiteNumber(tokens.input) ?? 0;
    const cacheRead = isRecord(tokens.cache) ? (finiteNumber(tokens.cache.read) ?? 0) : 0;
    const total = input + cacheRead;
    if (total > 0) return total;
  }
  return null;
}

/** "121k" shorthand (decimal k); keeps the toolbar compact at any scale. */
export function formatK(tokens: number): string {
  return `${String(Math.round(tokens / 1000))}k`;
}

/**
 * The strip's display text: `121k / 1049k · 12%` with a known window,
 * `121k` without one (never a fabricated percentage).
 */
export function formatContextUsage(used: number, contextWindow: number | undefined): string {
  const usedText = formatK(used);
  if (contextWindow === undefined || contextWindow <= 0) return usedText;
  const percent = Math.min(999, Math.max(0, Math.round((used / contextWindow) * 100)));
  return `${usedText} / ${formatK(contextWindow)} · ${String(percent)}%`;
}

/**
 * Resolve the context window for "provider/model" against the snapshot's
 * provider list; splits at the FIRST "/" (the wire's canonical rule), and
 * tolerates snapshots the server never enriched with limits.
 */
export function contextWindowForModel(
  model: string | undefined,
  providers: readonly {
    readonly id: string;
    readonly models: readonly { readonly id: string; readonly contextWindow?: number | undefined }[];
  }[],
): number | undefined {
  if (model === undefined) return undefined;
  const slash = model.indexOf("/"); // i18n-allow-literal
  if (slash === -1) return undefined;
  const providerId = model.slice(0, slash);
  const modelId = model.slice(slash + 1);
  for (const provider of providers) {
    if (provider.id !== providerId) continue;
    for (const entry of provider.models) {
      if (entry.id === modelId) return entry.contextWindow;
    }
  }
  return undefined;
}

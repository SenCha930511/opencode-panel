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

/**
 * Chat view-models + tolerant boundary parsers (todo 13 webview side).
 *
 * Everything here parses `unknown` wire data into typed view-models exactly
 * once; components and the store only ever see {@link PartVM} /
 * {@link MessageVM}. Parsers NEVER throw: an unrecognized part shape becomes
 * an `unknown` card (never dropped), a missing id becomes a synthesized
 * fallback id, and malformed deltas parse to `undefined` so the router can
 * skip the single bad entry instead of failing the batch.
 *
 * DELTA ENVELOPE (verbatim from T9 src/server/eventBridge.ts header):
 * `message.part.deltaBatch` payloads carry `{ parts: DeltaBatchEntry[] }`
 * where each entry is `{ sessionID?, messageID, partID, field?, delta,
 * count }` with deltas already merged per (messageID, partID, field) inside
 * the host's 30ms window. The malformed-delta fallback (`message.part.delta`
 * forwarded unbatched) shares the same per-entry shape.
 */

import { isRecord } from "../../../shared/protocol.js";

/** One (already host-merged) delta, mirrors T9's DeltaBatchEntry minus `count`. */
export interface DeltaBatchEntry {
  readonly sessionID: string | undefined;
  readonly messageID: string;
  readonly partID: string;
  readonly field: string | undefined;
  readonly delta: string;
}

export type ToolStatus = "pending" | "running" | "completed" | "error";

export type PartVM =
  | { readonly kind: "text"; readonly id: string; text: string }
  | { readonly kind: "reasoning"; readonly id: string; text: string }
  | {
      readonly kind: "tool";
      readonly id: string;
      /** Tool name VERBATIM from the payload (`tool`, else `name`). */
      readonly tool: string;
      readonly callID: string | undefined;
      status: ToolStatus;
      readonly title: string | undefined;
      readonly input: unknown;
      output: string | undefined;
      error: string | undefined;
      readonly raw: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "file";
      readonly id: string;
      readonly filename: string | undefined;
      readonly url: string | undefined;
      readonly mime: string | undefined;
    }
  | {
      readonly kind: "patch";
      readonly id: string;
      readonly sessionID: string | undefined;
      readonly messageID: string | undefined;
    }
  | {
      readonly kind: "unknown";
      readonly id: string;
      readonly typeName: string;
      readonly raw: Readonly<Record<string, unknown>>;
    };

export type PartKind = PartVM["kind"];

export interface MessageVM {
  readonly id: string;
  readonly sessionID: string | undefined;
  readonly role: string;
  readonly info: Readonly<Record<string, unknown>>;
  /** True while the message only exists because deltas referenced it. */
  readonly inFlight: boolean;
  parts: PartVM[];
}

export function parseToolStatus(value: unknown): ToolStatus {
  if (value === "running" || value === "completed" || value === "error") return value;
  return "pending";
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse one part; `fallbackId` keeps the card keyed when the payload dropped
 * the id. Unknown types yield an `unknown` card — the todo-13 hard rule is
 * that nothing a server (or an OMO plugin) emits may crash the list.
 */
export function parsePart(value: unknown, fallbackId: string): PartVM {
  if (!isRecord(value)) {
    return { kind: "unknown", id: fallbackId, typeName: "non-object", raw: {} };
  }
  const id = stringOr(value.id) ?? fallbackId;
  switch (value.type) {
    case "text":
      return { kind: "text", id, text: stringOr(value.text) ?? "" };
    case "reasoning":
      return { kind: "reasoning", id, text: stringOr(value.text) ?? "" };
    case "tool": {
      const state = isRecord(value.state) ? value.state : {};
      return {
        kind: "tool",
        id,
        tool: stringOr(value.tool) ?? stringOr(value.name) ?? "tool",
        callID: stringOr(value.callID),
        status: parseToolStatus(state.status),
        title: stringOr(state.title),
        input: state.input,
        output: stringOr(state.output),
        error: stringOr(state.error),
        raw: value,
      };
    }
    case "file":
      return {
        kind: "file",
        id,
        filename: stringOr(value.filename),
        url: stringOr(value.url),
        mime: stringOr(value.mime),
      };
    case "patch":
      return {
        kind: "patch",
        id,
        sessionID: stringOr(value.sessionID),
        messageID: stringOr(value.messageID),
      };
    default:
      return {
        kind: "unknown",
        id,
        typeName: stringOr(value.type) ?? "untyped",
        raw: value,
      };
  }
}

/** Parse one `{info, parts}` envelope; tolerant of partial shapes. */
export function parseMessage(value: unknown, index: number): MessageVM | undefined {
  if (!isRecord(value)) return undefined;
  const info = isRecord(value.info) ? value.info : {};
  const id = stringOr(info.id) ?? `message-${index}`;
  const rawParts = Array.isArray(value.parts) ? value.parts : [];
  const parts: PartVM[] = [];
  for (let i = 0; i < rawParts.length; i += 1) {
    parts.push(parsePart(rawParts[i], `${id}:part-${i}`));
  }
  return {
    id,
    sessionID: stringOr(info.sessionID),
    role: stringOr(info.role) ?? "assistant",
    info,
    inFlight: false,
    parts,
  };
}

/** Parse a full sync list (`messages.sync` full payload / delta upserts). */
export function parseMessageList(payload: unknown): MessageVM[] {
  if (!Array.isArray(payload)) return [];
  const messages: MessageVM[] = [];
  for (let i = 0; i < payload.length; i += 1) {
    const message = parseMessage(payload[i], i);
    if (message !== undefined) messages.push(message);
  }
  return messages;
}

/** Parse one delta entry (T9 envelope); `undefined` on malformed entries. */
export function parseDeltaEntry(value: unknown): DeltaBatchEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.messageID !== "string" || value.messageID.length === 0) return undefined;
  if (typeof value.partID !== "string" || value.partID.length === 0) return undefined;
  if (typeof value.delta !== "string" || value.delta.length === 0) return undefined;
  return {
    sessionID: stringOr(value.sessionID),
    messageID: value.messageID,
    partID: value.partID,
    field: stringOr(value.field),
    delta: value.delta,
  };
}

/** Parse the `message.part.deltaBatch` payload; skips malformed entries. */
export function parseDeltaBatch(payload: unknown): DeltaBatchEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.parts)) return [];
  const entries: DeltaBatchEntry[] = [];
  for (const value of payload.parts) {
    const entry = parseDeltaEntry(value);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

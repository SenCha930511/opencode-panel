/**
 * Shared literals + wire boundary parsers for the sessions webview domain.
 *
 * `SESSIONS_LIST_EVENT` mirrors src/host/handlers/sync.ts — the host posts the
 * session-list broadcast over the todo-3 `event` channel under this type
 * (todo-10 exposes no typed `sessionList` port; see the sync.ts module header
 * for the full rationale). The two copies are pinned by tests on both sides
 * because the host bundle must not import webview code.
 */

import type { SessionSummary } from "../../../shared/protocol.js";

export const SESSIONS_LIST_EVENT = "sessions.list";

/** Minimal disposal contract shared by the store's wire subscriptions. */
export interface Disposable {
  dispose(): void;
}

/**
 * Wire-side session entry: todo-3 `SessionSummary` plus the `shared` flag the
 * todo-12 badge needs (host extension field; absent degrades to unshared).
 */
export interface SessionEntry extends SessionSummary {
  readonly shared: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSubagentSessionEntry(entry: { title?: string; parentID?: string }): boolean {
  const lower = (entry.title ?? "").toLowerCase().trim();
  if (
    lower.startsWith("subtask:") ||
    lower.startsWith("subagent:") ||
    lower.startsWith("[subagent]") ||
    lower.startsWith("subtask ") ||
    lower.startsWith("subagent ") ||
    lower.includes("(subagent)") ||
    lower.includes("[subtask]")
  ) {
    return true;
  }
  if (entry.parentID && !lower.endsWith("(fork)")) {
    return true;
  }
  return false;
}

/** Boundary parse: unknown wire entry -> SessionEntry (null = drop). */
export function toSessionEntry(value: unknown): SessionEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.title !== "string") return null;
  if (typeof value.updatedAt !== "string") return null;
  const parentID = typeof value.parentID === "string" ? value.parentID : undefined;
  if (isSubagentSessionEntry({ title: value.title, parentID })) return null;
  return {
    id: value.id,
    title: value.title,
    updatedAt: value.updatedAt,
    shared: value.shared === true,
  };
}

/** Boundary parse of a host-pushed `{sessions}` payload (both carriers). */
export function toSessionEntries(value: unknown): readonly SessionEntry[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return [];
  const entries: SessionEntry[] = [];
  for (const item of value.sessions) {
    const entry = toSessionEntry(item);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

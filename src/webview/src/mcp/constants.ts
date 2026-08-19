/**
 * Wire literals + boundary parsers for the todo-20 MCP panel feed (webview
 * side).
 *
 * `MCP_STATUS_EVENT` mirrors src/host/handlers/mcpInfo.ts — the host pushes
 * the natively-configured MCP inventory plus the capability guard set over
 * the todo-3 `event` channel under this type (the frozen protocol names no
 * MCP or flag fetch; see that module's header for the full push contract).
 * The two copies are pinned by tests on both sides because the host and
 * webview bundles never import each other (precedent: todo-12's
 * SESSIONS_LIST_EVENT, todo-15's CAPABILITIES_REFRESH_EVENT).
 *
 * CARRIER DECISION (plan caveat-1 documentation): the omo/shell/oldServer
 * guard bits ride THIS push's `guards` block — todo-3's minimal
 * `init.capabilities` names only fork/question/todo, and todo 15's
 * `capabilities.refresh` carries picker data, not flags. The flags store
 * (./capabilityFlags.ts) still accepts (a) the init baseline and (b) an
 * optional `guards` block from a future capabilities.refresh revision, plus
 * the todo-7 `toWire()` alias spelling `omo` for omoDetected, so no later
 * wire change strands the UI.
 */

/** Event-channel type carrying the host's mcp.status payload. */
export const MCP_STATUS_EVENT = "mcp.status";

/** One natively-configured MCP server entry (status verbatim, error when set). */
export interface McpServerEntry {
  readonly name: string;
  readonly status: string;
  readonly error?: string;
}

/** The full guard set the mcp.status push carries (todo-7 guard() + extras). */
export interface McpGuards {
  readonly fork: boolean;
  readonly question: boolean;
  readonly todo: boolean;
  readonly shell: boolean;
  readonly omoDetected: boolean;
  readonly omoMcpNote: boolean;
  readonly oldServer: boolean;
}

/** Parsed mcp.status payload (see mcpInfo.ts header for the contract). */
export interface McpStatusSnapshot {
  readonly servers: readonly McpServerEntry[];
  readonly guards: McpGuards;
  readonly error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMcpServerEntry(value: unknown): McpServerEntry | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return undefined;
  }
  const status =
    typeof value.status === "string" && value.status.length > 0 ? value.status : "unknown";
  const error =
    typeof value.error === "string" && value.error.length > 0 ? value.error : undefined;
  return { name: value.name, status, ...(error === undefined ? {} : { error }) };
}

/**
 * Parse the full guard set (mcp.status requires all seven bits; a partial or
 * drifted block invalidates the WHOLE push — never a half-applied overlay).
 */
export function parseGuards(value: unknown): McpGuards | undefined {
  if (!isRecord(value)) return undefined;
  const { fork, question, todo, shell, omoDetected, omoMcpNote, oldServer } = value;
  if (
    typeof fork !== "boolean" ||
    typeof question !== "boolean" ||
    typeof todo !== "boolean" ||
    typeof shell !== "boolean" ||
    typeof omoDetected !== "boolean" ||
    typeof omoMcpNote !== "boolean" ||
    typeof oldServer !== "boolean"
  ) {
    return undefined;
  }
  return { fork, question, todo, shell, omoDetected, omoMcpNote, oldServer };
}

/**
 * The partial form of {@link McpGuards} carried by the non-authoritative
 * wire sources. Explicitly `-readonly`: the parser builds it incrementally
 * (a plain `?` mapping would keep {@link McpGuards}' readonly modifiers).
 */
export type McpGuardsOverlay = { -readonly [K in keyof McpGuards]?: boolean };

/**
 * Parse a PARTIAL guard overlay from the other wire sources
 * (init.capabilities today carries fork/question/todo; a future
 * capabilities.refresh revision may carry a `guards` block). Only boolean
 * keys apply; the todo-7 `toWire()` alias `omo` maps onto `omoDetected`.
 */
export function parseGuardsOverlay(value: unknown): McpGuardsOverlay {
  if (!isRecord(value)) return {};
  const overlay: McpGuardsOverlay = {};
  if (typeof value.fork === "boolean") overlay.fork = value.fork;
  if (typeof value.question === "boolean") overlay.question = value.question;
  if (typeof value.todo === "boolean") overlay.todo = value.todo;
  if (typeof value.shell === "boolean") overlay.shell = value.shell;
  if (typeof value.omoDetected === "boolean") overlay.omoDetected = value.omoDetected;
  if (typeof value.omo === "boolean") overlay.omoDetected = value.omo;
  if (typeof value.omoMcpNote === "boolean") overlay.omoMcpNote = value.omoMcpNote;
  if (typeof value.oldServer === "boolean") overlay.oldServer = value.oldServer;
  return overlay;
}

/** Boundary parse of the mcp.status payload; undefined = ignore the push. */
export function parseMcpStatusSnapshot(value: unknown): McpStatusSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const guards = parseGuards(value.guards);
  if (guards === undefined || !Array.isArray(value.servers)) return undefined;
  const servers: McpServerEntry[] = [];
  for (const item of value.servers) {
    const entry = toMcpServerEntry(item);
    if (entry !== undefined) servers.push(entry);
  }
  const error =
    typeof value.error === "string" && value.error.length > 0 ? value.error : undefined;
  return { servers, guards, ...(error === undefined ? {} : { error }) };
}

/**
 * Theme-token dot classes (todo 11 theme.css `--color-ok/--color-err/
 * --color-off/--color-warn`); never a raw hex in a component.
 */
export type McpDotClass = "bg-ok" | "bg-warn" | "bg-err" | "bg-off";

/**
 * opencode MCP status union per the installed SDK (types.gen.d.ts: McpStatus
 * = connected | disabled | failed | needs_auth | needs_client_registration).
 * Unknown/future statuses render as DATA with the warn dot — no invented
 * colors and no special-cased names (OMO-friendly).
 */
export function dotForStatus(status: string): McpDotClass {
  switch (status) {
    case "connected":
      return "bg-ok";
    case "disabled":
      return "bg-off";
    case "failed":
      return "bg-err";
    default:
      return "bg-warn";
  }
}

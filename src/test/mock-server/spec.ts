/**
 * OpenAPI spec for the mock server and the /doc page wrapping it.
 *
 * /doc EMBEDDING ASSUMPTION (must be re-verified against a live `opencode serve`
 * in a later executor-QA todo): the real server is assumed to serve a
 * Scalar-style HTML shell embedding the spec as
 *   <script id="api-reference" type="application/json">{...spec json...}</script>
 * which is the layout the capability detector (todo 7) will extract from.
 * `/doc?raw=1` additionally serves the pure JSON spec so detectors can be
 * tested against both forms (some server builds return JSON directly).
 */
import type { ScenarioName } from "./types.js";

type RouteRow = readonly [method: string, path: string, summary: string, modernOnly?: boolean];

/**
 * Full route inventory from plan todo 5. `modernOnly: true` rows are omitted
 * by the old-server scenario (it must 404 them AND drop them from /doc so the
 * capability detector hides the features).
 */
const ROUTES: ReadonlyArray<RouteRow> = [
  ["get", "/global/health", "Health check"],
  ["get", "/event", "Server-sent event stream"],
  ["get", "/session", "List sessions"],
  ["post", "/session", "Create session"],
  ["get", "/session/{id}", "Get session"],
  ["patch", "/session/{id}", "Update session"],
  ["delete", "/session/{id}", "Delete session"],
  ["post", "/session/{id}/fork", "Fork session", true],
  ["post", "/session/{id}/share", "Share session"],
  ["delete", "/session/{id}/share", "Unshare session"],
  ["post", "/session/{id}/abort", "Abort session"],
  ["post", "/session/{id}/summarize", "Summarize session"],
  ["post", "/session/{id}/revert", "Revert a message"],
  ["post", "/session/{id}/unrevert", "Restore reverted messages"],
  ["post", "/session/{id}/command", "Run a slash command"],
  ["post", "/session/{id}/shell", "Run a shell command"],
  ["post", "/session/{id}/prompt_async", "Prompt asynchronously", true],
  ["get", "/session/{id}/message", "List messages"],
  ["post", "/session/{id}/message", "Send a message and wait for completion"],
  ["get", "/session/{id}/message/{messageID}", "Get a message"],
  ["get", "/session/{id}/todo", "List session todos", true],
  ["get", "/session/{id}/diff", "Session diff"],
  ["post", "/session/{id}/permissions/{permissionID}", "Reply to a permission request"],
  // Question reply route shape is an ASSUMPTION (mirrors the permissions
  // route); the realtime event `question.asked` is plan-binding but the reply
  // endpoint is not confirmed in current opencode docs. old-server omits it.
  ["post", "/session/{id}/questions/{requestID}", "Reply to a question request", true],
  ["get", "/agent", "List agents"],
  ["get", "/command", "List commands"],
  ["get", "/config", "Get config"],
  ["patch", "/config", "Update config"],
  ["get", "/config/providers", "List configured providers and defaults"],
  ["get", "/provider", "List providers"],
  ["patch", "/provider", "Update provider auth/settings"],
  ["get", "/provider/auth", "Provider auth methods"],
  ["get", "/mcp", "MCP server status"],
  ["get", "/path", "Resolved paths"],
  ["get", "/file", "List files"],
  ["get", "/file/content", "Read file content"],
  ["get", "/file/status", "File change status"],
  ["get", "/find", "Find text in files"],
  ["get", "/find/file", "Find files by name"],
  ["get", "/find/symbol", "Find workspace symbols"],
];

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { summary: string; responses: Record<string, { description: string }> }>>;
}

/**
 * Question reply route shapes as advertised by the LIVE 1.18.15 doc probe:
 * the unprefixed `/session/{id}/question…` family fluctuates in and out of
 * the inventory, while the global routes and the `/api`-prefixed session
 * routes are stable — a capability detector must accept every family.
 */
const MODERN_QUESTION_ROWS: ReadonlyArray<RouteRow> = [
  ["post", "/session/{id}/question/{requestID}/reply", "Reply to a question request", true],
  ["post", "/session/{id}/question/{requestID}/reject", "Reject a question request", true],
  ["post", "/api/session/{sessionID}/question/{requestID}/reply", "Reply to a question request", true],
  ["post", "/api/session/{sessionID}/question/{requestID}/reject", "Reject a question request", true],
  ["post", "/question/{requestID}/reply", "Reply to a question request", true],
  ["post", "/question/{requestID}/reject", "Reject a question request", true],
];

export type DocVariant = "modern";

/** When `docVariant` is "modern", the legacy assumed question row is swapped
 *  for the real-world route families (mock `/doc?qshape=modern`). */
export type BuildSpecDocVariant = DocVariant | undefined;

export function buildOpenApiSpec(scenario: ScenarioName, version: string): OpenApiSpec {
  const oldServer = scenario === "old-server";
  const paths: OpenApiSpec["paths"] = {};
  for (const [method, path, summary, modernOnly] of ROUTES) {
    if (oldServer && modernOnly) continue;
    paths[path] = {
      ...(paths[path] ?? {}),
      [method]: { summary, responses: { "200": { description: "Success" } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "opencode API", version },
    paths,
  };
}

export function renderDocHtml(spec: OpenApiSpec): string {
  // Escaped so a "</script>" inside the JSON cannot terminate the tag early.
  const json = JSON.stringify(spec).replace(/</g, "\\u003c");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>opencode API</title></head>` +
    `<body><script id="api-reference" type="application/json">${json}</script></body></html>`
  );
}

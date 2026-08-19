/**
 * Raw read-only server probes for capability detection (plan todo 7a/b):
 * `GET /global/health` ({@link probeHealth}) and `GET /doc`
 * ({@link probeDoc}). Everything here flows through the panel client's
 * auth-injecting {@link ProbeFetch} and NEVER POSTs.
 *
 * Real opencode servers serve the OpenAPI spec under `/doc`, wrapped in a
 * Scalar-style HTML shell. The todo-5 mock documents the assumed embedding —
 * `<script id="api-reference" type="application/json">…</script>` — and some
 * builds answer JSON directly (`content-type: application/json`). This probe
 * handles both, then falls back to CHEAP read-only GET probes when the spec
 * cannot be obtained or parsed.
 *
 * Fallback semantics (plan rule — capability hidden on ambiguity):
 * only `GET /session/<probe>/todo` is distinguishable without mutating
 * anything: a 404 "session not found" proves the route EXISTS (the router
 * matched and rejected the id), while a 404 "route not found / not
 * available" means the route is ABSENT. Both answers are 404, so the body
 * decides. fork/question/shell are POST-only routes; a read-only probe
 * cannot distinguish absent-route from session-not-found, so those
 * capabilities are HIDDEN in fallback mode.
 */

import type { ProbeFetch } from "./clientFactory.js";

export interface HealthProbe {
  readonly ok: boolean;
  /** Server-reported version; "" when absent from the payload. */
  readonly version: string;
}

/** GET `${baseUrl}/global/health`; any failure → `{ ok: false, version: "" }`. */
export async function probeHealth(fetchImpl: ProbeFetch, baseUrl: string): Promise<HealthProbe> {
  try {
    const response = await fetchImpl(new Request(`${baseUrl}/global/health`));
    if (!response.ok) return { ok: false, version: "" };
    const body: unknown = await response.json();
    const version = isRecord(body) && typeof body.version === "string" ? body.version : "";
    return { ok: true, version };
  } catch {
    return { ok: false, version: "" };
  }
}

/**
 * Outcome of the `/doc` probe, discriminated by how the route inventory was
 * obtained (or not). `spec` carries the full spec path list; `fallback`
 * carries the single bit the read-only probe could prove.
 */
export type DocProbeResult =
  | { readonly kind: "spec"; readonly source: "json" | "embedded"; readonly paths: readonly string[] }
  | { readonly kind: "fallback"; readonly todoPresent: boolean };

const JSON_CONTENT = "application/json";

/** Sessions id used by fallback probes; must not collide with a real id. */
const FALLBACK_PROBE_SESSION = "__capability_probe__";

/**
 * Extract the OpenAPI path inventory from a `/doc` response body.
 * - JSON content-type → parse directly.
 * - otherwise → extract the embedded spec from the Scalar-style wrapper:
 *   prefer `<script id="api-reference" type="application/json">`, fall back
 *   to ANY `type="application/json"` script body.
 * Returns `undefined` when no usable spec is found.
 */
export function extractSpecPaths(
  contentType: string | null,
  body: string,
): readonly string[] | undefined {
  if (contentType !== null && contentType.toLowerCase().includes(JSON_CONTENT)) {
    return specPathsFromJson(body);
  }
  for (const candidate of embeddedSpecCandidates(body)) {
    const paths = specPathsFromJson(candidate);
    if (paths !== undefined) return paths;
  }
  return undefined;
}

/** Parse a spec document; `undefined` unless it is an object with an object `paths`. */
function specPathsFromJson(json: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (!isRecord(parsed.paths)) return undefined;
  return Object.keys(parsed.paths);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ID_API_REFERENCE = /\bid\s*=\s*"api-reference"/i;
const TYPE_JSON = /\btype\s*=\s*"application\/json"/i;

/**
 * Candidate spec bodies from an HTML wrapper, most-preferred first: the
 * `id="api-reference"` script, then any `type="application/json"` script.
 */
function embeddedSpecCandidates(html: string): readonly string[] {
  const byId: string[] = [];
  const byType: string[] = [];
  for (const match of html.matchAll(SCRIPT_BLOCK)) {
    const attrs = match[1] ?? "";
    const scriptBody = match[2];
    if (scriptBody === undefined) continue;
    if (ID_API_REFERENCE.test(attrs)) {
      byId.push(scriptBody);
    } else if (TYPE_JSON.test(attrs)) {
      byType.push(scriptBody);
    }
  }
  return [...byId, ...byType];
}

/**
 * Probe the todo route with a read-only GET against a deliberately
 * nonexistent session id. TRUE only when the router demonstrably matched the
 * route (404 whose body says the SESSION is missing); every other outcome is
 * ambiguous and answered FALSE so the feature stays hidden.
 */
async function probeTodoRoute(fetchImpl: ProbeFetch, baseUrl: string): Promise<boolean> {
  const url = `${baseUrl}/session/${FALLBACK_PROBE_SESSION}/todo`;
  let response: Response;
  try {
    response = await fetchImpl(new Request(url));
  } catch {
    return false;
  }
  if (response.status === 200) return true;
  if (response.status !== 404) return false;
  const text = await response.text().catch(() => "");
  return text.includes("session not found");
}

/**
 * Fetch and interpret `${baseUrl}/doc`. `docQuery` (without "?") is a test
 * seam letting suites exercise the JSON-direct branch against the todo-5
 * mock (`raw=1`); production callers omit it and get the wrapped HTML form.
 * Any transport failure, non-2xx, or unparsable body drops to the fallback
 * GET probes — never throws.
 */
export async function probeDoc(
  fetchImpl: ProbeFetch,
  baseUrl: string,
  docQuery?: string,
): Promise<DocProbeResult> {
  const url = `${baseUrl}/doc${docQuery === undefined ? "" : `?${docQuery}`}`;
  try {
    const response = await fetchImpl(new Request(url));
    if (response.ok) {
      const body = await response.text();
      const paths = extractSpecPaths(response.headers.get("content-type"), body);
      if (paths !== undefined) {
        const isJson = (response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes(JSON_CONTENT);
        return { kind: "spec", source: isJson ? "json" : "embedded", paths };
      }
    }
  } catch {
    // Transport failure: fall through to the cheap GET probes.
  }
  const todoPresent = await probeTodoRoute(fetchImpl, baseUrl);
  return { kind: "fallback", todoPresent };
}

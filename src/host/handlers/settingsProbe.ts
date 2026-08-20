/**
 * Server health probe for the settings page's Test Connection (plan todo 21).
 *
 * GETs `${baseUrl}/global/health` through the injected fetch factory — in
 * production this is the todo-7 auth-recovering `probeFetch`, so a password-
 * protected server probes exactly like every other panel request (stored
 * credentials are retried once on 401 and NEVER leave SecretStorage). The
 * probe NEVER throws: every outcome degrades to a typed {@link ServerHealth}
 * the settings page renders inline. `detail` carries only an HTTP status or
 * a fetch error message — never credential material.
 */

import { AuthRequiredError, type ProbeFetch } from "../../server/clientFactory.js";

export type ServerHealthStatus = "ok" | "unreachable" | "error";

export interface ServerHealth {
  readonly status: ServerHealthStatus;
  readonly url: string;
  /** Server-reported version, when the health payload carried one. */
  readonly version: string | null;
  /** ISO-8601 timestamp of the probe attempt. */
  readonly checkedAt: string;
  /** Technical detail for the failure states (HTTP status / fetch error). */
  readonly detail?: string;
}

export type HealthProbe = (baseUrl: string) => Promise<ServerHealth>;

export interface HealthProbeDeps {
  /** Builds the fetch used for a probe of one server (auth-aware in production). */
  readonly probeFetchFor: (baseUrl: string) => ProbeFetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DETAIL_LIMIT = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureDetail(error: unknown): string {
  if (error instanceof AuthRequiredError) {
    return "authentication required (store the password in the Server section)";
  }
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > DETAIL_LIMIT ? `${raw.slice(0, DETAIL_LIMIT)}…` : raw;
}

export function createHealthProbe(deps: HealthProbeDeps): HealthProbe {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? (() => new Date());
  return async (baseUrl) => {
    const checkedAt = now().toISOString();
    let response: Response;
    try {
      response = await deps.probeFetchFor(baseUrl)(
        new Request(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(timeoutMs) }),
      );
    } catch (error) {
      return { status: "unreachable", url: baseUrl, version: null, checkedAt, detail: failureDetail(error) };
    }
    if (!response.ok) {
      return {
        status: "error",
        url: baseUrl,
        version: null,
        checkedAt,
        detail: `HTTP ${response.status}`,
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "error", url: baseUrl, version: null, checkedAt, detail: "unparseable /global/health payload" };
    }
    const healthy = isRecord(payload) && payload.healthy !== false;
    const version =
      isRecord(payload) && typeof payload.version === "string" && payload.version.length > 0
        ? payload.version
        : null;
    if (!healthy) {
      return { status: "error", url: baseUrl, version, checkedAt, detail: "server reported unhealthy" };
    }
    return { status: "ok", url: baseUrl, version, checkedAt };
  };
}

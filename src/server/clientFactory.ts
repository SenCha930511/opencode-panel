/**
 * SDK client factory with basic-auth recovery (plan todo 7).
 *
 * Wraps `createOpencodeClient({ baseUrl })` from `@opencode-ai/sdk` behind a
 * custom `fetch` that implements the plan's credential flow:
 *
 *   1. Every request first goes out WITHOUT credentials.
 *   2. On 401 the credentials for this baseUrl are read from SecretStorage
 *      (`PanelSecrets`, todo 6) and the request is retried ONCE with
 *      `Authorization: Basic base64(user:pass)` — username defaults to
 *      "opencode" (opencode's default; overridable per server).
 *   3. No stored password, or the retry also answers 401 → throw
 *      {@link AuthRequiredError} carrying the baseUrl (the UI then offers
 *      password entry; ServerManager todo 8 catches this type).
 *
 * After a successful authenticated retry the header is remembered FOR THIS
 * CLIENT INSTANCE and sent preemptively, so long-lived consumers (SSE
 * subscribe, todo 9) do not pay a 401/retry round-trip per request. A 401 on
 * a remembered header means the credentials went stale and surfaces as
 * `AuthRequiredError("rejected")` without another retry (still ONE retry per
 * request — the spec's cap).
 *
 * Credentials are NEVER logged: trace lines carry method/url/status only, and
 * every line additionally passes through the todo-6 `redact` scrubber inside
 * `PanelLogger`.
 *
 * Public API consumed by other todos:
 * - todo 8 (ServerManager): {@link createPanelClient}, {@link AuthRequiredError}.
 * - todo 7 capability detector + todo 9 (SSE bridge): `panel.probeFetch` —
 *   the same auth-injecting fetch, reused for raw GET probes (`/doc`,
 *   `/global/health`, `/event`) so authed servers probe correctly.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../host/logger.js";
import type { PanelSecrets } from "../host/secrets.js";

/**
 * Fetch surface the SDK client and the raw capability probes share. Matches
 * the SDK `Config.fetch` contract (`(request: Request) => Promise<Response>`).
 */
export type ProbeFetch = (request: Request) => Promise<Response>;

export type AuthFailureReason = "no-credentials" | "rejected";

/**
 * The server demands basic auth and the request cannot proceed: either no
 * credentials are stored for {@link baseUrl} (UI should prompt) or the stored
 * ones were rejected (UI should re-prompt). NEVER carries credential material.
 */
export class AuthRequiredError extends Error {
  readonly baseUrl: string;
  readonly reason: AuthFailureReason;

  constructor(baseUrl: string, reason: AuthFailureReason) {
    super(
      `opencode server at ${baseUrl} requires authentication (${
        reason === "no-credentials" ? "no credentials stored" : "stored credentials rejected"
      })`,
    );
    this.name = "AuthRequiredError";
    this.baseUrl = baseUrl;
    this.reason = reason;
  }
}

export interface PanelClientDeps {
  readonly secrets: PanelSecrets;
  readonly logger: PanelLogger;
  /** Underlying fetch; defaults to `globalThis.fetch` (extension host). */
  readonly fetchImpl?: ProbeFetch;
}

export interface PanelServerClient {
  readonly baseUrl: string;
  readonly client: OpencodeClient;
  /** The auth-injecting fetch backing `client`; pass to the capability detector + SSE bridge. */
  readonly probeFetch: ProbeFetch;
}

/** opencode's default basic-auth username (OPENCODE_SERVER_USERNAME overrides server-side). */
const DEFAULT_USERNAME = "opencode";

/**
 * Build the auth-recovering fetch for one server. State (`cachedAuthHeader`)
 * lives in the closure: one instance per client, so a stale credential can
 * never leak across servers or across reconnects (todo 8 recreates the
 * client on reconnect, resetting the cache).
 */
function buildAuthFetch(baseUrl: string, raw: ProbeFetch, deps: PanelClientDeps): ProbeFetch {
  const { secrets, logger } = deps;
  let cachedAuthHeader: string | undefined;

  const withAuth = (request: Request, header: string | undefined): Request => {
    if (header === undefined) return request;
    const headers = new Headers(request.headers);
    headers.set("authorization", header);
    return new Request(request, { headers });
  };

  const credentialsHeader = async (): Promise<string | null> => {
    const password = await secrets.getPassword(baseUrl);
    if (password === undefined) return null;
    const username = (await secrets.getUsername(baseUrl)) ?? DEFAULT_USERNAME;
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return `Basic ${token}`;
  };

  const discardBody = async (response: Response): Promise<void> => {
    // Free the socket before the retry; failure is not actionable.
    try {
      await response.body?.cancel();
    } catch (error) {
      logger.debug(`http trace: failed to discard 401 body: ${String(error)}`);
    }
  };

  return async (request: Request) => {
    // Cloned upfront: once the first attempt runs, `request`'s body is spent
    // and could not be replayed for the authenticated retry (POST-safe).
    const replayable = request.clone();
    let response = await raw(withAuth(request, cachedAuthHeader));
    logger.httpTrace(`${request.method} ${request.url} -> ${response.status}`);
    if (response.status !== 401) return response;

    await discardBody(response);
    if (cachedAuthHeader !== undefined) {
      // The remembered header was rejected: stored credentials went stale.
      cachedAuthHeader = undefined;
      logger.warn(`opencode server at ${baseUrl} rejected the stored credentials`);
      throw new AuthRequiredError(baseUrl, "rejected");
    }

    logger.httpTrace(`${request.method} ${request.url} -> 401; retrying once with stored credentials`);
    const header = await credentialsHeader();
    if (header === null) {
      logger.warn(`opencode server at ${baseUrl} requires authentication; no credentials stored`);
      throw new AuthRequiredError(baseUrl, "no-credentials");
    }
    response = await raw(withAuth(replayable, header));
    logger.httpTrace(`${request.method} ${request.url} -> ${response.status} (authenticated retry)`);
    if (response.status === 401) {
      await discardBody(response);
      logger.warn(`opencode server at ${baseUrl} rejected the stored credentials`);
      throw new AuthRequiredError(baseUrl, "rejected");
    }
    cachedAuthHeader = header;
    return response;
  };
}

/**
 * Create an opencode SDK client for `baseUrl` with basic-auth recovery. The
 * returned `probeFetch` is the exact fetch the client uses — hand it to the
 * capability detector and the SSE bridge so every server call shares the
 * credential flow (and the post-auth header cache).
 */
export function createPanelClient(baseUrl: string, deps: PanelClientDeps): PanelServerClient {
  const raw: ProbeFetch = deps.fetchImpl ?? ((request) => globalThis.fetch(request));
  const probeFetch = buildAuthFetch(baseUrl, raw, deps);
  const client = createOpencodeClient({ baseUrl, fetch: probeFetch });
  return { baseUrl, client, probeFetch };
}

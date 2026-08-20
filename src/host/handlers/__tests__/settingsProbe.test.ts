import { describe, expect, it } from "vitest";
import { AuthRequiredError } from "../../../server/clientFactory.js";
import { createHealthProbe, type HealthProbeDeps } from "../settingsProbe.js";

/**
 * Probe behavioral matrix (plan todo 21): /global/health through a scripted
 * fetch. Every outcome is a typed ServerHealth — the probe never throws.
 */

const BASE_URL = "http://127.0.0.1:4096";
const FIXED_NOW = new Date("2026-08-20T04:00:00.000Z");

function probeReturning(body: unknown, status = 200) {
  return createHealthProbe({
    probeFetchFor: () => () =>
      Promise.resolve(
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
      ),
    now: () => FIXED_NOW,
  });
}

function probeWith(fetchImpl: HealthProbeDeps["probeFetchFor"] extends (baseUrl: string) => infer F ? F : never) {
  const requests: string[] = [];
  const probe = createHealthProbe({
    probeFetchFor: (baseUrl) => {
      requests.push(baseUrl);
      return fetchImpl;
    },
    now: () => FIXED_NOW,
  });
  return { probe, requests };
}

describe("createHealthProbe", () => {
  it("maps a healthy payload to ok with the reported version", async () => {
    // Given: a 200 { healthy, version } health answer
    const health = await probeReturning({ healthy: true, version: "1.2.3" })(BASE_URL);
    // Then: ok, version carried, timestamp fixed
    expect(health.status).toBe("ok");
    expect(health.version).toBe("1.2.3");
    expect(health.url).toBe(BASE_URL);
    expect(health.checkedAt).toBe(FIXED_NOW.toISOString());
  });

  it("probes exactly <baseUrl>/global/health", async () => {
    // Given: a fetch recording the outgoing request URL
    const seen: string[] = [];
    const { probe } = probeWith((request) => {
      seen.push(request.url);
      return Promise.resolve(new Response(JSON.stringify({ healthy: true }), { status: 200 }));
    });
    // When: the probe runs
    await probe(BASE_URL);
    // Then: exactly one request to the documented health route
    expect(seen).toEqual([`${BASE_URL}/global/health`]);
  });

  it("degrades a fetch rejection to unreachable with a technical detail", async () => {
    // Given: a fetch that fails like a refused connection
    const { probe } = probeWith(() => Promise.reject(new Error("fetch failed")));
    // When/Then
    const health = await probe(BASE_URL);
    expect(health.status).toBe("unreachable");
    expect(health.version).toBeNull();
    expect(health.detail).toContain("fetch failed");
  });

  it("maps a non-2xx answer to error with the HTTP status", async () => {
    // Given/When
    const health = await probeReturning({}, 500)(BASE_URL);
    // Then
    expect(health.status).toBe("error");
    expect(health.detail).toBe("HTTP 500");
    expect(health.version).toBeNull();
  });

  it("maps an unparseable body to error", async () => {
    // Given/When
    const health = await probeReturning("not json <*>")(BASE_URL);
    // Then
    expect(health.status).toBe("error");
    expect(health.detail).toBe("unparseable /global/health payload");
  });

  it("maps an explicit healthy:false payload to error", async () => {
    // Given/When
    const health = await probeReturning({ healthy: false })(BASE_URL);
    // Then
    expect(health.status).toBe("error");
    expect(health.detail).toBe("server reported unhealthy");
  });

  it("surfaces an auth rejection as an actionable detail", async () => {
    // Given: the auth-recovering fetch gave up (no stored credentials)
    const { probe } = probeWith(() => Promise.reject(new AuthRequiredError(BASE_URL, "no-credentials")));
    // When/Then
    const health = await probe(BASE_URL);
    expect(health.status).toBe("unreachable");
    expect(health.detail).toContain("authentication required");
  });

  it("carries no version when the payload omits it", async () => {
    const health = await probeReturning({ healthy: true })(BASE_URL);
    expect(health.status).toBe("ok");
    expect(health.version).toBeNull();
  });
});

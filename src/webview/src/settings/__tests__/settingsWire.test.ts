import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONFIG } from "../../../../host/config.js";
import {
  parseServerHealthWire,
  parseSetSettingsReplyWire,
  parseSettingsSnapshotWire,
  type ServerHealthWire,
} from "../settingsWire.js";

/**
 * Wire-mirror pinning (plan todo 21): the fixture below reproduces the host
 * authority's reply shape (src/host/handlers/settings.ts, asserted by the
 * host-side suite over the same values). Any honest reply parses; drifted
 * or partial payloads parse to undefined and the page keeps prior state.
 */

const SNAPSHOT_REPLY = {
  values: { ...DEFAULT_PANEL_CONFIG, port: 5001 },
  scope: { port: "workspace", serverUrl: "global" },
  secrets: { password: { isSet: true }, username: { isSet: false } },
} as const;

const HEALTH_OK: ServerHealthWire = {
  status: "ok",
  url: "http://127.0.0.1:5001",
  version: "1.0.1-test",
  checkedAt: "2026-08-20T04:30:00.000Z",
};

describe("parseSettingsSnapshotWire", () => {
  it("parses a full host snapshot reply", () => {
    // Given: the host-shaped snapshot fixture
    // When
    const parsed = parseSettingsSnapshotWire(SNAPSHOT_REPLY);
    // Then: typed values, per-field scope, secret flags
    if (parsed === undefined) throw new Error("expected a parsed snapshot");
    expect(parsed.values.port).toBe(5001);
    expect(parsed.values.hostname).toBe(DEFAULT_PANEL_CONFIG.hostname);
    expect(parsed.scope["port"]).toBe("workspace");
    expect(parsed.scope["serverUrl"]).toBe("global");
    expect(parsed.secrets).toEqual({ password: { isSet: true }, username: { isSet: false } });
  });

  it("drops unknown scope entries and defaults drifted value types", () => {
    // Given: a reply with a foreign scope value and a mistyped value
    const parsed = parseSettingsSnapshotWire({
      values: { port: "not a number" },
      scope: { port: "elsewhere" },
      secrets: { password: { isSet: false }, username: { isSet: true } },
    });
    // When/Then: port falls back to the manifest default, scope entry dropped
    if (parsed === undefined) throw new Error("expected a parsed snapshot");
    expect(parsed.values.port).toBe(DEFAULT_PANEL_CONFIG.port);
    expect("port" in parsed.scope).toBe(false);
    expect(parsed.secrets.username.isSet).toBe(true);
  });

  it("rejects a reply missing the secrets block", () => {
    // Given/When/Then
    expect(parseSettingsSnapshotWire({ values: {}, scope: {} })).toBeUndefined();
    expect(parseSettingsSnapshotWire(null)).toBeUndefined();
  });
});

describe("parseSetSettingsReplyWire", () => {
  it("parses an ok reply carrying serverHealth", () => {
    // Given/When
    const parsed = parseSetSettingsReplyWire({ ...SNAPSHOT_REPLY, ok: true, serverHealth: HEALTH_OK });
    // Then
    if (parsed === undefined) throw new Error("expected a parsed setSettings reply");
    expect(parsed.ok).toBe(true);
    expect(parsed.serverHealth).toEqual(HEALTH_OK);
  });

  it("rejects replies without ok:true or with a malformed health block", () => {
    // Given/When/Then
    expect(parseSetSettingsReplyWire({ ...SNAPSHOT_REPLY, serverHealth: HEALTH_OK })).toBeUndefined();
    expect(
      parseSetSettingsReplyWire({ ...SNAPSHOT_REPLY, ok: true, serverHealth: { status: "weird" } }),
    ).toBeUndefined();
  });
});

describe("parseServerHealthWire", () => {
  it("carries optional detail and a nullable version", () => {
    // Given/When
    const parsed = parseServerHealthWire({
      status: "unreachable",
      url: "http://x",
      version: null,
      checkedAt: "2026-01-01T00:00:00.000Z",
      detail: "connection refused",
    });
    // Then
    expect(parsed).toEqual({
      status: "unreachable",
      url: "http://x",
      version: null,
      checkedAt: "2026-01-01T00:00:00.000Z",
      detail: "connection refused",
    });
  });
});

// i18n-allow-literal — test fixtures/assertions carry literal wire data.
import { describe, expect, it } from "vitest";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { DEFAULT_PANEL_CONFIG } from "../../../../host/config.js";
import type { ServerHealthWire } from "../settingsWire.js";
import { SettingsFormStore } from "../settingsStore.js";

/**
 * Form-store behavior (plan todo 21): dirty tracking, patch assembly,
 * apply/revert semantics, validation gating, the empty-patch Test
 * Connection, and secret-flag updates. Driven against an in-memory loopback
 * host answering at the envelope level — no DOM anywhere.
 */

type Reply = { readonly ok: true; readonly content: unknown } | { readonly ok: false; readonly error: string };
type Responder = (payload: unknown) => Reply;

interface RecordedCall {
  readonly type: string;
  readonly payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HEALTH: ServerHealthWire = {
  status: "ok",
  url: "http://127.0.0.1:4096",
  version: "1.0.0-test",
  checkedAt: "2026-08-20T04:45:00.000Z",
};

function snapshotReply(values?: Readonly<Record<string, unknown>>) {
  return {
    values: { ...DEFAULT_PANEL_CONFIG, ...values },
    scope: {},
    secrets: { password: { isSet: false }, username: { isSet: false } },
  };
}

function parseSettingsWirePatch(payload: unknown): { readonly values: Record<string, unknown> } {
  if (!isRecord(payload) || !isRecord(payload.patch) || !isRecord(payload.patch.values)) {
    throw new Error("loopback received a malformed setSettings payload");
  }
  return { values: payload.patch.values };
}

function createLoopback(responders: Readonly<Record<string, Responder>>) {
  const calls: RecordedCall[] = [];
  let toWebview: (message: unknown) => void = () => {
    throw new Error("loopback not wired");
  };
  const port: WebviewPort = {
    postMessage: (raw) => {
      if (!isRecord(raw) || typeof raw.messageId !== "string" || typeof raw.type !== "string") {
        throw new Error("bad test envelope");
      }
      calls.push({ type: raw.type, payload: raw.payload });
      const responder = responders[raw.type];
      const reply: Reply =
        responder === undefined ? { ok: false, error: "unhandled request type" } : responder(raw.payload);
      queueMicrotask(() => {
        toWebview({
          type: "streamChunk",
          payload: {
            messageId: raw.messageId,
            status: reply.ok ? "success" : "error",
            done: true,
            content: reply.ok ? reply.content : reply.error,
          },
        });
      });
    },
    onMessage: (registered) => {
      toWebview = registered;
    },
  };
  const messenger = new WebviewMessenger(port);
  const send = (async (type: never, payload: never) => {
    try {
      return await messenger.request(type, payload);
    } catch {
      return null;
    }
  }) as import("../settingsStore.js").AppSend;
  return { send, calls };
}

function makeStore() {
  const snapshot = parseSnapshotOf(snapshotReply());
  return new SettingsFormStore(snapshot);
}

function parseSnapshotOf(reply: ReturnType<typeof snapshotReply>) {
  const parsed = structuredClone(reply) as unknown;
  // The production path boundary-parses the wire reply; mirror it here.
  return {
    values: (parsed as { values: typeof DEFAULT_PANEL_CONFIG }).values,
    scope: {},
    secrets: { password: { isSet: false }, username: { isSet: false } },
  };
}

describe("SettingsFormStore draft tracking", () => {
  it("starts clean with an empty patch", () => {
    // Given/When/Then
    const store = makeStore();
    expect(store.dirtyKeys()).toEqual([]);
    expect(store.buildPatch()).toEqual({ values: {}, scope: {} });
    expect(store.hasErrors()).toBe(false);
  });

  it("tracks edits and assembles the patch in manifest order", () => {
    // Given
    const store = makeStore();
    // When: edits entered back-to-front relative to manifest order
    store.setValue("chatFontSize", 16);
    store.setValue("port", 5050);
    store.setValue("serverArgs", ["--verbose"]);
    // Then: dirty state + ordered patch
    expect(store.dirtyKeys()).toEqual(["port", "serverArgs", "chatFontSize"]);
    expect(store.buildPatch()).toEqual({
      values: { port: 5050, serverArgs: ["--verbose"], chatFontSize: 16 },
      scope: {},
    });
  });

  it("marks an unchanged value dirty when its scope chip moves", () => {
    // Given
    const store = makeStore();
    // When: only the layer chip changes
    store.setScopeChoice("port", "workspace");
    // Then: the patch carries the current value at the new target
    expect(store.isDirty("port")).toBe(true);
    expect(store.buildPatch().values["port"]).toBe(DEFAULT_PANEL_CONFIG.port);
    expect(store.buildPatch().scope).toEqual({ port: "workspace" });
  });

  it("revert restores base values and clears errors", () => {
    // Given
    const store = makeStore();
    store.setValue("port", 1);
    store.setScopeChoice("port", "workspace");
    // When
    store.revert();
    // Then
    expect(store.dirtyKeys()).toEqual([]);
    expect(store.fieldError("port")).toBeNull();
  });

  it("flags invalid edits only while dirty", () => {
    // Given
    const store = makeStore();
    expect(store.fieldError("port")).toBeNull();
    // When: an out-of-range edit
    store.setValue("port", 70000);
    // Then: a blocking error, and hasErrors trips
    expect(store.fieldError("port")).not.toBeNull();
    expect(store.hasErrors()).toBe(true);
    // When fixed
    store.setValue("port", 8080);
    expect(store.fieldError("port")).toBeNull();
    expect(store.hasErrors()).toBe(false);
  });

  it("does not emit no-op edits", () => {
    // Given
    const store = makeStore();
    // When: setting the same value and the same scope
    store.setValue("hostname", DEFAULT_PANEL_CONFIG.hostname);
    store.setScopeChoice("debugLogs", "global");
    // Then
    expect(store.dirtyKeys()).toEqual([]);
  });
});

describe("SettingsFormStore apply / testConnection", () => {
  it("absorbs the apply reply as the new clean base", async () => {
    // Given: a loopback host whose setSettings acknowledges a fresh snapshot
    const { send, calls } = createLoopback({
      setSettings: (payload) => {
        const { values } = parseSettingsWirePatch(payload);
        return {
          ok: true,
          content: { ...snapshotReply(values), ok: true, serverHealth: HEALTH },
        };
      },
    });
    const store = makeStore();
    store.setValue("port", 6000);
    // When
    const applied = await store.apply(send);
    // Then
    expect(applied).toBe(true);
    expect(calls.map((call) => call.type)).toEqual(["setSettings"]);
    expect(store.dirtyKeys()).toEqual([]);
    const view = store.getSnapshot();
    expect(view.base.port).toBe(6000);
    expect(view.draft.port).toBe(6000);
    expect(view.serverHealth).toEqual(HEALTH);
    expect(view.saveFailed).toBe(false);
  });

  it("keeps the draft and flags saveFailed when the host rejects", async () => {
    // Given: a failing host
    const { send } = createLoopback({
      setSettings: () => ({ ok: false, error: "SettingsValidationError: port: must be an integer between 1 and 65535" }),
    });
    const store = makeStore();
    store.setValue("port", 6000);
    // When
    const applied = await store.apply(send);
    // Then
    expect(applied).toBe(false);
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(store.isDirty("port")).toBe(true);
  });

  it("never posts while local validation fails", async () => {
    // Given
    const { send, calls } = createLoopback({});
    const store = makeStore();
    store.setValue("port", 70000);
    // When
    const applied = await store.apply(send);
    // Then
    expect(applied).toBe(false);
    expect(calls).toEqual([]);
  });

  it("testConnection posts ONLY the empty patch and merges the health", async () => {
    // Given
    const { send, calls } = createLoopback({
      setSettings: () => ({ ok: true, content: { ...snapshotReply(), ok: true, serverHealth: HEALTH } }),
    });
    const store = makeStore();
    store.setValue("port", 6000);
    // When
    const health = await store.testConnection(send);
    // Then: the request carried an empty patch; draft untouched; health merged
    expect(health).toEqual(HEALTH);
    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (first === undefined) throw new Error("expected one recorded call");
    expect(parseSettingsWirePatch(first.payload).values).toEqual({});
    expect(store.isDirty("port")).toBe(true);
    expect(store.getSnapshot().serverHealth).toEqual(HEALTH);
  });

  it("markSecret flips only the addressed flag", () => {
    // Given
    const store = makeStore();
    // When/Then
    store.markSecret("password", true);
    expect(store.getSnapshot().secrets.password.isSet).toBe(true);
    expect(store.getSnapshot().secrets.username.isSet).toBe(false);
    store.markSecret("password", false);
    expect(store.getSnapshot().secrets.password.isSet).toBe(false);
  });
});

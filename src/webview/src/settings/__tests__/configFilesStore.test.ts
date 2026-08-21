// i18n-allow-literal — test fixtures/assertions carry literal wire data.
import { describe, expect, it } from "vitest";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import type {
  ConfigFileReadReply,
  ConfigFileWriteReply,
} from "../../../../shared/protocol.js";
import {
  ConfigFilesStore,
  type ConfigRequester,
} from "../configFilesStore.js";

/**
 * ConfigFilesStore behavior (plan T3): lazy per-slot loads with in-flight
 * dedup, local JSONC draft edits (dirty/parse-error recompute), mtime-
 * guarded saves with the host `[<code>]` error taxonomy (mtime-mismatch →
 * conflict, anything else → saveError), force saves, reload/revert,
 * beginCreate templates, and the external-store subscribe/getSnapshot
 * contract. Driven against an in-memory loopback host answering at the
 * envelope level — no DOM anywhere.
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

function ok(content: unknown): Reply {
  return { ok: true, content };
}

function fail(error: string): Reply {
  return { ok: false, error };
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
  return { messenger, calls };
}

function makeStore(messenger: WebviewMessenger): ConfigFilesStore {
  const request: ConfigRequester = (type, payload) => messenger.request(type, payload);
  return new ConfigFilesStore(request);
}

const READ_GLOBAL: ConfigFileReadReply = {
  path: "/home/test/.config/opencode/opencode.json",
  exists: true,
  rawText: '{\n  // keep me\n  "theme": "dark"\n}\n',
  mtimeMs: 123,
  parseError: null,
  legacyNoticePath: null,
};

function readReply(overrides: Partial<ConfigFileReadReply>): ConfigFileReadReply {
  return { ...READ_GLOBAL, ...overrides };
}

function writeReply(overrides?: Partial<ConfigFileWriteReply>): ConfigFileWriteReply {
  return { mtimeMs: 999, backupPath: `${READ_GLOBAL.path}.bak`, ...overrides };
}

function isWritePayload(value: unknown): value is { rawText: string; expectedMtimeMs?: number } {
  return isRecord(value) && typeof value.rawText === "string";
}

describe("ConfigFilesStore lazy slots", () => {
  it("starts unloaded for all four slots and loads one on demand", async () => {
    // Given: a loopback host answering reads
    const { messenger, calls } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    expect(store.slot("opencode", "global").loaded).toBe(false);
    expect(store.slot("opencode", "project").loaded).toBe(false);
    expect(store.slot("omo", "global").loaded).toBe(false);
    expect(store.slot("omo", "project").loaded).toBe(false);
    expect(calls).toEqual([]);
    // When
    await store.load("opencode", "global");
    // Then
    const slot = store.slot("opencode", "global");
    expect(slot.loaded).toBe(true);
    expect(slot.path).toBe(READ_GLOBAL.path);
    expect(slot.exists).toBe(true);
    expect(slot.baseText).toBe(READ_GLOBAL.rawText);
    expect(slot.draftText).toBe(READ_GLOBAL.rawText);
    expect(slot.mtimeMs).toBe(123);
    expect(slot.parseError).toBeNull();
    expect(slot.dirty).toBe(false);
    expect(slot.readOnly).toBe(false);
    expect(slot.conflict).toBe(false);
    expect(slot.saveError).toBeNull();
    expect(calls.map((call) => call.type)).toEqual(["configFileRead"]);
    // And: a second load is a no-op for a loaded slot
    await store.load("opencode", "global");
    expect(calls).toHaveLength(1);
    // And: the other slots are still untouched
    expect(store.slot("omo", "global").loaded).toBe(false);
  });

  it("deduplicates concurrent loads for the same slot", async () => {
    // Given
    const { messenger, calls } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    // When: two loads issued before the host answers
    const first = store.load("opencode", "global");
    const second = store.load("opencode", "global");
    await Promise.all([first, second]);
    // Then: a single wire request
    expect(calls).toHaveLength(1);
  });

  it("propagates legacyNoticePath and parseError from the read reply", async () => {
    // Given
    const reply = readReply({
      rawText: "{ bad }\n",
      parseError: "InvalidSymbol at offset 2",
      legacyNoticePath: "/home/test/.config/opencode/oh-my-openagent.json",
      exists: false,
    });
    const { messenger } = createLoopback({ configFileRead: () => ok(reply) });
    const store = makeStore(messenger);
    // When
    await store.load("omo", "global");
    // Then
    const slot = store.slot("omo", "global");
    expect(slot.legacyNoticePath).toBe("/home/test/.config/opencode/oh-my-openagent.json");
    expect(slot.parseError).toBe("InvalidSymbol at offset 2");
    expect(slot.readOnly).toBe(true);
    expect(slot.exists).toBe(false);
  });

  it("keeps the slot unloaded and records saveError on a load failure", async () => {
    // Given: project scope without a workspace folder
    const { messenger } = createLoopback({
      configFileRead: () => fail("ConfigFileError: [no-workspace] project scope needs a workspace folder"),
    });
    const store = makeStore(messenger);
    // When
    await store.load("opencode", "project");
    // Then
    const slot = store.slot("opencode", "project");
    expect(slot.loaded).toBe(false);
    expect(slot.saveError).toContain("[no-workspace]");
  });
});

describe("ConfigFilesStore draft editing", () => {
  it("editField patches the draft locally, flips dirty, and preserves comments", async () => {
    // Given
    const { messenger } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    // When
    store.editField("opencode", "global", ["theme"], "light");
    // Then
    const slot = store.slot("opencode", "global");
    expect(slot.draftText).toContain('"light"');
    expect(slot.draftText).toContain("// keep me");
    expect(slot.dirty).toBe(true);
    expect(slot.parseError).toBeNull();
    expect(slot.readOnly).toBe(false);
    // And: the base stays untouched until a save lands
    expect(slot.baseText).toBe(READ_GLOBAL.rawText);
  });

  it("recomputes parseError from the edited draft, not the load-time value", async () => {
    // Given: a doc the host flagged as broken
    const { messenger } = createLoopback({
      configFileRead: () => ok(readReply({ rawText: "{ bad }\n", parseError: "STALE_HOST_MARKER" })),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    expect(store.slot("opencode", "global").parseError).toBe("STALE_HOST_MARKER");
    // When: an edit lands (the draft stays broken — jsonc-parser recomputes)
    store.editField("opencode", "global", ["theme"], "dark");
    // Then: the slot error is the local recompute, not the host's stale marker
    const slot = store.slot("opencode", "global");
    expect(slot.parseError).not.toBeNull();
    expect(slot.parseError).not.toBe("STALE_HOST_MARKER");
    expect(slot.readOnly).toBe(true);
    expect(slot.dirty).toBe(true);
  });

  it("revert restores the base text and clears the draft edits", async () => {
    // Given
    const { messenger } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    expect(store.slot("opencode", "global").dirty).toBe(true);
    // When
    store.revert("opencode", "global");
    // Then
    const slot = store.slot("opencode", "global");
    expect(slot.draftText).toBe(READ_GLOBAL.rawText);
    expect(slot.dirty).toBe(false);
    expect(slot.parseError).toBeNull();
    expect(slot.saveError).toBeNull();
  });

  it("beginCreate fills the template only for a loaded missing file", async () => {
    // Given: the host reports the file missing
    const { messenger } = createLoopback({
      configFileRead: () =>
        ok(readReply({ exists: false, rawText: "", mtimeMs: 0 })),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    expect(store.slot("opencode", "global").exists).toBe(false);
    expect(store.slot("opencode", "global").dirty).toBe(false);
    // When
    store.beginCreate("opencode", "global");
    // Then: the opencode template, dirty, parseable
    const created = store.slot("opencode", "global");
    expect(created.draftText).toBe("{\n}\n");
    expect(created.dirty).toBe(true);
    expect(created.parseError).toBeNull();
  });

  it("beginCreate uses the omo template with the [opencode] nesting", async () => {
    // Given
    const { messenger } = createLoopback({
      configFileRead: () =>
        ok(readReply({ path: "/home/test/.omo/omo.jsonc", exists: false, rawText: "", mtimeMs: 0 })),
    });
    const store = makeStore(messenger);
    await store.load("omo", "global");
    // When
    store.beginCreate("omo", "global");
    // Then: the real ~/.omo/omo.jsonc nests under a literal "[opencode]"
    // SECTION key (verified read-only; the plain "opencode" key of the W2
    // round-trip fixture is byte-preservation data, not the schema shape).
    expect(store.slot("omo", "global").draftText).toBe('{\n  "[opencode]": {\n  }\n}\n');
  });

  it("beginCreate is a no-op on an existing file or before load", async () => {
    // Given
    const { messenger } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    // When: before load — nothing happens
    store.beginCreate("opencode", "global");
    expect(store.slot("opencode", "global").draftText).toBe("");
    // And: with an existing file — the draft is not clobbered
    await store.load("opencode", "global");
    store.beginCreate("opencode", "global");
    expect(store.slot("opencode", "global").draftText).toBe(READ_GLOBAL.rawText);
  });
});

describe("ConfigFilesStore save", () => {
  it("posts rawText with expectedMtimeMs and adopts the reply as the new base", async () => {
    // Given
    const { messenger, calls } = createLoopback({
      configFileRead: () => ok(READ_GLOBAL),
      configFileWrite: () => ok(writeReply()),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    // When
    const saved = await store.save("opencode", "global");
    // Then
    expect(saved).toBe(true);
    const writeCall = calls.find((call) => call.type === "configFileWrite");
    if (writeCall === undefined || !isWritePayload(writeCall.payload)) {
      throw new Error("expected a configFileWrite payload");
    }
    expect(writeCall.payload.rawText).toContain('"light"');
    expect(writeCall.payload.expectedMtimeMs).toBe(123);
    // And: base/mtime/exists adopted from the reply
    const slot = store.slot("opencode", "global");
    expect(slot.baseText).toBe(slot.draftText);
    expect(slot.dirty).toBe(false);
    expect(slot.mtimeMs).toBe(999);
    expect(slot.exists).toBe(true);
    expect(slot.conflict).toBe(false);
    expect(slot.saveError).toBeNull();
    expect(slot.saving).toBe(false);
  });

  it("refuses to save a clean slot or an unparseable draft", async () => {
    // Given: a broken doc that an edit leaves broken (dirty but unparseable)
    const { messenger, calls } = createLoopback({
      configFileRead: () => ok(readReply({ rawText: "{ bad }\n", parseError: "InvalidSymbol at offset 2" })),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "dark");
    const parseError = store.slot("opencode", "global").parseError;
    expect(parseError).not.toBeNull();
    // When: saving a dirty-but-broken draft
    const savedBroken = await store.save("opencode", "global");
    // Then: blocked before the wire, saveError carries the parse failure
    expect(savedBroken).toBe(false);
    expect(store.slot("opencode", "global").saveError).toBe(parseError);
    expect(calls.filter((call) => call.type === "configFileWrite")).toEqual([]);
    // And: a clean second slot refuses a no-op save as well
    const { messenger: m2, calls: c2 } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const fresh = makeStore(m2);
    await fresh.load("opencode", "global");
    expect(await fresh.save("opencode", "global")).toBe(false);
    expect(c2.filter((call) => call.type === "configFileWrite")).toEqual([]);
  });

  it("sets conflict on [mtime-mismatch] and keeps the draft", async () => {
    // Given: the host rejects with the mtime guard
    const { messenger } = createLoopback({
      configFileRead: () => ok(READ_GLOBAL),
      configFileWrite: () => fail("ConfigFileError: [mtime-mismatch] opencode.json changed on disk"),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    // When
    const saved = await store.save("opencode", "global");
    // Then
    expect(saved).toBe(false);
    const slot = store.slot("opencode", "global");
    expect(slot.conflict).toBe(true);
    expect(slot.dirty).toBe(true);
    expect(slot.saveError).toBeNull();
    expect(slot.saving).toBe(false);
  });

  it("records saveError on other host failures without flagging conflict", async () => {
    // Given
    const { messenger } = createLoopback({
      configFileRead: () => ok(READ_GLOBAL),
      configFileWrite: () => fail("ConfigFileError: [io] disk broke"),
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    // When
    const saved = await store.save("opencode", "global");
    // Then
    expect(saved).toBe(false);
    const slot = store.slot("opencode", "global");
    expect(slot.conflict).toBe(false);
    expect(slot.saveError).toContain("[io]");
    expect(slot.dirty).toBe(true);
  });

  it("force save omits expectedMtimeMs and clears the conflict", async () => {
    // Given: one mtime rejection, then a force retry
    let writes = 0;
    const { messenger, calls } = createLoopback({
      configFileRead: () => ok(READ_GLOBAL),
      configFileWrite: () => {
        writes += 1;
        return writes === 1
          ? fail("ConfigFileError: [mtime-mismatch] opencode.json changed on disk")
          : ok(writeReply({ mtimeMs: 555 }));
      },
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    expect(await store.save("opencode", "global")).toBe(false);
    expect(store.slot("opencode", "global").conflict).toBe(true);
    // When
    const forced = await store.save("opencode", "global", { force: true });
    // Then
    expect(forced).toBe(true);
    const writeCalls = calls.filter((call) => call.type === "configFileWrite");
    expect(writeCalls).toHaveLength(2);
    const forcedPayload = writeCalls[1]?.payload;
    if (forcedPayload === undefined || !isWritePayload(forcedPayload)) {
      throw new Error("expected a second configFileWrite payload");
    }
    expect("expectedMtimeMs" in forcedPayload).toBe(false);
    const slot = store.slot("opencode", "global");
    expect(slot.conflict).toBe(false);
    expect(slot.dirty).toBe(false);
    expect(slot.mtimeMs).toBe(555);
  });
});

describe("ConfigFilesStore reload + subscription", () => {
  it("reload discards the draft and adopts the fresh disk text", async () => {
    // Given: the disk moves on after the first read
    const newer = readReply({ rawText: '{\n  "theme": "solarized"\n}\n', mtimeMs: 456 });
    let reads = 0;
    const { messenger } = createLoopback({
      configFileRead: () => {
        reads += 1;
        return ok(reads === 1 ? READ_GLOBAL : newer);
      },
    });
    const store = makeStore(messenger);
    await store.load("opencode", "global");
    store.editField("opencode", "global", ["theme"], "light");
    expect(store.slot("opencode", "global").dirty).toBe(true);
    // When
    await store.reload("opencode", "global");
    // Then
    const slot = store.slot("opencode", "global");
    expect(slot.baseText).toBe(newer.rawText);
    expect(slot.draftText).toBe(newer.rawText);
    expect(slot.dirty).toBe(false);
    expect(slot.mtimeMs).toBe(456);
    expect(slot.conflict).toBe(false);
  });

  it("notifies subscribers on state changes with a stable view between emits", async () => {
    // Given
    const { messenger } = createLoopback({ configFileRead: () => ok(READ_GLOBAL) });
    const store = makeStore(messenger);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    const before = store.getSnapshot();
    // Then: stable identity while nothing happens
    expect(store.getSnapshot()).toBe(before);
    // When
    await store.load("opencode", "global");
    const afterLoad = store.getSnapshot();
    expect(afterLoad).not.toBe(before);
    store.editField("opencode", "global", ["theme"], "light");
    expect(store.getSnapshot()).not.toBe(afterLoad);
    expect(notifications).toBeGreaterThanOrEqual(2);
    // And: unsubscribe stops the count
    unsubscribe();
    const settled = notifications;
    store.editField("opencode", "global", ["theme"], "x");
    expect(notifications).toBe(settled);
  });
});

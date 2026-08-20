/**
 * Session-sync suite (plan todo 12, poll-based sync):
 * - SessionSync.refresh refetches `session.list` and posts the broadcast,
 *   deduping concurrent runs into ONE list call;
 * - the exact invalidation consumer registered by the composition refetches
 *   on `sessions` and ignores `messages`/`todos`;
 * - InvalidationHub fans one bridge callback out to N consumers and a throwing
 *   consumer never blocks the fan-out;
 * - INTEGRATION (todo-9 bridge + todo-5 mock SSE): `server.connected` resync
 *   and a pushed `session.updated` event each end in a fresh broadcast;
 * - the event-carrier literal is pinned (`"sessions.list"`) — the webview
 *   mirrors it in src/webview/src/sessions/constants.ts and pins it too.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EventBridge, createSdkEventSource } from "../../../server/eventBridge.js";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import { createPanelClient } from "../../../server/clientFactory.js";
import type { Capabilities } from "../../../server/capabilities.js";
import type { ServerConnection } from "../../../server/ServerManager.js";
import type { SessionListPayload } from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import {
  createSessionService,
  staticSessionSource,
  type SessionListEntry,
  type SessionService,
} from "../sessions.js";
import {
  InvalidationHub,
  SESSIONS_LIST_EVENT,
  SessionSync,
  sessionInvalidationConsumer,
  type ViewEventSink,
} from "../sync.js";

class NullChannel implements OutputChannelLike {
  appendLine(_line: string): void {}
}

const logger = new PanelLogger(new NullChannel(), () => true);

class RecordingEventSink implements ViewEventSink {
  readonly events: Array<{ readonly type: string; readonly payload: unknown }> = [];
  postEvent(type: string, payload: unknown): void {
    this.events.push({ type, payload });
  }
  sessionLists(): SessionListPayload[] {
    return this.events
      .filter((event) => event.type === SESSIONS_LIST_EVENT)
      .map((event) => event.payload as SessionListPayload);
  }
}

/** Counts list calls; every result is a fixed entry set. */
function countingService(entries: readonly SessionListEntry[]): {
  readonly service: SessionService;
  readonly calls: () => number;
} {
  let calls = 0;
  const session: SessionListEntry = {
    id: "ses_fake",
    title: "fake",
    updatedAt: "2026-01-01T00:00:00.000Z",
    shared: false,
  };
  const stub: SessionService = {
    listSessions: () => {
      calls += 1;
      return Promise.resolve(entries.length === 0 ? [session] : entries);
    },
    createSession: () => Promise.resolve(session),
    deleteSession: () => Promise.resolve(),
    renameSession: () => Promise.resolve(),
    shareSession: () => Promise.resolve({ url: "https://invalid/s/x" }),
    unshareSession: () => Promise.resolve(),
    forkSession: () => Promise.resolve(session),
    setSessionAuto: () => Promise.resolve(),
  };
  return { service: stub, calls: () => calls };
}

describe("SessionSync", () => {
  it("refresh posts the sessions.list broadcast payload", async () => {
    const entry: SessionListEntry = {
      id: "ses_1",
      title: "one",
      updatedAt: "2026-01-01T00:00:00.000Z",
      shared: true,
    };
    const { service } = countingService([entry]);
    const sink = new RecordingEventSink();
    const sync = new SessionSync({ service, sink, logger });

    await sync.refresh();

    const lists = sink.sessionLists();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.sessions).toEqual([entry]);
  });

  it("concurrent refreshes collapse into ONE list call", async () => {
    const { service, calls } = countingService([]);
    const sink = new RecordingEventSink();
    const sync = new SessionSync({ service, sink, logger });

    await Promise.all([sync.refresh(), sync.refresh(), sync.refresh()]);

    expect(calls()).toBe(1);
    expect(sink.sessionLists().length).toBe(1);
  });

  it("a failing list call is swallowed (logged) and posts nothing", async () => {
    const failing: SessionService = {
      listSessions: () => Promise.reject(new Error("server down")),
      createSession: () => Promise.reject(new Error("unused")),
      deleteSession: () => Promise.reject(new Error("unused")),
      renameSession: () => Promise.reject(new Error("unused")),
      shareSession: () => Promise.reject(new Error("unused")),
      unshareSession: () => Promise.reject(new Error("unused")),
      forkSession: () => Promise.reject(new Error("unused")),
      setSessionAuto: () => Promise.reject(new Error("unused")),
    };
    const sink = new RecordingEventSink();
    const sync = new SessionSync({ service: failing, sink, logger });

    await sync.refresh();

    expect(sink.sessionLists().length).toBe(0);
  });
});

describe("session invalidation consumer (the exact composition wiring)", () => {
  it("'sessions' triggers a refetch; 'messages'/'todos' are ignored", async () => {
    const { service, calls } = countingService([]);
    const sink = new RecordingEventSink();
    const sync = new SessionSync({ service, sink, logger });
    const consumer = sessionInvalidationConsumer(sync);

    consumer("messages", "ses_1");
    consumer("todos", "ses_1");
    await sync.refresh(); // drain any accidental schedule
    expect(calls()).toBe(1);

    consumer("sessions", "ses_1");
    await sync.refresh();
    expect(calls()).toBe(2);
    expect(sink.sessionLists().length).toBe(2);
  });
});

describe("InvalidationHub", () => {
  it("fans one callback out to every consumer in registration order", () => {
    const hub = new InvalidationHub(logger);
    const seen: string[] = [];
    hub.add((kind) => {
      seen.push(`a:${kind}`);
    });
    hub.add((kind) => {
      seen.push(`b:${kind}`);
    });
    hub.dispatch("sessions", "ses_9");
    expect(seen).toEqual(["a:sessions", "b:sessions"]);
  });

  it("a throwing consumer never blocks the rest of the fan-out", () => {
    const hub = new InvalidationHub(logger);
    const seen: string[] = [];
    hub.add(() => {
      throw new Error("consumer boom");
    });
    hub.add((kind) => {
      seen.push(`ok:${kind}`);
    });
    expect(() => {
      hub.dispatch("sessions", undefined);
    }).not.toThrow();
    expect(seen).toEqual(["ok:sessions"]);
  });

  it("dispose removes the consumer", () => {
    const hub = new InvalidationHub(logger);
    const seen: string[] = [];
    const sub = hub.add((kind) => {
      seen.push(kind);
    });
    hub.dispatch("sessions", undefined);
    sub.dispose();
    hub.dispatch("sessions", undefined);
    expect(seen).toEqual(["sessions"]);
  });
});

// ---------------------------------------------------------------------------
// Integration: real EventBridge + real mock server SSE stream.

const FAKE_CAPABILITIES: Capabilities = {
  version: "0.0.0-test",
  hasFork: true,
  hasQuestion: true,
  hasTodo: true,
  hasShell: true,
  agents: [],
  commands: [],
  mcpNative: [],
  omoDetected: false,
  omoMcpNote: false,
};

class EmptySecrets implements SecretStorage {
  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

function connectionFor(url: string): ServerConnection {
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger,
  });
  return {
    baseUrl: panel.baseUrl,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: FAKE_CAPABILITIES,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("waitFor timed out");
}

describe("bridge-driven session sync (integration vs mock server)", () => {
  let mock: MockServer | undefined;
  let bridge: EventBridge | undefined;

  afterEach(async () => {
    bridge?.dispose();
    bridge = undefined;
    if (mock !== undefined) {
      await mock.close();
      mock = undefined;
    }
  });

  it("resync on server.connected + debounced 'sessions' invalidation both broadcast", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const source = staticSessionSource(connection);
    const service = createSessionService({ source, logger });
    const sink = new RecordingEventSink();
    const sync = new SessionSync({ service, sink, logger });
    const hub = new InvalidationHub(logger);
    hub.add(sessionInvalidationConsumer(sync));

    bridge = new EventBridge({
      source: createSdkEventSource(connection.client),
      isServerAlive: () => true,
      sink: () => undefined,
      invalidate: hub.dispatch,
      resync: () => {
        void sync.refresh();
      },
      serverLost: () => undefined,
      logger,
      timing: { debounceMs: 5 },
    });
    bridge.start();

    // The real server emits server.connected on subscribe; the mock does not,
    // so drive it via the scenario push hook. The first push can race ahead of
    // the SDK's SSE subscription, so keep pushing until the resync broadcast
    // lands (idempotent: every connected-push re-runs the same resync).
    const currentMock = mock;
    await waitFor(() => {
      currentMock.pushEvent("server.connected", {});
      return sink.sessionLists().length > 0;
    });
    expect(sink.sessionLists()[0]?.sessions).toEqual([]);

    // A sessions-scoped SSE event debounces into an invalidation -> refetch.
    const created = await fetch(`${currentMock.url}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "sse created" }),
    });
    expect(created.ok).toBe(true);
    await waitFor(() =>
      sink.sessionLists().some((list) =>
        list.sessions.some((session) => session.title === "sse created"),
      ),
    );
  });

  it("the event-carrier literal is pinned for the webview mirror", () => {
    expect(SESSIONS_LIST_EVENT).toBe("sessions.list");
  });
});

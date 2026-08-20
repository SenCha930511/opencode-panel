/**
 * Session-sync composition module (plan todo 12, poll-based sync): the
 * documented glue between the todo-9 EventBridge "injected seams" and the
 * todo-12 sessions domain. T9 ships the subscribe->dispatch->backoff loop and
 * deliberately exposes NO registration companion; this module IS that
 * companion, as sanctioned by the todo-12 spec ("if T9 exposes no
 * registration companion yet, OWN a tiny composition module").
 *
 * WHAT IT WIRES (production, from extension.ts activation):
 * - EventBridge.source: per-attempt onboard (`ServerManager.onboardClient`,
 *   todo 8) + todo-9 `createSdkEventSource(connection.client)`. The bridge
 *   owns the reconnect schedule; onboarding re-uses the todo-7 detector's
 *   per-baseUrl cache, so retries pay no re-detection.
 * - EventBridge.isServerAlive: todo-8 lifecycle state managed|attached.
 * - EventBridge.sink: EVERY chat-relevant event is forwarded as a Forwarded
 *   event to the chat view via todo-10's only public push seam,
 *   `ChatViewProvider.postEvent` — todo-13's deltaBatch/message feed rides
 *   this same channel (todo-9 header: "sink (T10 ChatViewProvider)").
 * - EventBridge.invalidate: an {@link InvalidationHub} fans the debounced
 *   `SyncKind` signal out to domain consumers. Todo 12 registers the sessions
 *   refetch; todos 13/18 (messages/todos) later plug in via `hub.add(...)`
 *   WITHOUT touching this file or the bridge (the bridge accepts exactly one
 *   invalidate callback — the hub is the multiplicity point).
 * - EventBridge.resync: one `server.connected` -> full session-list refresh.
 * - EventBridge.serverLost: logged; also forwarded as {@link SERVER_LOST_EVENT}
 *   so the webview can surface the todo-9 "server-lost" banner (todo 11 owns
 *   the banner itself).
 *
 * sessionList CARRIER (documented deviation, binding for consumers):
 * todo-3 defines a dedicated `sessionList` push message, but todo 10 exposes
 * NO public seam that posts arbitrary typed HostMessages to a resolved view —
 * the only public host->webview push is `ChatViewProvider.postEvent`, which
 * wraps payloads into the todo-3 `event` envelope and reaches the CHAT view
 * (todo 11's app shell, where the session list is mounted). The session-list
 * broadcast therefore rides that channel as {@link SESSIONS_LIST_EVENT}
 * (`"sessions.list"`) whose payload IS the todo-3 `SessionListPayload`
 * (`{sessions}`). The webview store listens for it on the `event` channel AND
 * still subscribes the typed `sessionList` message, so if todo 10 later grows
 * a typed broadcast port (or the sessions view gets its own post seam — today
 * it has none) no consumer change is needed. The event-type literal is
 * mirrored in src/webview/src/sessions/constants.ts; host and webview tests
 * pin the same value across the boundary (webview code must not be imported
 * into the host bundle).
 *
 * SELECTION PERSISTENCE GAP (documented): todo 12 asks for a "host Memento
 * fallback" behind the webview's `vscode.setState` selection persistence.
 * Todo-3's protocol carries NO memento/read-write request type, and src/shared
 * is read-only for this todo, so the fallback cannot cross the wire yet. The
 * webview store keeps the persistence as an injected seam whose production
 * value maps onto `vscode.setState`; a future protocol key can back the same
 * seam with a Memento request without touching the store. Logged here so the
 * plan owner sees the gap exactly where it belongs.
 */

import type { Disposable } from "../config.js";
import type { PanelLogger } from "../logger.js";
import {
  EventBridge,
  createSdkEventSource,
  type EventBridgeTiming,
  type InvalidateSink,
  type ServerLostNotice,
  type SyncKind,
} from "../../server/eventBridge.js";
import type { ServerManager } from "../../server/ServerManager.js";
import type { SessionListPayload } from "../../shared/protocol.js";
import {
  createSessionService,
  type SessionClientSource,
  type SessionListEntry,
  type SessionListRefresher,
  type SessionService,
  type SessionsDomainDeps,
} from "./sessions.js";

// ---------------------------------------------------------------------------
// Event-carrier literals. Keep SESSIONS_LIST_EVENT in lockstep with
// src/webview/src/sessions/constants.ts (pinned by tests on both sides — the
// webview tree must not be imported into the host bundle).

/** Event-channel type carrying the todo-3 SessionListPayload to webviews. */
export const SESSIONS_LIST_EVENT = "sessions.list";

/** Event-channel type carrying the todo-9 ServerLostNotice to webviews. */
export const SERVER_LOST_EVENT = "server.lost";

// ---------------------------------------------------------------------------
// SessionSync: poll-refetch `session.list` -> broadcast. Never throws: a
// missing/dead server yields a debug log and NO broadcast (the init payload
// slice owned by todo 10 is the server-status surface, not this channel).

/** Counterpart of todo-10's `ChatViewProvider.postEvent` (its public push). */
export interface ViewEventSink {
  readonly postEvent: (type: string, payload: unknown) => void;
}

export interface SessionSyncDeps {
  readonly service: SessionService;
  readonly sink: ViewEventSink;
  readonly logger: PanelLogger;
}

export class SessionSync implements SessionListRefresher {
  private readonly deps: SessionSyncDeps;
  private inflight: Promise<void> | undefined;

  constructor(deps: SessionSyncDeps) {
    this.deps = deps;
  }

  /**
   * Refetch + broadcast, deduping concurrent runs (invalidation bursts collapse
   * into ONE list call). Never rejects.
   */
  refresh(): Promise<void> {
    this.inflight ??= this.run();
    return this.inflight;
  }

  private async run(): Promise<void> {
    try {
      const sessions: readonly SessionListEntry[] = await this.deps.service.listSessions();
      const payload: SessionListPayload = { sessions };
      this.deps.sink.postEvent(SESSIONS_LIST_EVENT, payload);
    } catch (error) {
      this.deps.logger.debug(`session sync refresh skipped: ${String(error)}`);
    } finally {
      this.inflight = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// InvalidationHub: the single `invalidate` callback the bridge requires,
// fanned out to N domain consumers. Registration order is preserved; a
// throwing consumer is logged and never blocks the rest of the fan-out.

export class InvalidationHub {
  private readonly consumers: InvalidateSink[] = [];
  private readonly logger: PanelLogger | undefined;

  constructor(logger?: PanelLogger) {
    this.logger = logger;
  }

  add(consumer: InvalidateSink): Disposable {
    this.consumers.push(consumer);
    return {
      dispose: () => {
        const index = this.consumers.indexOf(consumer);
        if (index >= 0) this.consumers.splice(index, 1);
      },
    };
  }

  /** The function handed to EventBridge's `invalidate` seam. */
  readonly dispatch: InvalidateSink = (kind: SyncKind, sessionId: string | undefined): void => {
    for (const consumer of [...this.consumers]) {
      try {
        consumer(kind, sessionId);
      } catch (error) {
        this.logger?.warn(`invalidation consumer failed for ${kind}: ${String(error)}`);
      }
    }
  };
}

/** The exact consumer wireSessionsDomain registers; only `sessions` refetches. */
export function sessionInvalidationConsumer(sync: SessionSync): InvalidateSink {
  return (kind) => {
    if (kind === "sessions") void sync.refresh();
  };
}

// ---------------------------------------------------------------------------
// wireSessionsDomain: the production composition extension.ts activates.

export interface SessionsWiringDeps {
  readonly manager: ServerManager;
  readonly logger: PanelLogger;
  /** Chat view's public event push (todo 10); forwards all bridge events. */
  readonly events: ViewEventSink;
  /** Injectable bridge timings (tests shrink the debounce). */
  readonly bridgeTiming?: Partial<EventBridgeTiming>;
}

export interface SessionsWiring {
  /** Feed into `registerSessionHandlers(panel.registerHandler, wiring.deps)`. */
  readonly deps: SessionsDomainDeps;
  /** Registration point for todos 13/18 (messages/todos invalidation). */
  readonly hub: InvalidationHub;
  readonly bridge: EventBridge;
  dispose(): void;
}

function isAlive(manager: ServerManager): boolean {
  const state = manager.state;
  return state.kind === "managed" || state.kind === "attached";
}

/** Build the todo-8-backed client source (onboard == start-if-needed + detect). */
export function managerSessionSource(manager: ServerManager): SessionClientSource {
  return {
    connect: async () => {
      const onboard = await manager.onboardClient();
      if (!onboard.ok) throw onboard.error;
      return onboard.connection;
    },
  };
}

/**
 * Compose the sessions domain sync: bridge + invalidation hub + poll sync +
 * the service/handler deps. The bridge starts subscribing immediately; it
 * reconnects forever while the server is managed|attached and refetches the
 * session list on `server.connected` resync and every debounced `sessions`
 * invalidation.
 */
export function wireSessionsDomain(deps: SessionsWiringDeps): SessionsWiring {
  const { manager, logger } = deps;
  const source = managerSessionSource(manager);
  const service = createSessionService({ source, logger });
  const sessionSync = new SessionSync({ service, sink: deps.events, logger });
  const hub = new InvalidationHub(logger);
  hub.add(sessionInvalidationConsumer(sessionSync));

  const bridge = new EventBridge({
    source: async (signal) => {
      const connection = await source.connect();
      return createSdkEventSource(connection.client)(signal);
    },
    isServerAlive: () => isAlive(manager),
    sink: (event) => {
      deps.events.postEvent(event.type, event.payload);
    },
    invalidate: hub.dispatch,
    resync: ({ droppedEventCount }) => {
      if (droppedEventCount > 0) {
        logger.warn(`event stream resync dropped ${droppedEventCount} queued event(s)`);
      }
      void sessionSync.refresh();
    },
    serverLost: (notice: ServerLostNotice) => {
      logger.warn(
        `event stream lost (${notice.reason}, failure ${notice.failures}): ${notice.detail}`,
      );
      deps.events.postEvent(SERVER_LOST_EVENT, notice);
    },
    logger,
    ...(deps.bridgeTiming === undefined ? {} : { timing: deps.bridgeTiming }),
  });
  // Activation-order fix (todo 24): the bridge's subscribe loop exits
  // PERMANENTLY when started while the manager is not yet alive (its
  // isServerAlive gate runs before the first attempt), and start() is a
  // one-shot (idempotent no-ops afterwards). wireSessionsDomain runs at
  // activation — long before any managed|attached transition — so defer the
  // start to the first alive transition; an already-alive manager starts
  // immediately. (A later dead→alive REVIVE still needs a fresh bridge —
  // documented pre-existing gap; the bridge itself exits on server loss.)
  let started = false;
  let startSubscription: Disposable | undefined;
  const startOnce = (): void => {
    if (started) return;
    started = true;
    bridge.start();
  };
  if (isAlive(manager)) {
    startOnce();
  } else {
    startSubscription = manager.onDidChangeState(() => {
      if (!isAlive(manager)) return;
      startSubscription?.dispose();
      startSubscription = undefined;
      startOnce();
    });
  }

  return {
    deps: { service, sync: sessionSync },
    hub,
    bridge,
    dispose: () => {
      startSubscription?.dispose();
      bridge.dispose();
    },
  };
}


/**
 * HTTP surface of the mock opencode server: routing table, SSE hub, dispatch.
 * Unknown routes always 404 with a JSON error — nothing is silently swallowed.
 * Session action routes live in routes-session.ts; canned GET routes in routes-static.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BusEvent, JsonObject, ScenarioName, SessionId } from "./types.js";
import { isScenarioName } from "./types.js";
import type { MockState, SessionRecord } from "./state.js";
import { MODERN_VERSION, OLD_SERVER_VERSION, createMockSession } from "./state.js";
import { buildOpenApiSpec, renderDocHtml } from "./spec.js";
import { buildSessionRoutes } from "./routes-session.js";
import { buildStaticRoutes } from "./routes-static.js";
import {
  HttpError,
  openSse,
  readJsonBody,
  sendApiError,
  sendHtml,
  sendJson,
} from "./httpkit.js";

export interface RouteContext {
  state: MockState;
  params: Record<string, string>;
  query: URLSearchParams;
  body: JsonObject;
}
export type Handler = (ctx: RouteContext, req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type Route = [method: string, pattern: string, handler: Handler];
/** Routes that only exist on modern servers; old-server 404s them (and /doc omits them). */
export const MODERN_ONLY = [
  "/session/:id/fork",
  "/session/:id/todo",
  "/session/:id/questions/:requestID",
  "/api/session/:id/question/:requestID/reply",
  "/session/:id/prompt_async",
] as const;

export class MockHttpServer {
  readonly state: MockState;
  private eventCounter = 0;
  private readonly sseClients = new Set<(frame: string) => void>();
  readonly routes: Route[];

  constructor(state: MockState) {
    this.state = state;
    this.routes = buildRoutes(this);
  }

  /** Broadcast to every connected /event client, assigning the event id. */
  emit(event: Omit<BusEvent, "id">): void {
    const full: BusEvent = { id: `evt_${++this.eventCounter}`, ...event };
    const frame = `data: ${JSON.stringify(full)}\n\n`;
    for (const write of this.sseClients) write(frame);
  }

  setScenario(name: ScenarioName): void {
    this.state.scenario = name;
    if (!this.state.versionPinned) {
      this.state.version = name === "old-server" ? OLD_SERVER_VERSION : MODERN_VERSION;
    }
  }

  addSse(req: IncomingMessage, res: ServerResponse): void {
    const write = openSse(req, res);
    this.sseClients.add(write);
    req.on("close", () => this.sseClients.delete(write));
    // Fidelity fix (todo 24): the real server greets EVERY /event
    // subscription with its own `server.connected` — the todo-9 bridge only
    // dispatches queued events after seeing it. The greeting is
    // per-subscription, so it bypasses the all-clients broadcast of emit().
    const greeting: BusEvent = {
      id: `evt_${++this.eventCounter}`,
      type: "server.connected",
      properties: {},
    };
    write(`data: ${JSON.stringify(greeting)}\n\n`);
  }

  /** Session lookup shared by every /session/:id route; 404s like the real API. */
  mustSession(ctx: RouteContext, res: ServerResponse): SessionRecord | undefined {
    const id = ctx.params.id as SessionId;
    const record = this.state.sessions.get(id);
    if (record === undefined) sendApiError(res, 404, `session not found: ${ctx.params.id}`);
    return record;
  }

  mustModern(pattern: string, res: ServerResponse): boolean {
    const flagged = (MODERN_ONLY as readonly string[]).includes(pattern);
    if (flagged && this.state.scenario === "old-server") {
      sendApiError(res, 404, `route not available on this server: ${pattern}`);
      return false;
    }
    return true;
  }

  /** Wraps a handler: resolves /session/:id to its record or answers 404. */
  sessionHandler(
    fn: (rec: SessionRecord, ctx: RouteContext, res: ServerResponse) => void | Promise<void>,
  ): Handler {
    return (ctx, _req, res) => {
      const record = this.mustSession(ctx, res);
      if (record === undefined) return;
      return fn(record, ctx, res);
    };
  }

  /** Wraps a handler: on the old-server scenario, modern-only routes answer a JSON 404. */
  modern(pattern: string, fn: Handler): Handler {
    return (ctx, req, res) => {
      if (!this.mustModern(pattern, res)) return;
      return fn(ctx, req, res);
    };
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const body = await readJsonBody(req);
      for (const [method, pattern, handler] of this.routes) {
        const params = matchRoute(method, pattern, req.method ?? "GET", url.pathname);
        if (params === null) continue;
        await handler({ state: this.state, params, query: url.searchParams, body }, req, res);
        return;
      }
      sendApiError(res, 404, `route not found: ${req.method ?? "GET"} ${url.pathname}`);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof HttpError) {
        sendApiError(res, error.status === 400 ? 400 : 404, error.message);
        return;
      }
      sendJson(res, 500, {
        name: "InternalError",
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

/** Segments match literally except `:name`, which captures one segment. */
function matchRoute(method: string, pattern: string, reqMethod: string, pathname: string): Record<string, string> | null {
  if (method !== reqMethod) return null;
  const want = pattern.split("/").filter(Boolean);
  const got = pathname.split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i];
    const g = got[i];
    if (w === undefined || g === undefined) return null;
    if (w.startsWith(":")) {
      params[w.slice(1)] = decodeURIComponent(g);
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

function buildRoutes(srv: MockHttpServer): Route[] {
  const one = srv.sessionHandler((rec, _ctx, res) => sendJson(res, 200, rec.info));
  return [
    ["GET", "/global/health", ({ state }, _req, res) => sendJson(res, 200, { healthy: true, version: state.version })],
    ["GET", "/doc", ({ state, query }, _req, res) => {
      const spec = buildOpenApiSpec(
        state.scenario,
        state.version,
        query.get("qshape") === "modern" ? "modern" : undefined,
      );
      if (query.get("raw") === "1") sendJson(res, 200, spec);
      else sendHtml(res, 200, renderDocHtml(spec));
    }],
    ["GET", "/event", (_ctx, req, res) => srv.addSse(req, res)],
    ["POST", "/__scenario", (ctx, _req, res) => {
      if (!isScenarioName(ctx.body.name)) {
        sendApiError(res, 400, `unknown scenario: ${JSON.stringify(ctx.body.name)}`);
        return;
      }
      srv.setScenario(ctx.body.name);
      sendJson(res, 200, { scenario: srv.state.scenario, version: srv.state.version });
    }],
    ["GET", "/session", ({ state }, _req, res) => sendJson(res, 200, [...state.sessions.values()].map((s) => s.info))],
    ["POST", "/session", ({ state, body }, _req, res) => {
      const record = createMockSession(state, typeof body.title === "string" ? body.title : "New session");
      state.sessions.set(record.info.id, record);
      srv.emit({ type: "session.created", properties: { info: record.info } });
      sendJson(res, 200, record.info);
    }],
    ["GET", "/session/:id", one],
    ["PATCH", "/session/:id", srv.sessionHandler((rec, { body }, res) => {
      if (typeof body.title === "string") rec.info.title = body.title;
      rec.info.time.updated = Date.now();
      srv.emit({ type: "session.updated", properties: { info: rec.info } });
      sendJson(res, 200, rec.info);
    })],
    ["DELETE", "/session/:id", srv.sessionHandler((rec, { state }, res) => {
      state.sessions.delete(rec.info.id);
      srv.emit({ type: "session.deleted", properties: { info: rec.info } });
      sendJson(res, 200, true);
    })],
    ...buildSessionRoutes(srv),
    ...buildStaticRoutes(),
  ];
}

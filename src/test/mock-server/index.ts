/**
 * Mock opencode server with scenario-driven SSE replay (plan todo 5 test harness).
 *
 * Usage:
 *   const server = await startMockServer(0);              // any free port
 *   await startMockServer(4096, { version: "9.9.9" });     // pinned health version
 *   server.setScenario("permission-flow");                 // or POST /__scenario
 *   server.pushEvent("todo.updated", { sessionID, todos });// inject any SSE event
 *   await server.close();
 *
 * Scenarios: see SCENARIO_NAMES. `startMockServer` accepts `port = 0` and the
 * returned object carries the resolved `port` + `url` for clients.
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { JsonObject, ScenarioName } from "./types.js";
import { SCENARIO_NAMES } from "./types.js";
import { createMockState } from "./state.js";
import { MockHttpServer } from "./server.js";

export interface MockServerOptions {
  /** Initial scenario (default "basic-chat"). Switch later via setScenario or POST /__scenario. */
  scenario?: ScenarioName;
  /** Version string for GET /global/health. When set, scenario switches never change it. */
  version?: string;
}

export interface MockServer {
  url: string;
  port: number;
  /** Inject an arbitrary event into the SSE bus (test driver hook). */
  pushEvent: (type: string, properties?: JsonObject) => void;
  setScenario: (name: ScenarioName) => void;
  close: () => Promise<void>;
}

export function startMockServer(port = 0, options: MockServerOptions = {}): Promise<MockServer> {
  const app = new MockHttpServer(createMockState(options.scenario ?? "basic-chat", options.version));
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    app.dispatch(req, res).catch(() => {
      // dispatch already error-handles; this only guards res.write throwing on dead sockets
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        pushEvent: (type, properties) => app.emit({ type, properties: properties ?? {} }),
        setScenario: (name) => app.setScenario(name),
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            for (const socket of sockets) socket.destroy();
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
  });
}

export { SCENARIO_NAMES };
export { MODERN_VERSION, OLD_SERVER_VERSION } from "./state.js";
export type { ScenarioName } from "./types.js";

/**
 * Fixture-backed GET routes (/agent, /config, /provider, /mcp, /path, /file,
 * /find). No state mutation, no SSE — one canned payload per route.
 */
import {
  agentsFor,
  commandsFor,
  configFixture,
  configProvidersFixture,
  mcpFixture,
  pathFixture,
  providerAuthFixture,
  providerListFixture,
} from "./fixtures.js";
import { sendJson } from "./httpkit.js";
import type { ScenarioName } from "./types.js";
import type { Handler, Route } from "./server.js";

const ok = (body: unknown): Handler => (_ctx, _req, res) => sendJson(res, 200, body);
const okState = (body: (scenario: ScenarioName) => unknown): Handler => {
  return ({ state }, _req, res) => sendJson(res, 200, body(state.scenario));
};

export function buildStaticRoutes(): Route[] {
  return [
    ["GET", "/agent", okState((scenario) => agentsFor(scenario))],
    ["GET", "/command", okState((scenario) => commandsFor(scenario))],
    ["GET", "/config", ok(configFixture())],
    ["PATCH", "/config", ok(configFixture())],
    ["GET", "/config/providers", ok(configProvidersFixture())],
    ["GET", "/provider", ok(providerListFixture())],
    ["PATCH", "/provider", ok(true)],
    ["POST", "/provider", ok(true)],
    ["GET", "/provider/auth", ok(providerAuthFixture())],
    ["GET", "/mcp", ok(mcpFixture())],
    ["GET", "/path", ok(pathFixture())],
    ["GET", "/file", ok([
      { name: "src", path: "src", absolute: "/mock/workspace/src", type: "directory", ignored: false },
      { name: "example.ts", path: "src/example.ts", absolute: "/mock/workspace/src/example.ts", type: "file", ignored: false },
    ])],
    ["GET", "/file/content", ok({ type: "text", content: "// mock file content\n" })],
    ["GET", "/file/status", ok([])],
    ["GET", "/find", ok([
      {
        path: { text: "src/example.ts" }, lines: { text: "export const value = 2;" }, line_number: 1, absolute_offset: 0,
        submatches: [{ match: { text: "value" }, start: 14, end: 19 }],
      },
    ])],
    ["GET", "/find/file", ok(["src/example.ts", "src/other.ts"])],
    ["GET", "/find/symbol", ok([
      {
        name: "value", kind: 13,
        location: { uri: "file:///mock/workspace/src/example.ts", range: { start: { line: 0, character: 13 }, end: { line: 0, character: 18 } } },
      },
    ])],
  ];
}

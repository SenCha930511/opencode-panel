/**
 * Scenario blocks 4-7 for smoke-mock.mjs (kept separate so each file stays small).
 * Receives the runner's helpers from smoke-mock.mjs and appends to its check count.
 */

export async function runLongStream({ api, openSse, createSession, check, deltasFor }) {
  console.log("scenario: long-stream");
  await api("POST", "/__scenario", { name: "long-stream" });
  const sse = openSse();
  const session = await createSession("long smoke");
  check((await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "go" }] })).status === 204, "prompt_async 204");
  await sse.waitFor((e) => e.type === "session.idle", "long stream completes", 30000);
  check(deltasFor(sse.events, session.id).length === 200, "long-stream emits exactly 200 deltas");
  sse.close();
}

export async function runErrorRevert({ api, openSse, createSession, check }) {
  console.log("scenario: error-revert");
  await api("POST", "/__scenario", { name: "error-revert" });
  const sse = openSse();
  const session = await createSession("error smoke");
  check((await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "go" }] })).status === 204, "prompt_async 204");
  await sse.waitFor((e) => e.type === "session.error", "session.error emitted");
  await sse.waitFor((e) => e.type === "session.idle", "session idle after error");
  const messages = await api("GET", `/session/${session.id}/message`);
  const assistant = messages.json.at(-1);
  check(assistant.info.error?.name === "APIError", "final message carries APIError");
  const revert = await api("POST", `/session/${session.id}/revert`, { messageID: assistant.info.id });
  check(revert.status === 200 && revert.json.revert?.messageID === assistant.info.id, "revert after error works");
  check((await api("POST", `/session/${session.id}/unrevert`)).status === 200, "unrevert works");
  sse.close();
}

export async function runOmoAgents({ api, openSse, createSession, check }) {
  console.log("scenario: omo-agents");
  await api("POST", "/__scenario", { name: "omo-agents" });
  const sse = openSse();
  const agents = await api("GET", "/agent");
  const names = agents.json.map((a) => a.name);
  for (const expected of ["build", "plan", "sisyphus", "oracle"]) {
    check(names.includes(expected), `GET /agent includes ${expected}`);
  }
  check(agents.json.find((a) => a.name === "sisyphus")?.builtIn === false, "omo agents marked builtIn:false");
  check((await api("GET", "/command")).json.some((c) => c.name === "ulw-research"), "GET /command includes custom commands");
  check((await api("GET", "/mcp")).json.context7?.status === "connected", "GET /mcp returns native MCP statuses");

  const session = await createSession("omo smoke");
  check((await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "go" }] })).status === 204, "prompt_async 204");
  await sse.waitFor((e) => e.type === "session.idle", "omo reply completes");
  const messages = await api("GET", `/session/${session.id}/message`);
  const toolParts = messages.json.at(-1).parts.filter((p) => p.type === "tool");
  check(toolParts.some((p) => p.tool === "skill_mcp"), "omo reply carries unknown tool part (skill_mcp)");
  check(toolParts.every((p) => p.state.status === "completed"), "tool parts are completed");
  sse.close();
}

/** Failure QA from the plan: old-server + probe /session/x/fork → 404 JSON. */
export async function runOldServer({ api, openSse, createSession, check, is404Json, deltasFor, base, OLD_SERVER_VERSION }) {
  console.log("scenario: old-server (failure QA: modern routes 404 with JSON)");
  const res = await api("POST", "/__scenario", { name: "old-server" });
  check(res.json.version === OLD_SERVER_VERSION, `scenario switch moves version to ${OLD_SERVER_VERSION}`);
  check((await api("GET", "/global/health")).json.version === OLD_SERVER_VERSION, "health reports old version");

  const session = await createSession("old smoke");
  is404Json(await api("POST", "/session/x/fork", {}), "POST /session/x/fork on old-server");
  is404Json(await api("GET", "/session/x/todo"), "GET /session/x/todo on old-server");
  is404Json(await api("POST", `/session/${session.id}/questions/qst_1`, { answers: [] }), "question reply on old-server");
  is404Json(await api("POST", `/session/${session.id}/prompt_async`, { parts: [] }), "prompt_async on old-server");

  const spec = await api("GET", "/doc?raw=1");
  const modernOnlyPaths = ["/session/{id}/fork", "/session/{id}/todo", "/session/{id}/questions/{requestID}", "/session/{id}/prompt_async"];
  for (const absent of modernOnlyPaths) {
    check(spec.json.paths[absent] === undefined, `old-server /doc omits ${absent}`);
  }
  check(!(await (await fetch(base + "/doc")).text()).includes("/session/{id}/fork"), "old-server /doc HTML omits fork");

  const sse = openSse();
  const sync = await api("POST", `/session/${session.id}/message`, { parts: [{ type: "text", text: "legacy" }] });
  check(sync.status === 200 && sync.json.info.role === "assistant", "sync POST /message still works (fallback path)");
  check(deltasFor(sse.events, session.id).length >= 1, "legacy prompt still streamed deltas");
  sse.close();
}

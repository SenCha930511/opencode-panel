#!/usr/bin/env node
/**
 * Smoke test for the mock opencode server (plan todo 5 acceptance).
 *
 * The harness is TypeScript (strict, NodeNext). To keep `node scripts/smoke-mock.mjs`
 * working verbatim, this script first bundles src/test/mock-server/index.ts with the
 * already-installed esbuild into node_modules/.cache/, then imports the compiled
 * artifact. No npm install, no runtime deps beyond node + the esbuild devDep.
 *
 * Runs all 7 scenarios through plain fetch + a minimal SSE reader and asserts the
 * plan's contracts, including the old-server 404 failure-QA rule. Exit 0 on pass.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runErrorRevert, runLongStream, runOldServer, runOmoAgents } from "./smoke-mock-scenarios.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "node_modules", ".cache", "opencode-panel", "mock-server.mjs");

await build({
  entryPoints: [path.join(root, "src", "test", "mock-server", "index.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
});

const { startMockServer, OLD_SERVER_VERSION } = await import(pathToFileURL(outfile).href);

let checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(`CHECK FAILED: ${label}`);
  checks += 1;
  console.log(`  ok — ${label}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = await startMockServer(0);
const base = server.url;

async function api(method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, contentType: res.headers.get("content-type") ?? "" };
}

/** Minimal SSE reader: collects parsed events; waitFor polls the buffer with a hard timeout. */
function openSse() {
  const events = [];
  const ac = new AbortController();
  const started = (async () => {
    const res = await fetch(base + "/event", { signal: ac.signal });
    if (res.status !== 200) throw new Error(`SSE /event status ${res.status}`);
    check(true, "GET /event returns 200 SSE");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5)));
        }
      }
    }
  })();
  started.catch(() => {}); // abort at close() is expected
  const waitFor = async (pred, label, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = events.find(pred);
      if (hit !== undefined) return hit;
      await sleep(10);
    }
    throw new Error(`timeout waiting for SSE event: ${label} (saw: ${events.map((e) => e.type).join(", ")})`);
  };
  return { events, waitFor, close: () => ac.abort() };
}

const is404Json = (r, label) => {
  check(r.status === 404, `${label} → 404 (got ${r.status})`);
  check(r.json && r.json.name === "NotFoundError", `${label} → JSON error body (name NotFoundError)`);
};

const deltasFor = (events, sessionId) =>
  events.filter((e) => e.type === "message.part.delta" && e.properties?.sessionID === sessionId);

async function createSession(title) {
  const r = await api("POST", "/session", { title });
  check(r.status === 200, "POST /session → 200");
  check(typeof r.json.id === "string" && r.json.id.startsWith("ses_"), "new session has ses_ id");
  return r.json;
}

// ---------------------------------------------------------------- setup + /doc + 404 contract
console.log("setup: health, /doc forms, unknown-route 404");
{
  const health = await api("GET", "/global/health");
  check(health.status === 200 && health.json.healthy === true, "GET /global/health healthy");
  check(typeof health.json.version === "string", "health carries a version string");

  const doc = await fetch(base + "/doc");
  const html = await doc.text();
  check(doc.headers.get("content-type")?.includes("text/html") === true, "/doc is text/html");
  check(html.includes('<script id="api-reference" type="application/json">'), "/doc embeds spec in api-reference script tag");
  const embedded = html.match(/<script id="api-reference" type="application\/json">(.*?)<\/script>/s);
  check(embedded !== null, "embedded spec extractable from /doc HTML");
  const specFromHtml = JSON.parse(embedded[1]);
  check(specFromHtml.paths["/session/{id}/fork"] !== undefined, "embedded spec lists fork route");

  const raw = await api("GET", "/doc?raw=1");
  check(raw.status === 200 && raw.json.paths["/session/{id}/fork"] !== undefined, "/doc?raw=1 is parseable JSON spec");

  is404Json(await api("GET", "/definitely-not-a-route"), "unknown route");
}

// ---------------------------------------------------------------- scenario 1: basic-chat
console.log("scenario: basic-chat");
await api("POST", "/__scenario", { name: "basic-chat" });
{
  const sse = openSse();
  const session = await createSession("basic-chat smoke");

  const wrongVerb = await api("POST", `/session/${session.id}/unshare`);
  is404Json(wrongVerb, "POST /session/:id/unshare (the verb must be DELETE /session/:id/share)");

  const rename = await api("PATCH", `/session/${session.id}`, { title: "renamed" });
  check(rename.status === 200 && rename.json.title === "renamed", "PATCH /session/:id renames");

  const async_ = await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "hello mock" }] });
  check(async_.status === 204, "POST prompt_async → 204 immediately");
  await sse.waitFor((e) => e.type === "message.part.delta", "first delta");
  check(deltasFor(sse.events, session.id).length >= 1, "basic-chat emits ≥1 message.part.delta");
  await sse.waitFor((e) => e.type === "session.idle" && e.properties?.sessionID === session.id, "session idle");

  const messages = await api("GET", `/session/${session.id}/message`);
  check(messages.status === 200 && messages.json.length === 2, "GET message returns user+assistant");
  check(messages.json[1].parts.some((p) => p.type === "text" && p.text.includes("mock assistant")), "assistant part text accumulated");

  const deltaCountBefore = deltasFor(sse.events, session.id).length;
  const sync = await api("POST", `/session/${session.id}/message`, { parts: [{ type: "text", text: "sync please" }] });
  check(sync.status === 200 && sync.json.info.role === "assistant" && sync.json.parts.length > 0, "sync POST /message waits and completes");
  check(deltasFor(sse.events, session.id).length > deltaCountBefore, "sync prompt also streamed deltas first");

  const fork = await api("POST", `/session/${session.id}/fork`, {});
  check(fork.status === 200 && fork.json.parentID === session.id && fork.json.id !== session.id, "fork returns child session");
  await api("DELETE", `/session/${fork.json.id}`);

  const share = await api("POST", `/session/${session.id}/share`);
  check(share.status === 200 && typeof share.json.share?.url === "string", "share returns url");
  const unshare = await api("DELETE", `/session/${session.id}/share`);
  check(unshare.status === 200 && unshare.json.share === undefined, "DELETE /session/:id/share unshares (the real verb)");

  const revert = await api("POST", `/session/${session.id}/revert`, { messageID: sync.json.info.id });
  check(revert.status === 200 && revert.json.revert?.messageID === sync.json.info.id, "revert sets revert block");
  const unrevert = await api("POST", `/session/${session.id}/unrevert`);
  check(unrevert.status === 200 && unrevert.json.revert === undefined, "unrevert clears revert block");
  check((await api("POST", `/session/${session.id}/summarize`, { providerID: "mock-provider", modelID: "mock-large" })).status === 200, "summarize 200");
  check((await api("POST", `/session/${session.id}/abort`)).status === 200, "abort 200");
  check((await api("GET", `/session/${session.id}/todo`)).json.length >= 1, "todo list served");
  check(Array.isArray((await api("GET", `/session/${session.id}/diff`)).json), "diff served");
  check((await api("DELETE", `/session/${session.id}`)).json === true, "DELETE /session/:id → true");
  sse.close();
}

// ---------------------------------------------------------------- scenario 2: permission-flow
console.log("scenario: permission-flow");
await api("POST", "/__scenario", { name: "permission-flow" });
{
  const sse = openSse();
  const session = await createSession("permission smoke");
  check((await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "go" }] })).status === 204, "prompt_async 204");
  const asked = await sse.waitFor((e) => e.type === "permission.asked", "permission.asked");
  check(typeof asked.properties.id === "string" && asked.properties.permission === "bash", "permission.asked carries id + permission");
  const noReply = await api("POST", `/session/${session.id}/permissions/${asked.properties.id}`, {});
  check(noReply.status === 400, "permission reply without response → 400");
  const replied = await api("POST", `/session/${session.id}/permissions/${asked.properties.id}`, { response: "once" });
  check(replied.status === 200 && replied.json === true, "permission reply once → 200 true");
  await sse.waitFor((e) => e.type === "permission.replied" && e.properties?.response === "once", "permission.replied once");
  await sse.waitFor((e) => e.type === "session.idle", "session idle after permission");
  is404Json(await api("POST", `/session/${session.id}/permissions/per_404`, { response: "once" }), "reply to unknown permission");
  sse.close();
}

// ---------------------------------------------------------------- scenario 3: question-flow
console.log("scenario: question-flow");
await api("POST", "/__scenario", { name: "question-flow" });
{
  const sse = openSse();
  const session = await createSession("question smoke");
  check((await api("POST", `/session/${session.id}/prompt_async`, { parts: [{ type: "text", text: "go" }] })).status === 204, "prompt_async 204");
  const asked = await sse.waitFor((e) => e.type === "question.asked", "question.asked");
  check(Array.isArray(asked.properties.questions) && asked.properties.questions.length === 1, "question.asked carries questions");
  const answered = await api("POST", `/session/${session.id}/questions/${asked.properties.id}`, { answers: [["minimal"]] });
  check(answered.status === 200 && answered.json === true, "question reply → 200 true");
  await sse.waitFor((e) => e.type === "question.replied" && e.properties?.requestID === asked.properties.id, "question.replied");
  await sse.waitFor((e) => e.type === "session.idle", "session idle after question");
  sse.close();
}

// -------------------------------------------------- scenarios 4-7 (smoke-mock-scenarios.mjs)
const deps = { api, openSse, createSession, check, is404Json, deltasFor, base, OLD_SERVER_VERSION };
await runLongStream(deps);
await runErrorRevert(deps);
await runOmoAgents(deps);
await runOldServer(deps);

await server.close();
console.log(`\nSMOKE OK — ${checks} checks passed across 7 scenarios + doc/404 contracts`);
process.exitCode = 0;

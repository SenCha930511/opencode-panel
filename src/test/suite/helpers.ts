/**
 * Todo-24 suite harness: one in-band mock server + one activated extension
 * shared by all suite files (idempotent `startHarness`), plus the strictly
 * typed plumbing for the todo-10/24 dev seams (`_test` hooks on the chat
 * provider, the env-gated `PanelActivationTestApi` extension export).
 *
 * No assertion touches a webview DOM — everything waits on the typed wire
 * messages recorded by `_test.getPostedMessages()` or feeds envelopes
 * through `_test.receiveFromWebview(...)` (the REAL HostMessenger dispatch).
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { startMockServer, type MockServer } from "../mock-server/index.js";
import type { PanelActivationTestApi } from "../../host/testSeam.js";
import type { ServerManager, ServerManagerState } from "../../server/ServerManager.js";
import { renderServerState } from "../../host/statusBar.js";
import type { DevProviderTestHooks } from "../../providers/BaseViewProvider.js";
import { CHAT_VIEW_ID } from "../../providers/registration.js";
import type { FromWebviewProtocol, HostMessage } from "../../shared/protocol.js";
import { MODERN_VERSION, OLD_SERVER_VERSION } from "../mock-server/index.js";

export { MODERN_VERSION, OLD_SERVER_VERSION };

export const EXTENSION_ID = "SenCha930511.opencode-panel";
export const DEFAULT_PORT = "4099";

export function testPort(): string {
  return process.env.OPENCODE_PANEL_TEST_PORT ?? DEFAULT_PORT;
}

export function mockBaseUrl(): string {
  return `http://127.0.0.1:${testPort()}`;
}

/** QA knob: skip starting the mock ⇒ the activation attach MUST fail (no hang). */
export function skipMock(): boolean {
  return (process.env.OPENCODE_PANEL_TEST_SKIP_MOCK ?? "") !== "";
}

export interface Harness {
  mock: MockServer | undefined;
  api: PanelActivationTestApi;
  chatHooks: DevProviderTestHooks;
}

let harness: Harness | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow the env-gated extension export (fail loud when the seam is off). */
function requireTestApi(extension: vscode.Extension<unknown>): PanelActivationTestApi {
  const exportsValue: unknown = extension.isActive ? extension.exports : undefined;
  const api = isRecord(exportsValue) ? exportsValue : undefined;
  assert.ok(
    api !== undefined &&
      isRecord(api.manager) &&
      typeof (api.manager as { start?: unknown }).start === "function" &&
      typeof (api.manager as { dispose?: unknown }).dispose === "function" &&
      isRecord(api.chat) &&
      isRecord(api.sessions),
    "todo-24 seam inactive: activation returned no test API " +
      "(OPENCODE_PANEL_TEST_PORT must be set in the extension host env)",
  );
  return exportsValue as PanelActivationTestApi;
}

/** Narrow the dev-only `_test` provider hooks (fail loud in production builds). */
export function devHooks(provider: unknown): DevProviderTestHooks {
  const candidate: unknown = Reflect.get(provider as object, "_test");
  assert.ok(isRecord(candidate), "_test hook missing — needs a __DEV__ extension bundle");
  assert.equal(typeof candidate.getPostedMessages, "function");
  assert.equal(typeof candidate.hasResolvedView, "function");
  assert.equal(typeof candidate.receiveFromWebview, "function");
  return candidate as unknown as DevProviderTestHooks;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitFor(condition: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(25);
  }
  assert.fail(`timed out after ${String(timeoutMs)}ms waiting for ${what}`);
}

/**
 * Wait for the manager to ATTACH (todo-24 harness). A manager `error` state
 * short-circuits with the error message — the QA failure case (dead port)
 * therefore reports a clean attach failure in milliseconds, never a hang.
 */
export async function waitForAttached(
  manager: ServerManager,
  timeoutMs = 25_000,
): Promise<ServerManagerState> {
  const deadline = Date.now() + timeoutMs;
  let state = manager.state;
  while (Date.now() < deadline) {
    if (state.kind === "attached" || state.kind === "managed") return state;
    if (state.kind === "error") {
      assert.fail(
        `manager attach failed before reaching attached: ${state.error.message} ` +
          "(OPENCODE_PANEL_TEST_PORT must point at the suite's mock)",
      );
    }
    await sleep(25);
    state = manager.state;
  }
  assert.fail(`timed out after ${String(timeoutMs)}ms waiting for manager attach`);
}

/** Focus the chat view and wait for the provider to resolve it. */
export async function focusChatView(chatHooks: DevProviderTestHooks): Promise<void> {
  await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  await waitFor(
    () => chatHooks.hasResolvedView(),
    "chat webview view resolution",
    15_000,
  );
}

/** Start (once) the shared mock + activated extension; QA-skip starts no mock. */
export async function startHarness(): Promise<Harness> {
  if (harness !== undefined) {
    if (!skipMock()) await waitForAttached(harness.api.manager);
    return harness;
  }
  let mock: MockServer | undefined;
  if (!skipMock()) {
    mock = await startMockServer(Number(testPort()));
  }
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension !== undefined, `extension ${EXTENSION_ID} not installed in the host`);
  await extension.activate();
  const api = requireTestApi(extension);
  const chatHooks = devHooks(api.chat);
  harness = { mock, api, chatHooks };
  if (!skipMock()) await waitForAttached(api.manager);
  return harness;
}

/** Restart the mock on the same fixed port under a new scenario/version. */
export async function restartMock(h: Harness, scenario: "basic-chat" | "old-server"): Promise<MockServer> {
  if (h.mock !== undefined) {
    await h.mock.close();
    h.mock = undefined;
  }
  const next = await startMockServer(Number(testPort()), {
    scenario,
    ...(scenario === "old-server" ? { version: OLD_SERVER_VERSION } : {}),
  });
  h.mock = next;
  return next;
}

/** Create a session through the mock's loopback REST (sanctioned test seam). */
export async function createMockSession(
  mock: MockServer,
  title: string,
): Promise<{ id: string }> {
  const response = await fetch(`${mock.url}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  assert.ok(response.ok, `mock POST /session failed with HTTP ${response.status}`);
  const body: unknown = await response.json();
  assert.ok(isRecord(body) && typeof body.id === "string", "mock session has no id");
  return { id: body.id };
}

/** Feed one protocol envelope through the REAL per-view messenger dispatch. */
export function sendFromWebview<K extends keyof FromWebviewProtocol>(
  chatHooks: DevProviderTestHooks,
  envelope: { messageId: string; type: K; payload: FromWebviewProtocol[K] },
): void {
  // The messenger boundary parses (`parseRequestEnvelope`), so the envelope
  // crosses as unknown exactly like a real webview postMessage — no cast.
  chatHooks.receiveFromWebview({ ...envelope });
}

export type EventMessage = Extract<HostMessage, { type: "event" }>;
export type StreamChunkMessage = Extract<HostMessage, { type: "streamChunk" }>;
export type InitMessage = Extract<HostMessage, { type: "init" }>;

export function isEventOfType(message: HostMessage, type: string): message is EventMessage {
  return message.type === "event" && message.payload.type === type;
}

export function isStreamChunkFor(message: HostMessage, messageId: string): message is StreamChunkMessage {
  return message.type === "streamChunk" && message.payload.messageId === messageId;
}

export function isTerminalChunkFor(message: HostMessage, messageId: string): message is StreamChunkMessage {
  return isStreamChunkFor(message, messageId) && message.payload.done;
}

export function isInitPosted(message: HostMessage): message is InitMessage {
  return message.type === "init";
}

/** One polled posted-message expectation (keeps waitForPosted at 2 params). */
export interface PostedWait {
  /** Recorder offset — only messages posted from here on may match. */
  readonly from: number;
  /** Human-readable wait target for timeout errors. */
  readonly description: string;
  readonly timeoutMs?: number;
}

/**
 * Poll the recorded posts (from `wait.from` on) for the first match. The
 * baseline indexes the whole recorder so cross-test noise never matches;
 * 25ms polling rides real wall-clock waits (stream arrival is async). The
 * type-guard overload narrows the returned message for payload access.
 */
export async function waitForPosted<T extends HostMessage>(
  chatHooks: DevProviderTestHooks,
  wait: PostedWait & { readonly matches: (message: HostMessage) => message is T },
): Promise<T>;
export async function waitForPosted(
  chatHooks: DevProviderTestHooks,
  wait: PostedWait & { readonly matches: (message: HostMessage) => boolean },
): Promise<HostMessage>;
export async function waitForPosted(
  chatHooks: DevProviderTestHooks,
  wait: PostedWait & { readonly matches: (message: HostMessage) => boolean },
): Promise<HostMessage> {
  const timeoutMs = wait.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  let found: HostMessage | undefined;
  await waitFor(
    () => {
      found = chatHooks.getPostedMessages().slice(wait.from).find(wait.matches);
      return found !== undefined;
    },
    wait.description,
    deadline - Date.now(),
  );
  assert.ok(found !== undefined);
  return found;
}

/** Recorder offset for "messages posted from this point on". */
export function postedBaseline(chatHooks: DevProviderTestHooks): number {
  return chatHooks.getPostedMessages().length;
}

/** Exact status-bar projection the item shows for the current state. */
export function statusBarText(state: ServerManagerState): string {
  return renderServerState(state).text;
}

/**
 * Prompt dispatch pipeline (plan todo 14, host side): the sendPrompt route
 * decision as an injectable pure-ish module.
 *
 * ROUTE DECISION (plan hard rule — async FIRST, sync only as fallback):
 * 1. PRIMARY: raw `POST {baseUrl}/session/:id/prompt_async` through the
 *    todo-7 auth-injecting `probeFetch` (same credential flow the SDK client
 *    uses), expecting `204 No Content`. The plan asks for the raw POST so the
 *    route choice and the 204 contract are explicit at this seam; the
 *    installed SDK (1.18.18) also ships a typed `session.promptAsync`, but it
 *    issues the exact same request through the same injected fetch — the raw
 *    path keeps one code path instead of two. The body is NEVER read beyond
 *    the status: streaming state arrives over the todo-9 SSE bridge, not in
 *    this response (acceptance: the pipeline must resolve at 204 without
 *    awaiting anything from the server past the headers — a body reader that
 *    throws must not be able to break this path).
 * 2. FALLBACK — only when the server answers HTTP 404 (older opencode
 *    without the route, e.g. the mock `old-server` scenario): the sync
 *    `client.session.prompt({ path: { id }, body })` is awaited. The reply
 *    lands when the sync call resolves; live state still flows via the
 *    bridge — nothing is fabricated into the reply.
 * 3. Any other non-2xx (400/500/...) or a network failure is a dispatch
 *    error carrying the server's message text (the QA failure path:
 *    toast the text, keep the draft).
 *
 * BODY SHAPE mirrors the SDK's SessionPrompt(Async)Data body:
 * `parts` is the text part FIRST, then every wire `Attachment` mapped to an
 * opencode file part (`{type:"file", url, mime, filename}`); `model` is
 * parsed from the todo-3 wire's single `provider/model` string into
 * `{providerID, modelID}` (split at the FIRST "/"); `agent` passes through
 * verbatim. Both routes send the identical body so behavior cannot diverge
 * between server generations.
 */

import type { FilePartInput, OpencodeClient, TextPartInput } from "@opencode-ai/sdk";
import type { ProbeFetch } from "../../server/clientFactory.js";
import type { Attachment, FromWebviewProtocol } from "../../shared/protocol.js";

export type SendPromptPayload = FromWebviewProtocol["sendPrompt"];

/** Part union the prompt routes accept (text + file only for todo 14). */
export type PromptPartInput = TextPartInput | FilePartInput;

export interface PromptModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

/** The JSON body both prompt routes receive (SDK SessionPromptData shape). */
export interface PromptRequestBody {
  readonly parts: PromptPartInput[];
  readonly model?: PromptModelRef;
  readonly agent?: string;
}

export type PromptRoute = "prompt_async" | "sync";

export type PromptDispatchResult =
  | { readonly ok: true; readonly route: PromptRoute }
  | { readonly ok: false; readonly error: string };

/** The narrowest client slice the pipeline needs (the sync prompt call). */
export interface PromptSyncCapable {
  readonly session: {
    readonly prompt: OpencodeClient["session"]["prompt"];
  };
}

export interface PromptPipelineDeps {
  readonly baseUrl: string;
  /** Todo-7 auth-injecting fetch (the exact fetch behind the SDK client). */
  readonly probeFetch: ProbeFetch;
  /** Todo-8 onboarded SDK client (sync fallback + abort live here). */
  readonly client: PromptSyncCapable;
}

/**
 * Parse the todo-3 wire `model` string ("provider/model") into the SDK's
 * `{providerID, modelID}`. A string without a "/" separator — or with an
 * empty side — cannot name a provider-qualified model and is omitted
 * entirely (never half-sent). The split is at the FIRST "/" because model
 * ids themselves may contain "/".
 */
export function parseModelString(model: string | undefined): PromptModelRef | undefined {
  if (model === undefined) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

/** Map one todo-3 wire attachment to the opencode file-part input. */
export function attachmentToFilePart(attachment: Attachment): FilePartInput {
  return {
    type: "file",
    url: attachment.url,
    mime: attachment.mimeType,
    filename: attachment.name,
  };
}

/**
 * Build the route-shared request body: text part first, then file parts;
 * optional model/agent only present when the wire carried them.
 */
export function buildPromptBody(payload: SendPromptPayload): PromptRequestBody {
  const parts: PromptPartInput[] = [{ type: "text", text: payload.text }];
  for (const attachment of payload.attachments) {
    parts.push(attachmentToFilePart(attachment));
  }
  const model = parseModelString(payload.model);
  return {
    parts,
    ...(model === undefined ? {} : { model }),
    ...(payload.agent === undefined ? {} : { agent: payload.agent }),
  };
}

const ERROR_SNIPPET_CAP = 300;

/** Human detail out of a server JSON envelope ({data:{message}} | {message}). */
function messageFromJson(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof record.message === "string" ? record.message : undefined;
}

/** Read an error response's body best-effort and extract its message text. */
async function errorTextFromResponse(response: Response): Promise<string> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return "unreadable error body";
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const message = messageFromJson(parsed);
    if (message !== undefined) return message;
  } catch {
    // Not JSON — fall through to the raw snippet.
  }
  const snippet = text.trim();
  return snippet.length <= ERROR_SNIPPET_CAP ? snippet : `${snippet.slice(0, ERROR_SNIPPET_CAP)}…`;
}

/** Sync fallback: await the SDK `session.prompt`; resolve into a result. */
async function dispatchSync(
  id: string,
  body: PromptRequestBody,
  client: PromptSyncCapable,
): Promise<PromptDispatchResult> {
  const result = await client.session.prompt({
    path: { id },
    body: { parts: body.parts, ...(body.model === undefined ? {} : { model: body.model }),
      ...(body.agent === undefined ? {} : { agent: body.agent }) },
  });
  if (result.error !== undefined || result.data === undefined) {
    const error = result.error;
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : (messageFromJson(error) ?? String(error));
    return { ok: false, error: `sync prompt failed: ${detail} (HTTP ${String(result.response.status)})` };
  }
  return { ok: true, route: "sync" };
}

/**
 * Dispatch one sendPrompt payload. Async-first via raw `prompt_async` (204);
 * a 404 flips to the sync SDK call; everything else is an error result with
 * the server's message preserved. NEVER throws: network failures and SDK
 * rejections both fold into the error result so the handler owns the single
 * "throw on !ok" conversion into a protocol error reply.
 */
export async function dispatchPrompt(
  payload: SendPromptPayload,
  deps: PromptPipelineDeps,
): Promise<PromptDispatchResult> {
  const body = buildPromptBody(payload);
  const url = `${deps.baseUrl}/session/${encodeURIComponent(payload.sessionId)}/prompt_async`;
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  let response: Response;
  try {
    response = await deps.probeFetch(request);
  } catch (error) {
    return {
      ok: false,
      error: `prompt_async request failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    };
  }

  if (response.status === 404) {
    // Older opencode (no prompt_async route): sync fallback, awaited here.
    return dispatchSync(payload.sessionId, body, deps.client);
  }
  if (response.status >= 200 && response.status < 300) {
    // 204 No Content is the contract; any other 2xx is accepted leniently.
    // The body is deliberately left unread: streaming rides the SSE bridge.
    return { ok: true, route: "prompt_async" };
  }
  const detail = await errorTextFromResponse(response);
  return { ok: false, error: `prompt_async failed: ${detail} (HTTP ${String(response.status)})` };
}

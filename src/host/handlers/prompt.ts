/**
 * Prompt domain host handlers (plan todo 14): `sendPrompt` + `abort`,
 * registered through the todo-10 registry seam (`RegisterHandler`, the same
 * structural twin sessions.ts uses) so this module NEVER touches
 * src/providers or src/shared. The client comes from the todo-12
 * {@link SessionClientSource} seam (production: ServerManager.onboardClient),
 * which yields the todo-8 {@link ServerConnection} — `baseUrl`,
 * `client` and the todo-7 auth-injecting `probeFetch` in one object.
 *
 * `sendPrompt` delegates the route decision to {@link dispatchPrompt}
 * (todo-14 pipeline): `prompt_async` 204 first, sync `session.prompt` only
 * on a 404. The reply envelope closes when the pipeline resolves and ALWAYS
 * carries `null` on success — streamed state arrives via the todo-9 bridge /
 * todo-13 `messages.sync`; nothing about the assistant reply is fabricated
 * into this reply. A failed dispatch throws {@link PromptDispatchError}
 * carrying the server's message text, which the todo-3 host messenger turns
 * into an error reply (webview: toast + draft retained).
 *
 * `abort` uses the SDK's `session.abort({ path: { id } })`. CHOICE
 * (documented per the todo spec): verified against @opencode-ai/sdk 1.18.18
 * (`gen/sdk.gen.d.ts` line 150 exports the typed method issuing
 * `POST /session/{id}/abort`), so the SDK path is preferred over a raw
 * probeFetch POST — it shares `fromSdkJournal` error unwrapping conventions
 * with the sessions domain and needs no second route literal.
 */

import type { PanelLogger } from "../logger.js";
import type { FromWebviewResponse } from "../../shared/protocol.js";
import type { RegisterHandler, SessionClientSource } from "./sessions.js";
import { dispatchPrompt } from "./promptPipeline.js";

/** One failed prompt/abort dispatch; detail comes from the server verbatim. */
export class PromptDispatchError extends Error {
  readonly operation: "sendPrompt" | "abort";

  constructor(operation: "sendPrompt" | "abort", detail: string) {
    super(`${operation} failed: ${detail}`);
    this.name = "PromptDispatchError";
    this.operation = operation;
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const data = record.data;
    if (typeof data === "object" && data !== null) {
      const message = (data as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}

export interface PromptDomainDeps {
  readonly source: SessionClientSource;
  readonly logger: PanelLogger;
}

/**
 * Register the two prompt-domain handlers. Each connect()s per request so a
 * dropped server reconnects through the todo-8 onboard path exactly like the
 * sessions domain does.
 */
export function registerPromptHandlers(register: RegisterHandler, deps: PromptDomainDeps): void {
  const { source, logger } = deps;

  register("sendPrompt", async (payload): Promise<FromWebviewResponse["sendPrompt"]> => {
    const connection = await source.connect();
    const result = await dispatchPrompt(payload, {
      baseUrl: connection.baseUrl,
      probeFetch: connection.probeFetch,
      client: connection.client,
    });
    if (!result.ok) {
      logger.warn(`prompt domain: sendPrompt failed: ${result.error}`);
      throw new PromptDispatchError("sendPrompt", result.error);
    }
    logger.debug(`prompt domain: sendPrompt dispatched via ${result.route}`);
    return null;
  });

  register("abort", async ({ sessionId }): Promise<FromWebviewResponse["abort"]> => {
    const connection = await source.connect();
    const result = await connection.client.session.abort({ path: { id: sessionId } });
    if (result.error !== undefined) {
      const detail = `${errorDetail(result.error)} (HTTP ${String(result.response.status)})`;
      logger.warn(`prompt domain: abort failed: ${detail}`);
      throw new PromptDispatchError("abort", detail);
    }
    return null;
  });
}

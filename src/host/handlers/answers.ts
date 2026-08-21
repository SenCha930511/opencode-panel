/**
 * Permission + question reply host handlers (plan todo 16), registered
 * against the todo-3 envelope types through the todo-10 registry seam — this
 * module NEVER touches src/providers, src/shared or src/server internals.
 *
 * SDK CONTRACT (verified against the installed @opencode-ai/sdk 1.18.18,
 * dist/gen/sdk.gen.d.ts):
 * - `client.postSessionIdPermissionsPermissionId({ path: { id, permissionID },
 *   body: { response } })` IS present ("Respond to a permission request"),
 *   so the permission reply rides the SDK's own route/auth plumbing. Result
 *   arrives as hey-api's `{data, error, response}` union
 *   (`throwOnError: false`); failures unwrap into {@link PermissionAnswerError}.
 * - NO question-reply method exists in this SDK build (verified: grep over
 *   dist/gen has no questions route), so the question reply is a raw POST
 *   through the todo-7 `probeFetch` (same basic-auth injection) to the
 *   canonical v1.18.x route `POST {baseUrl}/api/session/:id/question/:requestID/reply`
 *   with body `{answers: string[][]}` — the wire carries per-index label
 *   choices, each wrapped as its own single-label list to satisfy the
 *   server's schema (liberarian-verified against the official question
 *   group; old servers 404 the route and todo 7 exposes `hasQuestion`
 *   for pre-hiding).
 *
 * TYPED ERROR CONTRACT (webview consumes via the todo-3 error reply text):
 * - Any question-reply 404 becomes {@link QuestionUnsupportedError}. The name
 *   is the machine-readable marker: the webview matches
 *   `err.message.startsWith("QuestionUnsupportedError:")` and then hides every
 *   pending question card with one toast (`question.unavailable`). 404 here
 *   means EITHER an old server missing the route (todo-7 `hasQuestion=false`
 *   path) OR an already-defunct request — both fold into the same
 *   capability-aware degradation per todo 16 of the plan.
 * - Non-404 question failures and ANY permission failure become
 *   {@link QuestionAnswerError} / {@link PermissionAnswerError} carrying the
 *   HTTP status; the webview maps `PermissionAnswerError` + `HTTP 404` onto
 *   the card's "expired" state (QA failure scenario: reply after abort).
 *
 * Handlers return null on success; they throw typed errors on failure, which
 * the todo-3 HostMessenger converts into a protocol-level error reply.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "../logger.js";
import type { RegisterHandler } from "./sessions.js";
import type { ProbeFetch } from "../../server/clientFactory.js";
import type { ServerConnection } from "../../server/ServerManager.js";
import type {
  FromWebviewResponse,
  PermissionResponse,
} from "../../shared/protocol.js";

// ---------------------------------------------------------------------------
// Seams and typed errors.

/** The smallest connection source this domain needs (todo-12 precedent). */
export interface AnswerClientSource {
  readonly connect: () => Promise<ServerConnection>;
}

/** Build an AnswerClientSource over a fixed connection (no lifecycle). */
export function staticAnswerSource(connection: ServerConnection): AnswerClientSource {
  return { connect: () => Promise.resolve(connection) };
}

export type AnswerOperation = "permission" | "question";

/** One failed permission-reply server call; carries no credentials. */
export class PermissionAnswerError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status: number | undefined) {
    super(`permission reply failed: ${detail}`);
    this.name = "PermissionAnswerError";
    this.status = status;
  }
}

/** One failed question-reply server call (non-404). */
export class QuestionAnswerError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status: number | undefined) {
    super(`question reply failed: ${detail}`);
    this.name = "QuestionAnswerError";
    this.status = status;
  }
}

/**
 * The question reply route 404'd: either the connected server predates the
 * questions endpoint (todo-7 `hasQuestion` hidden surface) or the request is
 * no longer answerable. The webview collapses both onto “hide question
 * cards + one toast”, keyed off this error's name.
 */
export class QuestionUnsupportedError extends Error {
  constructor(detail: string) {
    super(`question replies unsupported on this server: ${detail}`);
    this.name = "QuestionUnsupportedError";
  }
}

export interface AnswerServiceDeps {
  readonly source: AnswerClientSource;
  readonly logger: PanelLogger;
}

export interface AnswerService {
  answerPermission(input: {
    readonly sessionId: string;
    readonly permissionID: string;
    readonly response: PermissionResponse;
  }): Promise<void>;
  answerQuestion(input: {
    readonly sessionId: string;
    readonly requestID: string;
    readonly answers: readonly string[];
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// SDK result unwrapping (same hey-api union shape as ./sessions.ts; kept
// domain-local so this file never depends on a sibling domain's internals).

interface SdkResultLike<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly response: Response;
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

async function unwrapPermissionResult(
  deps: AnswerServiceDeps,
  call: (client: OpencodeClient) => Promise<SdkResultLike<boolean>>,
): Promise<void> {
  const connection = await deps.source.connect();
  const result = await call(connection.client);
  if (result.error !== undefined || result.data === undefined) {
    const status = result.response.status;
    const detail = `${errorDetail(result.error)} (HTTP ${String(status)})`;
    deps.logger.warn(`answers domain: permission reply failed: ${detail}`);
    throw new PermissionAnswerError(detail, status);
  }
}

async function postQuestionReply(
  deps: AnswerServiceDeps,
  probeFetch: ProbeFetch,
  url: string,
  answers: readonly string[],
): Promise<void> {
  const response = await probeFetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: answers.map((answer) => (Array.isArray(answer) ? answer : [answer])) }),
    }),
  );
  if (response.status === 404) {
    const detail = `${url} (HTTP 404)`;
    deps.logger.warn(`answers domain: question reply unsupported: ${detail}`);
    throw new QuestionUnsupportedError(detail);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    const detail = `${snippet === "" ? "empty body" : snippet} (HTTP ${response.status})`;
    deps.logger.warn(`answers domain: question reply failed: ${detail}`);
    throw new QuestionAnswerError(detail, response.status);
  }
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  return {
    async answerPermission({ sessionId, permissionID, response }) {
      await unwrapPermissionResult(deps, (client) =>
        client.postSessionIdPermissionsPermissionId({
          path: { id: sessionId, permissionID },
          body: { response },
        }),
      );
    },

    async answerQuestion({ sessionId, requestID, answers }) {
      const connection = await deps.source.connect();
      const base = connection.baseUrl.replace(/\/+$/, "");
      // Canonical v1.18.x question reply route (official + live-probe verified):
      // the earlier mirror-assumption route `/session/:id/questions/:id` never existed.
      const url =
        `${base}/api/session/${encodeURIComponent(sessionId)}` +
        `/question/${encodeURIComponent(requestID)}/reply`;
      await postQuestionReply(deps, connection.probeFetch, url, answers);
    },
  };
}

// ---------------------------------------------------------------------------
// Handler registration (todo-10 registry seam).

export interface AnswersDomainDeps {
  readonly service: AnswerService;
}

/**
 * Register the two answer handlers. Each maps the frozen todo-3 wire keys
 * verbatim onto the service call; the operation's success contract IS the
 * reply (no post-action verification round-trips).
 */
export function registerAnswerHandlers(register: RegisterHandler, deps: AnswersDomainDeps): void {
  const { service } = deps;

  register(
    "answerPermission",
    async ({ sessionId, permissionID, response }): Promise<FromWebviewResponse["answerPermission"]> => {
      await service.answerPermission({ sessionId, permissionID, response });
      return null;
    },
  );

  register(
    "answerQuestion",
    async ({ sessionId, questionID, answers }): Promise<FromWebviewResponse["answerQuestion"]> => {
      await service.answerQuestion({ sessionId, requestID: questionID, answers });
      return null;
    },
  );
}

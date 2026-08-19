/** Request/response plumbing for the mock server: body reading, JSON and SSE writers. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorBody, JsonObject } from "./types.js";

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<JsonObject> {
  if (req.method !== "POST" && req.method !== "PATCH") return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > BODY_LIMIT_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("expected a JSON object body");
    }
    return parsed as JsonObject;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid JSON body");
  }
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

export function sendApiError(res: ServerResponse, status: 400 | 404, message: string): void {
  const body: ApiErrorBody = {
    name: status === 400 ? "BadRequestError" : "NotFoundError",
    data: { message },
  };
  sendJson(res, status, body);
}

/** Registers an SSE client and returns its write function; removal is on socket close. */
export function openSse(req: IncomingMessage, res: ServerResponse): (frame: string) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  const write = (frame: string): void => {
    res.write(frame);
  };
  req.on("close", () => {
    res.end();
  });
  return write;
}

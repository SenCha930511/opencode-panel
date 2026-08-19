/**
 * Slash-command execution (plan todo 15, host side): the todo-3 `runCommand`
 * wire request {sessionId, command, args[]} maps onto
 * `session.command({path:{id}, body:{command, arguments: args.join(" ")}})`
 * — the SDK's single arguments string. Registered through the todo-10
 * registry seam (the todo-12 RegisterHandler twin from ./sessions.ts), so
 * this module never touches src/providers or src/shared.
 *
 * A server failure throws {@link CommandRunError}; the todo-3 messenger
 * converts it into an error reply and the webview surfaces it as a toast
 * (the QA failure path, asserted in __tests__/commands.test.ts).
 */

import { isRecord } from "../../shared/protocol.js";
import type { RegisterHandler, SessionClientSource } from "./sessions.js";

export interface CommandDomainDeps {
  readonly source: SessionClientSource;
}

/** One failed slash-command execution; carries no credentials. */
export class CommandRunError extends Error {
  readonly status: number | undefined;

  constructor(detail: string, status: number | undefined) {
    super(`slash command failed: ${detail}`);
    this.name = "CommandRunError";
    this.status = status;
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return String(error);
}

/** Folded slice of the SDK session.command result this path reads. */
export interface SessionCommandCallResult {
  readonly data?: unknown;
  readonly error: unknown;
  readonly response?: Response;
}

/** Structural slice of OpencodeClient the command path calls (fakeable). */
export interface SessionCommandClient {
  readonly session: {
    command(options: {
      readonly path: { readonly id: string };
      readonly body: { readonly command: string; readonly arguments: string };
    }): Promise<SessionCommandCallResult>;
  };
}

/**
 * The slash-command execution step, exported separately from the handler so
 * the wire->SDK mapping is unit-testable with a capturing client.
 */
export async function runSlashCommand(
  client: SessionCommandClient,
  input: { readonly sessionId: string; readonly command: string; readonly args: readonly string[] },
): Promise<void> {
  const result = await client.session.command({
    path: { id: input.sessionId },
    body: { command: input.command, arguments: input.args.join(" ") },
  });
  if (result.error !== undefined) {
    const status = result.response?.status;
    throw new CommandRunError(`${errorDetail(result.error)} (HTTP ${String(status)})`, status);
  }
}

/** Register the todo-15 message handlers (currently just `runCommand`). */
export function registerCommandHandlers(register: RegisterHandler, deps: CommandDomainDeps): void {
  register("runCommand", async ({ sessionId, command, args }) => {
    const connection = await deps.source.connect();
    await runSlashCommand(connection.client, { sessionId, command, args });
    return null;
  });
}

/**
 * Export transcript (plan todo 19): host-side markdown export of one session.
 * No todo-3 wire type fits (the protocol is frozen — domain requests are all
 * server-bound), so the surface is the additive `opencodePanel.exportTranscript`
 * command registered by extension.ts; NO new protocol key is invented.
 *
 * FLOW (all data from `client.session.*`, never fabricated):
 * 1. Resolve the session id: the explicit command argument, else the most
 *    recently-updated session from `session.list` (the list is server-sorted
 *    by recency — the palette invocation exports the user's latest context).
 *    An empty server is {@link ExportTranscriptOutcome} `no-session`.
 * 2. Fetch the title (`session.get`; a fetch hiccup degrades to
 *    `Session <id>` with a debug log, never fails the export) and the full
 *    message list (`session.messages`) — the ONLY transcript source.
 * 3. Render via ./exportMarkdown.
 * 4. Show the save dialog with `defaultUri` =
 *    `${workspace}/.opencode-exports/session-<id>-<yymmdd-hhmmss>.md` (no
 *    workspace: no defaultUri and the dialog starts at its own default).
 *    Cancel is the `cancelled` outcome, not an error.
 * 5. `mkdir -p` the chosen file's parent and write the markdown.
 *
 * SEAMS: {@link ExportFs} (node:fs/promises in production, an in-memory map
 * in tests — the requirement "export writes markdown through an injected fs
 * seam"), {@link SaveDialog} (vscode `showSaveDialog` in production), a
 * workspace-folder accessor, and {@link Clock.now} for the filename stamp.
 * This module imports NO `vscode`; extension.ts wires the runtime values.
 */

import { dirname, join } from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { PanelLogger } from "./logger.js";
import type { ServerConnection } from "../server/ServerManager.js";
import { isRecord } from "../shared/protocol.js";
import { renderTranscriptMarkdown } from "./exportMarkdown.js";
import { createSessionService, type SessionClientSource } from "./handlers/sessions.js";

// ---------------------------------------------------------------------------
// Seams, outcome union, typed error.

export interface ExportFs {
  mkdir(path: string, options: { readonly recursive: boolean }): Promise<unknown>;
  writeFile(path: string, contents: string): Promise<unknown>;
}

export interface SaveDialog {
  /** Resolves the chosen absolute path, or undefined when cancelled. */
  show(defaultUri: string | undefined): Promise<string | undefined>;
}

export interface Clock {
  now(): number;
}

export type ExportTranscriptOutcome =
  | { readonly kind: "exported"; readonly path: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "no-session" };

/** One failed export step, naming the step; carries no credentials. */
export class ExportTranscriptError extends Error {
  readonly step: "list" | "messages" | "write";

  constructor(step: "list" | "messages" | "write", detail: string) {
    super(`export transcript failed at ${step}: ${detail}`);
    this.name = "ExportTranscriptError";
    this.step = step;
  }
}

export const EXPORT_DIRNAME = ".opencode-exports";

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** `session-<safeId>-<yyyymmdd-hhmmss>.md`; deterministic per clock value. */
export function exportFileName(sessionId: string, now: number): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "-");
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `session-${safe}-${stamp}.md`;
}

// ---------------------------------------------------------------------------
// The flow.

export interface ExportTranscriptDeps {
  readonly source: SessionClientSource;
  readonly logger: PanelLogger;
  readonly fs: ExportFs;
  readonly dialog: SaveDialog;
  readonly workspaceFolder: () => string | undefined;
  readonly clock: Clock;
}

export interface ExportTranscriptArgs {
  readonly sessionId?: string;
}

async function resolveSessionTitle(
  connection: ServerConnection,
  logger: PanelLogger,
  sessionId: string,
): Promise<string> {
  try {
    const result = await connection.client.session.get({ path: { id: sessionId } });
    if (result.error === undefined && result.data !== undefined) return result.data.title;
  } catch (error) {
    logger.debug(`export transcript: session.get hiccup: ${errorSummary(error)}`);
  }
  return `Session ${sessionId}`;
}

async function fetchMessages(
  client: OpencodeClient,
  sessionId: string,
): Promise<readonly unknown[]> {
  const result = await client.session.messages({ path: { id: sessionId } });
  if (result.error !== undefined) {
    throw new ExportTranscriptError("messages", errorSummary(result.error));
  }
  return result.data;
}

export async function exportTranscript(
  deps: ExportTranscriptDeps,
  args: ExportTranscriptArgs,
): Promise<ExportTranscriptOutcome> {
  let sessionId = args.sessionId;
  if (sessionId === undefined) {
    const sessions = createSessionService({ source: deps.source, logger: deps.logger });
    const list = await sessions.listSessions().catch((error: unknown) => {
      throw new ExportTranscriptError("list", errorSummary(error));
    });
    // Recency sort lives here, not in trust of server order: real opencode
    // sorts session.list by most-recently-updated, but the todo-5 mock (and
    // any drifted server) may not. ISO-8601 strings compare lexicographically.
    let latest: (typeof list)[number] | undefined;
    for (const entry of list) {
      if (latest === undefined || entry.updatedAt > latest.updatedAt) latest = entry;
    }
    sessionId = latest?.id;
    if (sessionId === undefined) return { kind: "no-session" };
  }

  const connection = await deps.source.connect();
  const [title, messages] = await Promise.all([
    resolveSessionTitle(connection, deps.logger, sessionId),
    fetchMessages(connection.client, sessionId),
  ]);
  const markdown = renderTranscriptMarkdown({
    title,
    sessionId,
    exportedAt: new Date(deps.clock.now()).toISOString(),
    messages,
  });

  const folder = deps.workspaceFolder();
  const fileName = exportFileName(sessionId, deps.clock.now());
  const defaultUri = folder === undefined ? undefined : join(folder, EXPORT_DIRNAME, fileName);
  const chosen = await deps.dialog.show(defaultUri);
  if (chosen === undefined) return { kind: "cancelled" };

  try {
    await deps.fs.mkdir(dirname(chosen), { recursive: true });
    await deps.fs.writeFile(chosen, markdown);
  } catch (error) {
    throw new ExportTranscriptError("write", errorSummary(error));
  }
  deps.logger.info(`export transcript: wrote ${chosen} (${String(messages.length)} messages)`);
  return { kind: "exported", path: chosen };
}

// ---------------------------------------------------------------------------
// Command factory: extension.ts plugs the vscode-backed notifier seams in.

/** Argument the additive command accepts (palette passes nothing). */
export interface ExportCommandArgs {
  readonly sessionId?: string;
}

export interface ExportCommandDeps {
  readonly run: (args: ExportTranscriptArgs) => Promise<ExportTranscriptOutcome>;
  readonly info: (message: string) => void;
  readonly error: (message: string) => void;
}

function isExportArgs(raw: unknown): raw is { readonly sessionId: string } {
  return isRecord(raw) && typeof raw.sessionId === "string";
}

function toExportArgs(raw: unknown): ExportCommandArgs {
  return isExportArgs(raw) ? { sessionId: raw.sessionId } : {};
}

/**
 * Outcome mapping: exported -> one info notification; cancelled -> silent
 * (cancel is not an error); no-session -> honest info message; any thrown
 * ExportTranscriptError -> error notification carrying the step detail.
 */
export function createExportTranscriptCommand(
  deps: ExportCommandDeps,
): (args?: unknown) => Promise<void> {
  return async (rawArgs?: unknown) => {
    try {
      const outcome = await deps.run(toExportArgs(rawArgs));
      switch (outcome.kind) {
        case "exported":
          deps.info(`OpenCode Panel: session transcript exported to ${outcome.path}`);
          return;
        case "cancelled":
          return;
        case "no-session":
          deps.info("OpenCode Panel: no session to export");
          return;
        default: {
          const exhaustive: never = outcome;
          return exhaustive;
        }
      }
    } catch (error) {
      deps.error(error instanceof Error ? error.message : String(error));
    }
  };
}

// i18n-allow-literal — test fixtures/assertions carry literal wire data
// (command names mirrored from the mock server), not display copy.
/**
 * Slash-command execution suite (plan todo 15): the runSlashCommand
 * wire->SDK mapping with a capturing client, and the runCommand handler
 * round-tripped through the todo-3 HostMessenger against the todo-5 mock
 * server — happy path (null reply) and QA failure (server 404 => error
 * reply naming the failure).
 */

import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../logger.js";
import { HostMessenger, type HostPort } from "../../messenger.js";
import { PanelSecrets, type SecretStorage } from "../../secrets.js";
import type { Capabilities } from "../../../server/capabilities.js";
import { createPanelClient } from "../../../server/clientFactory.js";
import type { ServerConnection } from "../../../server/ServerManager.js";
import type { HostMessage, StreamChunkPayload } from "../../../shared/protocol.js";
import { startMockServer, type MockServer } from "../../../test/mock-server/index.js";
import { staticSessionSource } from "../sessions.js";
import {
  registerCommandHandlers,
  runSlashCommand,
  type SessionCommandClient,
} from "../commands.js";

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
}

/** SecretStorage fake: never holds credentials (mock server needs none). */
class EmptySecrets implements SecretStorage {
  get(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  store(): Promise<void> {
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

const BASE_CAPABILITIES: Capabilities = {
  version: "0.0.0-test",
  hasFork: true,
  hasQuestion: true,
  hasTodo: true,
  hasShell: true,
  agents: [],
  commands: [],
  mcpNative: [],
  omoDetected: false,
  omoMcpNote: false,
};

function connectionFor(url: string): ServerConnection {
  const panel = createPanelClient(url, {
    secrets: new PanelSecrets(new EmptySecrets()),
    logger: new PanelLogger(new CapturingChannel(), () => false),
  });
  return {
    baseUrl: url,
    ownership: "attached",
    client: panel.client,
    probeFetch: panel.probeFetch,
    capabilities: BASE_CAPABILITIES,
  };
}

let mock: MockServer | undefined;

afterEach(async () => {
  if (mock !== undefined) {
    await mock.close();
    mock = undefined;
  }
});

describe("runSlashCommand", () => {
  it("maps wire payload onto session.command (command verbatim, args joined)", async () => {
    const captured: Array<{
      readonly path: { readonly id: string };
      readonly body: { readonly command: string; readonly arguments: string };
    }> = [];
    const stubClient: SessionCommandClient = {
      session: {
        command: (options) => {
          captured.push(options);
          return Promise.resolve({ data: {}, error: undefined });
        },
      },
    };

    await runSlashCommand(stubClient, {
      sessionId: "ses_1",
      command: "ulw-research",
      args: ["find", "leads"],
    });

    expect(captured).toEqual([
      { path: { id: "ses_1" }, body: { command: "ulw-research", arguments: "find leads" } },
    ]);
  });
});

describe("runCommand handler", () => {
  function messengerHarness(connection: ServerConnection): {
    readonly post: (type: "runCommand", payload: unknown) => string;
    readonly nextReply: (messageId: string) => Promise<StreamChunkPayload>;
  } {
    const posted: HostMessage[] = [];
    const waiters = new Map<string, (payload: StreamChunkPayload) => void>();
    let counter = 0;
    let listener: (message: unknown) => void = () => {
      throw new Error("message listener not wired");
    };
    const port: HostPort = {
      postMessage: (message) => {
        posted.push(message);
        if (message.type === "streamChunk") {
          const waiter = waiters.get(message.payload.messageId);
          if (waiter !== undefined) {
            waiters.delete(message.payload.messageId);
            waiter(message.payload);
          }
        }
      },
      onMessage: (registered) => {
        listener = registered;
      },
    };
    const messenger = new HostMessenger(port);
    registerCommandHandlers((type, handler) => messenger.register(type, handler), {
      source: staticSessionSource(connection),
    });
    return {
      post(type, payload) {
        counter += 1;
        const messageId = `run-${counter}`;
        listener({ messageId, type, payload });
        return messageId;
      },
      nextReply(messageId) {
        const existing = posted.find(
          (message) => message.type === "streamChunk" && message.payload.messageId === messageId,
        );
        if (existing !== undefined && existing.type === "streamChunk") {
          return Promise.resolve(existing.payload);
        }
        return new Promise<StreamChunkPayload>((resolve) => {
          waiters.set(messageId, resolve);
        });
      },
    };
  }

  it("executes against the mock server and replies null (happy path)", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const messenger = messengerHarness(connection);

    const created = await connection.client.session.create({ body: { title: "cmd target" } });
    if (created.error !== undefined || created.data === undefined) {
      throw new Error("session create failed");
    }

    const reply = await messenger.nextReply(
      messenger.post("runCommand", { sessionId: created.data.id, command: "help", args: [] }),
    );
    expect(reply.status).toBe("success");
    expect(reply.done).toBe(true);
    expect(reply.content).toBeNull();
  });

  it("surfaces a server failure as an error reply (unknown session)", async () => {
    mock = await startMockServer(0);
    const connection = connectionFor(mock.url);
    const messenger = messengerHarness(connection);

    const reply = await messenger.nextReply(
      messenger.post("runCommand", { sessionId: "ses_missing", command: "help", args: [] }),
    );
    expect(reply.status).toBe("error");
    if (typeof reply.content !== "string") {
      throw new Error("error reply must carry a message string");
    }
    expect(reply.content).toContain("slash command failed");
  });
});

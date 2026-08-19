/**
 * clientFactory auth recovery (plan todo 7 acceptance): a real 401 in front
 * of the todo-5 mock — implemented as an in-test HTTP proxy, not a mock
 * scenario — proves the unauthenticated-first → retry-once → typed-error
 * flow and that credentials never reach the log.
 */
import http from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PanelLogger, type OutputChannelLike } from "../../host/logger.js";
import { PanelSecrets, type SecretStorage } from "../../host/secrets.js";
import {
  AuthRequiredError,
  createPanelClient,
} from "../clientFactory.js";
import { startMockServer, type MockServer } from "../../test/mock-server/index.js";

class CapturingChannel implements OutputChannelLike {
  readonly lines: string[] = [];
  appendLine(line: string): void {
    this.lines.push(line);
  }
}

class FakeSecretStorage implements SecretStorage {
  readonly entries = new Map<string, string>();
  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.entries.get(key));
  }
  store(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}

function makeLogger(): { logger: PanelLogger; channel: CapturingChannel } {
  const channel = new CapturingChannel();
  return { logger: new PanelLogger(channel, () => true), channel };
}

/**
 * Proxy that 401s every request unless the Authorization header equals
 * `expectedBasic()`, forwarding allowed requests to the mock unchanged.
 * Records the raw Authorization header (null when absent) per attempt.
 */
interface AuthProxy {
  url: string;
  authLog: Array<string | null>;
  /** Expected credential pair; mutable so tests can rotate it mid-flight. */
  expected: { user: string; pass: string };
  expectedBasic: () => string;
  close: () => Promise<void>;
}

async function startAuthProxy(targetUrl: string, user: string, pass: string): Promise<AuthProxy> {
  const sockets = new Set<Socket>();
  const state: AuthProxy = {
    url: "",
    authLog: [],
    expected: { user, pass },
    expectedBasic: () =>
      `Basic ${Buffer.from(`${state.expected.user}:${state.expected.pass}`, "utf8").toString("base64")}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        app.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  const app = http.createServer((req, res) => {
    void (async () => {
      const authorization = req.headers.authorization ?? null;
      state.authLog.push(authorization);
      if (authorization !== state.expectedBasic()) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "UnauthorizedError", data: { message: "authentication required" } }));
        return;
      }
      const upstream = await fetch(`${targetUrl}${req.url ?? "/"}`, { method: req.method ?? "GET" });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      res.end(body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  app.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (address === null || typeof address === "string") {
    throw new Error("auth proxy has no port");
  }
  state.url = `http://127.0.0.1:${address.port}`;
  return state;
}

describe("createPanelClient auth recovery", () => {
  let mock: MockServer | undefined;
  let proxy: AuthProxy | undefined;

  afterEach(async () => {
    await proxy?.close();
    proxy = undefined;
    await mock?.close();
    mock = undefined;
  });

  it("plain server: SDK calls work unauthenticated", async () => {
    // Given a mock without any auth in front
    mock = await startMockServer(0, { scenario: "basic-chat" });
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(mock.url, { secrets, logger });
    // When/Then
    const result = await panel.client.app.agents();
    expect(result.data).toHaveLength(4);
  });

  it("401 → reads stored credentials → retries once with Basic header → caches it", async () => {
    // Given a 401 wall with matching stored credentials
    mock = await startMockServer(0, { scenario: "basic-chat" });
    proxy = await startAuthProxy(mock.url, "panel-user", "s3cret");
    const { logger, channel } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    await secrets.setUsername(proxy.url, "panel-user");
    await secrets.setPassword(proxy.url, "s3cret");
    const panel = createPanelClient(proxy.url, { secrets, logger });
    // When: two separate SDK calls
    const agents = await panel.client.app.agents();
    await panel.client.config.get();
    // Then: data flowed through
    expect(agents.data).toHaveLength(4);
    // And the first attempt went out bare, the retry carried Basic, and the
    // SECOND call reused the cached header (no third 401 dance)
    expect(proxy.authLog).toEqual([null, proxy.expectedBasic(), proxy.expectedBasic()]);
    // And the wire credential is exactly base64("panel-user:s3cret")
    const token = proxy.expectedBasic().replace(/^Basic /, "");
    expect(Buffer.from(token, "base64").toString("utf8")).toBe("panel-user:s3cret");
    // And neither the password nor the token ever hit the log
    const all = channel.lines.join("\n");
    expect(all).not.toContain("s3cret");
    expect(all).not.toContain(token);
    expect(channel.lines.some((line) => line.includes("401"))).toBe(true);
  });

  it("defaults the username to 'opencode' when only a password is stored", async () => {
    // Given
    mock = await startMockServer(0, { scenario: "basic-chat" });
    proxy = await startAuthProxy(mock.url, "opencode", "p4ss");
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    await secrets.setPassword(proxy.url, "p4ss");
    const panel = createPanelClient(proxy.url, { secrets, logger });
    // When
    const result = await panel.client.app.agents();
    // Then
    expect(result.data).toHaveLength(4);
    expect(proxy.authLog).toEqual([null, proxy.expectedBasic()]);
  });

  it("no stored credentials → AuthRequiredError(no-credentials) carrying the baseUrl", async () => {
    // Given
    mock = await startMockServer(0, { scenario: "basic-chat" });
    proxy = await startAuthProxy(mock.url, "opencode", "whatever");
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    const panel = createPanelClient(proxy.url, { secrets, logger });
    // When
    const error = await panel.client.app.agents().then(
      () => null,
      (caught: unknown) => caught,
    );
    // Then
    expect(error).toBeInstanceOf(AuthRequiredError);
    if (error instanceof AuthRequiredError) {
      expect(error.reason).toBe("no-credentials");
      expect(error.baseUrl).toBe(proxy.url);
    }
  });

  it("stored credentials rejected → AuthRequiredError(rejected) after ONE retry", async () => {
    // Given: stored password does not match what the proxy expects
    mock = await startMockServer(0, { scenario: "basic-chat" });
    proxy = await startAuthProxy(mock.url, "opencode", "right-pass");
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    await secrets.setPassword(proxy.url, "wrong-pass");
    const panel = createPanelClient(proxy.url, { secrets, logger });
    // When
    const error = await panel.client.app.agents().then(
      () => null,
      (caught: unknown) => caught,
    );
    // Then: exactly two attempts (bare + one retry), typed error
    expect(proxy.authLog).toHaveLength(2);
    expect(error).toBeInstanceOf(AuthRequiredError);
    if (error instanceof AuthRequiredError) {
      expect(error.reason).toBe("rejected");
      expect(error.baseUrl).toBe(proxy.url);
    }
  });

  it("a 401 on the remembered header → credentials went stale → AuthRequiredError(rejected)", async () => {
    // Given a working authenticated client
    mock = await startMockServer(0, { scenario: "basic-chat" });
    proxy = await startAuthProxy(mock.url, "opencode", "s3cret");
    const { logger } = makeLogger();
    const secrets = new PanelSecrets(new FakeSecretStorage());
    await secrets.setPassword(proxy.url, "s3cret");
    const panel = createPanelClient(proxy.url, { secrets, logger });
    await panel.client.app.agents();
    // When the server-side password rotates (stored one now stale)
    proxy.expected = { user: "opencode", pass: "rotated" };
    const error = await panel.client.app.agents().then(
      () => null,
      (caught: unknown) => caught,
    );
    // Then
    expect(error).toBeInstanceOf(AuthRequiredError);
    if (error instanceof AuthRequiredError) expect(error.reason).toBe("rejected");
  });
});

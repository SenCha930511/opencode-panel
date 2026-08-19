/**
 * Secret storage for opencode server credentials.
 *
 * Wraps `context.secrets` (`vscode.SecretStorage`) behind an injectable
 * interface so tests run without the extension host. Secrets are NEVER
 * stored in configuration keys, Memento, or logs — SecretStorage only.
 * Both `serverPassword` and the optional `serverUsername` (opencode's
 * basic-auth username can be overridden via OPENCODE_SERVER_USERNAME) are
 * keyed by server URL so credentials for multiple servers coexist:
 *
 *   opencodePanel.auth.<base64url(serverUrl)>.password
 *   opencodePanel.auth.<base64url(serverUrl)>.username
 */

/**
 * Minimal structural mirror of `vscode.SecretStorage`. Both `Promise` and
 * vscode's `Thenable` results satisfy `PromiseLike`, so the real storage and
 * test fakes both fit.
 */
export interface SecretStorage {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export type SecretKind = "password" | "username";

export type SecretInputProblem = "empty-server-url" | "empty-value";

export class PanelSecretsError extends Error {
  readonly problem: SecretInputProblem;
  readonly kind: SecretKind;

  constructor(problem: SecretInputProblem, kind: SecretKind) {
    super(`invalid secret input: ${problem} (kind: ${kind})`);
    this.name = "PanelSecretsError";
    this.problem = problem;
    this.kind = kind;
  }
}

/**
 * Storage key for a server's credential. The server URL is encoded with
 * URL-safe base64 (no padding) so keys stay a flat, URL-agnostic string.
 * @throws PanelSecretsError when `serverUrl` is blank.
 */
export function secretKey(serverUrl: string, kind: SecretKind): string {
  if (serverUrl.trim().length === 0) {
    throw new PanelSecretsError("empty-server-url", kind);
  }
  const encoded = Buffer.from(serverUrl, "utf8").toString("base64url");
  return `opencodePanel.auth.${encoded}.${kind}`;
}

/**
 * Get/set/delete the basic-auth credentials of one opencode server.
 * Consumed by the SDK client factory (todo 7) and the settings page
 * (todo 21).
 */
export class PanelSecrets {
  constructor(private readonly storage: SecretStorage) {}

  async getPassword(serverUrl: string): Promise<string | undefined> {
    return this.get(serverUrl, "password");
  }

  async setPassword(serverUrl: string, value: string): Promise<void> {
    return this.set(serverUrl, "password", value);
  }

  async deletePassword(serverUrl: string): Promise<void> {
    return this.storage.delete(secretKey(serverUrl, "password"));
  }

  async getUsername(serverUrl: string): Promise<string | undefined> {
    return this.get(serverUrl, "username");
  }

  async setUsername(serverUrl: string, value: string): Promise<void> {
    return this.set(serverUrl, "username", value);
  }

  async deleteUsername(serverUrl: string): Promise<void> {
    return this.storage.delete(secretKey(serverUrl, "username"));
  }

  private async get(serverUrl: string, kind: SecretKind): Promise<string | undefined> {
    const value = await this.storage.get(secretKey(serverUrl, kind));
    // SecretStorage may yield "" for a cleared slot; callers treating ""
    // as a credential is worse than treating it as absent.
    return value === "" ? undefined : value;
  }

  private async set(serverUrl: string, kind: SecretKind, value: string): Promise<void> {
    if (value.length === 0) {
      throw new PanelSecretsError("empty-value", kind);
    }
    await this.storage.store(secretKey(serverUrl, kind), value);
  }
}

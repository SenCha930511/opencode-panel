import { describe, expect, it } from "vitest";
import { PanelSecrets, PanelSecretsError, secretKey, type SecretStorage } from "../secrets.js";

const URL_A = "http://127.0.0.1:4096";
const URL_B = "https://opencode.internal:8443";
// Independent expectations: base64url encodings produced by an external
// node invocation, pinned here so the key format cannot silently drift.
const KEY_A_PASSWORD = "opencodePanel.auth.aHR0cDovLzEyNy4wLjAuMTo0MDk2.password";
const KEY_A_USERNAME = "opencodePanel.auth.aHR0cDovLzEyNy4wLjAuMTo0MDk2.username";
const KEY_B_PASSWORD = "opencodePanel.auth.aHR0cHM6Ly9vcGVuY29kZS5pbnRlcm5hbDo4NDQz.password";

/** Test double implementing ONLY SecretStorage — no Memento, per spec. */
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

describe("secretKey", () => {
  it("builds the flat per-server key in base64url form", () => {
    // Given/When/Then: exact, independently computed key strings
    expect(secretKey(URL_A, "password")).toBe(KEY_A_PASSWORD);
    expect(secretKey(URL_A, "username")).toBe(KEY_A_USERNAME);
    expect(secretKey(URL_B, "password")).toBe(KEY_B_PASSWORD);
  });

  it("produces URL-safe keys without padding or base64 specials", () => {
    // Given: a URL whose base64 contains +, / and = in its classic form
    const key = secretKey("http://192.168.1.10:8080", "password");
    // When/Then: the middle segment is pure base64url
    expect(key).not.toMatch(/[+/=]/);
    expect(key).toMatch(/^opencodePanel\.auth\..*\.password$/);
  });

  it("rejects a blank serverUrl", () => {
    // Given/When/Then: typed error, exact problem code
    expect(() => secretKey("  ", "password")).toThrowError(PanelSecretsError);
    expect(() => secretKey("", "username")).toThrowError(/empty-server-url/);
  });
});

describe("PanelSecrets", () => {
  it("stores and reads back a password under the per-server key", async () => {
    // Given
    const storage = new FakeSecretStorage();
    const secrets = new PanelSecrets(storage);
    // When
    await secrets.setPassword(URL_A, "opencode-secret");
    const value = await secrets.getPassword(URL_A);
    // Then: round-trip plus exact key placement
    expect(value).toBe("opencode-secret");
    expect(storage.entries.get(KEY_A_PASSWORD)).toBe("opencode-secret");
  });

  it("returns undefined for a credential that was never stored", async () => {
    // Given/When/Then
    await expect(new PanelSecrets(new FakeSecretStorage()).getPassword(URL_A)).resolves.toBeUndefined();
  });

  it("normalizes an empty-string slot to undefined", async () => {
    // Given: storage yields "" (SecretStorage may do this for cleared slots)
    const storage = new FakeSecretStorage();
    storage.entries.set(KEY_A_PASSWORD, "");
    // When/Then
    await expect(new PanelSecrets(storage).getPassword(URL_A)).resolves.toBeUndefined();
  });

  it("stores and deletes the optional username", async () => {
    // Given
    const storage = new FakeSecretStorage();
    const secrets = new PanelSecrets(storage);
    // When
    await secrets.setUsername(URL_A, "custom-user");
    // Then
    expect(await secrets.getUsername(URL_A)).toBe("custom-user");
    expect(storage.entries.get(KEY_A_USERNAME)).toBe("custom-user");
    // When deleted it is gone from the storage itself
    await secrets.deleteUsername(URL_A);
    expect(storage.entries.has(KEY_A_USERNAME)).toBe(false);
    await expect(secrets.getUsername(URL_A)).resolves.toBeUndefined();
  });

  it("deletes a stored password without touching other servers", async () => {
    // Given: credentials for two servers
    const storage = new FakeSecretStorage();
    const secrets = new PanelSecrets(storage);
    await secrets.setPassword(URL_A, "pw-a");
    await secrets.setPassword(URL_B, "pw-b");
    // When
    await secrets.deletePassword(URL_A);
    // Then: A is gone from storage, B untouched
    expect(storage.entries.has(KEY_A_PASSWORD)).toBe(false);
    expect(await secrets.getPassword(URL_B)).toBe("pw-b");
  });

  it("keys credentials by serverUrl so servers never collide", async () => {
    // Given/When: same concern as delete, on the read path
    const secrets = new PanelSecrets(new FakeSecretStorage());
    await secrets.setPassword(URL_A, "pw-a");
    // Then
    await expect(secrets.getPassword(URL_B)).resolves.toBeUndefined();
  });

  it("rejects an empty credential value", async () => {
    // Given
    const storage = new FakeSecretStorage();
    const secrets = new PanelSecrets(storage);
    // When/Then: typed error, storage untouched
    await expect(secrets.setPassword(URL_A, "")).rejects.toThrowError(PanelSecretsError);
    await expect(secrets.setUsername(URL_A, "")).rejects.toThrowError(/empty-value/);
    expect(storage.entries.size).toBe(0);
  });

  it("rejects blank server urls on every operation", async () => {
    // Given
    const secrets = new PanelSecrets(new FakeSecretStorage());
    // When/Then
    await expect(secrets.getPassword("")).rejects.toThrowError(/empty-server-url/);
    await expect(secrets.setPassword("", "x")).rejects.toThrowError(/empty-server-url/);
    await expect(secrets.deletePassword(" ")).rejects.toThrowError(/empty-server-url/);
  });
});

import { describe, expect, it } from "vitest";
import { PanelLogger, redact, REDACTED, type OutputChannelLike } from "../logger.js";

describe("redact", () => {
  it("scrubs Authorization Basic credentials (acceptance failure QA)", () => {
    // Given: an HTTP auth header carrying credential material
    const line = "Authorization: Basic abc123";
    // When: the line is redacted
    const scrubbed = redact(line);
    // Then: the credential is gone and the scheme word survives
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).toBe(`Authorization: Basic ${REDACTED}`);
  });

  it("scrubs Authorization Basic in any case", () => {
    // Given: headers with mixed/upper casing
    // When/Then: every casing variant loses the token
    expect(redact("AUTHORIZATION: BASIC s3cr3t")).toBe(`AUTHORIZATION: BASIC ${REDACTED}`);
    expect(redact("authorization: basic s3cr3t")).toBe(`authorization: basic ${REDACTED}`);
    expect(redact("AuThOrIzAtIoN: BaSiC s3cr3t")).toBe(`AuThOrIzAtIoN: BaSiC ${REDACTED}`);
  });

  it("leaves non-Basic authorization schemes untouched", () => {
    // Given: a Bearer header (out of redaction scope per spec)
    // When/Then: it passes through
    expect(redact("Authorization: Bearer token-xyz")).toBe(
      "Authorization: Bearer token-xyz",
    );
  });

  it("scrubs password= assignments", () => {
    // Given: a password assignment and a URL-query-style fragment
    // When/Then: only the value is replaced, delimiters survive
    expect(redact("password=hunter2")).toBe(`password=${REDACTED}`);
    expect(redact("?user=default&password=hunter2&port=4096")).toBe(
      `?user=default&password=${REDACTED}&port=4096`,
    );
  });

  it("scrubs env-style values whose name matches *KEY*", () => {
    // Given: API-key assignments in env dump form
    // When/Then: the value after the = is scrubbed regardless of position
    expect(redact("MY_API_KEY=abc123")).toBe(`MY_API_KEY=${REDACTED}`);
    expect(redact("export ANTHROPIC_API_KEY='abc'")).toBe(`export ANTHROPIC_API_KEY=${REDACTED}`);
  });

  it("scrubs env-style values whose name matches *TOKEN*", () => {
    // Given/When/Then
    expect(redact("GITHUB_TOKEN=ghp_abc")).toBe(`GITHUB_TOKEN=${REDACTED}`);
  });

  it("scrubs env-style values whose name matches *PASSWORD*", () => {
    // Given/When/Then
    expect(redact("OPENCODE_SERVER_PASSWORD=hunter2")).toBe(
      `OPENCODE_SERVER_PASSWORD=${REDACTED}`,
    );
  });

  it("scrubs quoted values wholesale, including spaces", () => {
    // Given: a quoted secret containing whitespace
    const line = 'OPENCODE_SERVER_PASSWORD="hunter 2" extra';
    // When/Then: no fragment of the quoted value leaks
    const scrubbed = redact(line);
    expect(scrubbed).not.toContain("hunter");
    expect(scrubbed).toBe(`OPENCODE_SERVER_PASSWORD=${REDACTED} extra`);
  });

  it("scrubs every secret on a multi-secret line", () => {
    // Given: a line combining an auth header and an env assignment
    const line = "Authorization: Basic abc123 OPENCODE_SERVER_PASSWORD=pw";
    // When/Then
    expect(redact(line)).toBe(
      `Authorization: Basic ${REDACTED} OPENCODE_SERVER_PASSWORD=${REDACTED}`,
    );
  });

  it("leaves non-sensitive text and assignments untouched", () => {
    // Given/When/Then
    expect(redact("GET /session 200 HOSTNAME=macbook")).toBe(
      "GET /session 200 HOSTNAME=macbook",
    );
  });

  it("over-redacts non-secret names matching the env globs, by design", () => {
    // Given: a harmless name that still matches *KEY* — spec is wholesale
    // When/Then: scrubbed (safe direction for secret leakage)
    expect(redact("KEYBOARD_LAYOUT=us")).toBe(`KEYBOARD_LAYOUT=${REDACTED}`);
  });

  it("is idempotent", () => {
    // Given/When/Then
    const line = "Authorization: Basic abc123 password=hunter2";
    expect(redact(redact(line))).toBe(redact(line));
  });
});

describe("redact edge cases", () => {
  it("scrubs every sensitive element of a JSON-ish env array, keeping safe entries", () => {
    // Given: a spawn-env array as it appears in process traces
    const line = 'env: ["OPENCODE_SERVER_PASSWORD=hunter2","PATH=/usr/bin","GIT_TOKEN=ghp_x"]';
    // When: the line is redacted
    const scrubbed = redact(line);
    // Then: no secret fragment survives; non-sensitive entries stay readable
    expect(scrubbed).not.toContain("hunter2");
    expect(scrubbed).not.toContain("ghp_x");
    expect(scrubbed).toContain("PATH=/usr/bin");
    expect(scrubbed).toContain(`OPENCODE_SERVER_PASSWORD=${REDACTED}`);
    expect(scrubbed).toContain(`GIT_TOKEN=${REDACTED}`);
  });

  it("scrubs a double-quoted value containing an escaped quote, wholesale", () => {
    // Given: a password whose quoted shell form embeds an escaped quote
    const line = 'OPENCODE_SERVER_PASSWORD="hun\\"ter2" opencode serve';
    // When/Then: the whole quoted run is replaced — no fragment leaks
    const scrubbed = redact(line);
    expect(scrubbed).not.toContain("hun");
    expect(scrubbed).not.toContain("ter2");
    expect(scrubbed).toBe(`OPENCODE_SERVER_PASSWORD=${REDACTED} opencode serve`);
  });

  it("scrubs single-quoted values containing spaces", () => {
    // Given/When/Then
    expect(redact("API_TOKEN='tok en' next")).toBe(`API_TOKEN=${REDACTED} next`);
  });

  it("scrubs an empty quoted value the same as any quoted value", () => {
    // Given/When/Then
    expect(redact('PASSWORD=""')).toBe(`PASSWORD=${REDACTED}`);
  });

  it("treats = inside a quoted value as content, not as a delimiter", () => {
    // Given/When/Then
    expect(redact('TOKEN="a=b"')).toBe(`TOKEN=${REDACTED}`);
  });

  it("scrubs lowercase and mixed-case env names", () => {
    // Given: env globs are case-insensitive per spec
    // When/Then
    expect(redact("github_token=ghp_x")).toBe(`github_token=${REDACTED}`);
    expect(redact("api_Key=k")).toBe(`api_Key=${REDACTED}`);
  });

  it("scrubs OPENCODE_SERVER_PASSWORD as a bare env prefix on a command line", () => {
    // Given: the canonical spawn trace shape
    const line = "OPENCODE_SERVER_PASSWORD=hunter2 opencode serve --port 4096";
    // When/Then: the value stops at whitespace; the command survives intact
    expect(redact(line)).toBe(`OPENCODE_SERVER_PASSWORD=${REDACTED} opencode serve --port 4096`);
  });

  it("scrubs a quoted password prefix wrapping a piped command line", () => {
    // Given: quoted env prefix + shell pipe
    const line = 'env OPENCODE_SERVER_PASSWORD="hun ter2" npx opencode serve | tee out.log';
    // When/Then
    expect(redact(line)).toBe(`env OPENCODE_SERVER_PASSWORD=${REDACTED} npx opencode serve | tee out.log`);
  });

  it("scrubs semicolon-joined command lines without eating the separator", () => {
    // Given/When/Then
    expect(redact("export OPENCODE_SERVER_PASSWORD=hunter2; opencode serve")).toBe(
      `export OPENCODE_SERVER_PASSWORD=${REDACTED}; opencode serve`,
    );
  });

  it("scrubs repeated sensitive names on the same line", () => {
    // Given/When/Then
    expect(redact("A_TOKEN=1 B_TOKEN=2")).toBe(`A_TOKEN=${REDACTED} B_TOKEN=${REDACTED}`);
  });
});

describe("PanelLogger", () => {
  class FakeChannel implements OutputChannelLike {
    readonly lines: string[] = [];
    appendLine(line: string): void {
      this.lines.push(line);
    }
  }

  const FIXED_NOW = new Date("2026-08-20T12:34:56.789Z");

  function harness(debugEnabled: boolean): {
    channel: FakeChannel;
    logger: PanelLogger;
  } {
    const channel = new FakeChannel();
    const logger = new PanelLogger(channel, () => debugEnabled, () => FIXED_NOW);
    return { channel, logger };
  }

  it("writes info lines with timestamp and level", () => {
    // Given: a logger with debugLogs off
    const { channel, logger } = harness(false);
    // When: an info line is logged
    logger.info("server attached on port 4096");
    // Then: exactly one formatted line lands
    expect(channel.lines).toEqual([
      "[2026-08-20T12:34:56.789Z] [info] server attached on port 4096",
    ]);
  });

  it("redacts secrets in every written line", () => {
    // Given: a logger
    const { channel, logger } = harness(false);
    // When: a line carrying credential material is logged at info level
    logger.info("trace Authorization: Basic abc123");
    // Then
    expect(channel.lines[0]).not.toContain("abc123");
    expect(channel.lines[0]).toContain(`Authorization: Basic ${REDACTED}`);
  });

  it("drops debug lines when debugLogs is off", () => {
    // Given: a logger honoring debugLogs=false
    const { channel, logger } = harness(false);
    // When
    logger.debug("prompt body: write me a poem");
    // Then: nothing is written
    expect(channel.lines).toEqual([]);
  });

  it("writes debug lines, redacted, when debugLogs is on", () => {
    // Given
    const { channel, logger } = harness(true);
    // When
    logger.debug("OPENCODE_SERVER_PASSWORD=hunter2");
    // Then
    expect(channel.lines).toEqual([
      `[2026-08-20T12:34:56.789Z] [debug] OPENCODE_SERVER_PASSWORD=${REDACTED}`,
    ]);
  });

  it("routes spawned-process streams and HTTP traces through debug with redaction", () => {
    // Given: debug on
    const { channel, logger } = harness(true);
    // When: process output and an HTTP trace carrying secrets arrive
    logger.processStdout("listening Authorization: Basic abc123");
    logger.processStderr("fatal: GITHUB_TOKEN=ghp_abc");
    logger.httpTrace("POST /session/basic -> 401 password=hunter2");
    // Then: tagged, redacted, debug-level
    expect(channel.lines[0]).toContain("[proc:out]");
    expect(channel.lines[0]).not.toContain("abc123");
    expect(channel.lines[1]).toContain("[proc:err]");
    expect(channel.lines[1]).toContain(`GITHUB_TOKEN=${REDACTED}`);
    expect(channel.lines[2]).toContain("[http]");
    expect(channel.lines[2]).toContain(`password=${REDACTED}`);
    expect(channel.lines.every((line) => line.includes("[debug]"))).toBe(true);
  });

  it("suppresses process streams when debugLogs is off", () => {
    // Given
    const { channel, logger } = harness(false);
    // When
    logger.processStdout("noise");
    logger.processStderr("noise");
    logger.httpTrace("noise");
    // Then
    expect(channel.lines).toEqual([]);
  });

  it("evaluates the debug gate on every call, not once at construction", () => {
    // Given: a gate that flips between writes
    const channel = new FakeChannel();
    let gate = false;
    const logger = new PanelLogger(channel, () => gate, () => FIXED_NOW);
    // When: a debug line is written before and after enabling
    logger.debug("before");
    gate = true;
    logger.debug("after");
    // Then: only the enabled write landed
    expect(channel.lines).toHaveLength(1);
    expect(channel.lines[0]).toContain("after");
  });
});

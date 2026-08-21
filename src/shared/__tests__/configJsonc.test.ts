import { describe, expect, it } from "vitest";
import {
  applyJsoncEdit,
  applyJsoncRemove,
  isSecretPath,
  parseJsonc,
  topLevelKeys,
} from "../configJsonc.js";

/**
 * JSONC edit core (plan W1, dual-bundle with the webview): comment-preserving
 * edits via jsonc-parser `modify`+`applyEdits`, error strings via
 * `printParseErrorCode`, the secret-path heuristic, and top-level key listing
 * for unknown-key detection. Pure module — no node imports anywhere.
 */

describe("parseJsonc", () => {
  it("parses JSONC with comments and trailing commas without errors", () => {
    // Given a JSONC document using comments and a trailing comma
    const text = '{\n  // a comment\n  "model": "m1",\n}\n';
    // When it is parsed
    const result = parseJsonc(text);
    // Then no errors are reported and the value reflects the document
    expect(result.errors).toEqual([]);
    expect(result.value).toEqual({ model: "m1" });
  });

  it("reports parse errors as printParseErrorCode strings", () => {
    // Given an unparseable document (value missing after the colon)
    const text = '{ "a": }';
    // When it is parsed
    const result = parseJsonc(text);
    // Then the machine-stable parse error code surfaces in the error string
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("ValueExpected");
  });
});

describe("applyJsoncEdit", () => {
  const fixture = '{\n  // keep me\n  "agent": {\n    "model": "old"\n  },\n  "zzzUnknown": true\n}\n';

  it("edits a nested value while preserving comments and unknown keys", () => {
    // Given a document with a comment, a known nested key, and an unknown key
    // When the nested key is edited
    const edited = applyJsoncEdit(fixture, ["agent", "model"], "new");
    // Then the comment and unknown key survive byte-identical, and only the
    // targeted path changed
    expect(edited).toContain("// keep me");
    expect(edited).toContain('"zzzUnknown": true');
    expect(edited).not.toContain('"old"');
    expect(parseJsonc(edited).value).toEqual({ agent: { model: "new" }, zzzUnknown: true });
  });

  it("inserts a missing key into an existing object", () => {
    // Given a document missing the target key
    const text = '{\n  "a": 1\n}\n';
    // When a new key is written
    const edited = applyJsoncEdit(text, ["b"], 2);
    // Then the document still parses and carries both keys
    expect(parseJsonc(edited).value).toEqual({ a: 1, b: 2 });
  });

  it("appends to an array via the -1 index segment", () => {
    // Given a document with a string-list value
    const text = '{\n  "plugins": ["a"]\n}\n';
    // When an entry is appended
    const edited = applyJsoncEdit(text, ["plugins", -1], "b");
    // Then the entry lands at the end of the array
    expect(parseJsonc(edited).value).toEqual({ plugins: ["a", "b"] });
  });

  it("replaces an existing array element by index", () => {
    // Given a document with a two-element list
    const text = '{\n  "plugins": ["a", "b"]\n}\n';
    // When the first element is replaced
    const edited = applyJsoncEdit(text, ["plugins", 0], "z");
    // Then only that element changed
    expect(parseJsonc(edited).value).toEqual({ plugins: ["z", "b"] });
  });
});

describe("applyJsoncRemove", () => {
  it("removes a key while preserving the sibling and its trailing comment", () => {
    // Given a document with two keys and a comment trailing the kept key
    // (jsonc-parser drops trivia adjacent to the REMOVED key by design)
    const text = '{\n  "gone": 1,\n  "stays": 2 // keep me\n}\n';
    // When one key is removed
    const edited = applyJsoncRemove(text, ["gone"]);
    // Then the sibling and its comment survive and no dangling comma remains
    expect(edited).toContain("// keep me");
    expect(parseJsonc(edited).value).toEqual({ stays: 2 });
  });

  it("leaves the text untouched when the key does not exist", () => {
    // Given a document without the target key
    const text = '{\n  "a": 1\n}\n';
    // When a removal of a missing key is requested
    const edited = applyJsoncRemove(text, ["missing"]);
    // Then the text is byte-identical
    expect(edited).toBe(text);
  });
});

describe("isSecretPath", () => {
  const cases: ReadonlyArray<{
    readonly path: readonly (string | number)[];
    readonly expected: boolean;
  }> = [
    // Positive: secret-bearing name under a secret-carrying container.
    { path: ["mcp", "github", "env", "GITHUB_PERSONAL_ACCESS_TOKEN"], expected: true },
    { path: ["mcp", "x", "environment", "API_KEY"], expected: true },
    { path: ["provider", "p", "options", "apiKey"], expected: true },
    { path: ["mcp", "x", "headers", "x-api-secret"], expected: true },
    { path: ["provider", "p", "options", "password"], expected: true },
    // Negative: non-secret name inside a container.
    { path: ["mcp", "x", "environment", "FOO"], expected: false },
    // Negative: secret-ish name but no secret-carrying ancestor.
    { path: ["keybinds"], expected: false },
    { path: ["agent", "build", "token"], expected: false },
    // Negative: ordinary keys.
    { path: ["agent", "build", "model"], expected: false },
    { path: ["permission"], expected: false },
    // Negative: numeric last segment (array indices are never secret names).
    { path: ["env", 0], expected: false },
  ];

  for (const { path, expected } of cases) {
    it(`returns ${expected} for ${JSON.stringify(path)}`, () => {
      expect(isSecretPath(path)).toBe(expected);
    });
  }
});

describe("topLevelKeys", () => {
  it("lists top-level keys in order across comments and containers", () => {
    // Given a document with comments and nested containers
    const text = '{\n  "a": 1,\n  // note\n  "b": { "nested": true },\n  "c": []\n}\n';
    // When the top-level keys are listed
    // Then the root keys come back in document order, nested keys excluded
    expect(topLevelKeys(text)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for empty or non-object documents", () => {
    expect(topLevelKeys("")).toEqual([]);
    expect(topLevelKeys("[]")).toEqual([]);
  });
});

/**
 * Shared JSONC edit core for the config-file editor (plan W1). Pure and
 * environment-neutral — bundled into BOTH the host extension (esbuild) and
 * the settings webview (vite), so no node or vscode imports may appear here.
 *
 * All edits go through jsonc-parser `modify` + `applyEdits`, which patch the
 * source text at the targeted path only: comments, key order, unknown keys,
 * and formatting elsewhere survive byte-identical by construction.
 */

import { applyEdits, modify, parse, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";

export type JsoncPath = readonly (string | number)[];

export interface JsoncParseResult {
  /** Machine-stable parse codes (`printParseErrorCode`), one per syntax error. */
  readonly errors: readonly string[];
  readonly value: unknown;
}

export function parseJsonc(text: string): JsoncParseResult {
  const collected: ParseError[] = [];
  const value: unknown = parse(text, collected, { allowTrailingComma: true, disallowComments: false });
  return {
    errors: collected.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`),
    value,
  };
}

const EDIT_OPTIONS = {
  formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" },
  getInsertionIndex: (): number => -1,
};

export function applyJsoncEdit(text: string, path: JsoncPath, value: unknown): string {
  return applyEdits(text, modify(text, [...path], value, EDIT_OPTIONS));
}

export function applyJsoncRemove(text: string, path: JsoncPath): string {
  return applyEdits(text, modify(text, [...path], undefined, EDIT_OPTIONS));
}

const SECRET_NAME = /key|token|secret|password/i;
const SECRET_CONTAINERS: ReadonlySet<string> = new Set(["environment", "env", "headers", "options"]);

export function isSecretPath(path: JsoncPath): boolean {
  const last = path[path.length - 1];
  if (typeof last !== "string" || !SECRET_NAME.test(last)) return false;
  return path
    .slice(0, -1)
    .some((segment) => typeof segment === "string" && SECRET_CONTAINERS.has(segment.toLowerCase()));
}

export function topLevelKeys(text: string): string[] {
  const tree = parseTree(text, undefined, { allowTrailingComma: true });
  if (tree?.type !== "object") return [];
  const keys: string[] = [];
  for (const property of tree.children ?? []) {
    if (property.type !== "property") continue;
    const keyNode = property.children?.[0];
    // A property node's first child is typed "string" by construction.
    if (keyNode !== undefined && keyNode.type === "string") keys.push(String(keyNode.value));
  }
  return keys;
}

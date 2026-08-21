/**
 * Live JSON preview redaction (plan T4): swaps secret leaf VALUES for a mask
 * through jsonc-parser point edits, so comments, key order, and every
 * non-secret byte stay verbatim while a live key/token never renders in clear
 * text — the same guarantee the MaskedInput lanes give the form. Shared by
 * the opencode + omo config tabs; preview stays view-only (no copy affordance).
 */

import { applyJsoncEdit, isSecretPath, parseJsonc, type JsoncPath } from "../../../shared/configJsonc.js";
import { isRecord } from "../../../shared/protocol.js";

const SECRET_VALUE_MASK = "••••••••";
const SECRET_NAME = /key|token|secret|password/i;

/**
 * Preview redaction predicate: the shared isSecretPath (secret-named key
 * under an environment/env/headers/options ancestor) plus the mcp oauth
 * block, which the form masks explicitly while the shared container list
 * does not list it.
 */
function isPreviewSecretPath(path: JsoncPath): boolean {
  if (isSecretPath(path)) return true;
  const last = path[path.length - 1];
  if (typeof last !== "string" || !SECRET_NAME.test(last)) return false;
  const ancestors = path.slice(0, -1);
  return ancestors.some((segment) => typeof segment === "string" && segment.toLowerCase() === "oauth"); // i18n-allow-literal — code-only expression, no display copy
}

function collectSecretLeafPaths(value: unknown, path: readonly (string | number)[], found: JsoncPath[]): void {
  if (typeof value === "string") {
    if (value.length > 0 && isPreviewSecretPath(path)) found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectSecretLeafPaths(entry, [...path, index], found);
    });
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      collectSecretLeafPaths(entry, [...path, key], found);
    }
  }
}

export function redactPreviewText(text: string): string {
  const { value } = parseJsonc(text);
  const paths: JsoncPath[] = [];
  collectSecretLeafPaths(value, [], paths);
  let redacted = text;
  for (const path of paths) redacted = applyJsoncEdit(redacted, path, SECRET_VALUE_MASK);
  return redacted;
}

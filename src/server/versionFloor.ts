/**
 * Version-floor comparison for the capability detector (plan todo 7a:
 * `minimumServerVersion` from todo-6 config).
 */

const VERSION_TRIPLE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/** "1.0.42-mock" → [1, 0, 42]; pre-release suffixes are ignored for the floor check. */
function parseVersionTriple(version: string): readonly [number, number, number] | undefined {
  const match = VERSION_TRIPLE.exec(version.trim());
  if (match === null) return undefined;
  const major = match[1];
  if (major === undefined) return undefined;
  return [Number(major), Number(match[2] ?? "0"), Number(match[3] ?? "0")];
}

/**
 * True when `version` sorts strictly below `minimum` (numeric X.Y.Z compare).
 * Unparsable inputs never flag — a weird version string must not scare the
 * user into a false "old server" warning.
 */
export function isBelowMinimumVersion(version: string, minimum: string): boolean {
  const parsed = parseVersionTriple(version);
  const floor = parseVersionTriple(minimum);
  if (parsed === undefined || floor === undefined) return false;
  for (let i = 0; i < 3; i += 1) {
    const got = parsed[i] ?? 0;
    const want = floor[i] ?? 0;
    if (got !== want) return got < want;
  }
  return false;
}

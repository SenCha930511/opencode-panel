/**
 * Relative-time rendering for session rows. Uses the platform's
 * Intl.RelativeTimeFormat with the host-injected locale, so both supported
 * display languages come from the runtime — no new display literals and no
 * additions to the shared string tables (todo-12 binding).
 */

const LADDER: ReadonlyArray<readonly [unit: Intl.RelativeTimeFormatUnit, seconds: number]> = [
  ["year", 31_557_600],
  ["month", 2_629_800],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/**
 * `iso` -> localized relative string ("3 minutes ago" / "3 分鐘前"), or ""
 * for an unparseable timestamp (the row then shows no time rather than a
 * broken literal). `nowMs` is injected so tests are deterministic.
 */
export function formatRelativeTime(iso: string, nowMs: number, locale: string): string {
  const thenMs = Date.parse(iso);
  if (!Number.isFinite(thenMs)) return "";
  const deltaSeconds = (thenMs - nowMs) / 1000;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of LADDER) {
    if (Math.abs(deltaSeconds) >= seconds || seconds === 1) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return "";
}

/**
 * formatRelativeTime suite: Intl-driven relative strings in both shipped
 * locales (en + zh-TW), future times, and unparseable input. No display
 * literals live here — the strings come from the platform locale.
 */

import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../time.js";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("formatRelativeTime", () => {
  it("renders seconds/minutes/hours/days relative to now", () => {
    expect(formatRelativeTime(new Date(NOW - 30_000).toISOString(), NOW, "en")).toContain("30");
    expect(formatRelativeTime(minutesAgo(3), NOW, "en")).toContain("3");
    expect(formatRelativeTime(minutesAgo(3), NOW, "en")).toContain("minute");
    expect(formatRelativeTime(new Date(NOW - 5 * 3_600_000).toISOString(), NOW, "en")).toContain(
      "hour",
    );
    expect(formatRelativeTime(new Date(NOW - 3 * 86_400_000).toISOString(), NOW, "en")).toContain(
      "day",
    );
  });

  it("renders in zh-TW when the host injected that locale", () => {
    const text = formatRelativeTime(minutesAgo(5), NOW, "zh-TW");
    expect(text).toContain("5");
    expect(text).not.toContain("minute");
  });

  it("renders future times as future-relative", () => {
    const text = formatRelativeTime(new Date(NOW + 2 * 3_600_000).toISOString(), NOW, "en");
    expect(text).toContain("in");
  });

  it("returns an empty string for unparseable timestamps", () => {
    expect(formatRelativeTime("not-a-date", NOW, "en")).toBe("");
  });
});

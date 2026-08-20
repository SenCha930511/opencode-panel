// i18n-allow-literal — test fixtures/assertions carry literal wire data and
// English fixture strings; they are wire fixtures, not display copy routed
// through t().
/**
 * Token-usage strip suite (FIX-D): the DOM-free aggregation math over the
 * todo-13 message view, the hidden-when-empty contract, and the SSR label
 * rendering with sentinel string overrides (proving the t() wiring rather
 * than the bundled table).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { InitPayload } from "../../../../../shared/protocol.js";
import { en } from "../../../../../shared/strings.js";
import { StringsProvider } from "../../../../lib/i18n.js";
import type { MessageVM } from "../../types.js";
import { sumAssistantUsage } from "../usageMath.js";
import { UsageStrip } from "../UsageStrip.js";

function message(
  id: string,
  role: string,
  tokens: Record<string, unknown> | undefined,
): MessageVM {
  return {
    id,
    sessionID: "ses_1",
    role,
    info: tokens === undefined ? {} : { id, sessionID: "ses_1", role, tokens },
    inFlight: false,
    parts: [],
  };
}

describe("sumAssistantUsage", () => {
  it("sums assistant tokens across messages for the session", () => {
    // Given: two assistant replies with full counters and one partial
    const usage = sumAssistantUsage([
      message("m1", "assistant", { input: 12, output: 40, reasoning: 0, cache: { read: 1 } }),
      message("m2", "assistant", { input: 8, output: 20, reasoning: 5 }),
      message("m3", "assistant", { input: 2 }),
    ]);
    // Then: every present field is summed; cache does not leak into the strip
    expect(usage).toEqual({ input: 22, output: 60, reasoning: 5 });
  });

  it("ignores user rows even when they carry a tokens record", () => {
    const usage = sumAssistantUsage([
      message("m1", "user", { input: 999, output: 999 }),
      message("m2", "assistant", { input: 3, output: 4 }),
    ]);
    expect(usage).toEqual({ input: 3, output: 4, reasoning: undefined });
  });

  it("returns null when no assistant message reports usage (hidden strip)", () => {
    // Given: rows without tokens records (in-flight placeholders, old servers)
    expect(sumAssistantUsage([message("m1", "assistant", undefined)])).toBeNull();
    expect(sumAssistantUsage([])).toBeNull();
  });

  it("treats non-finite and non-numeric fields as absent, never fabricated", () => {
    const usage = sumAssistantUsage([
      message("m1", "assistant", { input: "many", output: Number.NaN, reasoning: 7 }),
    ]);
    expect(usage).toEqual({ input: undefined, output: undefined, reasoning: 7 });
  });
});

// -- SSR rendering -----------------------------------------------------------

const SENTINELS = {
  title: "ZZ_SENTINEL_USAGE_TITLE_ZZ",
  input: "ZZ_SENTINEL_USAGE_IN_ZZ",
  output: "ZZ_SENTINEL_USAGE_OUT_ZZ",
  reasoning: "ZZ_SENTINEL_USAGE_REASONING_ZZ",
} as const;

function renderStrip(usage: Parameters<typeof UsageStrip>[0]["usage"]): string {
  const init: InitPayload = {
    locale: "en",
    strings: {
      ...en,
      "chat.usage": SENTINELS.title,
      "chat.usage.input": SENTINELS.input,
      "chat.usage.output": SENTINELS.output,
      "chat.usage.reasoning": SENTINELS.reasoning,
    },
    server: { url: "http://127.0.0.1:9", version: "0.0.0-mock" },
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
  };
  return renderToStaticMarkup(
    <StringsProvider init={init}>
      <UsageStrip usage={usage} />
    </StringsProvider>,
  );
}

describe("UsageStrip SSR", () => {
  it("renders nothing when there is no usage data", () => {
    expect(renderStrip(null)).toBe("");
  });

  it("renders the title + per-field sentinel labels with the summed numbers", () => {
    // Given: a full aggregate
    const html = renderStrip({ input: 22, output: 60, reasoning: 5 });
    // Then: every label is served through t() and every number is shown
    expect(html).toContain('data-oc-usage');
    expect(html).toContain(`title="${SENTINELS.title}"`);
    expect(html).toContain(`${SENTINELS.input} 22`);
    expect(html).toContain(`${SENTINELS.output} 60`);
    expect(html).toContain(`${SENTINELS.reasoning} 5`);
  });

  it("omits fields the wire never carried (absence is not a fabricated 0)", () => {
    const html = renderStrip({ input: 12, output: 40, reasoning: undefined });
    expect(html).toContain(`${SENTINELS.input} 12`);
    expect(html).toContain(`${SENTINELS.output} 40`);
    expect(html).not.toContain(SENTINELS.reasoning);
  });
});

// i18n-allow-literal — test fixtures/assertions carry literal wire data and
// English fixture strings; they are wire fixtures, not display copy routed
// through t().
/**
 * Usage strip suite: the CURRENT-context math (latest assistant turn's
 * prompt footprint: input + cache.read), the k/percent formatting, model
 * window resolution, and the hidden-when-empty contract, plus SSR rendering
 * with a sentinel title override (proving the t() wiring rather than the
 * bundled table).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { InitPayload } from "../../../../../shared/protocol.js";
import { en } from "../../../../../shared/strings.js";
import { StringsProvider } from "../../../../lib/i18n.js";
import type { MessageVM } from "../../types.js";
import {
  contextWindowForModel,
  formatContextUsage,
  formatK,
  latestContextTokens,
  sumAssistantUsage,
} from "../usageMath.js";
import { UsageStrip } from "../usageStrip.js";

function message(
  id: string,
  role: string,
  tokens: Record<string, unknown> | undefined,
  inFlight = false,
): MessageVM {
  return {
    id,
    sessionID: "ses_1",
    role,
    info: tokens === undefined ? {} : { id, sessionID: "ses_1", role, tokens },
    inFlight,
    parts: [],
  };
}

describe("sumAssistantUsage", () => {
  it("sums assistant tokens across messages for the session", () => {
    const usage = sumAssistantUsage([
      message("m1", "assistant", { input: 12, output: 40, reasoning: 0, cache: { read: 1 } }),
      message("m2", "assistant", { input: 8, output: 20, reasoning: 5 }),
      message("m3", "assistant", { input: 2 }),
    ]);
    expect(usage).toEqual({ input: 22, output: 60, reasoning: 5 });
  });
});

describe("latestContextTokens", () => {
  it("reads the LATEST assistant turn's prompt footprint (input + cache.read)", () => {
    const used = latestContextTokens([
      message("m1", "assistant", { input: 100, cache: { read: 23, write: 999 } }),
      message("m2", "assistant", { input: 121_000, cache: { read: 400 } }),
    ]);
    // The LAST message wins; cache.write stays out of the prompt window.
    expect(used).toBe(121_400);
  });

  it("skips in-flight placeholders, user rows, and tokenless replies", () => {
    const used = latestContextTokens([
      message("m1", "assistant", { input: 500 }),
      message("m2", "user", { input: 9999 }),
      message("m3", "assistant", { input: 9999 }, true),
      message("m4", "assistant", undefined),
    ]);
    expect(used).toBe(500);
  });

  it("returns null when nothing reported", () => {
    expect(latestContextTokens([])).toBeNull();
    expect(latestContextTokens([message("m1", "assistant", undefined)])).toBeNull();
  });
});

describe("formatK / formatContextUsage", () => {
  it("formats k units with the decimal convention", () => {
    expect(formatK(121_400)).toBe("121k");
    expect(formatK(1_048_576)).toBe("1049k");
    expect(formatK(500)).toBe("1k");
  });

  it("renders `used / window · pct%` with a limit, plain `used` without one", () => {
    expect(formatContextUsage(125_829, 1_048_576)).toBe("126k / 1049k · 12%");
    expect(formatContextUsage(121_400, undefined)).toBe("121k");
  });
});

describe("contextWindowForModel", () => {
  const providers = [
    {
      id: "mock-provider",
      models: [
        { id: "mock-large", contextWindow: 200_000 },
        { id: "mock-small" },
      ],
    },
  ];

  it("resolves the window for provider/model; tolerates missing data", () => {
    expect(contextWindowForModel("mock-provider/mock-large", providers)).toBe(200_000);
    expect(contextWindowForModel("mock-provider/mock-small", providers)).toBeUndefined();
    expect(contextWindowForModel("other/mock-large", providers)).toBeUndefined();
    expect(contextWindowForModel("noslash", providers)).toBeUndefined();
    expect(contextWindowForModel(undefined, providers)).toBeUndefined();
  });
});

// -- SSR rendering -----------------------------------------------------------

const SENTINEL_TITLE = "ZZ_SENTINEL_USAGE_TITLE_ZZ";

function renderStrip(used: number | null, contextWindow?: number): string {
  const init: InitPayload = {
    locale: "en",
    strings: { ...en, "chat.usage": SENTINEL_TITLE },
    server: { url: "http://127.0.0.1:9", version: "0.0.0-mock" },
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
  };
  return renderToStaticMarkup(
    <StringsProvider init={init}>
      <UsageStrip used={used} {...(contextWindow === undefined ? {} : { contextWindow })} />
    </StringsProvider>,
  );
}

describe("UsageStrip SSR", () => {
  it("renders nothing when there is no usage data", () => {
    expect(renderStrip(null)).toBe("");
  });

  it("renders the title via t() + the k/percentage display", () => {
    const html = renderStrip(125_829, 1_048_576);
    expect(html).toContain('data-oc-usage');
    expect(html).toContain(`title="${SENTINEL_TITLE}"`);
    expect(html).toContain("126k / 1049k · 12%");
  });

  it("omits the window segment entirely when no limit was reported (never a fabricated ratio)", () => {
    const html = renderStrip(121_400);
    expect(html).toContain(">121k<");
    expect(html).not.toContain(" / ");
    expect(html).not.toContain("·");
  });
});

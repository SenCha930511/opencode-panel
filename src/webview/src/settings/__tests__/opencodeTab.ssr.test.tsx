// i18n-allow-literal — test fixtures/assertions carry literal wire data.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StringsProvider } from "../../../lib/i18n.js";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { AppProvider } from "../../app/context.js";
import type { ConfigFileReadReply, InitPayload } from "../../../../shared/protocol.js";
import { en } from "../../../../shared/strings.js";
import { OpenCodeConfigTab } from "../openCodeConfigTab.js";
import { ConfigFilesStore, type ConfigRequester } from "../configFilesStore.js";

/**
 * OpenCodeConfigTab SSR suite (plan T4a, node env — no jsdom): the rewritten
 * tab renders its chrome (file path, create CTA, parse-error banner, conflict
 * lane), the spec sections through sentinel ids, the deprecated/unknown
 * read-only notices derived from a fixture draft, masked secret rows that
 * never leak values, and the view-only live JSON preview. Sentinel overrides
 * on the cfg.* ids prove every visible label rides t().
 */

const SENTINELS = {
  secGeneral: "ZZ_OC_SECTION_GENERAL_ZZ",
  secPlugins: "ZZ_OC_SECTION_PLUGINS_ZZ",
  secPermission: "ZZ_OC_SECTION_PERMISSION_ZZ",
  secAgents: "ZZ_OC_SECTION_AGENTS_ZZ",
  secMcp: "ZZ_OC_SECTION_MCP_ZZ",
  secProviders: "ZZ_OC_SECTION_PROVIDERS_ZZ",
  fieldModel: "ZZ_OC_FIELD_MODEL_ZZ",
  advanced: "ZZ_OC_ADVANCED_ZZ",
  noticeDeprecated: "ZZ_OC_DEPRECATED:{keys}:ZZ",
  noticeUnknown: "ZZ_OC_UNKNOWN:{keys}:ZZ",
  preview: "ZZ_OC_PREVIEW_ZZ",
  fileCreate: "ZZ_OC_CREATE_ZZ",
  fileMissing: "ZZ_OC_MISSING_ZZ",
  fileParseError: "ZZ_OC_PARSE_ERROR_ZZ",
  fileConflict: "ZZ_OC_CONFLICT_ZZ",
  maskedIsSet: "ZZ_OC_MASKED_ISSET_ZZ",
} as const;

function stubStrings(): Readonly<Record<string, string>> {
  return {
    ...en,
    "cfg.sec.oc.general": SENTINELS.secGeneral,
    "cfg.sec.oc.plugins": SENTINELS.secPlugins,
    "cfg.sec.oc.permission": SENTINELS.secPermission,
    "cfg.sec.oc.agents": SENTINELS.secAgents,
    "cfg.sec.oc.mcp": SENTINELS.secMcp,
    "cfg.sec.oc.providers": SENTINELS.secProviders,
    "cfg.f.model": SENTINELS.fieldModel,
    "cfg.advanced.title": SENTINELS.advanced,
    "cfg.notice.deprecated": SENTINELS.noticeDeprecated,
    "cfg.notice.unknown": SENTINELS.noticeUnknown,
    "cfg.preview.title": SENTINELS.preview,
    "cfg.file.create": SENTINELS.fileCreate,
    "cfg.file.missing": SENTINELS.fileMissing,
    "cfg.file.parseError": SENTINELS.fileParseError,
    "cfg.file.conflict": SENTINELS.fileConflict,
    "cfg.masked.isSet": SENTINELS.maskedIsSet,
  };
}

function stubInit(): InitPayload {
  return {
    locale: "en",
    strings: stubStrings(),
    server: { url: "http://127.0.0.1:4096", version: "1.2.3-test" },
    capabilities: { fork: true, question: false, todo: true },
    settings: {},
  } as InitPayload;
}

type Reply = { readonly ok: true; readonly content: unknown } | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopbackMessenger(reply: Reply): WebviewMessenger {
  let toWebview: (message: unknown) => void = () => {
    throw new Error("loopback not wired");
  };
  const port: WebviewPort = {
    postMessage: (raw) => {
      if (!isRecord(raw) || typeof raw.messageId !== "string") {
        throw new Error("bad test envelope");
      }
      queueMicrotask(() => {
        toWebview({
          type: "streamChunk",
          payload: {
            messageId: raw.messageId,
            status: reply.ok ? "success" : "error",
            done: true,
            content: reply.ok ? reply.content : reply.error,
          },
        });
      });
    },
    onMessage: (registered) => {
      toWebview = registered;
    },
  };
  return new WebviewMessenger(port);
}

function readReply(partial?: Partial<ConfigFileReadReply>): ConfigFileReadReply {
  return {
    path: "/home/test/.config/opencode/opencode.json",
    exists: true,
    rawText: "{}\n",
    mtimeMs: 1,
    parseError: null,
    legacyNoticePath: null,
    ...partial,
  };
}

async function loadedStore(reply: ConfigFileReadReply): Promise<ConfigFilesStore> {
  const request: ConfigRequester = (type, payload) => loopbackMessenger({ ok: true, content: reply }).request(type, payload);
  const store = new ConfigFilesStore(request);
  await store.load("opencode", "global");
  return store;
}

function renderTab(store: ConfigFilesStore, scope: "global" | "project" = "global"): string {
  const init = stubInit();
  return renderToString(
    <StringsProvider init={init}>
      <AppProvider init={init} messenger={new WebviewMessenger({ postMessage: () => {}, onMessage: () => {} })}>
        <OpenCodeConfigTab store={store} scope={scope} />
      </AppProvider>
    </StringsProvider>,
  );
}

const RICH_DRAFT =
  '{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "acme/fast",\n' +
  '  "plugin": ["p1"],\n  "layout": "auto",\n  "theme": "dark",\n  "frobnicate": true,\n' +
  '  "agent": { "general": { "model": "acme/fast", "tools": { "bash": true } } },\n' +
  '  "permission": { "bash": { "git status": "allow" } },\n' +
  '  "mcp": { "exa": { "type": "local", "command": ["npx", "exa"], "environment": { "API_KEY": "sekret-value" } } }\n}\n';

describe("OpenCodeConfigTab SSR — spec sections", () => {
  it("renders tier-1 section/field labels through t() with draft values", async () => {
    // Given: a loaded slot with a rich draft
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    // When
    const html = renderTab(store);
    // Then: every tier-1 section header rides t()
    expect(html).toContain(SENTINELS.secGeneral);
    expect(html).toContain(SENTINELS.secPlugins);
    expect(html).toContain(SENTINELS.secPermission);
    expect(html).toContain(SENTINELS.secAgents);
    expect(html).toContain(SENTINELS.secMcp);
    expect(html).toContain(SENTINELS.secProviders);
    // And: the tier-2 advanced heading renders
    expect(html).toContain(SENTINELS.advanced);
    // And: field labels + draft values land
    expect(html).toContain(SENTINELS.fieldModel);
    expect(html).toContain("acme/fast");
    // And: the agent record name surfaces
    expect(html).toContain("general");
  });

  it("renders the file path in the chrome", async () => {
    // Given/When
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    const html = renderTab(store);
    // Then
    expect(html).toContain("/home/test/.config/opencode/opencode.json");
  });
});

describe("OpenCodeConfigTab SSR — notices", () => {
  it("renders the deprecated-keys read-only notice from the fixture", async () => {
    // Given: layout/theme are deprecated top-level keys; agent.general.tools is deprecated
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    // When
    const html = renderTab(store);
    // Then: the notice copy substitutes the detected key list
    expect(html).toContain("ZZ_OC_DEPRECATED:layout, theme, agent.general.tools:ZZ");
  });

  it("renders the unknown-keys notice without flagging known or deprecated keys", async () => {
    // Given/When
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    const html = renderTab(store);
    // Then: only the invented key is listed
    expect(html).toContain("ZZ_OC_UNKNOWN:frobnicate:ZZ");
  });
});

describe("OpenCodeConfigTab SSR — secrets and preview", () => {
  it("masks mcp environment values — the secret never renders in clear text", async () => {
    // Given/When
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    const html = renderTab(store);
    // Then: the env KEY is visible, its value behind the mask + isSet chip,
    // and the live preview redacts secret leaves — never a clear-text leak.
    expect(html).toContain("API_KEY");
    expect(html).toContain("••••••••");
    expect(html).toContain(SENTINELS.maskedIsSet);
    expect(html).not.toContain("sekret-value");
  });

  it("renders the live JSON preview view-only from the draft text", async () => {
    // Given/When
    const store = await loadedStore(readReply({ rawText: RICH_DRAFT }));
    const html = renderTab(store);
    // Then: the preview header rides t() and the draft text is present verbatim
    expect(html).toContain(SENTINELS.preview);
    expect(html).toContain("frobnicate");
    expect(html).toContain("&quot;layout&quot;");
  });
});

describe("OpenCodeConfigTab SSR — slot states", () => {
  it("offers the create CTA when the file is missing", async () => {
    // Given
    const store = await loadedStore(readReply({ exists: false, rawText: "", mtimeMs: 0 }));
    // When
    const html = renderTab(store);
    // Then
    expect(html).toContain(SENTINELS.fileMissing);
    expect(html).toContain(SENTINELS.fileCreate);
  });

  it("shows the parse-error banner and no spec sections when the draft is broken", async () => {
    // Given
    const store = await loadedStore(readReply({ rawText: "{ bad }\n", parseError: "InvalidSymbol at offset 2" }));
    // When
    const html = renderTab(store);
    // Then: the banner renders and the renderer emits no sections
    expect(html).toContain(SENTINELS.fileParseError);
    expect(html).not.toContain(SENTINELS.secGeneral);
  });

  it("renders the no-args fallback path without crashing (loading state)", () => {
    // Given: no store prop — the tab builds its own lane and awaits a load
    const init = stubInit();
    // When
    const html = renderToString(
      <StringsProvider init={init}>
        <AppProvider init={init} messenger={new WebviewMessenger({ postMessage: () => {}, onMessage: () => {} })}>
          <OpenCodeConfigTab />
        </AppProvider>
      </StringsProvider>,
    );
    // Then
    expect(html).toContain(en["app.loading"]);
  });
});

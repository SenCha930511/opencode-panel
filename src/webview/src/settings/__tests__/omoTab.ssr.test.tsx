// i18n-allow-literal — test fixtures/assertions carry literal wire data.
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { InitPayload } from "../../../../shared/protocol.js";
import { en } from "../../../../shared/strings.js";
import { StringsProvider } from "../../../lib/i18n.js";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import { AppProvider } from "../../app/context.js";
import { OmoConfigTab, redactPreviewText } from "../omoConfigTab.js";
import { ConfigFilesStore, type ConfigRequester } from "../configFilesStore.js";
import type { SpecComponentContext } from "../configFormRenderer.js";
import { OMO_KNOWN_BLOCK_KEYS, OMO_SPEC } from "../omoSpec.js";
import { SharedBaseSection } from "../omoSections.js";

/**
 * OmoConfigTab SSR suite (plan T4b, node env — no jsdom): the rewritten tab
 * edits the LITERAL "[opencode]" block of omo.jsonc through the W3 store +
 * renderer — sentinel overrides on the cfg.sec.omo/cfg.notice ids prove every
 * label rides t(); the [opencode]-nested fixture (agents/categories chips/
 * block unknowns) mirrors the real ~/.omo/omo.jsonc shape; the deprecated
 * variant keys, profiles/legacy notices, parse-error banner, and the live
 * draft preview each render through their pinned string ids. The spec
 * structure test locks the tier inventory and the "[opencode]"-rooted paths.
 */

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

const SENTINELS = {
  secAgents: "ZZ_SENTINEL_SEC_AGENTS_ZZ",
  secCategories: "ZZ_SENTINEL_SEC_CATEGORIES_ZZ",
  secDisabled: "ZZ_SENTINEL_SEC_DISABLED_ZZ",
  secBackgroundTask: "ZZ_SENTINEL_SEC_BT_ZZ",
  secSisyphus: "ZZ_SENTINEL_SEC_SISYPHUS_ZZ",
  secMemory: "ZZ_SENTINEL_SEC_MEMORY_ZZ",
  secRuntimeFallback: "ZZ_SENTINEL_SEC_RT_ZZ",
  secModelCapabilities: "ZZ_SENTINEL_SEC_MC_ZZ",
  secTmux: "ZZ_SENTINEL_SEC_TMUX_ZZ",
  secGitMaster: "ZZ_SENTINEL_SEC_GIT_ZZ",
  secBrowserAutomation: "ZZ_SENTINEL_SEC_BA_ZZ",
  secCodegraph: "ZZ_SENTINEL_SEC_CODEGRAPH_ZZ",
  secClaudeCode: "ZZ_SENTINEL_SEC_CC_ZZ",
  secIntegrations: "ZZ_SENTINEL_SEC_INTEGRATIONS_ZZ",
  secExperimental: "ZZ_SENTINEL_SEC_EXPERIMENTAL_ZZ",
  secOther: "ZZ_SENTINEL_SEC_OTHER_ZZ",
  secShared: "ZZ_SENTINEL_SEC_SHARED_ZZ",
  advanced: "ZZ_SENTINEL_ADVANCED_ZZ",
  noticeDeprecated: "ZZ_SENTINEL_NOTICE_DEPRECATED_ZZ",
  noticeUnknown: "ZZ_SENTINEL_NOTICE_UNKNOWN_ZZ",
  noticeProfiles: "ZZ_SENTINEL_NOTICE_PROFILES_ZZ",
  noticeLegacy: "ZZ_SENTINEL_NOTICE_LEGACY_ZZ",
  noticeSharedBase: "ZZ_SENTINEL_NOTICE_SHAREDBASE_ZZ",
  filePath: "ZZ_SENTINEL_FILE_PATH_ZZ",
  fileMissing: "ZZ_SENTINEL_FILE_MISSING_ZZ",
  fileCreate: "ZZ_SENTINEL_FILE_CREATE_ZZ",
  fileParseError: "ZZ_SENTINEL_FILE_PARSE_ERROR_ZZ",
  fileReadOnly: "ZZ_SENTINEL_FILE_READONLY_ZZ",
} as const;

function stubStrings(): Readonly<Record<string, string>> {
  return {
    ...en,
    "cfg.sec.omo.agents": SENTINELS.secAgents,
    "cfg.sec.omo.categories": SENTINELS.secCategories,
    "cfg.sec.omo.disabled": SENTINELS.secDisabled,
    "cfg.sec.omo.backgroundTask": SENTINELS.secBackgroundTask,
    "cfg.sec.omo.sisyphus": SENTINELS.secSisyphus,
    "cfg.sec.omo.memory": SENTINELS.secMemory,
    "cfg.sec.omo.runtimeFallback": SENTINELS.secRuntimeFallback,
    "cfg.sec.omo.modelCapabilities": SENTINELS.secModelCapabilities,
    "cfg.sec.omo.tmux": SENTINELS.secTmux,
    "cfg.sec.omo.gitMaster": SENTINELS.secGitMaster,
    "cfg.sec.omo.browserAutomation": SENTINELS.secBrowserAutomation,
    "cfg.sec.omo.codegraph": SENTINELS.secCodegraph,
    "cfg.sec.omo.claudeCode": SENTINELS.secClaudeCode,
    "cfg.sec.omo.integrations": SENTINELS.secIntegrations,
    "cfg.sec.omo.experimental": SENTINELS.secExperimental,
    "cfg.sec.omo.other": SENTINELS.secOther,
    "cfg.sec.omo.shared": SENTINELS.secShared,
    "cfg.advanced.title": SENTINELS.advanced,
    "cfg.notice.deprecated": "ZZ_SENTINEL_NOTICE_DEPRECATED_ZZ {keys}",
    "cfg.notice.unknown": "ZZ_SENTINEL_NOTICE_UNKNOWN_ZZ {keys}",
    "cfg.notice.profiles": SENTINELS.noticeProfiles,
    "cfg.notice.legacy": "ZZ_SENTINEL_NOTICE_LEGACY_ZZ {path}",
    "cfg.notice.sharedBase": SENTINELS.noticeSharedBase,
    "cfg.file.path": SENTINELS.filePath,
    "cfg.file.missing": SENTINELS.fileMissing,
    "cfg.file.create": SENTINELS.fileCreate,
    "cfg.file.parseError": SENTINELS.fileParseError,
    "cfg.file.readOnly": SENTINELS.fileReadOnly,
  };
}

function stubInit(): InitPayload {
  return {
    locale: "en",
    strings: stubStrings(),
    server: { url: "http://127.0.0.1:4096", version: "1.2.3-test" },
    capabilities: { fork: true, question: false, todo: true },
    settings: {},
  };
}

const FIXTURE_PATH = "/home/test/.omo/omo.jsonc";

/** [opencode]-nested fixture mirroring the shape of the real ~/.omo/omo.jsonc. */
const FIXTURE =
  '// OMO fixture\n{\n  "[opencode]": {\n' +
  '    "$schema": "https://example.test/omo.schema.json",\n' +
  '    "agents": {\n' +
  '      "sisyphus": { "model": "nchc/Kimi-K3",\n' +
  '        "models": ["nchc/GLM-5.2", { "model": "acme/backup-x", "reasoning": "high" }],\n' +
  '        "skills": ["debugging"] },\n' +
  '      "oracle": { "model": "nchc/Kimi-K3", "variant": "max" }\n' +
  "    },\n" +
  '    "categories": {\n' +
  '      "ultrabrain": { "model": "nchc/Kimi-K3", "variant": "max" },\n' +
  '      "quick": { "model": "nchc/GLM-5.2" }\n' +
  "    },\n" +
  '    "disabled_hooks": ["goal"],\n' +
  '    "disabled_mcps": ["websearch"],\n' +
  '    "background_task": { "defaultConcurrency": 7654321, "providerConcurrency": { "nchc": 3 } },\n' +
  '    "runtime_fallback": false,\n' +
  '    "tmux": { "enabled": true, "layout": "tiled-layout-x" },\n' +
  '    "frobnicate_unknown_key": { "x": 1 }\n' +
  "  },\n" +
  '  "telemetry": { "enabled": false },\n' +
  '  "profiles": { "work": { "agents": { "sisyphus": { "model": "acme/x" } } } },\n' +
  '  "_migrations": ["2026-08-reasoning-unification"],\n' +
  '  "$schema": "https://example.test/omo.schema.json"\n}\n';

interface LoadOptions {
  readonly rawText: string;
  readonly path?: string;
  readonly exists?: boolean;
  readonly parseError?: string | null;
  readonly legacyNoticePath?: string | null;
}

async function loadedStore(options: LoadOptions): Promise<ConfigFilesStore> {
  const reply = {
    path: options.path ?? FIXTURE_PATH,
    exists: options.exists ?? true,
    rawText: options.rawText,
    mtimeMs: 1,
    parseError: options.parseError ?? null,
    legacyNoticePath: options.legacyNoticePath ?? null,
  };
  const request: ConfigRequester = (type, payload) => loopbackMessenger({ ok: true, content: reply }).request(type, payload);
  const store = new ConfigFilesStore(request);
  await store.load("omo", "global");
  return store;
}

function renderTab(store: ConfigFilesStore): string {
  return renderToString(
    <StringsProvider init={stubInit()}>
      <AppProvider
        init={stubInit()}
        messenger={
          new WebviewMessenger({
            postMessage: () => {},
            onMessage: () => {},
          })
        }
      >
        <OmoConfigTab store={store} scope="global" />
      </AppProvider>
    </StringsProvider>,
  );
}

describe("OmoConfigTab SSR — header + tier structure", () => {
  it("renders the file header with path and tier-1 section sentinels from the string table", async () => {
    // Given: a loaded existing omo slot
    const store = await loadedStore({ rawText: FIXTURE });
    // When
    const html = renderTab(store);
    // Then: header shows the string-table label and the slot path
    expect(html).toContain(SENTINELS.filePath);
    expect(html).toContain(FIXTURE_PATH);
    // And: the three tier-1 section titles render from t()
    expect(html).toContain(SENTINELS.secAgents);
    expect(html).toContain(SENTINELS.secCategories);
    expect(html).toContain(SENTINELS.secDisabled);
    // And: no missing-file CTA for an existing file
    expect(html).not.toContain(SENTINELS.fileCreate);
  });

  it("offers the create CTA with the missing notice when the file does not exist", async () => {
    // Given
    const store = await loadedStore({ rawText: "", exists: false });
    // When
    const html = renderTab(store);
    // Then
    expect(html).toContain(SENTINELS.fileMissing);
    expect(html).toContain(SENTINELS.fileCreate);
  });

  it("wraps every tier-2 section under one advanced disclosure block, collapsed", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then: one advanced heading owns the tier-2 sections
    expect(html).toContain(SENTINELS.advanced);
    for (const sentinel of [
      SENTINELS.secBackgroundTask,
      SENTINELS.secSisyphus,
      SENTINELS.secMemory,
      SENTINELS.secRuntimeFallback,
      SENTINELS.secModelCapabilities,
      SENTINELS.secTmux,
      SENTINELS.secGitMaster,
      SENTINELS.secBrowserAutomation,
      SENTINELS.secCodegraph,
      SENTINELS.secClaudeCode,
      SENTINELS.secIntegrations,
      SENTINELS.secExperimental,
      SENTINELS.secOther,
      SENTINELS.secShared,
    ]) {
      expect(html).toContain(sentinel);
    }
    // And: collapsed tier-2 content stays out of the markup (unique fixture
    // tokens prove the fields never render open by accident)
    expect(html).not.toContain("7654321");
    expect(html).not.toContain("tiled-layout-x");
  });
});

describe("OmoConfigTab SSR — [opencode] block content", () => {
  it("renders agent and category records with values from inside the [opencode] block", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then: the record entry names and model values land in the tier-1 records
    expect(html).toContain('value="sisyphus"');
    expect(html).toContain('value="quick"');
    expect(html).toContain("nchc/Kimi-K3");
    // And: per-entry expandable detail lanes exist for the chain/skills editors
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders disabled_* chips with the known enums and selected membership", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then: enum options and selected hooks/mcps render as pressed chips
    expect(html).toContain(">goal</button>");
    expect(html).toContain(">websearch</button>");
    expect(html).toContain(">context7</button>");
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders the deprecated variant notice for agents and categories entries", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then
    expect(html).toContain("ZZ_SENTINEL_NOTICE_DEPRECATED_ZZ");
    expect(html).toContain("agents.oracle.variant");
    expect(html).toContain("categories.ultrabrain.variant");
  });

  it("lists unknown keys inside the [opencode] block as preserved read-only", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then
    expect(html).toContain("ZZ_SENTINEL_NOTICE_UNKNOWN_ZZ");
    expect(html).toContain("frobnicate_unknown_key");
  });

  it("renders the profiles notice when the root profiles key is present", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then
    expect(html).toContain(SENTINELS.noticeProfiles);
  });

  it("renders the legacy notice with the migrated path when the host reports one", async () => {
    // Given
    const store = await loadedStore({
      rawText: "",
      exists: false,
      legacyNoticePath: "/home/test/.config/opencode/oh-my-openagent.json",
    });
    // When
    const html = renderTab(store);
    // Then
    expect(html).toContain("ZZ_SENTINEL_NOTICE_LEGACY_ZZ");
    expect(html).toContain("/home/test/.config/opencode/oh-my-openagent.json");
  });
});

describe("OmoConfigTab SSR — parse-error + preview", () => {
  it("renders the parse-error banner read-only and still shows the raw draft text", async () => {
    // Given
    const store = await loadedStore({ rawText: "{ bad }\n", parseError: "InvalidSymbol at offset 2" });
    // When
    const html = renderTab(store);
    // Then: banner + read-only chip, renderer sections suppressed
    expect(html).toContain(SENTINELS.fileParseError);
    expect(html).toContain(SENTINELS.fileReadOnly);
    expect(html).not.toContain(SENTINELS.secAgents);
    expect(html).not.toContain(SENTINELS.secBackgroundTask);
    // And: the preview surfaces the broken draft for fixing
    expect(html).toContain("{ bad }");
  });

  it("renders a view-only JSON preview section title for a healthy draft", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then
    expect(html).toContain(en["cfg.preview.title"]);
  });
});

describe("OmoConfigTab SSR — legacy slop purge", () => {
  it("never resurrects the old localStorage/invented-key UI", async () => {
    // Given/When
    const store = await loadedStore({ rawText: FIXTURE });
    const html = renderTab(store);
    // Then
    for (const sludge of ["researchDepth", "orchestrationMode", "autoVerify", "opencode:omo:gui_state", "localStorage"]) {
      expect(html).not.toContain(sludge);
    }
  });
});

describe("omoSpec structure", () => {
  it("declares tier-1 exactly as agents/categories/disabled and keeps tier-2 full-coverage", () => {
    // Given/When
    const tier1 = OMO_SPEC.filter((section) => section.tier === 1).map((section) => section.id);
    const tier2 = OMO_SPEC.filter((section) => section.tier === 2).map((section) => section.id);
    // Then
    expect(tier1).toEqual(["cfg.sec.omo.agents", "cfg.sec.omo.categories", "cfg.sec.omo.disabled"]);
    expect(tier2).toEqual([
      "cfg.sec.omo.backgroundTask",
      "cfg.sec.omo.sisyphus",
      "cfg.sec.omo.memory",
      "cfg.sec.omo.runtimeFallback",
      "cfg.sec.omo.modelCapabilities",
      "cfg.sec.omo.tmux",
      "cfg.sec.omo.gitMaster",
      "cfg.sec.omo.browserAutomation",
      "cfg.sec.omo.codegraph",
      "cfg.sec.omo.claudeCode",
      "cfg.sec.omo.integrations",
      "cfg.sec.omo.experimental",
      "cfg.sec.omo.other",
      "cfg.sec.omo.shared",
    ]);
  });

  it("roots every declarative field path at the literal [opencode] key and inside the known-key set", () => {
    // Given/When/Then
    for (const section of OMO_SPEC) {
      for (const field of section.fields ?? []) {
        expect(field.path[0]).toBe("[opencode]");
        expect(OMO_KNOWN_BLOCK_KEYS).toContain(field.path[1]);
      }
    }
  });
});

describe("OmoConfigTab SSR — masked secrets", () => {
  const MASKED_FIXTURE =
    '{\n  "[opencode]": {\n    "openclaw": { "enabled": true,\n' +
    '      "replyListener": { "discordBotToken": "sekret-token", "telegramChatId": "-1001" }\n    }\n  }\n}\n';

  it("redacts openclaw replyListener tokens in the preview text", () => {
    // Given/When: the pure preview redactor over a token-bearing draft
    const redacted = redactPreviewText(MASKED_FIXTURE);
    // Then: the token value is masked; the key name and non-secret neighbors stay verbatim
    expect(redacted).not.toContain("sekret-token");
    expect(redacted).toContain("••••••••");
    expect(redacted).toContain('"discordBotToken"');
    expect(redacted).toContain('"-1001"');
  });

  it("never leaks the replyListener token anywhere in the tab markup", async () => {
    // Given/When
    const store = await loadedStore({ rawText: MASKED_FIXTURE });
    const html = renderTab(store);
    // Then: tier-2 is collapsed and even a forced-open preview path is always redacted
    expect(html).not.toContain("sekret-token");
  });
});

describe("omoSections — shared-base display rows", () => {
  function CtxHarness(props: { readonly ctx: SpecComponentContext }): ReactNode {
    return SharedBaseSection(props.ctx);
  }

  it("renders $schema/_migrations read-only display rows with the resolution note", async () => {
    // Given: a loaded store as the spec context source
    const store = await loadedStore({ rawText: FIXTURE });
    // When: the shared-base section renders under the string provider
    const html = renderToString(
      <StringsProvider init={stubInit()}>
        <CtxHarness ctx={{ store, file: "omo", scope: "global", slot: store.slot("omo", "global") }} />
      </StringsProvider>,
    );
    // Then: the read-only row values render verbatim and the note rides t()
    expect(html).toContain("https://example.test/omo.schema.json");
    expect(html).toContain("2026-08-reasoning-unification");
    expect(html).toContain(SENTINELS.noticeSharedBase);
  });
});

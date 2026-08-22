// i18n-allow-literal — test fixtures/assertions carry literal wire data.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StringsProvider } from "../../../lib/i18n.js";
import { WebviewMessenger, type WebviewPort } from "../../../lib/messenger.js";
import type { ConfigFileReadReply } from "../../../../shared/protocol.js";
import { en } from "../../../../shared/strings.js";
import { ConfigFormRenderer, type SpecSection } from "../configFormRenderer.js";
import { ConfigFilesStore, type ConfigRequester } from "../configFilesStore.js";

/**
 * ConfigFormRenderer SSR smoke (plan T3, node env — no jsdom): a small
 * declarative spec renders through the loopback-loaded store — sentinel
 * overrides on the cfg.* ids prove every label rides t(), the draft value
 * flows into the input, and an unparseable slot renders nothing at all
 * (the read-only banner/preview fallback belongs to the tab).
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

function makeStore(messenger: WebviewMessenger): ConfigFilesStore {
  const request: ConfigRequester = (type, payload) => messenger.request(type, payload);
  return new ConfigFilesStore(request);
}

const SENTINEL_SECTION = "ZZ_SENTINEL_SECTION_GENERAL_ZZ";
const SENTINEL_FIELD = "ZZ_SENTINEL_FIELD_MODEL_ZZ";

const SECTIONS: readonly SpecSection[] = [
  {
    id: "cfg.sec.oc.general",
    tier: 1,
    fields: [{ id: "cfg.f.model", path: ["model"], kind: "text" }],
  },
];

async function loadedStore(rawText: string, parseError: string | null): Promise<ConfigFilesStore> {
  const reply: ConfigFileReadReply = {
    path: "/home/test/.config/opencode/opencode.json",
    exists: true,
    rawText,
    mtimeMs: 1,
    parseError,
    legacyNoticePath: null,
  };
  const store = makeStore(loopbackMessenger({ ok: true, content: reply }));
  await store.load("opencode", "global");
  return store;
}

function renderRenderer(store: ConfigFilesStore): string {
  return renderToString(
    <StringsProvider
      init={{
        locale: "en",
        strings: {
          ...en,
          "cfg.sec.oc.general": SENTINEL_SECTION,
          "cfg.f.model": SENTINEL_FIELD,
        },
      }}
    >
      <ConfigFormRenderer store={store} file="opencode" scope="global" sections={SECTIONS} />
    </StringsProvider>,
  );
}

describe("ConfigFormRenderer SSR smoke", () => {
  it("renders a spec section with sentinel labels via t() and the draft value", async () => {
    // Given: a loaded slot with a model value
    const store = await loadedStore('{\n  "model": "anthropic/claude-3-7"\n}\n', null);
    // When
    const html = renderRenderer(store);
    // Then: the section and field labels come from the string table
    expect(html).toContain(SENTINEL_SECTION);
    expect(html).toContain(SENTINEL_FIELD);
    // And: the draft value flows into the rendered input
    expect(html).toContain("anthropic/claude-3-7");
  });

  it("renders nothing for a slot with a parseError", async () => {
    // Given
    const store = await loadedStore("{ bad }\n", "InvalidSymbol at offset 2");
    // When
    const html = renderRenderer(store);
    // Then
    expect(html).not.toContain(SENTINEL_SECTION);
    expect(html).not.toContain(SENTINEL_FIELD);
  });
});

describe("ConfigFormRenderer SSR — widget dispatch + editors", () => {
  const WIDE_SENTINELS = {
    sectionGeneral: "ZZ_WIDE_SECTION_GENERAL_ZZ",
    toggle: "ZZ_WIDE_TOGGLE_ZZ",
    steps: "ZZ_WIDE_STEPS_ZZ",
    listAdd: "ZZ_WIDE_LIST_ADD_ZZ",
    kvAdd: "ZZ_WIDE_KV_ADD_ZZ",
    maskedIsSet: "ZZ_WIDE_MASKED_ISSET_ZZ",
    recordsAdd: "ZZ_WIDE_RECORDS_ADD_ZZ",
    sectionPlugins: "ZZ_WIDE_SECTION_PLUGINS_ZZ",
    timeout: "ZZ_WIDE_TIMEOUT_ZZ",
  } as const;

  const WIDE_DRAFT =
    '{\n  "model": "acme/fast",\n  "autoupdate": true,\n  "steps": 3,\n  "mode": "plan",\n' +
    '  "plugin": ["p1", "p2"],\n  "env": { "API_KEY": "sekret-value" },\n  "headers": { "PLAIN": "vv" },\n' +
    '  "disabled_hooks": ["a", "zz"],\n' +
    '  "toolSpec": { "bash": { "enabled": true, "note": "xnote" } }\n}\n';

  const WIDE_SECTIONS: readonly SpecSection[] = [
    {
      id: "cfg.sec.oc.general",
      tier: 1,
      fields: [
        { id: "cfg.f.model", path: ["model"], kind: "text" },
        { id: "cfg.f.autoupdate", path: ["autoupdate"], kind: "toggle" },
        { id: "cfg.f.steps", path: ["steps"], kind: "number" },
        { id: "cfg.f.mode", path: ["mode"], kind: "select", options: ["build", "plan"] },
        { id: "cfg.f.permission", path: ["model"], kind: "model" },
        { id: "cfg.f.plugins", path: ["plugin"], kind: "list" },
        { id: "cfg.f.tools", path: ["headers"], kind: "kv" },
        { id: "cfg.f.apiKey", path: ["env"], kind: "kv", masked: true },
        { id: "cfg.f.disabled", path: ["disabled_hooks"], kind: "chips", options: ["a", "b"] },
        {
          id: "cfg.f.agents",
          path: ["toolSpec"],
          kind: "records",
          columns: [
            { key: "enabled", label: "cfg.f.autoUpdate", kind: "toggle" },
            { key: "note", label: "cfg.f.description", kind: "text" },
          ],
        },
      ],
    },
    {
      id: "cfg.sec.oc.plugins",
      tier: 2,
      fields: [{ id: "cfg.f.timeout", path: ["timeout"], kind: "number" }],
    },
  ];

  function wideStrings(): Readonly<Record<string, string>> {
    return {
      ...en,
      "cfg.sec.oc.general": WIDE_SENTINELS.sectionGeneral,
      "cfg.f.autoupdate": WIDE_SENTINELS.toggle,
      "cfg.f.steps": WIDE_SENTINELS.steps,
      "cfg.list.add": WIDE_SENTINELS.listAdd,
      "cfg.kv.add": WIDE_SENTINELS.kvAdd,
      "cfg.masked.isSet": WIDE_SENTINELS.maskedIsSet,
      "cfg.records.add": WIDE_SENTINELS.recordsAdd,
      "cfg.sec.oc.plugins": WIDE_SENTINELS.sectionPlugins,
      "cfg.f.timeout": WIDE_SENTINELS.timeout,
    };
  }

  async function renderWide(): Promise<string> {
    const reply: ConfigFileReadReply = {
      path: "/home/test/.config/opencode/opencode.json",
      exists: true,
      rawText: WIDE_DRAFT,
      mtimeMs: 1,
      parseError: null,
      legacyNoticePath: null,
    };
    const store = makeStore(loopbackMessenger({ ok: true, content: reply }));
    await store.load("opencode", "global");
    return renderToString(
      <StringsProvider init={{ locale: "en", strings: wideStrings() }}>
        <ConfigFormRenderer store={store} file="opencode" scope="global" sections={WIDE_SECTIONS} />
      </StringsProvider>,
    );
  }

  it("dispatches scalar widgets reading values from the draft text", async () => {
    // Given/When
    const html = await renderWide();
    // Then: text input carries the draft value, number local text is seeded,
    // every toggle renders as a checkbox, the select renders every enum option
    expect(html).toContain('value="acme/fast"');
    expect(html).toContain(WIDE_SENTINELS.toggle);
    expect(html).toContain(WIDE_SENTINELS.steps);
    expect(html).toContain('value="3"');
    expect(html.match(/type="checkbox"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('value="build"');
    expect(html).toContain('value="plan"');
  });

  it("renders the model combobox as a datalist-backed free-text input", async () => {
    // Given/When
    const html = await renderWide();
    // Then
    expect(html).toContain("<datalist");
    expect(html).toMatch(/<input[^>]*\blist="/);
  });

  it("renders the string-list editor with one row per item and an add action", async () => {
    // Given/When
    const html = await renderWide();
    // Then
    expect(html).toContain('value="p1"');
    expect(html).toContain('value="p2"');
    expect(html).toContain(WIDE_SENTINELS.listAdd);
  });

  it("renders kv entries and never leaks a masked secret value", async () => {
    // Given/When
    const html = await renderWide();
    // Then: the plain kv shows keys + values; the masked kv shows the mask + isSet chip
    expect(html).toContain("PLAIN");
    expect(html).toContain('value="vv"');
    expect(html).toContain(WIDE_SENTINELS.kvAdd);
    expect(html).toContain("API_KEY");
    expect(html).toContain("••••••••");
    expect(html).toContain(WIDE_SENTINELS.maskedIsSet);
    expect(html).not.toContain("sekret-value");
  });

  it("renders chips for known options and free-text extras", async () => {
    // Given/When
    const html = await renderWide();
    // Then
    expect(html).toContain(">a</");
    expect(html).toContain(">b</");
    expect(html).toContain(">zz</");
  });

  it("renders the records table with typed cells per column kind", async () => {
    // Given/When
    const html = await renderWide();
    // Then: the entry key is rendered for the row; typed cells carry values; the toggle cell is checked
    expect(html).toContain("bash");
    expect(html).toContain('value="xnote"');
    expect(html.match(/checked/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(WIDE_SENTINELS.recordsAdd);
  });

  it("renders tier-2 sections collapsed behind their own advanced disclosure", async () => {
    // Given/When
    const html = await renderWide();
    // Then: the tier-2 section header renders as a collapsed disclosure; its field stays hidden
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(WIDE_SENTINELS.sectionPlugins);
    expect(html).not.toContain(WIDE_SENTINELS.timeout);
  });
});

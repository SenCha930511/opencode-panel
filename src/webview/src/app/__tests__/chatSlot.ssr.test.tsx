// i18n-allow-literal — test fixtures/assertions carry literal wire data and
// structural markers; they are not display copy routed through t().
/**
 * FIX-E regression guard (THE F-wave guard): proves the production slot
 * composition mounts the REAL chat surface — composer, message area, pickers
 * + attachments extras, session menu, cards dock, session dock — and can
 * never silently lose `slots.chat` again.
 *
 * Three layers, all node-env + react-dom/server SSR (no jsdom, per the
 * repo's webview test rules):
 *
 * 1. FULL SLOTS RENDER: `<App/>` rendered with `createAppSlots()` — the same
 *    seam bootstrap mounts — asserting the structural markers of every
 *    composed piece. If the seam record drops `chat`, the markers vanish.
 * 2. STATIC CONSUMPTION GUARD: reads `../bootstrap.tsx` source and pins the
 *    structural wiring tokens (`createAppSlots()` + `slots={slots}`), so a
 *    future bootstrap that stops consuming the seam fails the suite. Source
 *    pinning targets machine-consumed wiring tokens only (never prose).
 * 3. COMPOSED-PIECES SMOKE: `<ChatSlot/>` alone + the todo-13 renderer
 *    contract (`MessageListBody`) with a seeded store proves the per-message
 *    hover menu rows (todo 19) actually render.
 *
 * Runtime globals: `acquireVsCodeApi`/`window` are the ambient platform
 * handles lib/messenger.ts declares; stubbing them at the process boundary
 * lets the REAL composition (real singleton messenger, real stores) render
 * in node — nothing in the composition itself is swapped out.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";

import type { InitPayload } from "../../../../shared/protocol.js";
import { en } from "../../../../shared/strings.js";
import { StringsProvider } from "../../../lib/i18n.js";
import { getWebviewMessenger } from "../../../lib/messenger.js";
import { MessageListBody } from "../../chat/MessageList.js";
import { MessageStore } from "../../chat/messageStore.js";
import { AppProvider } from "../context.js";
import { App } from "../../App.js";
import { ChatSlot, createAppSlots } from "../chatSlot.js";

const SENTINELS = {
  searchPlaceholder: "ZZ_SENTINEL_SEARCH_SESSIONS_ZZ",
  commandsTitle: "ZZ_SENTINEL_COMMANDS_MENU_ZZ",
  composerPlaceholder: "ZZ_SENTINEL_COMPOSER_PLACEHOLDER_ZZ",
  revert: "ZZ_SENTINEL_MESSAGE_REVERT_ZZ",
  unrevert: "ZZ_SENTINEL_MESSAGE_UNREVERT_ZZ",
} as const;

function stubInit(overrides?: Partial<InitPayload>): InitPayload {
  return {
    locale: "en",
    strings: {
      ...en,
      "sessions.searchPlaceholder": SENTINELS.searchPlaceholder,
      "commands.title": SENTINELS.commandsTitle,
      "composer.placeholder": SENTINELS.composerPlaceholder,
      "messages.revert": SENTINELS.revert,
      "messages.unrevert": SENTINELS.unrevert,
    },
    server: { url: "http://127.0.0.1:4096", version: "0.0.0-test" },
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
    ...overrides,
  };
}

beforeAll(() => {
  // Platform boundary stubs (see header): the messenger module resolves the
  // ambient webview runtime only through these two globals.
  const globals = globalThis as Record<string, unknown>;
  globals.acquireVsCodeApi = () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  });
  globals.window = { addEventListener: () => undefined };
});

function renderWithProviders(element: ReactNode): string {
  const init = stubInit();
  return renderToStaticMarkup(
    <StringsProvider init={init}>
      <AppProvider init={init} messenger={getWebviewMessenger()}>
        {element}
      </AppProvider>
    </StringsProvider>,
  );
}

describe("production slots record (regression: slots.chat must stay mounted)", () => {
  it("renders the real chat surface + sessions rail through createAppSlots()", () => {
    // Given: the exact slots record bootstrap mounts
    // When: the chat route renders under SSR
    const html = renderToStaticMarkup(createAppSlotsTree());
    // Then: every composed surface carries its structural marker
    expect(html).toContain('data-oc-slot="sessions"');
    expect(html).toContain('data-oc-slot="chat"');
    expect(html).toContain("data-oc-composer");
    expect(html).toContain("data-oc-composer-extras");
    expect(html).toContain('data-oc-dock="session"');
    expect(html).toContain("data-oc-chat-toolbar");
    // And: the real panels (not the default empty states) render from t()
    expect(html).toContain(SENTINELS.searchPlaceholder);
    expect(html).toContain(SENTINELS.commandsTitle);
    expect(html).toContain(SENTINELS.composerPlaceholder);
    // And: the cards dock honestly hides while no requests are pending
    expect(html).not.toContain('data-oc-dock="cards"');
  });

  it("pins bootstrap's consumption of the seam (static wiring tokens)", () => {
    // Given: the bootstrap source
    const source = readFileSync(new URL("../bootstrap.tsx", import.meta.url), "utf8");
    // Then: it composes the seam record and passes it to AppProvider
    expect(source).toContain("createAppSlots()");
    expect(source).toMatch(/slots=\{slots\}/);
  });
});

/** The `<App/>` tree below the seam's slots, exactly as bootstrap composes it. */
function createAppSlotsTree(): ReactElement {
  const init = stubInit();
  return (
    <StringsProvider init={init}>
      <AppProvider init={init} messenger={getWebviewMessenger()} slots={createAppSlots()}>
        <App />
      </AppProvider>
    </StringsProvider>
  );
}

describe("composed chat pieces smoke", () => {
  it("ChatSlot renders toolbar, message area (empty state), composer, and session dock", () => {
    const html = renderWithProviders(<ChatSlot />);
    expect(html).toContain("data-oc-chat");
    expect(html).toContain("data-oc-chat-toolbar");
    expect(html).toContain("data-oc-composer");
    expect(html).toContain('data-oc-dock="session"');
    expect(html).toContain(SENTINELS.commandsTitle);
  });

  it("the per-message hover menu renders its rows from t() (todo-19 mount)", () => {
    // Given: a seeded store with a user prompt + assistant reply
    const store = new MessageStore();
    store.applyFullSync("ses_1", [
      {
        info: { id: "m1", role: "user", sessionID: "ses_1" },
        parts: [{ id: "p1", type: "text", text: "hello" }],
      },
      {
        info: { id: "m2", role: "assistant", sessionID: "ses_1" },
        parts: [{ id: "p2", type: "text", text: "world" }],
      },
    ]);
    // When: the todo-13 renderer contract maps the rows
    const html = renderWithProviders(
      <MessageListBody messages={store.getState().messages} store={store} />,
    );
    // Then: every row wraps in the hover group and its menu rows render via t()
    expect(html).toContain("group relative");
    expect(html).toContain(SENTINELS.revert);
    expect(html).toContain(SENTINELS.unrevert);
    expect(html).toContain('data-role="assistant"');
    expect(html).toContain('data-role="user"');
  });
});

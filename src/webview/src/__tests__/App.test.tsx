import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InitPayload } from "../../../shared/protocol.js";
import { en } from "../../../shared/strings.js";
import { StringsProvider } from "../../lib/i18n.js";
import { WebviewMessenger } from "../../lib/messenger.js";
import { App } from "../App";
import { AppProvider, deriveServerStatus, isServerLostEvent } from "../app/context";

/**
 * Smoke suite for the todo-11 shell. jsdom/@testing-library are NOT yet
 * installed (they land with todo 13's package bump), so renders run through
 * react-dom/server in the node environment: enough to prove the shell wires
 * init -> strings -> header/slots/routes without crashing, including the
 * Radix primitives under SSR.
 *
 * Display-copy assertions use sentinel overrides injected into the stub
 * string table, so a green run proves the t() wiring (a green from the
 * bundled English table alone could pass with the wiring bypassed).
 */

const SENTINELS = {
  newSession: "ZZ_SENTINEL_NEW_SESSION_ZZ",
  connected: "ZZ_SENTINEL_SERVER_CONNECTED_ZZ",
  stopped: "ZZ_SENTINEL_SERVER_STOPPED_ZZ",
  settingsTitle: "ZZ_SENTINEL_SETTINGS_TITLE_ZZ",
  sessionsEmpty: "ZZ_SENTINEL_SESSIONS_EMPTY_ZZ",
  messagesEmpty: "ZZ_SENTINEL_MESSAGES_EMPTY_ZZ",
} as const;

function stubStrings(): Readonly<Record<string, string>> {
  return {
    ...en,
    "sessions.new": SENTINELS.newSession,
    "server.status.connected": SENTINELS.connected,
    "server.status.stopped": SENTINELS.stopped,
    "settings.title": SENTINELS.settingsTitle,
    "sessions.empty": SENTINELS.sessionsEmpty,
    "messages.empty": SENTINELS.messagesEmpty,
  };
}

function stubInit(overrides?: Partial<InitPayload>): InitPayload {
  return {
    locale: "en",
    strings: stubStrings(),
    server: { url: "http://127.0.0.1:4096", version: "0.0.0-test" },
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
    ...overrides,
  };
}

function stubMessenger(): WebviewMessenger {
  const posted: unknown[] = [];
  return new WebviewMessenger({
    postMessage: (message) => {
      posted.push(message);
    },
    onMessage: () => {},
  });
}

function renderShell(init: InitPayload, initialRoute?: "chat" | "settings"): string {
  return renderToString(
    <StringsProvider init={init}>
      <AppProvider
        init={init}
        messenger={stubMessenger()}
        {...(initialRoute === undefined ? {} : { initialRoute })}
      >
        <App />
      </AppProvider>
    </StringsProvider>,
  );
}

describe("App shell smoke render", () => {
  it("renders new-session button, connected status label, and default slot empty states via t()", () => {
    // Given: an init payload with a live server and sentinel display strings
    // When: the shell renders the default chat route
    const html = renderShell(stubInit());
    // Then: every wired label carries the sentinel, proving t() served it
    expect(html).toContain(SENTINELS.newSession);
    expect(html).toContain(SENTINELS.connected);
    expect(html).toContain(SENTINELS.sessionsEmpty);
    expect(html).toContain(SENTINELS.messagesEmpty);
    // And: the T12/T13 mount slots carry their documented contract markers
    expect(html).toContain('data-oc-slot="sessions"');
    expect(html).toContain('data-oc-slot="chat"');
  });

  it("renders the settings route placeholder instead of the chat slots", () => {
    // Given/When: the shell renders with the settings route selected
    const html = renderShell(stubInit(), "settings");
    // Then: the settings heading renders and the chat slots are absent
    expect(html).toContain(SENTINELS.settingsTitle);
    expect(html).not.toContain('data-oc-slot="chat"');
  });

  it("shows the stopped status when the init server slice is disconnected", () => {
    // Given: init with the disconnected zero server slice
    // When: the header renders
    const html = renderShell(stubInit({ server: { url: "", version: null } }));
    // Then: the stopped label (green-dot claims are absent) is served
    expect(html).toContain(SENTINELS.stopped);
    expect(html).not.toContain(SENTINELS.connected);
  });

  it("applies chatFontFamily/chatFontSize overrides from init.settings as inline tokens", () => {
    // Given: settings carrying explicit chat font overrides
    const init = stubInit({ settings: { chatFontFamily: "SSSFONT", chatFontSize: 14 } });
    // When: the shell root renders
    const html = renderShell(init);
    // Then: the overrides land on the token custom properties, not on fonts directly
    expect(html).toContain("--oc-chat-font-family:SSSFONT");
    expect(html).toContain("--oc-chat-font-size:14px");
  });
});

describe("deriveServerStatus", () => {
  it("maps disconnected / unprobed / probed wire states onto ui states", () => {
    expect(deriveServerStatus({ url: "", version: null })).toBe("stopped");
    expect(deriveServerStatus({ url: "http://x", version: null })).toBe("probing");
    expect(deriveServerStatus({ url: "http://x", version: "1.0.0" })).toBe("connected");
  });
});

describe("isServerLostEvent", () => {
  it("accepts every documented lost spelling and rejects unrelated events", () => {
    expect(isServerLostEvent("server-lost")).toBe(true);
    expect(isServerLostEvent("server.lost")).toBe(true);
    expect(isServerLostEvent("server_disconnected")).toBe(true);
    expect(isServerLostEvent("server.disposed")).toBe(true);
    expect(isServerLostEvent("message.part.delta")).toBe(false);
    expect(isServerLostEvent("session.updated")).toBe(false);
  });
});

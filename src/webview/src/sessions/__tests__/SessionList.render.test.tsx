/**
 * SessionList server-render suite (node env, react-dom/server — the sandbox
 * carries no jsdom and npm installs are out of scope; SSR asserts the static
 * structure that the TODO-12 spec pins: skeleton rows while loading, the
 * empty state, row titles from the filter, and the shared badge marker).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { StringsProvider } from "../../../lib/i18n.js";
import { en } from "../../../../shared/strings.js";
import { SessionList } from "../SessionList.js";
import { SessionsStore } from "../sessionsStore.js";
import { createLoopback, makeEntry } from "./stubHost.js";

function render(element: ReactNode): string {
  return renderToStaticMarkup(
    <StringsProvider init={{ locale: "en", strings: en }}>{element}</StringsProvider>,
  );
}

function storeWith(entries: readonly ReturnType<typeof makeEntry>[]): {
  readonly store: SessionsStore;
} {
  const loopback = createLoopback();
  const store = new SessionsStore({ messenger: loopback.messenger });
  store.attach();
  loopback.host.pushSessionList(entries);
  return { store };
}

describe("SessionList (server render)", () => {
  it("renders skeleton rows while the list is loading", () => {
    const loopback = createLoopback();
    const store = new SessionsStore({ messenger: loopback.messenger });
    const html = render(<SessionList store={store} />);
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain(en["sessions.empty"]);
  });

  it("renders the todo-4 empty state when no sessions exist", () => {
    const { store } = storeWith([]);
    const html = render(<SessionList store={store} />);
    expect(html).toContain(en["sessions.empty"]);
  });

  it("renders row titles and the shared badge marker", () => {
    const { store } = storeWith([
      makeEntry("ses_1", "Alpha session", true),
      makeEntry("ses_2", "Beta session"),
    ]);
    const html = render(<SessionList store={store} />);
    expect(html).toContain("Alpha session");
    expect(html).toContain("Beta session");
    // badge marker present only for the shared row's aria id
    expect(html.match(/aria-label="shared"/g)).toHaveLength(1); // i18n-allow-literal
  });

  it("the search filter narrows the rendered rows", () => {
    const { store } = storeWith([
      makeEntry("ses_1", "Refactor Auth"),
      makeEntry("ses_2", "Write tests"),
    ]);
    store.setFilter("auth");
    const html = render(<SessionList store={store} />);
    expect(html).toContain("Refactor Auth");
    expect(html).not.toContain("Write tests");
  });

  it("marks the selected session with aria-current", () => {
    const { store } = storeWith([makeEntry("ses_1", "First"), makeEntry("ses_2", "Second")]);
    store.select("ses_2");
    const html = render(<SessionList store={store} />);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("renders the error banner when the store is in error state", async () => {
    const loopback = createLoopback();
    const store = new SessionsStore({ messenger: loopback.messenger });
    store.attach();
    loopback.host.pushSessionList([makeEntry("ses_1", "Any")]);
    loopback.host.respond("renameSession", () => ({ ok: false, error: "boom-marker" }));
    await expect(store.renameSession("ses_1", "x")).rejects.toThrow();
    const html = render(<SessionList store={store} />);
    expect(html).toContain("boom-marker");
    expect(html).toContain('role="alert"');
  });
});

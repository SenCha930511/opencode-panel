// i18n-allow-literal — test fixtures/assertions carry literal wire payloads
// and English reason labels; they are wire data, not display copy.
// allow: SIZE_OK — one acceptance narrative per todo-17 webview requirement;
// the suites share harness seams and splitting breaks the per-todo QA story.
/**
 * Attachments webview acceptance suite (plan todo 17) — node environment,
 * no jsdom: component assertions use `react-dom/server` static markup and
 * everything behavioral runs through the DOM-free modules (logic / images /
 * search / controller) exactly as the todo-14 Composer suite does.
 *
 * - chip store: add/remove/clear, keyed by id, subscribers notified.
 * - @-query extraction matrix: at-caret token, mid-token caret, at-start,
 *   after-space, bare `@`, `email@host` non-mention, no-@.
 * - debounce: a typing burst costs AT MOST one searchFiles call (150ms
 *   trailing), latest-wins, cleared/empty queries request nothing, search
 *   failure degrades to empty rows without throwing.
 * - paste/pick (stub clipboard files -> data URLs): chips staged through
 *   the gate; an 11 MiB image is rejected as `size` BEFORE it can stage;
 *   the EXACT 10 MiB boundary stages fine.
 * - host push: `attachments.add` events stage chips (sensitive reason
 *   carried); the busy transition clears staging (clear-on-send).
 * - SSR: palette rows render with path titles; the sensitive banner lists
 *   staged risky chips.
 * - mirror contract: sensitive rules behave identically to the host suite's
 *   pinned matrix; the event literal matches src/host/handlers/attachments.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { en } from "../../../../../shared/strings.js";
import type { InitPayload } from "../../../../../shared/protocol.js";
import { WebviewMessenger, type WebviewPort } from "../../../../lib/messenger.js";
import { StringsProvider } from "../../../../lib/i18n.js";
import { AppProvider } from "../../../app/context.js";
import type { ChatEvent, ChatEventListener } from "../../events.js";
import {
  ATTACHMENTS_ADD_EVENT,
  createAttachmentsController,
  type AttachmentsController,
} from "../index.js";
import {
  baseNameOfPath,
  chipFromPath,
  extractMentionQuery,
  replaceMentionToken,
  sensitivePathReason,
  stripMentionToken,
  urlFromServerPath,
} from "../logic.js";
import {
  IMAGE_MIME_ALLOWLIST,
  MAX_IMAGE_BYTES,
  ImageAttachmentError,
  attachmentFromImageData,
  assertImageAllowed,
  dataUrlByteLength,
} from "../images.js";
import { imageFilesFrom } from "../domGlue.js";
import { createMentionSearch } from "../search.js";
import { MentionPalette } from "../MentionPalette.js";
import { AttachmentsExtras } from "../AttachmentsExtras.js";

// ---------------------------------------------------------------------------
// Seams.

function createIdgen(): () => string {
  let counter = 0;
  return () => `att-${++counter}`;
}

interface FakeEvents {
  readonly source: {
    subscribeEvent(listener: ChatEventListener): () => void;
  };
  emit(event: ChatEvent): void;
}

function createFakeEvents(): FakeEvents {
  let listener: ChatEventListener | undefined;
  return {
    source: {
      subscribeEvent: (registered) => {
        listener = registered;
        return () => {
          listener = undefined;
        };
      },
    },
    emit: (event) => listener?.(event),
  };
}

function dataUrlOf(bytes: number, mime: string): string {
  return `data:${mime};base64,${Buffer.alloc(bytes).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Chip store.

describe("attachment store", () => {
  it("add/remove/clear with subscribers notified and stable ids", () => {
    const controller = createAttachmentsController({ idgen: createIdgen() });
    const seen: number[] = [];
    const unsubscribe = controller.subscribe(() => seen.push(controller.chips.length));

    const first = controller.add({ name: "a.ts", mimeType: "text/plain", url: "file:///a.ts" });
    const second = controller.addPath("src/b.md");
    expect(controller.chips.map((chip) => chip.id)).toEqual([first.id, second.id]);
    expect(controller.chips[1]).toMatchObject({ name: "b.md", mimeType: "text/markdown" });

    controller.remove(first.id);
    expect(controller.chips.map((chip) => chip.id)).toEqual([second.id]);

    controller.clear();
    expect(controller.chips).toEqual([]);
    expect(seen).toEqual([1, 2, 1, 0]);

    unsubscribe();
    controller.addPath("src/c.ts");
    expect(seen).toEqual([1, 2, 1, 0]);
  });

  it("clear is a no-op when empty (no notification storm)", () => {
    const controller = createAttachmentsController({ idgen: createIdgen() });
    let calls = 0;
    controller.subscribe(() => {
      calls += 1;
    });
    controller.clear();
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// @-query extraction matrix + token strip.

describe("extractMentionQuery", () => {
  it("at-start token", () => {
    expect(extractMentionQuery("@exa", 4)).toEqual({ query: "exa", start: 0, end: 4 });
  });

  it("after-space token", () => {
    expect(extractMentionQuery("hi @ex", 6)).toEqual({ query: "ex", start: 3, end: 6 });
  });

  it("caret mid-token queries the text up to the caret and spans the whole token", () => {
    expect(extractMentionQuery("see @abcdef plus", 8)).toEqual({
      query: "abc",
      start: 4,
      end: 11,
    });
  });

  it("bare @ yields an empty query", () => {
    expect(extractMentionQuery("@", 1)).toEqual({ query: "", start: 0, end: 1 });
  });

  it("mid-token @ is not a mention (email@host)", () => {
    expect(extractMentionQuery("email@host", 9)).toBeUndefined();
  });

  it("no-@ text and a token the caret left are not mentions", () => {
    expect(extractMentionQuery("hello", 5)).toBeUndefined();
    expect(extractMentionQuery("hi @ex there", 12)).toBeUndefined();
    expect(extractMentionQuery("", 0)).toBeUndefined();
  });

  it("stripMentionToken removes only the token and places the caret at its start", () => {
    const text = "please check @src/app.ts for this";
    const mention = extractMentionQuery(text, 20);
    if (mention === undefined) throw new Error("mention not found");
    expect(stripMentionToken(text, mention)).toBe("please check  for this");
    expect(mention.start).toBe(13);
  });

  it("replaceMentionToken replaces the token with @path and trailing space", () => {
    const text = "please check @app for this";
    const mention = extractMentionQuery(text, 17);
    if (mention === undefined) throw new Error("mention not found");
    const { newText, newCaret } = replaceMentionToken(text, mention, "src/app.ts");
    expect(newText).toBe("please check @src/app.ts  for this");
    expect(newCaret).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Debounced search machine.

describe("mention search debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a typing burst costs at most one request and resolves rows latest-wins", async () => {
    const calls: string[] = [];
    const search = createMentionSearch({
      search: (query) => {
        calls.push(query);
        return Promise.resolve([`src/${query}.ts`]);
      },
    });
    search.setQuery("a");
    search.setQuery("ab");
    search.setQuery("abc");
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(160);
    expect(calls).toEqual(["abc"]);
    expect(search.rows).toEqual(["src/abc.ts"]);

    search.setQuery("abcd");
    await vi.advanceTimersByTimeAsync(160);
    expect(calls).toEqual(["abc", "abcd"]);
    expect(search.rows).toEqual(["src/abcd.ts"]);
  });

  it("undefined/empty queries cancel pending work and request nothing", async () => {
    const calls: string[] = [];
    const search = createMentionSearch({
      search: (query) => {
        calls.push(query);
        return Promise.resolve([query]);
      },
    });
    search.setQuery("ab");
    await vi.advanceTimersByTimeAsync(160);
    expect(search.rows).toEqual(["ab"]);

    search.setQuery(undefined);
    expect(search.rows).toEqual([]);
    search.setQuery("x");
    search.setQuery("");
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toEqual(["ab"]);
  });

  it("a stale response cannot overwrite newer rows; failure degrades to empty rows", async () => {
    let resolveFirst: { (rows: readonly string[]): void } | undefined;
    const search = createMentionSearch({
      search: (query) =>
        query === "slow"
          ? new Promise<readonly string[]>((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve(["fresh"]),
    });
    search.setQuery("slow");
    await vi.advanceTimersByTimeAsync(160);
    search.setQuery("fast");
    await vi.advanceTimersByTimeAsync(160);
    expect(search.rows).toEqual(["fresh"]);
    resolveFirst?.(["stale"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(search.rows).toEqual(["fresh"]);

    const failing = createMentionSearch({
      search: () => Promise.reject(new Error("server down")),
    });
    failing.setQuery("boom");
    await vi.advanceTimersByTimeAsync(160);
    expect(failing.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Image gate + paste/pick chip production (stub clipboard, no jsdom).

describe("image attachments", () => {
  it("stub clipboard files pass the allowlist filter; images stage as data-URL chips", () => {
    const png = new File([new Uint8Array(8)], "shot.png", { type: "image/png" });
    const clip = new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" });
    const picked = imageFilesFrom({ files: [png, clip] } as unknown as DataTransfer);
    expect(picked).toEqual([png]);

    const controller = createAttachmentsController({ idgen: createIdgen() });
    const dataUrl = dataUrlOf(8, "image/png");
    const chip = attachmentFromImageData(
      { name: picked[0]?.name ?? "", mimeType: "image/png", dataUrl },
      "att-img",
    );
    const staged = controller.add({
      name: chip.name,
      mimeType: chip.mimeType,
      url: chip.url,
    });
    expect(staged.url).toBe(dataUrl);
    expect(controller.chips).toHaveLength(1);
  });

  it("QA FAILURE: 11 MiB rejected as `size` BEFORE staging; exact 10 MiB stages", () => {
    const controller = createAttachmentsController({ idgen: createIdgen() });
    const eleven = dataUrlOf(11 * 1024 * 1024, "image/png");
    expect(() =>
      controller.addImage({ name: "huge.png", mimeType: "image/png", dataUrl: eleven }),
    ).toThrowError(expect.objectContaining({ kind: "size", name: "ImageAttachmentError" }) as Error);
    expect(controller.chips).toEqual([]);

    const exact = dataUrlOf(MAX_IMAGE_BYTES, "image/png");
    const chip = controller.addImage({ name: "edge.png", mimeType: "image/png", dataUrl: exact });
    expect(controller.chips.map((entry) => entry.id)).toEqual([chip.id]);
  });

  it("format gate + boundary math mirror the host authority", () => {
    expect(() => attachmentFromImageData({ name: "v.mp4", mimeType: "video/mp4", dataUrl: dataUrlOf(4, "video/mp4") }, "x")).toThrowError(
      expect.objectContaining({ kind: "format" }) as Error,
    );
    for (const mime of IMAGE_MIME_ALLOWLIST) {
      expect(() => assertImageAllowed(mime, 4)).not.toThrow();
    }
    expect(dataUrlByteLength(dataUrlOf(1, "image/png"))).toBe(1);
    expect(dataUrlByteLength(dataUrlOf(2, "image/png"))).toBe(2);
    expect(dataUrlByteLength(dataUrlOf(3, "image/png"))).toBe(3);
    expect(() => dataUrlByteLength("bogus")).toThrowError(ImageAttachmentError);
  });
});

// ---------------------------------------------------------------------------
// Host push events + clear-on-send.

describe("host push contract", () => {
  it("attachments.add stages the pushed chip with its sensitive reason", () => {
    const events = createFakeEvents();
    const controller = createAttachmentsController({ events: events.source, idgen: createIdgen() });
    events.emit({
      type: ATTACHMENTS_ADD_EVENT,
      payload: {
        attachment: { name: ".env", mimeType: "text/plain", url: "file:///u/app/.env" },
        sensitive: "dotenv secrets file",
        source: "file",
      },
    });
    expect(controller.chips).toEqual([
      {
        id: "att-1",
        name: ".env",
        mimeType: "text/plain",
        url: "file:///u/app/.env",
        sensitive: "dotenv secrets file",
      },
    ]);
  });

  it("malformed pushes are dropped, and the busy transition clears staging", () => {
    const events = createFakeEvents();
    const controller = createAttachmentsController({ events: events.source, idgen: createIdgen() });
    events.emit({ type: ATTACHMENTS_ADD_EVENT, payload: { attachment: { name: 42 } } });
    expect(controller.chips).toEqual([]);

    controller.addPath("src/a.ts");
    expect(controller.chips).toHaveLength(1);
    events.emit({ type: "session.status", payload: { status: { type: "busy" } } });
    expect(controller.chips).toEqual([]);
  });

  it("clearOnBusy:false keeps staging through busy", () => {
    const events = createFakeEvents();
    const controller = createAttachmentsController({
      events: events.source,
      idgen: createIdgen(),
      clearOnBusy: false,
    });
    controller.addPath("src/a.ts");
    events.emit({ type: "session.status", payload: { status: { type: "busy" } } });
    expect(controller.chips).toHaveLength(1);
  });

  it("pins the event literal the host mirrors", () => {
    expect(ATTACHMENTS_ADD_EVENT).toBe("attachments.add");
  });
});

// ---------------------------------------------------------------------------
// Sensitive-path mirror matrix (identical expectations to the host suite).

describe("sensitive path mirror", () => {
  const MATRIX: ReadonlyArray<readonly [string, string | undefined]> = [
    ["/u/app/.env", "dotenv secrets file"],
    ["/u/app/.env.production", "dotenv secrets file"],
    ["C:\\certs\\server.PEM", "private key / certificate material"],
    ["~/.ssh/id_rsa", "SSH private key"],
    ["~/.ssh/id_ed25519", "SSH private key"],
    ["/u/gcp/credentials.json", "cloud credentials"],
    ["/u/app/README.md", undefined],
    ["/u/app/environment.ts", undefined],
  ];

  it("matches the host suite's pinned matrix exactly", () => {
    for (const [path, reason] of MATRIX) {
      expect(sensitivePathReason(path)).toBe(reason);
    }
  });

  it("chipFromPath flags risky picks and keeps server-relative urls verbatim", () => {
    const flagged = chipFromPath("secrets/.env", "id-1");
    expect(flagged.sensitive).toBe("dotenv secrets file");
    expect(flagged.url).toBe("secrets/.env");

    const absolute = chipFromPath("/u/src/index.ts", "id-2");
    expect(absolute.sensitive).toBeUndefined();
    expect(absolute.url).toBe("file:///u/src/index.ts");
    expect(absolute.name).toBe("index.ts");

    expect(urlFromServerPath("C:\\repo\\a file.ts")).toBe("file://C:/repo/a%20file.ts");
    expect(baseNameOfPath("/a/b/")).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// SSR rendering (renderToStaticMarkup; no effects run here).

function initFor(): InitPayload {
  return {
    locale: "en",
    strings: en,
    server: { url: "http://127.0.0.1:9", version: "0.0.0-mock" },
    capabilities: { fork: true, question: true, todo: true },
    settings: {},
  };
}

function renderWithApp(ui: ReactNode): string {
  const port: WebviewPort = {
    postMessage: () => undefined,
    onMessage: () => undefined,
  };
  const messenger = new WebviewMessenger(port);
  const init = initFor();
  return renderToStaticMarkup(
    <StringsProvider init={init}>
      <AppProvider init={init} messenger={messenger}>
        {ui}
      </AppProvider>
    </StringsProvider>,
  );
}

describe("SSR rows + banner", () => {
  it("palette rows render full paths in titles and basenames as labels", () => {
    const html = renderToStaticMarkup(
      <MentionPalette rows={["src/app.ts", "docs/notes.md"]} />,
    );
    expect(html).toContain('title="src/app.ts"');
    expect(html).toContain('title="docs/notes.md"');
    expect(html).toContain(">app.ts<");
    expect(html).toContain(">notes.md<");
  });

  it("the extras row renders the sensitive banner listing staged risky chips", () => {
    const controller: AttachmentsController = createAttachmentsController({ idgen: createIdgen() });
    controller.add({
      name: ".env",
      mimeType: "text/plain",
      url: "file:///u/app/.env",
      sensitive: "dotenv secrets file",
    });
    controller.addPath("src/ok.ts");
    const html = renderWithApp(<AttachmentsExtras controller={controller} />);
    expect(html).toContain("Sensitive files staged");
    expect(html).toContain(".env");
    expect(html).toContain("dotenv secrets file");
    expect(html).not.toContain("ok.ts");
    expect(html).toContain('type="file"');
  });

  it("without risky chips the extras row renders no banner copy", () => {
    const controller = createAttachmentsController({ idgen: createIdgen() });
    controller.addPath("src/ok.ts");
    const html = renderWithApp(<AttachmentsExtras controller={controller} />);
    expect(html).not.toContain("Sensitive files staged");
  });
});

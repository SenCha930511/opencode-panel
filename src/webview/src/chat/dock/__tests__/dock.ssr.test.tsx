// i18n-allow-literal — assertions match English fallback strings + verbatim
// fixture text (file paths, todo contents); they are fixtures, not display
// copy authored here.
/**
 * SessionDock SSR render suite (plan todo 18, node env — jsdom is not
 * installed). Assertions run in two DOM-free layers, mirroring todo-16's
 * cards.test.tsx:
 * - `react-dom/server` static markup for structure (rows, +adds/−dels
 *   counters, empty states, capability-hidden contract, collapsed shell);
 * - direct invocation through an element-tree walk to CLICK the row buttons
 *   against stubs (openDiff/openFile wiring) — the components themselves are
 *   hook-driven, so only the hook-free click surfaces are exercised.
 * Notice ordering (exactly one capability toast) lives in
 * ./dockStore.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { resetActiveSessionForTest, setActiveSession } from "../../activeSession.js";
import type { ChatEventSource, Unsubscribe } from "../../events.js";
import type { WebviewStateLike } from "../../draftStore.js";
import { DiffFileRow, DiffsPanel, SessionDock, TodosPanel, type DockActions } from "../sessionDock.js";
import { TodoPinnedList } from "../todoPinnedList.js";
import { DockStateStore, DockStore } from "../dockStore.js";
import { parseSessionDiffPayload, type DockDiffFileVM, type DockTodoVM } from "../dockTypes.js";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const SILENT_SOURCE: ChatEventSource = {
  subscribeEvent: (): Unsubscribe => () => undefined,
};

function todo(id: string, content: string, status = "pending"): DockTodoVM {
  return { id, content, status, priority: "high" };
}

function diff(file: string, additions: number, deletions: number): DockDiffFileVM {
  return { file, additions, deletions };
}

function fakeStateLike(initial?: unknown): WebviewStateLike {
  let state = initial;
  return {
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

function loadedStore(): DockStore {
  const store = new DockStore();
  store.applyEvent({
    type: "todos.sync",
    payload: { sessionId: "ses_1", todos: [todo("t1", "Replay scripted deltas", "in_progress"), todo("t2", "Complete assistant message", "completed")] },
  });
  store.applyEvent({
    type: "diffs.sync",
    payload: { sessionId: "ses_1", diffs: [diff("src/example.ts", 3, 2)] },
  });
  return store;
}

interface RenderDockOptions {
  readonly store?: DockStore;
  readonly open?: boolean;
  readonly todosEnabled?: boolean;
  readonly actions?: DockActions;
}

function renderDock(options: RenderDockOptions = {}): string {
  const stateLike = fakeStateLike(options.open === false ? { sessionDock: { open: false } } : undefined);
  return render(
    <SessionDock
      store={options.store ?? loadedStore()}
      stateStore={new DockStateStore(stateLike)}
      source={SILENT_SOURCE}
      {...(options.todosEnabled === undefined ? {} : { todosEnabled: options.todosEnabled })}
      {...(options.actions === undefined ? {} : { actions: options.actions })}
    />,
  );
}

// -- element-tree click walker (the row buttons are hook-free) --------------

interface FoundButton {
  readonly label: string;
  readonly marker: string | undefined;
  click(): void;
}

function flattenText(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return flattenText((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function collectButtons(node: unknown, found: FoundButton[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, found);
    return;
  }
  if (typeof node !== "object" || node === null || !("props" in node)) return;
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (element.type === "button") {
    const onClick = element.props.onClick;
    const marker =
      typeof element.props["data-diff-file"] === "string"
        ? `diff:${element.props["data-diff-file"] as string}`
        : typeof element.props["data-open-file"] === "string"
          ? `open:${element.props["data-open-file"] as string}`
          : undefined;
    found.push({
      label: flattenText(element.props.children),
      marker,
      click: () => {
        if (typeof onClick === "function") onClick();
      },
    });
    return;
  }
  collectButtons(element.props.children, found);
}

afterEach(() => {
  resetActiveSessionForTest();
});

describe("TodosPanel SSR", () => {
  it("renders rows with status dots and strikes completed items", () => {
    const html = render(
      <TodosPanel todos={[todo("t1", "in flight", "in_progress"), todo("t2", "done item", "completed")]} />,
    );
    expect(html).toContain("in flight");
    expect(html).toContain("done item");
    expect(html).toContain("bg-info");
    expect(html).toContain("bg-ok");
    expect(html).toContain("line-through");
  });

  it("renders the empty-state string", () => {
    expect(render(<TodosPanel todos={[]} />)).toContain("No todos yet");
  });
});

describe("DiffsPanel SSR", () => {
  it("renders file rows with colored +adds/−dels counters", () => {
    const html = render(
      <DiffsPanel diffs={[diff("src/example.ts", 3, 2)]} sessionId="ses_1" actions={{ openDiff: () => undefined, openFile: () => undefined }} />,
    );
    expect(html).toContain("src/example.ts");
    expect(html).toContain('<span class="shrink-0 text-ok">+3</span>');
    expect(html).toContain('<span class="shrink-0 text-err">−2</span>');
    expect(html).toContain('aria-label="Open diff"');
    expect(html).not.toContain('aria-label="Open file"');
  });

  it("renders the empty-state string", () => {
    expect(render(<DiffsPanel diffs={[]} sessionId="ses_1" actions={{ openDiff: () => undefined, openFile: () => undefined }} />)).toContain(
      "No file changes in this session",
    );
  });
});

describe("SessionDock SSR", () => {
  it("renders the active session's todos and diffs rows inside an expanded shell", () => {
    setActiveSession("ses_1");
    const html = renderDock();
    expect(html).toContain('data-oc-dock="session"');
    expect(html).toContain("Replay scripted deltas");
    expect(html).toContain("src/example.ts");
    expect(html).toContain("+3");
    expect(html).toContain("Todos");
    expect(html).toContain("File changes");
    expect(html).toContain('aria-expanded="true"');
  });

  it("shows both empty states when nothing has synced yet", () => {
    const html = renderDock({ store: new DockStore() });
    expect(html).toContain("No todos yet");
    expect(html).toContain("No file changes in this session");
  });

  it("hides entirely when the initial hasTodo capability bit is false", () => {
    expect(renderDock({ todosEnabled: false })).toBe("");
  });

  it("hides entirely once todos-unsupported latched (QA old-server path)", () => {
    const store = loadedStore();
    store.applyEvent({ type: "todos.sync", payload: { sessionId: "ses_1", unsupported: true } });
    expect(renderDock({ store })).toBe("");
  });

  it("hides only the diffs section when diffs-unsupported latched", () => {
    const store = loadedStore();
    store.applyEvent({ type: "diffs.sync", payload: { unsupported: true } });
    setActiveSession("ses_1");
    const html = renderDock({ store });
    expect(html).toContain("Replay scripted deltas");
    expect(html).not.toContain("src/example.ts");
    expect(html).not.toContain("No file changes in this session");
  });

  it("renders only the collapsed header when persisted closed", () => {
    setActiveSession("ses_1");
    const html = renderDock({ open: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Todos");
    expect(html).not.toContain("Replay scripted deltas");
    expect(html).not.toContain("src/example.ts");
  });

  it("wires the row's click to openDiff with the file argument (native diff, report P0-1)", () => {
    const openedDiffs: { readonly sessionId: string; readonly messageID?: string; readonly file?: string }[] = [];
    const openedFiles: string[] = [];
    const actions: DockActions = {
      openDiff: (input) => {
        openedDiffs.push(input);
      },
      openFile: (path) => {
        openedFiles.push(path);
      },
    };
    // Direct invocation: DiffFileRow is hook-free, so it can be called as a
    // plain function (never rendered through the hooks dispatcher).
    const tree = DiffFileRow({
      diff: diff("src/example.ts", 3, 2),
      sessionId: "ses_1",
      actions,
      openDiffLabel: "Open diff",
    });
    const buttons: FoundButton[] = [];
    collectButtons(tree, buttons);

    const openButton = buttons.find((button) => button.marker === "open:src/example.ts");
    expect(openButton?.label).toBe("src/example.ts");

    openButton?.click();
    expect(openedDiffs).toEqual([{ sessionId: "ses_1", file: "src/example.ts" }]);
    expect(openedFiles).toEqual([]);
  });
});

describe("TodoPinnedList SSR", () => {
  it("renders the active session's todos with status glyphs and the done counter", () => {
    setActiveSession("ses_1");
    const html = render(<TodoPinnedList store={loadedStore()} />);
    expect(html).toContain("data-oc-todo-pinned");
    expect(html).toContain("Replay scripted deltas");
    expect(html).toContain("Complete assistant message");
    // 1 of 2 rows is terminal (completed).
    expect(html).toContain("1/2");
    expect(html).toContain("✓");
    expect(html).toContain("▶");
    expect(html).toContain("line-through");
  });

  it("renders nothing without an active session, an empty list, or the unsupported latch", () => {
    // No active session: the strip must not leak another session's list.
    expect(render(<TodoPinnedList store={loadedStore()} />)).toBe("");

    setActiveSession("ses_1");
    expect(render(<TodoPinnedList store={new DockStore()} />)).toBe("");

    const latched = loadedStore();
    latched.applyEvent({ type: "todos.sync", payload: { sessionId: "ses_1", unsupported: true } });
    expect(render(<TodoPinnedList store={latched} />)).toBe("");
  });

  it("tracks the SHARED store live (one store, two surfaces contract)", () => {
    setActiveSession("ses_1");
    const store = new DockStore();
    expect(render(<TodoPinnedList store={store} />)).toBe("");
    store.applyEvent({
      type: "todo.updated",
      payload: { sessionID: "ses_1", todos: [todo("t9", "Ship the gate", "pending")] },
    });
    const html = render(<TodoPinnedList store={store} />);
    expect(html).toContain("Ship the gate");
    expect(html).toContain("○");
  });
});

describe("diff-row double-click dedupe (sweep E2)", () => {
  it("a rapid second click on the same row fires openDiff only once", () => {
    const openedDiffs: { sessionId: string; file: string }[] = [];
    const actions: DockActions = {
      openDiff: (input) => {
        openedDiffs.push(input as { sessionId: string; file: string });
      },
      openFile: () => undefined,
    };
    const tree = DiffFileRow({
      diff: diff("src/dedupe-case.ts", 1, 1),
      sessionId: "ses_dedupe",
      actions,
      openDiffLabel: "Open diff",
    });
    const buttons: FoundButton[] = [];
    collectButtons(tree as ReactElement, buttons);
    const openButton = buttons.find((button) => button.marker === "open:src/dedupe-case.ts");
    expect(openButton).toBeDefined();
    openButton?.click();
    openButton?.click();
    expect(openedDiffs).toEqual([{ sessionId: "ses_dedupe", file: "src/dedupe-case.ts" }]);
  });
});

describe("boundary parser drift tolerance (sweep E4)", () => {
  it("a single drifted diff row never sinks the whole list", () => {
    const parsed = parseSessionDiffPayload({
      sessionID: "ses_drift",
      diff: [
        { file: "a.ts", additions: 1, deletions: 0 },
        { file: "drifted.ts" },
        { file: "b.ts", additions: 2, deletions: 3 },
      ],
    });
    expect(parsed?.sessionID).toBe("ses_drift");
    expect(parsed?.diffs?.map((row) => row.file)).toEqual(["a.ts", "b.ts"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Listener } from "../config.js";
import {
  renderServerState,
  StatusBarController,
  statusBarMenuItems,
  type StatusBarItemLike,
  type StatusBarMenuItem,
  type StatusBarRenderModel,
} from "../statusBar.js";
import {
  ServerStartError,
  type ServerManagerState,
} from "../../server/serverLifecycle.js";

class FakeStateSource {
  state: ServerManagerState = { kind: "stopped" };
  private readonly listeners = new Set<Listener<ServerManagerState>>();

  readonly event = (listener: Listener<ServerManagerState>): { dispose(): void } => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(next: ServerManagerState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

class FakeItem implements StatusBarItemLike {
  readonly applied: StatusBarRenderModel[] = [];
  shown = 0;
  disposed = false;

  apply(model: StatusBarRenderModel): void {
    this.applied.push(model);
  }

  show(): void {
    this.shown += 1;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeMenu {
  seen: readonly StatusBarMenuItem[] | undefined;

  constructor(private readonly pickResult: StatusBarMenuItem | undefined) {}

  pick(items: readonly StatusBarMenuItem[]): Promise<StatusBarMenuItem | undefined> {
    this.seen = [...items];
    return Promise.resolve(this.pickResult);
  }
}

class FakeExecutor {
  readonly executed: string[] = [];

  execute(command: string): unknown {
    this.executed.push(command);
    return undefined;
  }
}

function makeController(menu: FakeMenu, executor: FakeExecutor) {
  const source = new FakeStateSource();
  const item = new FakeItem();
  const controller = new StatusBarController({
    getState: () => source.state,
    onDidChangeState: source.event,
    item,
    menu,
    commands: executor,
    t: (text) => text,
  });
  return { source, item, controller };
}

describe("renderServerState", () => {
  it("maps stopped to a gray circle-slash without port or tooltip", () => {
    // Given/When
    const model = renderServerState({ kind: "stopped" });
    // Then
    expect(model).toEqual<StatusBarRenderModel>({
      text: "$(circle-slash) OpenCode",
      colorToken: "descriptionForeground",
      tooltip: undefined,
    });
  });

  it("maps probing and stopping to a yellow spinning sync icon", () => {
    // Given/When/Then: both transitional states render identically
    expect(renderServerState({ kind: "probing", baseUrl: "http://127.0.0.1:4096" })).toEqual(
      renderServerState({ kind: "stopping" }),
    );
    expect(renderServerState({ kind: "stopping" })).toEqual<StatusBarRenderModel>({
      text: "$(sync~spin) OpenCode",
      colorToken: "charts.yellow",
      tooltip: undefined,
    });
  });

  it("maps managed to a green server-environment icon with the port", () => {
    // Given/When
    const model = renderServerState({ kind: "managed", baseUrl: "http://127.0.0.1:4096" });
    // Then
    expect(model.text).toBe("$(server-environment) OpenCode:4096");
    expect(model.colorToken).toBe("charts.green");
  });

  it("maps attached to a blue plug icon with the port", () => {
    // Given/When
    const model = renderServerState({ kind: "attached", baseUrl: "http://10.0.0.2:8080" });
    // Then
    expect(model.text).toBe("$(plug) OpenCode:8080");
    expect(model.colorToken).toBe("charts.blue");
  });

  it("omits the port suffix when the URL carries no explicit port", () => {
    // Given/When
    const model = renderServerState({ kind: "managed", baseUrl: "https://opencode.internal" });
    // Then
    expect(model.text).toBe("$(server-environment) OpenCode");
  });

  it("maps error to red and surfaces the failure text as tooltip", () => {
    // Given: an actionable start failure carrying no credential material
    const error = new ServerStartError({ kind: "binary-not-found", binaryPath: "/nope" });
    // When
    const model = renderServerState({ kind: "error", error });
    // Then
    expect(model.text).toBe("$(error) OpenCode");
    expect(model.colorToken).toBe("errorForeground");
    expect(model.tooltip).toBe(error.message);
  });
});

describe("statusBarMenuItems", () => {
  it("lists the six manifest commands in stable order, including openLogs", () => {
    // Given/When
    const items = statusBarMenuItems((text) => text);
    // Then
    expect(items.map((item) => item.command)).toEqual([
      "opencodePanel.startServer",
      "opencodePanel.stopServer",
      "opencodePanel.restartServer",
      "opencodePanel.openSettings",
      "opencodePanel.openTui",
      "opencodePanel.openLogs",
    ]);
  });

  it("routes every label through the injected l10n lookup", () => {
    // Given/When
    const items = statusBarMenuItems((text) => `L:${text}`);
    // Then: the t() mechanism was applied to every label
    expect(items.every((item) => item.label.startsWith("L:"))).toBe(true);
  });
});

describe("StatusBarController", () => {
  it("applies the current state on construction and shows the item", () => {
    // Given/When
    const { item } = makeController(new FakeMenu(undefined), new FakeExecutor());
    // Then: initial render is the stopped mapping, applied and shown
    expect(item.applied).toEqual([renderServerState({ kind: "stopped" })]);
    expect(item.shown).toBe(1);
  });

  it("re-renders on every manager state change", () => {
    // Given
    const { source, item } = makeController(new FakeMenu(undefined), new FakeExecutor());
    // When
    source.emit({ kind: "probing", baseUrl: "http://127.0.0.1:4096" });
    source.emit({ kind: "managed", baseUrl: "http://127.0.0.1:4096" });
    // Then
    expect(item.applied).toHaveLength(3);
    expect(item.applied[2]?.text).toBe("$(server-environment) OpenCode:4096");
  });

  it("executes the picked command, including the openLogs entry", async () => {
    // Given: a menu scripted to pick the openLogs item
    const executor = new FakeExecutor();
    const target = statusBarMenuItems((text) => text).find(
      (item) => item.command === "opencodePanel.openLogs",
    );
    if (target === undefined) throw new Error("openLogs menu entry missing");
    const { controller } = makeController(new FakeMenu(target), executor);
    // When
    await controller.showMenu();
    // Then
    expect(executor.executed).toEqual(["opencodePanel.openLogs"]);
  });

  it("executes nothing when the quickpick is dismissed", async () => {
    // Given
    const executor = new FakeExecutor();
    const { controller } = makeController(new FakeMenu(undefined), executor);
    // When
    await controller.showMenu();
    // Then
    expect(executor.executed).toEqual([]);
  });

  it("offers the localized menu items to the quickpick", async () => {
    // Given
    const menu = new FakeMenu(undefined);
    const { controller } = makeController(menu, new FakeExecutor());
    // When
    await controller.showMenu();
    // Then
    expect(menu.seen).toHaveLength(6);
  });

  it("unsubscribes and disposes the item on dispose", () => {
    // Given
    const { source, item, controller } = makeController(new FakeMenu(undefined), new FakeExecutor());
    // When
    controller.dispose();
    source.emit({ kind: "managed", baseUrl: "http://127.0.0.1:4096" });
    // Then: no listener left, item disposed, no further applications
    expect(source.listenerCount).toBe(0);
    expect(item.disposed).toBe(true);
    expect(item.applied).toHaveLength(1);
  });
});

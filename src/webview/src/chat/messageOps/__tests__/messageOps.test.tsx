// i18n-allow-literal — test fixtures/assertions carry fixture strings and
// English sentinel text; display copy lives behind t() in the components.
/**
 * Message-ops webview acceptance suite (plan todo 19) — node env, no jsdom:
 * pure logic + the confirm-gated controller + SSR markup assertions, with a
 * scripted host loopback for the wire-level stories:
 *
 * - the confirm dialog opens BEFORE any revert request crosses the wire
 *   (pending state set -> zero requests; confirm() -> exactly one revert
 *   with the verbatim ids; cancel() -> none) — the plan's hard QA rule;
 * - capability flags hide/show rows (explicit false hides, missing bits stay
 *   visible — the wire carries no revert/summarize/shell bits today);
 * - regenerate composes revert THEN resend, in order, and resends nothing
 *   when the revert fails (QA failure: no local removal);
 * - a 404-class host error maps to the unsupported (capability) reporter,
 *   a 500 to the raw error reporter;
 * - the session-menu model hides/show rows per availability and disables
 *   Export without a seam.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { StringsProvider } from "../../../../lib/i18n.js";
import { en } from "../../../../../shared/strings.js";
import { isRecord } from "../../../../../shared/protocol.js";
import type { MessageVM } from "../../types.js";
import {
  MessageActionsController,
  copyShareLink,
  requestRevert,
  requestSummarize,
  type MessageOpReporter,
  type RegenerateVerbs,
} from "../actions.js";
import {
  applyShellFlag,
  classifyMessageOpError,
  findLastUserText,
  resolveMessageOpAvailability,
  userTextOf,
  type MessageOpAvailability,
} from "../logic.js";
import {
  attachCapabilityFlags,
  getCapabilityFlags,
  resetCapabilityFlagsForTest,
} from "../../../mcp/capabilityFlags.js";
import { MCP_STATUS_EVENT } from "../../../mcp/constants.js";
import {
  MessageActionsMenuView,
  type ConfirmDialogViewProps,
} from "../MessageActionsMenu.js";
import { SessionMenuItems, sessionMenuModel } from "../sessionMenuRows.js";
import { WebviewMessenger, type WebviewPort } from "../../../../lib/messenger.js";

// ---------------------------------------------------------------------------
// Fixtures + scripted host loopback.

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <StringsProvider init={{ locale: "en", strings: en }}>{element}</StringsProvider>,
  );
}

function userMessage(id: string, text: string, inFlight = false): MessageVM {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    info: {},
    inFlight,
    parts: [{ kind: "text", id: `${id}:prt`, text }],
  };
}

function assistantMessage(id: string, text: string): MessageVM {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    info: {},
    inFlight: false,
    parts: [{ kind: "text", id: `${id}:prt`, text }],
  };
}

interface RecordedCall {
  readonly type: string;
  readonly payload: unknown;
}

/** In-memory todo-3 loopback: records requests; per-type error text script. */
class ScriptedHost {
  readonly calls: RecordedCall[] = [];
  private readonly failures = new Map<string, string>();
  private readonly contents = new Map<string, unknown>();

  failWith(type: string, errorText: string): void {
    this.failures.set(type, errorText);
  }
  respondWith(type: string, content: unknown): void {
    this.failures.delete(type);
    this.contents.set(type, content);
  }
  callsOf(type: string): RecordedCall[] {
    return this.calls.filter((call) => call.type === type);
  }

  protected receive(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.messageId !== "string" || typeof raw.type !== "string") {
      throw new Error("bad test envelope");
    }
    const { messageId, type, payload } = raw;
    this.calls.push({ type, payload });
    const failure = this.failures.get(type);
    const status = failure === undefined ? "success" : "error";
    const content = failure ?? this.contents.get(type) ?? null;
    this.deliver({
      type: "streamChunk",
      payload: { messageId, status, done: true, content },
    });
  }

  private deliver: (message: unknown) => void = () => {
    throw new Error("loopback not wired");
  };

  connect(): { readonly messenger: WebviewMessenger } {
    let listener: ((message: unknown) => void) | undefined;
    const port: WebviewPort = {
      postMessage: (message) => {
        this.receive(message);
      },
      onMessage: (registered) => {
        listener = registered;
      },
    };
    this.deliver = (message) => {
      if (listener === undefined) throw new Error("webview messenger not listening");
      listener(message);
    };
    return { messenger: new WebviewMessenger(port) };
  }
}

interface RecordingReporter extends MessageOpReporter {
  readonly unsupportedCount: number;
  readonly errors: string[];
}

function recordingReporter(): RecordingReporter {
  const state = { count: 0, errors: [] as string[] };
  return {
    get unsupportedCount() {
      return state.count;
    },
    errors: state.errors,
    unsupported() {
      state.count += 1;
    },
    error(message: string) {
      state.errors.push(message);
    },
  };
}

const SOME_MESSAGE = userMessage("msg_u", "fix the parser");

describe("logic", () => {
  it("availability: missing bits stay visible; explicit false hides rows", () => {
    expect(resolveMessageOpAvailability(undefined)).toEqual({
      revert: true,
      unrevert: true,
      summarize: true,
      shell: true,
    });
    expect(resolveMessageOpAvailability({ fork: true, question: true, todo: true })).toEqual({
      revert: true,
      unrevert: true,
      summarize: true,
      shell: true,
    });
    expect(resolveMessageOpAvailability({ shell: false }).shell).toBe(false);
    const revertHidden = resolveMessageOpAvailability({ revert: false });
    expect(revertHidden.revert).toBe(false);
    expect(revertHidden.unrevert).toBe(false);
    expect(revertHidden.summarize).toBe(true);
    expect(resolveMessageOpAvailability("garbage").shell).toBe(true);
  });

  it("userTextOf concatenates text parts and skips other kinds", () => {
    const message = userMessage("msg_a", "alpha");
    const augmented: MessageVM = {
      ...message,
      parts: [
        ...message.parts,
        { kind: "reasoning", id: "r1", text: "internal" },
        { kind: "text", id: "t2", text: " beta" },
      ],
    };
    expect(userTextOf(augmented)).toBe("alpha beta");
    expect(userTextOf(userMessage("msg_b", "   "))).toBeUndefined();
    expect(userTextOf(assistantMessage("msg_c", "reply"))).toBe("reply");
  });

  it("findLastUserText walks backwards, skips in-flight, and anchors inclusively", () => {
    const messages = [
      userMessage("msg_u1", "first ask"),
      assistantMessage("msg_a1", "first reply"),
      userMessage("msg_u2", "second ask"),
      userMessage("msg_u3", "draft in flight", true),
      assistantMessage("msg_a2", "second reply"),
    ];
    expect(findLastUserText(messages)).toEqual({ messageId: "msg_u2", text: "second ask" });
    // Inclusive anchor: an assistant anchor resolves its parent prompt.
    expect(findLastUserText(messages, "msg_a2")).toEqual({ messageId: "msg_u2", text: "second ask" });
    // A user anchor targets itself.
    expect(findLastUserText(messages, "msg_u1")).toEqual({ messageId: "msg_u1", text: "first ask" });
    expect(findLastUserText(messages, "msg_missing")).toBeUndefined();
    expect(findLastUserText([])).toBeUndefined();
  });

  it("classifyMessageOpError maps the unsupported name, everything else to other", () => {
    expect(classifyMessageOpError("MessageOpUnsupportedError: revert failed: x (HTTP 404)")).toBe(
      "unsupported",
    );
    expect(classifyMessageOpError("MessageOpError: revert failed: boom (HTTP 500)")).toBe("other");
    expect(classifyMessageOpError("SummarizeModelUnavailableError: no model")).toBe("other");
  });

  it("applyShellFlag: the shell row shows only when BOTH sources allow it", () => {
    const base = resolveMessageOpAvailability(undefined);
    // Plan hard rule: hasShell false/unknown (store at rest) hides shell.
    expect(applyShellFlag(base, false).shell).toBe(false);
    expect(applyShellFlag(base, true).shell).toBe(true);
    // The fold is AND, not OR: an init-hidden row cannot be re-shown.
    expect(applyShellFlag(resolveMessageOpAvailability({ shell: false }), true).shell).toBe(false);
    expect(applyShellFlag(base, false).summarize).toBe(true);
    expect(applyShellFlag(base, false).revert).toBe(true);
  });

  it("hasShell reaches the fold only through the todo-20 store (mcp.status push)", () => {
    resetCapabilityFlagsForTest();
    try {
      const base = resolveMessageOpAvailability({ fork: true, question: true, todo: true });
      // At rest the folded shell hides: the frozen init matrix has no shell bit.
      expect(applyShellFlag(base, getCapabilityFlags().shell).shell).toBe(false);

      let listener: (message: unknown) => void = () => {
        throw new Error("listener not registered");
      };
      const port: WebviewPort = {
        postMessage: () => {},
        onMessage: (registered) => {
          listener = registered;
        },
      };
      attachCapabilityFlags(new WebviewMessenger(port));
      listener({
        type: "event",
        payload: {
          type: MCP_STATUS_EVENT,
          payload: {
            servers: [],
            guards: {
              fork: true,
              question: true,
              todo: true,
              shell: true,
              omoDetected: false,
              omoMcpNote: false,
              oldServer: false,
            },
          },
        },
      });
      expect(applyShellFlag(base, getCapabilityFlags().shell).shell).toBe(true);
    } finally {
      resetCapabilityFlagsForTest();
    }
  });
});

describe("verbs + reporter mapping", () => {
  it("requestRevert posts the verbatim payload and folds 404 into unsupported", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const reporter = recordingReporter();

    const ok = await requestRevert(messenger, { id: "ses_1", messageID: "msg_x" }, reporter);
    expect(ok).toBe(true);
    expect(host.callsOf("revert")[0]?.payload).toEqual({ id: "ses_1", messageID: "msg_x" });

    host.failWith("revert", "MessageOpUnsupportedError: revert failed: nf (HTTP 404)");
    const rejected = await requestRevert(messenger, { id: "ses_1", messageID: "m" }, reporter);
    expect(rejected).toBe(false);
    expect(reporter.unsupportedCount).toBe(1);
    expect(reporter.errors).toHaveLength(0);

    host.failWith("revert", "MessageOpError: revert failed: boom (HTTP 500)");
    const serverError = await requestRevert(messenger, { id: "ses_1", messageID: "m" }, reporter);
    expect(serverError).toBe(false);
    expect(reporter.errors[0]).toBe("MessageOpError: revert failed: boom (HTTP 500)");
  });

  it("requestSummarize shares the same fold", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const reporter = recordingReporter();
    host.failWith("summarize", "SummarizeModelUnavailableError: summarize has no model: none");
    const ok = await requestSummarize(messenger, { id: "ses_1" }, reporter);
    expect(ok).toBe(false);
    expect(reporter.unsupportedCount).toBe(0);
    expect(reporter.errors[0]).toContain("SummarizeModelUnavailableError");
  });
});

describe("confirm-gated controller", () => {
  it("QA rule: the dialog opens before ANY revert request crosses the wire", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [],
      messenger,
      reporter: recordingReporter(),
    });

    controller.requestRevert("msg_target");
    expect(controller.getPending()).toEqual({ kind: "revert", messageId: "msg_target" });
    expect(host.callsOf("revert")).toHaveLength(0);

    const ok = await controller.confirm();
    expect(ok).toBe(true);
    expect(host.callsOf("revert")[0]?.payload).toEqual({ id: "ses_1", messageID: "msg_target" });
    expect(controller.getPending()).toBeNull();
  });

  it("cancel drops the intent without any wire call", () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [],
      messenger,
      reporter: recordingReporter(),
    });
    controller.requestRevert("msg_target");
    controller.cancel();
    expect(controller.getPending()).toBeNull();
    expect(host.callsOf("revert")).toHaveLength(0);
  });

  it("unrevert runs immediately (non-destructive, no gate)", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [],
      messenger,
      reporter: recordingReporter(),
    });
    const ok = await controller.unrevert();
    expect(ok).toBe(true);
    expect(host.callsOf("unrevert")).toHaveLength(1);
  });

  it("regenerate composes revert THEN resend in order over the wire", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [
        SOME_MESSAGE,
        assistantMessage("msg_a1", "a reply"),
        userMessage("msg_u2", "second ask"),
      ],
      messenger,
      reporter: recordingReporter(),
    });

    expect(controller.requestRegenerate()).toBe(true);
    expect(controller.getPending()).toEqual({
      kind: "regenerate",
      messageId: "msg_u2",
      text: "second ask",
    });
    expect(host.callsOf("revert")).toHaveLength(0);

    const ok = await controller.confirm();
    expect(ok).toBe(true);
    expect(host.callsOf("revert")[0]?.payload).toEqual({ id: "ses_1", messageID: "msg_u2" });
    const resend = host.callsOf("sendPrompt")[0]?.payload;
    expect(resend).toMatchObject({ sessionId: "ses_1", text: "second ask" });
    // Order pinned: revert strictly precedes the resend.
    const revertIndex = host.calls.findIndex((call) => call.type === "revert");
    const resendIndex = host.calls.findIndex((call) => call.type === "sendPrompt");
    expect(revertIndex).toBeGreaterThanOrEqual(0);
    expect(resendIndex).toBeGreaterThan(revertIndex);
  });

  it("QA failure: a failed revert resends nothing and removes nothing locally", async () => {
    const revertCalls: unknown[] = [];
    const resent: string[] = [];
    const verbs: RegenerateVerbs = {
      revert: (payload) => {
        revertCalls.push(payload);
        return Promise.resolve(false); // host 500 -> folded to false by the menu verb
      },
      sendText: (_sessionId, text) => {
        resent.push(text);
        return Promise.resolve(true);
      },
    };
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [SOME_MESSAGE],
      regenerateVerbs: verbs,
      messenger: new ScriptedHost().connect().messenger,
      reporter: recordingReporter(),
    });

    expect(controller.requestRegenerate()).toBe(true);
    const ok = await controller.confirm();
    expect(ok).toBe(false);
    expect(revertCalls).toHaveLength(1);
    expect(resent).toHaveLength(0);
  });

  it("requestRegenerate without a user text target is a no-op false", () => {
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [assistantMessage("msg_a1", "only assistants here")],
      messenger: new ScriptedHost().connect().messenger,
      reporter: recordingReporter(),
    });
    expect(controller.requestRegenerate()).toBe(false);
    expect(controller.getPending()).toBeNull();
  });

  it("onReverted fires with the target id only after a proven-successful revert", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const reverted: string[] = [];
    { // success path
      const controller = new MessageActionsController({
        sessionId: () => "ses_1",
        messages: () => [],
        messenger,
        reporter: recordingReporter(),
        onReverted: (messageId) => reverted.push(messageId),
      });
      controller.requestRevert("msg_target");
      expect(await controller.confirm()).toBe(true);
    }
    expect(reverted).toEqual(["msg_target"]);

    host.failWith("revert", "Error: blown (HTTP 500)");
    { // failure path: the marker callback must NOT fire
      const controller = new MessageActionsController({
        sessionId: () => "ses_1",
        messages: () => [],
        messenger,
        reporter: recordingReporter(),
        onReverted: (messageId) => reverted.push(messageId),
      });
      controller.requestRevert("msg_again");
      expect(await controller.confirm()).toBe(false);
    }
    expect(reverted).toEqual(["msg_target"]);
  });

  it("regenerate success also reports the revert point; failure does not", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    const reverted: string[] = [];
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [SOME_MESSAGE],
      messenger,
      reporter: recordingReporter(),
      onReverted: (messageId) => reverted.push(messageId),
    });
    expect(controller.requestRegenerate()).toBe(true);
    expect(await controller.confirm()).toBe(true);
    expect(reverted).toEqual(["msg_u"]);
  });

  it("onUnreverted fires only after a proven-successful unrevert", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    let restored = 0;
    const controller = new MessageActionsController({
      sessionId: () => "ses_1",
      messages: () => [],
      messenger,
      reporter: recordingReporter(),
      onUnreverted: () => {
        restored += 1;
      },
    });
    expect(await controller.unrevert()).toBe(true);
    expect(restored).toBe(1);
    host.failWith("unrevert", "Error: blown (HTTP 500)");
    expect(await controller.unrevert()).toBe(false);
    expect(restored).toBe(1);
  });
});

describe("share copy", () => {
  it("copies the share url, surfaces share failures, and swallows clipboard blocks", async () => {
    const host = new ScriptedHost();
    const { messenger } = host.connect();
    host.respondWith("share", { url: "https://mock.opncd.invalid/s/ses_1" });
    const clipboardCalls: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        clipboardCalls.push(text);
        return Promise.resolve();
      },
    };

    const copied = await copyShareLink(messenger, "ses_1", clipboard);
    expect(copied).toEqual({ kind: "copied" });
    expect(clipboardCalls).toEqual(["https://mock.opncd.invalid/s/ses_1"]);

    host.failWith("share", "SessionOperationError: session share failed: nf (HTTP 404)");
    const failed = await copyShareLink(messenger, "ses_1", clipboard);
    expect(failed.kind).toBe("share-failed");
    if (failed.kind !== "share-failed") throw new Error("expected share-failed");
    expect(failed.message).toContain("HTTP 404");

    host.respondWith("share", { url: "https://mock.opncd.invalid/s/ses_1" });
    const blocked = await copyShareLink(messenger, "ses_1", {
      writeText: () => Promise.reject(new Error("denied")),
    });
    expect(blocked).toEqual({ kind: "clipboard-failed" });
  });
});

// ---------------------------------------------------------------------------
// SSR markup assertions.

function menuController(over?: {
  readonly messages?: readonly MessageVM[];
  readonly host?: ScriptedHost;
}): { readonly controller: MessageActionsController; readonly host: ScriptedHost } {
  const host = over?.host ?? new ScriptedHost();
  const controller = new MessageActionsController({
    sessionId: () => "ses_1",
    messages: () => over?.messages ?? [SOME_MESSAGE],
    messenger: host.connect().messenger,
    reporter: recordingReporter(),
  });
  return { controller, host };
}

function StubConfirmDialog(props: ConfirmDialogViewProps): ReactNode {
  return (
    <div data-testid="confirm-dialog">
      {`${props.copy} [${props.cancelLabel}|${props.confirmLabel}]`}
    </div>
  );
}

describe("MessageActionsMenuView (SSR)", () => {
  const allVisible: MessageOpAvailability = {
    revert: true,
    unrevert: true,
    summarize: true,
    shell: true,
  };

  it("renders revert / unrevert / regenerate rows when available", () => {
    const { controller } = menuController();
    const html = render(
      <MessageActionsMenuView
        message={assistantMessage("msg_a1", "reply")}
        availability={allVisible}
        controller={controller}
        ConfirmDialog={StubConfirmDialog}
      />,
    );
    expect(html).toContain(en["messages.revert"]);
    expect(html).toContain(en["messages.unrevert"]);
    expect(html).toContain(en["messages.regenerate"]);
  });

  it("hides rows per capability flags and hides regenerate without a user text", () => {
    const hidden = menuController();
    const hiddenHtml = render(
      <MessageActionsMenuView
        message={assistantMessage("msg_a1", "reply")}
        availability={{ revert: false, unrevert: false, summarize: true, shell: true }}
        controller={hidden.controller}
        ConfirmDialog={StubConfirmDialog}
      />,
    );
    expect(hiddenHtml).not.toContain(en["messages.revert"]);
    expect(hiddenHtml).not.toContain(en["messages.unrevert"]);
    expect(hiddenHtml).not.toContain(en["messages.regenerate"]);

    const noTarget = menuController({ messages: [] });
    const noTargetHtml = render(
      <MessageActionsMenuView
        message={assistantMessage("msg_a1", "reply")}
        availability={allVisible}
        controller={noTarget.controller}
        ConfirmDialog={StubConfirmDialog}
      />,
    );
    expect(noTargetHtml).toContain(en["messages.revert"]);
    expect(noTargetHtml).not.toContain(en["messages.regenerate"]);
  });

  it("opens the confirm dialog from the gate state and wires confirm/cancel copy", () => {
    const { controller } = menuController();
    controller.requestRevert("msg_target");
    const html = render(
      <MessageActionsMenuView
        message={assistantMessage("msg_a1", "reply")}
        availability={allVisible}
        controller={controller}
        ConfirmDialog={StubConfirmDialog}
      />,
    );
    expect(html).toContain('data-testid="confirm-dialog"');
    expect(html).toContain(en["messages.revertConfirm"]);
    expect(html).toContain(en["common.confirm"]);
    expect(html).toContain(en["common.cancel"]);
  });

  it("no dialog markup while nothing is pending", () => {
    const { controller } = menuController();
    const html = render(
      <MessageActionsMenuView
        message={assistantMessage("msg_a1", "reply")}
        availability={allVisible}
        controller={controller}
        ConfirmDialog={StubConfirmDialog}
      />,
    );
    expect(html).not.toContain('data-testid="confirm-dialog"');
  });
});

describe("session menu (model + SSR items)", () => {
  const available: MessageOpAvailability = {
    revert: true,
    unrevert: true,
    summarize: true,
    shell: true,
  };

  it("model: capability flags and session presence drive the rows", () => {
    const full = sessionMenuModel({ availability: available, hasSession: true, hasExport: false });
    expect(full).toEqual({
      summarize: true,
      shell: true,
      export: { visible: true, enabled: false },
      share: true,
    });
    expect(sessionMenuModel({ availability: available, hasSession: false, hasExport: true })).toEqual({
      summarize: false,
      shell: false,
      export: { visible: true, enabled: false },
      share: false,
    });
    const oldServerish = sessionMenuModel({
      availability: { revert: false, unrevert: false, summarize: false, shell: false },
      hasSession: true,
      hasExport: true,
    });
    expect(oldServerish.summarize).toBe(false);
    expect(oldServerish.shell).toBe(false);
    expect(oldServerish.export.enabled).toBe(true);
  });

  it("SSR: items render per model and Export is disabled without the seam", () => {
    const labels = {
      summarize: en["messages.summarize"],
      shell: en["messages.shell"],
      export: en["messages.export"],
      share: en["sessions.share"],
    };
    const html = render(
      <DropdownMenu.Root open modal={false}>
        <DropdownMenu.Content forceMount>
          <SessionMenuItems
            model={sessionMenuModel({ availability: available, hasSession: true, hasExport: false })}
            labels={labels}
            onSelect={() => undefined}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    expect(html).toContain(en["messages.summarize"]);
    expect(html).toContain(en["messages.shell"]);
    expect(html).toContain(en["messages.export"]);
    expect(html).toContain(en["sessions.share"]);
    expect(html).toContain('aria-disabled="true"');
  });

  it("SSR: hidden rows stay out (old-server capability shape)", () => {
    const labels = {
      summarize: en["messages.summarize"],
      shell: en["messages.shell"],
      export: en["messages.export"],
      share: en["sessions.share"],
    };
    const html = render(
      <DropdownMenu.Root open modal={false}>
        <DropdownMenu.Content forceMount>
          <SessionMenuItems
            model={sessionMenuModel({
              availability: { revert: false, unrevert: false, summarize: false, shell: false },
              hasSession: true,
              hasExport: true,
            })}
            labels={labels}
            onSelect={() => undefined}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    expect(html).not.toContain(en["messages.summarize"]);
    expect(html).not.toContain(en["messages.shell"]);
    expect(html).toContain(en["messages.export"]);
    expect(html).toContain(en["sessions.share"]);
  });
});

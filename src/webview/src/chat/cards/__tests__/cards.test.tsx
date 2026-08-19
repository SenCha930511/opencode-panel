// i18n-allow-literal — assertions match English fallback strings + verbatim
// mock payload text; they are fixtures, not display copy authored here.
/**
 * Permission/Question card SSR render suite (plan todo 16, node env).
 *
 * jsdom/@testing-library/react are NOT installed (npm installs are
 * forbidden), so assertions run in two DOM-free layers:
 * - `react-dom/server` static markup for structure (labels, disabled
 *   contract, expired state, dock badge);
 * - direct invocation of the HOOK-FREE `PermissionReplyButtons` + an element
 *   tree walk to CLICK every button against stubs — the "buttons wired to
 *   stubs" acceptance without a renderer.
 * The reply-to-wire behavior beyond the click lives in
 * ./pendingRequests.test.ts (controller suite).
 */

import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { resetActiveSessionForTest, setActiveSession } from "../../activeSession.js";
import { ChatCardsDock } from "../ChatCardsDock.js";
import { PermissionCard, PermissionReplyButtons } from "../PermissionCard.js";
import { QuestionCard } from "../QuestionCard.js";
import { PendingRequestsStore } from "../pendingRequests.js";
import type { PermissionCardVM, QuestionCardVM } from "../cardTypes.js";

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function permissionCard(status: PermissionCardVM["status"]): PermissionCardVM {
  return {
    kind: "permission",
    sessionId: "ses_1",
    requestId: "per_1",
    permission: "bash",
    patterns: ["ls -la"],
    purpose: "ls -la",
    status,
  };
}

function questionCard(status: QuestionCardVM["status"]): QuestionCardVM {
  return {
    kind: "question",
    sessionId: "ses_1",
    requestId: "qst_1",
    questions: [
      {
        question: "Which variant should I build?",
        header: "Variant",
        options: [
          { label: "minimal", description: "Smallest working version" },
          { label: "full", description: "All features" },
        ],
        multiple: false,
      },
    ],
    status,
  };
}

// -- element-tree click walker (PermissionReplyButtons is hook-free) ---------

interface FoundButton {
  readonly label: string;
  readonly disabled: boolean;
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
  const onClick = element.props.onClick;
  if (element.type === "button") {
    found.push({
      label: flattenText(element.props.children),
      disabled: element.props.disabled === true,
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

describe("PermissionCard SSR", () => {
  it("renders title, verbatim tool name, purpose and all three reply buttons", () => {
    const html = render(
      <PermissionCard card={permissionCard("pending")} onReply={() => undefined} onDismiss={() => undefined} />,
    );
    expect(html).toContain("Permission required");
    expect(html).toContain("bash");
    expect(html).toContain("ls -la");
    expect(html).toContain("Allow once");
    expect(html).toContain("Always allow");
    expect(html).toContain("Reject");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("This permission request has expired");
  });

  it("replying state disables every button (optimistic disable)", () => {
    const html = render(
      <PermissionCard card={permissionCard("replying")} onReply={() => undefined} onDismiss={() => undefined} />,
    );
    expect(html).toContain("Allow once");
    expect(html).toContain('disabled=""');
  });

  it("expired state shows the expired note and removes the reply buttons", () => {
    const html = render(
      <PermissionCard card={permissionCard("expired")} onReply={() => undefined} onDismiss={() => undefined} />,
    );
    expect(html).toContain("This permission request has expired");
    expect(html).not.toContain("Allow once");
    expect(html).not.toContain("Always allow");
    expect(html).toContain("Close");
  });
});

describe("PermissionReplyButtons wiring (button clicks against stubs)", () => {
  it("each button fires onReply with exactly its wire response value", () => {
    const fired: string[] = [];
    const tree = PermissionReplyButtons({
      busy: false,
      labels: { once: "Allow once", always: "Always allow", reject: "Reject" },
      onReply: (response) => fired.push(response),
    });
    const buttons: FoundButton[] = [];
    collectButtons(tree, buttons);
    expect(buttons.map((button) => button.label)).toEqual([
      "Allow once",
      "Always allow",
      "Reject",
    ]);
    for (const button of buttons) button.click();
    expect(fired).toEqual(["once", "always", "reject"]);
  });

  it("busy state marks all three buttons disabled", () => {
    const tree = PermissionReplyButtons({
      busy: true,
      labels: { once: "o", always: "a", reject: "r" },
      onReply: () => undefined,
    });
    const buttons: FoundButton[] = [];
    collectButtons(tree, buttons);
    expect(buttons.length).toBe(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});

describe("QuestionCard SSR", () => {
  it("renders the question payload as data: header, question, option chips, submit/cancel", () => {
    const html = render(
      <QuestionCard card={questionCard("pending")} onSubmit={() => undefined} onDismiss={() => undefined} />,
    );
    expect(html).toContain("opencode is asking a question");
    expect(html).toContain("Variant");
    expect(html).toContain("Which variant should I build?");
    expect(html).toContain("minimal");
    expect(html).toContain("full");
    expect(html).toContain("Submit answer");
    expect(html).toContain("Cancel");
    // Nothing answered yet: submit is disabled until every question has one.
    expect(html).toContain('disabled=""');
  });

  it("a question without options renders a free-form input", () => {
    const card: QuestionCardVM = {
      kind: "question",
      sessionId: "ses_1",
      requestId: "qst_2",
      questions: [{ question: "What should I name it?", header: undefined, options: [], multiple: false }],
      status: "pending",
    };
    const html = render(<QuestionCard card={card} onSubmit={() => undefined} onDismiss={() => undefined} />);
    expect(html).toContain("<input");
    expect(html).toContain("What should I name it?");
  });

  it("expired state shows the shared expired note with a close affordance", () => {
    const html = render(
      <QuestionCard card={questionCard("expired")} onSubmit={() => undefined} onDismiss={() => undefined} />,
    );
    expect(html).toContain("This permission request has expired");
    expect(html).toContain("Close");
    expect(html).not.toContain("Submit answer");
  });
});

describe("ChatCardsDock SSR", () => {
  it("renders the active session's cards plus the cross-session queue badge", () => {
    const store = new PendingRequestsStore();
    store.applyEvent({
      type: "permission.asked",
      payload: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["ls -la"], metadata: {}, always: [] },
    });
    store.applyEvent({
      type: "permission.asked",
      payload: { id: "per_2", sessionID: "ses_other", permission: "edit", patterns: [], metadata: {} },
    });
    store.applyEvent({
      type: "permission.asked",
      payload: { id: "per_3", sessionID: "ses_other", permission: "webfetch", patterns: [], metadata: {} },
    });
    setActiveSession("ses_1");
    const html = render(<ChatCardsDock store={store} questionsEnabled={true} />);
    expect(html).toContain("bash");
    // The badge counts the two OTHER sessions' actionable requests.
    expect(html).toContain(">2</span>");
    // Other sessions' cards are never rendered into this view.
    expect(html).not.toContain(">edit<");
    expect(html).not.toContain("webfetch");
  });

  it("renders nothing when there are no cards and no badge", () => {
    setActiveSession("ses_1");
    const store = new PendingRequestsStore();
    const html = render(<ChatCardsDock store={store} questionsEnabled={true} />);
    expect(html).toBe("");
  });

  it("question cards are absent entirely when the store latched unsupported", () => {
    const store = new PendingRequestsStore();
    setActiveSession("ses_1");
    store.setQuestionsEnabled(false);
    store.applyEvent({
      type: "question.asked",
      payload: {
        id: "qst_1",
        sessionID: "ses_1",
        questions: [{ question: "Which variant should I build?", options: [{ label: "minimal" }] }],
      },
    });
    const html = render(<ChatCardsDock store={store} questionsEnabled={false} />);
    expect(html).toBe("");
  });
});

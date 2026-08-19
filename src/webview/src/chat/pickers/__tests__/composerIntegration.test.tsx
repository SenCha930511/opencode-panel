// i18n-allow-literal — test fixtures/assertions carry literal wire data.
/**
 * Composer-integration SSR suite (plan todo 15): the T14 hand-off hook
 * produces the ChatDock `composer` prop slice — extras row plus the
 * QA-correct agent/model fields (empty agent list => `agent` omitted even
 * when a selection exists).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import type { InitPayload } from "../../../../../shared/protocol.js";
import { WebviewMessenger, type WebviewPort } from "../../../../lib/messenger.js";
import { AppProvider } from "../../../app/context.js";
import { resetActiveSessionForTest, setActiveSession } from "../../activeSession.js";
import {
  configureComposerPersistence,
  resetComposerStateForTest,
  setAgentSelection,
} from "../../composerState.js";
import { attachCapabilityStore, resetCapabilityStoreForTest } from "../capabilityStore.js";
import { useComposerPickers } from "../composerIntegration.js";

const INIT: InitPayload = {
  locale: "en",
  strings: {},
  server: { url: "", version: null },
  capabilities: { fork: true, question: true, todo: true },
  settings: {},
};

function fakeMessenger(): { readonly messenger: WebviewMessenger; readonly push: (m: unknown) => void } {
  let listener: (message: unknown) => void = () => {};
  const port: WebviewPort = {
    postMessage: () => {},
    onMessage: (registered) => {
      listener = registered;
    },
  };
  return {
    messenger: new WebviewMessenger(port),
    push: (message) => {
      listener(message);
    },
  };
}

function pushSnapshot(
  push: (message: unknown) => void,
  snapshot: Record<string, unknown>,
): void {
  push({ type: "event", payload: { type: "capabilities.refresh", payload: snapshot } });
}

function Probe(): ReactNode {
  const props = useComposerPickers();
  return (
    <div
      {...(props.agent === undefined ? {} : { "data-agent": props.agent })}
      {...(props.model === undefined ? {} : { "data-model": props.model })}
    >
      {props.extras}
    </div>
  );
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const FULL_SNAPSHOT = {
  agents: [
    { name: "build", mode: "primary", builtIn: true },
    { name: "sisyphus", mode: "primary", builtIn: false },
  ],
  commands: [{ name: "help", description: "Show help" }],
  providers: [
    {
      id: "mock-provider",
      name: "Mock Provider",
      models: [{ id: "mock-large", name: "Mock Large" }],
    },
  ],
  defaultModels: { "mock-provider": "mock-large" },
  defaultModel: "mock-provider/mock-large",
};

beforeEach(() => {
  resetCapabilityStoreForTest();
  resetComposerStateForTest();
  resetActiveSessionForTest();
  configureComposerPersistence(undefined);
});

describe("useComposerPickers", () => {
  it("hand off the ChatDock prop slice: selections + resolved default model + extras row", () => {
    const fake = fakeMessenger();
    // SSR never runs effects, so the hook's attach-on-mount does not fire;
    // production mounts attach the same store (idempotent per messenger).
    attachCapabilityStore(fake.messenger);
    pushSnapshot(fake.push, FULL_SNAPSHOT);
    setActiveSession("ses_1");
    setAgentSelection("ses_1", "sisyphus");

    const html = render(
      <AppProvider init={INIT} messenger={fake.messenger}>
        <Probe />
      </AppProvider>,
    );
    expect(html).toContain('data-agent="sisyphus"');
    expect(html).toContain('data-model="mock-provider/mock-large"');
    // The extras row renders the same selection on the picker trigger.
    expect(html).toContain(">sisyphus</span>");
  });

  it("QA failure: empty agent list omits agent from the hand-off and hides the agent picker", () => {
    const fake = fakeMessenger();
    attachCapabilityStore(fake.messenger);
    pushSnapshot(fake.push, { ...FULL_SNAPSHOT, agents: [] });
    setActiveSession("ses_1");
    setAgentSelection("ses_1", "sisyphus");

    const html = render(
      <AppProvider init={INIT} messenger={fake.messenger}>
        <Probe />
      </AppProvider>,
    );
    expect(html).not.toContain("data-agent=");
    expect(html).not.toContain("Select agent");
    // The model picker still resolves the server default.
    expect(html).toContain('data-model="mock-provider/mock-large"');
  });
});

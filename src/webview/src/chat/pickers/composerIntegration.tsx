/**
 * Todo-15 -> todo-14 composer hand-off (documented glue; no T14 file is
 * edited). The Composer ships two extension points for this todo:
 * `extras` (ReactNode row rendered above the input row) and the controlled
 * `agent` / `model` props (forwarded onto the todo-3 sendPrompt payload
 * verbatim). {@link useComposerPickers} returns exactly that prop slice.
 *
 * INTEGRATION (verbatim, for whoever mounts ChatDock):
 *   function ChatSection(props: ChatDockProps): ReactNode {
 *     const pickers = useComposerPickers();
 *     return <ChatDock {...props} composer={pickers} />;
 *   }
 *   // bootstrap: slots.chat = <ChatSection />
 * {@link ChatSection} below IS that glue, ready to mount.
 *
 * SELECTION SEMANTICS: agent/model come from chat/composerState.ts
 * `buildPromptExtras` — the QA omission rule (empty agent list => `agent`
 * never reaches the payload) is therefore enforced HERE as well as in any
 * direct buildPromptExtras consumer. The hooks read the todo-13 active
 * session themselves; ChatPickers (inside `extras`) renders the same
 * selection on its triggers, so the visible value and the payload value can
 * never drift apart.
 *
 * SLASH PALETTE PLACEMENT: anchored inside the Composer itself (the only
 * owner of the live textarea text) — mounted in a relative wrapper above the
 * textarea with `text={text}`, `onAccepted` clearing the consumed command
 * text, and the composer's keydown routed through the palette while it is
 * open (Enter accepts, arrows move, Escape dismisses). The component lives
 * in ./CommandPalette.tsx; the CANONICAL trigger flow is: type "/" ->
 * palette lists commands -> click/Enter -> runCommand.
 */

import { useEffect, type ReactNode } from "react";
import { useApp } from "../../app/context.js";
import { useActiveSession } from "../activeSession.js";
import { ChatDock, type ChatDockProps } from "../Composer.js";
import { buildPromptExtras, usePickerSelection } from "../composerState.js";
import type { MessageStore } from "../messageStore.js";
import { attachCapabilityStore, useCapabilitySnapshot } from "./capabilityStore.js";
import { ChatPickers } from "./ChatPickers.js";

/** The exact `composer` prop slice ChatDock forwards into `<Composer/>`. */
export interface ComposerPickerProps {
  readonly extras: ReactNode;
  readonly agent?: string;
  readonly model?: string;
}

export function useComposerPickers(store?: MessageStore): ComposerPickerProps {
  const { messenger } = useApp();
  const sessionId = useActiveSession();
  const snapshot = useCapabilitySnapshot();
  const selection = usePickerSelection(sessionId ?? "");

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  if (snapshot === undefined) {
    return { extras: <ChatPickers {...(store === undefined ? {} : { store })} /> };
  }
  const selected = buildPromptExtras(sessionId ?? "", snapshot);
  return {
    extras: <ChatPickers {...(store === undefined ? {} : { store })} />,
    ...(selected.agent === undefined ? {} : { agent: selected.agent }),
    ...(selected.model === undefined ? {} : { model: selected.model }),
  };
}

/** Ready-made slots.chat mount wiring the todo-15 pickers into ChatDock. */
export function ChatSection(props: ChatDockProps): ReactNode {
  const pickers = useComposerPickers();
  return <ChatDock {...props} composer={pickers} />;
}

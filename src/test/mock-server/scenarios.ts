/**
 * Replay engine: drives a session from busy to idle through the active scenario
 * script (replays.ts), emitting the SSE lifecycle the plan consumes
 * (session.status → deltas → message.updated → session.idle).
 *
 * `POST .../prompt_async` fires the replay in the background (204 immediately);
 * `POST .../message` awaits `done` and returns the completed assistant message.
 */
import type { BusEvent, MessageWithParts, MockPart } from "./types.js";
import type { MockState, SessionRecord } from "./state.js";
import { createAssistantMessage, createUserMessage } from "./state.js";
import { replayByScenario } from "./replays.js";
import type { ReplayContext } from "./replays.js";

export interface ReplayHandle {
  /** Finalized assistant message with parts (sync POST /message awaits this). */
  done: Promise<MessageWithParts>;
}

export function runReplay(
  state: MockState,
  session: SessionRecord,
  emit: (event: Omit<BusEvent, "id">) => void,
): ReplayHandle {
  const user = createUserMessage(state, session.info.id);
  const assistant = createAssistantMessage(state, session.info.id, user.id);
  const parts: MockPart[] = [];
  session.status = "busy";
  session.messages.push({ info: user, parts: [] });
  emit({ type: "session.status", properties: { sessionID: session.info.id, status: { type: "busy" } } });
  emit({ type: "message.updated", properties: { info: user } });

  const ctx: ReplayContext = {
    state,
    session,
    user,
    assistant,
    emit: (type, properties) => emit({ type, properties }),
    addPart: (part) => parts.push(part),
    newPartId: () => state.partId(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    aborted: () => state.abortRequested.has(session.info.id),
  };

  const done = replayByScenario[state.scenario](ctx)
    .catch((error: unknown) => {
      assistant.error = {
        name: "UnknownError",
        data: { message: error instanceof Error ? error.message : String(error) },
      };
    })
    .then(() => {
      const now = state.now();
      assistant.time.completed = now;
      if (!assistant.error) assistant.finish = "stop";
      const text = parts
        .filter((p): p is Extract<MockPart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");
      assistant.tokens.output = Math.ceil(text.length / 4);
      assistant.tokens.input = 12;
      session.messages.push({ info: assistant, parts });
      session.info.time.updated = now;
      session.status = "idle";
      state.abortRequested.delete(session.info.id);
      emit({ type: "message.updated", properties: { info: assistant } });
      emit({ type: "session.updated", properties: { info: session.info } });
      emit({ type: "session.status", properties: { sessionID: session.info.id, status: { type: "idle" } } });
      emit({ type: "session.idle", properties: { sessionID: session.info.id } });
    })
    .then((): MessageWithParts => ({ info: assistant, parts }));

  return { done };
}

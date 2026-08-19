/**
 * Composer input state (plan todo 15, webview side): the per-session agent /
 * model picker selections the composer attaches to outgoing prompts.
 *
 * T14 CONSUMPTION CONTRACT (binding): T14's composer reads
 * {@link buildPromptExtras}(sessionId, snapshot) when assembling the todo-3
 * `sendPrompt` payload and spreads the result — the frozen protocol carries
 * `agent?: string` and `model?: string` ("provider/model"; the host's todo-14
 * pipeline splits it at the FIRST "/" — see src/host/handlers/capabilityInfo.ts
 * `splitModelId`). The QA failure rule lives HERE, not in T14: an empty
 * `snapshot.agents` list (old-server scenario) means the agent dropdown is
 * hidden and buildPromptExtras OMITS `agent` even if a selection exists
 * (asserted in pickers/__tests__). `model` passes through whenever a
 * selection or a server default resolved one (see pickers/logic.ts
 * `resolveInitialModel`).
 *
 * STORAGE: selections key off `sessionId` (todo-15: "selection persisted
 * per session"), in an immutable Record mirror so useSyncExternalStore
 * snapshots are referentially stable. Persistence reuses the todo-12
 * `getWebviewState()` seam via {@link ComposerPersistence} with a namespaced
 * `pickers` sub-key, shallow-merged into whatever other stores wrote (the
 * todo-12 sessions store owns its sibling key). `vscode.setState` replaces
 * the WHOLE state, so the two stores are last-writer-wins across webview
 * reloads until a protocol memento key lands — the same documented gap
 * todo-12 recorded in sessions/persistence.ts and host/handlers/sync.ts;
 * persistence here is a best-effort convenience, never correctness.
 */

import { useSyncExternalStore } from "react";
import { isRecord } from "../../../shared/protocol.js";
import { getWebviewState } from "../../lib/messenger.js";
import type { AgentEntry, CapabilitySnapshot } from "./pickers/constants.js";
import { resolveInitialModel } from "./pickers/logic.js";

// ---------------------------------------------------------------------------
// Selection model.

export interface PickerSelection {
  readonly agent?: string;
  readonly model?: string;
}

type SelectionsBySession = Readonly<Record<string, PickerSelection>>;

const PERSIST_KEY = "pickers";

/** Sync persistence seam (node tests use an in-memory fake). */
export interface ComposerPersistence {
  load(): SelectionsBySession | undefined;
  save(selections: SelectionsBySession): void;
}

function isSelection(value: unknown): value is PickerSelection {
  if (!isRecord(value)) return false;
  if (value.agent !== undefined && typeof value.agent !== "string") return false;
  return value.model === undefined || typeof value.model === "string";
}

function isSelectionsBySession(value: unknown): value is SelectionsBySession {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isSelection);
}

/**
 * Production persistence over the shared vscode state handle. Reads tolerate
 * drift (an unparsable slice loads as "nothing"); writes shallow-merge so a
 * sibling store's keys survive this save (theirs still clobber this slice on
 * THEIR save — the documented last-writer-wins above).
 */
export function createWebviewComposerPersistence(): ComposerPersistence {
  const state = getWebviewState();
  return {
    load: () => {
      const value = state.getState();
      if (!isRecord(value)) return undefined;
      const slice = value[PERSIST_KEY];
      return isSelectionsBySession(slice) ? slice : undefined;
    },
    save: (selections) => {
      const current = state.getState();
      const base = isRecord(current) ? current : {};
      state.setState({ ...base, [PERSIST_KEY]: selections });
    },
  };
}

// ---------------------------------------------------------------------------
// Module store.

type Listener = { (): void };

const EMPTY_SELECTION: PickerSelection = {};
const listeners = new Set<Listener>();

let selections: SelectionsBySession = {};
let persistence: ComposerPersistence | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Test seam: inject a persistence fake (or reset to "none") between suites.
 * Passing undefined restores lazy production resolution.
 */
export function configureComposerPersistence(next: ComposerPersistence | undefined): void {
  persistence = next;
}

/** Lazily resolve the production seam; undefined outside a webview runtime. */
function activePersistence(): ComposerPersistence | undefined {
  if (persistence !== undefined) return persistence;
  try {
    return createWebviewComposerPersistence();
  } catch (error) {
    // acquireVsCodeApi exists only inside a real webview; node/test renders
    // degrade to memory-only persistence (never a crash).
    if (error instanceof ReferenceError) return undefined;
    throw error;
  }
}

function hydrate(): void {
  const loaded = activePersistence()?.load();
  if (loaded !== undefined) selections = loaded;
}

let hydrated = false;

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  hydrate();
}

function writeSelections(next: SelectionsBySession): void {
  selections = next;
  activePersistence()?.save(selections);
  emit();
}

/** The session's selection; the shared empty record when never touched. */
export function getPickerSelection(sessionId: string): PickerSelection {
  ensureHydrated();
  return selections[sessionId] ?? EMPTY_SELECTION;
}

function writeSelection(sessionId: string, next: PickerSelection): void {
  ensureHydrated();
  if (next.agent === undefined && next.model === undefined) {
    if (selections[sessionId] === undefined) return;
    const rest: Record<string, PickerSelection> = { ...selections };
    delete rest[sessionId];
    writeSelections(rest);
    return;
  }
  writeSelections({ ...selections, [sessionId]: next });
}

/** Record (or clear, with undefined) the session's agent selection. */
export function setAgentSelection(sessionId: string, agent: string | undefined): void {
  const current = getPickerSelection(sessionId);
  writeSelection(sessionId, {
    ...(agent === undefined ? {} : { agent }),
    ...(current.model === undefined ? {} : { model: current.model }),
  });
}

/** Record (or clear, with undefined) the session's model selection. */
export function setModelSelection(sessionId: string, model: string | undefined): void {
  const current = getPickerSelection(sessionId);
  writeSelection(sessionId, {
    ...(current.agent === undefined ? {} : { agent: current.agent }),
    ...(model === undefined ? {} : { model }),
  });
}

// ---------------------------------------------------------------------------
// Prompt extras — the T14 consumption contract (see the module header).

export interface PromptExtras {
  readonly agent?: string;
  readonly model?: string;
}

/** The static snapshot slice the extras rule reads (test-friendly). */
export type PromptExtrasSnapshot = Pick<CapabilitySnapshot, "agents" | "providers" | "defaultModels"> & {
  readonly defaultModel?: string;
};

/**
 * The {agent?, model?} fields for the next sendPrompt of `sessionId`.
 * `agent` is omitted when the server advertises NO agents (QA rule); a set
 * agent selection otherwise passes through as-is (the server owns
 * validation). `model` is the explicit selection, else the resolved server
 * default; both may be absent.
 */
export function buildPromptExtras(
  sessionId: string,
  snapshot: PromptExtrasSnapshot,
): PromptExtras {
  const selection = getPickerSelection(sessionId);
  const model =
    selection.model ??
    resolveInitialModel({
      providers: snapshot.providers,
      defaultModels: snapshot.defaultModels,
      ...(snapshot.defaultModel === undefined ? {} : { defaultModel: snapshot.defaultModel }),
    });
  return {
    ...(snapshot.agents.length > 0 && selection.agent !== undefined
      ? { agent: selection.agent }
      : {}),
    ...(model === undefined ? {} : { model }),
  };
}

// ---------------------------------------------------------------------------
// React binding.

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePickerSelection(sessionId: string): PickerSelection {
  const read = (): PickerSelection => {
    return getPickerSelection(sessionId);
  };
  // getServerSnapshot == read: renderToStaticMarkup suites mount hook users.
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Test seam: clear selections and re-hydrate lazily. An injected persistence
 * fake (configureComposerPersistence) SURVIVES this reset so the standard
 * order is configure -> reset -> exercise.
 */
export function resetComposerStateForTest(): void {
  selections = {};
  hydrated = false;
  emit();
}

/** Re-exported for T14's convenience (one import path for input extras). */
export type { AgentEntry, CapabilitySnapshot };

/**
 * In-memory store for the mock opencode server.
 * Deterministic ids (ses_1, msg_2, ...) so tests can assert on them.
 */
import type {
  AssistantMessageInfo,
  MessageId,
  MessageWithParts,
  MockSession,
  PartId,
  PermissionRequest,
  PermissionResponse,
  QuestionRequest,
  ScenarioName,
  SessionId,
  TodoItem,
  UserMessageInfo,
} from "./types.js";
import { zeroTokens } from "./types.js";
import { MOCK_DIRECTORY, MODERN_VERSION, defaultTodos } from "./fixtures.js";

export { MOCK_DIRECTORY, MODERN_VERSION, OLD_SERVER_VERSION } from "./fixtures.js";

export interface SessionRecord {
  info: MockSession;
  messages: MessageWithParts[];
  todos: TodoItem[];
  status: "idle" | "busy";
}

export interface PendingPermission {
  request: PermissionRequest;
  promise: Promise<PermissionResponse>;
  settle: (response: PermissionResponse) => void;
}

export interface QuestionAnswer {
  answers?: unknown;
  reject?: boolean;
}

export interface PendingQuestion {
  request: QuestionRequest;
  promise: Promise<QuestionAnswer>;
  settle: (answer: QuestionAnswer) => void;
}

export interface MockState {
  scenario: ScenarioName;
  /** Version reported by /global/health. Locked when the caller pinned one. */
  version: string;
  versionPinned: boolean;
  sessions: Map<SessionId, SessionRecord>;
  pendingPermissions: Map<string, PendingPermission>;
  pendingQuestions: Map<string, PendingQuestion>;
  abortRequested: Set<SessionId>;
  now: () => number;
  sessionId: () => SessionId;
  messageId: () => MessageId;
  partId: () => PartId;
  requestId: (prefix: string) => string;
}

export function createMockState(scenario: ScenarioName, version?: string): MockState {
  const counters = new Map<string, number>();
  const next = (prefix: string): string => {
    const value = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, value);
    return `${prefix}_${value}`;
  };
  return {
    scenario,
    version: version ?? MODERN_VERSION,
    versionPinned: version !== undefined,
    sessions: new Map(),
    pendingPermissions: new Map(),
    pendingQuestions: new Map(),
    abortRequested: new Set(),
    now: () => Date.now(),
    sessionId: () => next("ses") as SessionId,
    messageId: () => next("msg") as MessageId,
    partId: () => next("prt") as PartId,
    requestId: (prefix: string) => next(prefix),
  };
}

export function createMockSession(
  state: MockState,
  title: string,
  parentID?: SessionId,
): SessionRecord {
  const created = state.now();
  const info: MockSession = {
    id: state.sessionId(),
    projectID: "mock-project",
    directory: MOCK_DIRECTORY,
    title,
    version: state.version,
    time: { created, updated: created },
  };
  if (parentID !== undefined) info.parentID = parentID;
  return { info, messages: [], todos: defaultTodos(), status: "idle" };
}

export function createUserMessage(state: MockState, sessionID: SessionId): UserMessageInfo {
  return {
    id: state.messageId(),
    sessionID,
    role: "user",
    time: { created: state.now() },
    agent: "build",
    model: { providerID: "mock-provider", modelID: "mock-large" },
  };
}

export function createAssistantMessage(
  state: MockState,
  sessionID: SessionId,
  parentID: MessageId,
): AssistantMessageInfo {
  return {
    id: state.messageId(),
    sessionID,
    role: "assistant",
    time: { created: state.now() },
    parentID,
    modelID: "mock-large",
    providerID: "mock-provider",
    mode: "build",
    path: { cwd: MOCK_DIRECTORY, root: MOCK_DIRECTORY },
    cost: 0,
    tokens: zeroTokens(),
  };
}

/**
 * Shared types for the mock opencode server.
 *
 * Field shapes mirror @opencode-ai/sdk (1.18.18) gen types — Session, Message,
 * Part, Permission, Todo, Agent — plus the v2 SSE taxonomy the plan consumes
 * (message.part.delta, permission.asked, question.asked). Where the two SDK
 * generations disagree we follow the plan binding; see the todo-5 evidence log.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

declare const idBrand: unique symbol;
type Brand<T, B extends string> = T & { readonly [idBrand]: B };
export type SessionId = Brand<string, "SessionId">;
export type MessageId = Brand<string, "MessageId">;
export type PartId = Brand<string, "PartId">;

export const SCENARIO_NAMES = [
  "basic-chat",
  "permission-flow",
  "question-flow",
  "long-stream",
  "error-revert",
  "omo-agents",
  "old-server",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export function isScenarioName(value: unknown): value is ScenarioName {
  return typeof value === "string" && (SCENARIO_NAMES as readonly string[]).includes(value);
}

/**
 * SSE envelope. Newer opencode servers carry a monotonically increasing `id`.
 * `properties` stays `unknown`: the server only ever JSON-stringifies events.
 */
export interface BusEvent {
  id: string;
  type: string;
  properties: unknown;
}

export interface TokenCount {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}
export function zeroTokens(): TokenCount {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

export interface UserMessageInfo {
  id: MessageId;
  sessionID: SessionId;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
}

export interface AssistantMessageInfo {
  id: MessageId;
  sessionID: SessionId;
  role: "assistant";
  time: { created: number; completed?: number };
  parentID: MessageId;
  modelID: string;
  providerID: string;
  mode: string;
  path: { cwd: string; root: string };
  cost: number;
  tokens: TokenCount;
  error?: { name: string; data: JsonObject };
  finish?: string;
}
export type MessageInfo = UserMessageInfo | AssistantMessageInfo;

export interface TextPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "text";
  text: string;
  time: { start: number; end?: number };
}

export type ToolState =
  | { status: "pending"; input: JsonObject; raw: string }
  | { status: "running"; input: JsonObject; title?: string; time: { start: number } }
  | {
      status: "completed";
      input: JsonObject;
      output: string;
      title: string;
      metadata: JsonObject;
      time: { start: number; end: number };
    }
  | { status: "error"; input: JsonObject; error: string; time: { start: number; end: number } };

export interface ToolPart {
  id: PartId;
  sessionID: SessionId;
  messageID: MessageId;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}
export type MockPart = TextPart | ToolPart;

export interface MessageWithParts {
  info: MessageInfo;
  parts: MockPart[];
}

export interface MockSession {
  id: SessionId;
  projectID: string;
  directory: string;
  parentID?: SessionId;
  share?: { url: string };
  title: string;
  version: string;
  time: { created: number; updated: number };
  revert?: { messageID: MessageId; partID?: PartId; snapshot?: string };
}

export interface TodoItem {
  id: string;
  content: string;
  status: string;
  priority: string;
}

export interface AgentInfo {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtIn: boolean;
  permission: { edit: "ask" | "allow" | "deny"; bash: Record<string, "ask" | "allow" | "deny"> };
  tools: Record<string, boolean>;
  options: JsonObject;
  model?: { providerID: string; modelID: string };
}

export interface CommandInfo {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template: string;
  subtask?: boolean;
}

/** Shape of v2 `permission.asked` properties (EventPermissionAsked). */
export interface PermissionRequest {
  id: string;
  sessionID: SessionId;
  permission: string;
  patterns: string[];
  metadata: JsonObject;
  always: string[];
  tool?: { messageID: MessageId; callID: string };
}

export interface QuestionInfoItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
}

/** Shape of v2 `question.asked` properties (EventQuestionAsked). */
export interface QuestionRequest {
  id: string;
  sessionID: SessionId;
  questions: QuestionInfoItem[];
  tool?: { messageID: MessageId; callID: string };
}

export type PermissionResponse = "once" | "always" | "reject";

export interface FileDiffEntry {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

/** HTTP error envelope matching the SDK's BadRequestError / NotFoundError shape. */
export interface ApiErrorBody {
  name: "BadRequestError" | "NotFoundError";
  data: { message: string };
}

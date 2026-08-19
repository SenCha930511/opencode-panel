/**
 * Tolerant boundary parsers for the todo-16 forwarded events (webview side).
 * Never throw: a malformed payload parses to `undefined` and vanishes
 * silently, mirroring the todo-13 parse posture — nothing a server (or an
 * OMO plugin) emits may crash the dock.
 */

import { isRecord } from "../../../../shared/protocol.js";
import type {
  PermissionCardVM,
  QuestionCardVM,
  QuestionOptionVM,
  QuestionPromptVM,
} from "./cardTypes.js";

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => {
    return typeof entry === "string";
  });
}

function parseQuestionOption(value: unknown): QuestionOptionVM | undefined {
  if (!isRecord(value)) return undefined;
  const label = stringOr(value.label);
  if (label === undefined) return undefined;
  return { label, description: stringOr(value.description) };
}

function parseQuestionPrompt(value: unknown): QuestionPromptVM | undefined {
  if (!isRecord(value)) return undefined;
  const question = stringOr(value.question);
  if (question === undefined) return undefined;
  const options = Array.isArray(value.options)
    ? value.options
        .map(parseQuestionOption)
        .filter((option): option is QuestionOptionVM => {
          return option !== undefined;
        })
    : [];
  return {
    question,
    header: stringOr(value.header),
    options,
    multiple: value.multiple === true,
  };
}

export interface AskKey {
  readonly sessionId: string;
  readonly requestId: string;
}

function parseAskedBase(payload: unknown): AskKey | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = stringOr(payload.sessionID);
  const requestId = stringOr(payload.id);
  if (sessionId === undefined || requestId === undefined) return undefined;
  return { sessionId, requestId };
}

export function parsePermissionCard(payload: unknown): PermissionCardVM | undefined {
  const base = parseAskedBase(payload);
  if (base === undefined || !isRecord(payload)) return undefined;
  const permission = stringOr(payload.permission) ?? stringOr(payload.type);
  if (permission === undefined) return undefined;
  const patterns = stringsOf(payload.patterns);
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
  const description = metadata === undefined ? undefined : stringOr(metadata.description);
  const purpose = description ?? (patterns.length > 0 ? patterns.join(", ") : undefined);
  return {
    kind: "permission",
    ...base,
    permission,
    patterns,
    purpose,
    status: "pending",
  };
}

export function parseQuestionCard(payload: unknown): QuestionCardVM | undefined {
  const base = parseAskedBase(payload);
  if (base === undefined || !isRecord(payload) || !Array.isArray(payload.questions)) {
    return undefined;
  }
  const questions = payload.questions
    .map(parseQuestionPrompt)
    .filter((prompt): prompt is QuestionPromptVM => {
      return prompt !== undefined;
    });
  if (questions.length === 0) return undefined;
  return { kind: "question", ...base, questions, status: "pending" };
}

export function sessionIdOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return stringOr(payload.sessionID);
}

/** replied/rejected envelopes name the request via permissionID or requestID. */
export function repliedKeyOf(payload: unknown): AskKey | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = stringOr(payload.sessionID);
  const requestId = stringOr(payload.permissionID) ?? stringOr(payload.requestID);
  if (sessionId === undefined || requestId === undefined) return undefined;
  return { sessionId, requestId };
}

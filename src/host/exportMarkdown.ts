/**
 * Transcript markdown renderer (plan todo 19, host side): one session's
 * `{info, parts}[]` (verbatim `client.session.messages` payload) becomes a
 * readable markdown document. Pure and total: an unrecognized part shape is
 * exported as a fenced-JSON card (never dropped — matching the todo-13
 * webview rule that server/OMO payloads must not lose content), a missing
 * role becomes an `unknown` heading.
 *
 * English headings by design: this is generated export content (dev-file
 * surface), not UI display copy, so the todo-4 string tables do not apply.
 * Part text is emitted verbatim — an export is an honest record, and
 * re-sanitizing would rewrite data the user asked to keep.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1);
}

/** `> ` quote-prefix every line of a reasoning block. */
function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function fenced(content: string): string {
  // Outdent the fence when the content itself carries triple backticks.
  return content.includes("```") ? `~~~\n${content}\n~~~` : `\`\`\`\n${content}\n\`\`\``;
}

function renderToolPart(part: Record<string, unknown>): string {
  const state = isRecord(part.state) ? part.state : {};
  const tool = stringOr(part.tool) ?? stringOr(part.name) ?? "tool";
  const title = stringOr(state.title);
  const status = stringOr(state.status);
  const headline =
    `**Tool: ${tool}**` +
    (title !== undefined && title.length > 0 ? ` — ${title}` : "") +
    (status !== undefined ? ` (${status})` : "");
  const output = stringOr(state.output);
  const lines = [headline];
  if (output !== undefined && output.trim().length > 0) lines.push(fenced(output));
  const error = stringOr(state.error);
  if (error !== undefined && error.trim().length > 0) lines.push(`Error: ${error}`);
  return lines.join("\n\n");
}

/** One part -> markdown block; unknown shapes degrade to fenced JSON. */
export function renderPart(part: unknown): string {
  if (!isRecord(part)) return "";
  switch (part.type) {
    case "text":
      return stringOr(part.text) ?? "";
    case "reasoning": {
      const text = stringOr(part.text) ?? "";
      return text.trim().length === 0 ? "" : quoteBlock(text);
    }
    case "tool":
      return renderToolPart(part);
    case "file": {
      const filename = stringOr(part.filename) ?? stringOr(part.url) ?? "attachment";
      const mime = stringOr(part.mime);
      return `- ${filename}${mime === undefined ? "" : ` (${mime})`}`;
    }
    default:
      return fenced(JSON.stringify(part, null, 2));
  }
}

/** One message envelope -> a role heading plus its part blocks. */
export function renderMessage(message: unknown): string[] {
  if (!isRecord(message)) return [];
  const info = isRecord(message.info) ? message.info : {};
  const role = capitalize(stringOr(info.role) ?? "unknown");
  const blocks = [`## ${role}`];
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const part of parts) {
    const block = renderPart(part);
    if (block.trim().length > 0) blocks.push(block);
  }
  return blocks;
}

export interface TranscriptInput {
  readonly title: string;
  readonly sessionId: string;
  /** ISO-8601 export timestamp (from the injected clock). */
  readonly exportedAt: string;
  readonly messages: readonly unknown[];
}

/** The whole document: front-matter header, then messages in payload order. */
export function renderTranscriptMarkdown(input: TranscriptInput): string {
  const sections: string[] = [
    `# ${input.title}`,
    [
      `- Session: \`${input.sessionId}\``,
      `- Exported: ${input.exportedAt}`,
      `- Messages: ${String(input.messages.length)}`,
    ].join("\n"),
  ];
  for (const message of input.messages) {
    sections.push(...renderMessage(message));
  }
  return `${sections.join("\n\n")}\n`;
}

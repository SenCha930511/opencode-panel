import type { PartVM } from "../types.js";

type UnknownPart = Extract<PartVM, { kind: "unknown" }>;

function prettyJson(value: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(value, null, 2) ?? "{}";
  } catch {
    return "{}";
  }
}

/**
 * Lifecycle and internal telemetry part types that should be hidden from UI.
 */
export function isHiddenPartType(typeName: string): boolean {
  const type = typeName.toLowerCase().trim();
  return (
    type === "step-start" ||
    type === "step_start" ||
    type === "step-finish" ||
    type === "step_finish" ||
    type === "step" ||
    type === "finish" ||
    type.startsWith("step-") ||
    type.startsWith("step_") ||
    type.endsWith("-finish") ||
    type.endsWith("_finish") ||
    type.includes("step-start") ||
    type.includes("step-finish") ||
    type.includes("step_start") ||
    type.includes("step_finish")
  );
}

/**
 * Fallback for part shapes this milestone does not know (SDK additions, OMO
 * plugin parts): a collapsed JSON card, keyed by id, that can never crash.
 */
export function JsonPartView(props: { readonly part: UnknownPart }) {
  if (isHiddenPartType(props.part.typeName)) {
    return null;
  }
  return (
    <details className="rounded border border-dashed border-[var(--vscode-panel-border)] px-2 py-1 text-[0.9em] opacity-80">
      <summary className="cursor-pointer select-none font-mono break-all">
        {props.part.typeName}
      </summary>
      <pre className="mt-1 overflow-x-auto rounded bg-[var(--vscode-textCodeBlock-background)] p-2">
        {prettyJson(props.part.raw)}
      </pre>
    </details>
  );
}

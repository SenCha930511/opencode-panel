/**
 * Category glyphs for the generic tool card. Chosen by a NAME-MORPHOLOGY
 * heuristic only (substring classes, default wrench) — NEVER by enumerating
 * tool names, so unknown/OMO tools (skill_mcp, team_*, ...) all render. The
 * heuristic picks an icon family; it never gates behavior.
 */

export type ToolIconKind = "terminal" | "search" | "edit" | "read" | "tool";

export function toolIconKind(tool: string): ToolIconKind {
  const name = tool.toLowerCase();
  if (/(bash|shell|cmd|command|terminal|exec)/.test(name)) return "terminal";
  if (/(search|grep|find|query|lookup|scan|glob)/.test(name)) return "search";
  if (/(edit|write|patch|replace|insert|delete|remove|rename|move|create)/.test(name)) return "edit";
  if (/(read|fetch|get|load|open|view|list|cat)/.test(name)) return "read";
  return "tool";
}

const STROKE_PROPS = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Svg(props: { readonly children: React.ReactNode }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 opacity-70">
      {props.children}
    </svg>
  );
}

export function ToolIcon(props: { readonly kind: ToolIconKind }) {
  switch (props.kind) {
    case "terminal":
      return (
        <Svg>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" {...STROKE_PROPS} />
          <path d="M4.5 6.5 7 8.8 4.5 11" {...STROKE_PROPS} />
          <path d="M8.5 11h3" {...STROKE_PROPS} />
        </Svg>
      );
    case "search":
      return (
        <Svg>
          <circle cx="7" cy="7" r="4.5" {...STROKE_PROPS} />
          <path d="m10.5 10.5 3 3" {...STROKE_PROPS} />
        </Svg>
      );
    case "edit":
      return (
        <Svg>
          <path d="M11 2.5a1.8 1.8 0 0 1 2.5 2.5L6 12.5l-3.4.9.9-3.4L11 2.5Z" {...STROKE_PROPS} />
        </Svg>
      );
    case "read":
      return (
        <Svg>
          <path d="M2.5 4.5c2-1 4-1 5.5.3 1.5-1.3 3.5-1.3 5.5-.3v9c-2-1-4-1-5.5.3-1.5-1.3-3.5-1.3-5.5-.3v-9Z" {...STROKE_PROPS} />
        </Svg>
      );
    case "tool":
      return (
        <Svg>
          <path d="M9.8 2.6a3.4 3.4 0 0 0-4.5 4.2L2 13.1a1.7 1.7 0 1 0 2.4 2.4l6.3-3.3a3.4 3.4 0 0 0 4.2-4.5l-2.2 2.2-2.1-2.1 2.2-2.2a3.4 3.4 0 0 0-3-3Z" {...STROKE_PROPS} />
        </Svg>
      );
    default: {
      const exhaustive: never = props.kind;
      return exhaustive;
    }
  }
}

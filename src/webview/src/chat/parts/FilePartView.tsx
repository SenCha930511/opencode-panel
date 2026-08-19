import { useStrings } from "../../../lib/i18n.js";
import type { PartVM } from "../types.js";
import { useChatActions } from "../chatContext.js";

type FilePart = Extract<PartVM, { kind: "file" }>;

function displayName(part: FilePart): string {
  if (part.filename !== undefined && part.filename.length > 0) return part.filename;
  if (part.url !== undefined) return part.url;
  return part.mime ?? "file";
}

/** File attachment chip: name verbatim from the payload, open via host. */
export function FilePartView(props: { readonly part: FilePart }) {
  const { t } = useStrings();
  const actions = useChatActions();
  const name = displayName(props.part);
  const path = props.part.filename ?? props.part.url ?? "";
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--vscode-panel-border)] px-1.5 py-0.5 text-[0.9em]">
      <span className="max-w-64 truncate">{name}</span>
      {props.part.mime !== undefined ? (
        <span className="text-[var(--vscode-descriptionForeground)]">{props.part.mime}</span>
      ) : null}
      <button
        type="button"
        className="text-[var(--vscode-textLink-foreground)] hover:underline"
        onClick={() => {
          if (path.length > 0) actions.openFile(path);
        }}
      >
        {t("dock.diffs.openFile")}
      </button>
    </span>
  );
}

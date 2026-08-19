import { useStrings } from "../../../lib/i18n.js";
import type { PartVM } from "../types.js";
import { useChatActions } from "../chatContext.js";

type PatchPart = Extract<PartVM, { kind: "patch" }>;

/** Patch part: a single button opening the session diff via the host. */
export function PatchPartView(props: { readonly part: PatchPart }) {
  const { t } = useStrings();
  const actions = useChatActions();
  const sessionId = props.part.sessionID ?? "";
  return (
    <button
      type="button"
      className="rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 text-[0.9em] text-[var(--vscode-textLink-foreground)] hover:underline"
      onClick={() => {
        if (sessionId.length === 0) return;
        if (props.part.messageID !== undefined) {
          actions.openDiff({ sessionId, messageID: props.part.messageID });
        } else {
          actions.openDiff({ sessionId });
        }
      }}
    >
      {t("dock.diffs.openDiff")}
    </button>
  );
}

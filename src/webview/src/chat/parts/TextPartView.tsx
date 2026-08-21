import type { PartVM } from "../types.js";
import { useStrings } from "../../../lib/i18n.js";
import { Markdown } from "./Markdown.js";
import { isSystemReminderText, cleanSystemReminderText } from "../visibility.js";

export function TextPartView(props: { readonly part: Extract<PartVM, { kind: "text" }> }) {
  const { t } = useStrings();
  const text = props.part.text;
  if (isSystemReminderText(text)) {
    const cleaned = cleanSystemReminderText(text);
    return (
      <div className="my-1.5 w-full rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-fg shadow-xs">
        <div className="flex items-center gap-1.5 font-semibold text-sky-400 mb-1.5 select-none">
          <span className="flex h-4.5 w-4.5 items-center justify-center rounded bg-sky-500/20 text-xs">🔔</span>
          <span>{t("chat.systemReminder.label")}</span>
        </div>
        <div className="text-fg/90 space-y-1 font-mono text-[11px] leading-relaxed">
          <Markdown text={cleaned} />
        </div>
      </div>
    );
  }
  return <Markdown text={text} />;
}

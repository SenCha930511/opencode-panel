import { useMemo, useState } from "react";
import { useStrings } from "../../../lib/i18n.js";
import type { QuestionCardVM } from "./cardTypes.js";

function QuestionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.4 6.2a1.8 1.8 0 1 1 2.6 1.6c-.62.34-1 .76-1 1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.4" r=".8" fill="currentColor" />
    </svg>
  );
}

export interface QuestionCardProps {
  readonly card: QuestionCardVM;
  onSubmit(answers: readonly string[]): void;
  /** Local-only hide (common.cancel); NEVER settles the server request. */
  onDismiss(): void;
}

/**
 * Question card in Antigravity style:
 * Interactive multi/single option selection with radio/checkboxes, descriptions,
 * optional custom write-in reply, and polished action buttons.
 */
export function QuestionCard(props: QuestionCardProps) {
  const { t } = useStrings();
  const { card } = props;
  const initial = useMemo(
    () => ({
      selected: card.questions.map((): readonly string[] => []),
      texts: card.questions.map(() => ""),
    }),
    [card.questions],
  );
  const [selected, setSelected] = useState<readonly (readonly string[])[]>(initial.selected);
  const [texts, setTexts] = useState<readonly string[]>(initial.texts);

  const busy = card.status === "replying";
  const expired = card.status === "expired";

  const toggle = (index: number, label: string, multiple: boolean): void => {
    setSelected((current) =>
      current.map((labels, at) => {
        if (at !== index) return labels;
        if (multiple) {
          return labels.includes(label)
            ? labels.filter((entry) => entry !== label) // i18n-allow-literal
            : [...labels, label];
        }
        return labels.includes(label) ? [] : [label];
      }),
    );
  };

  const setText = (index: number, text: string): void => {
    setTexts((current) => current.map((entry, at) => (at === index ? text : entry)));
  };

  const answers = card.questions.map((prompt, index) => {
    const selectedList = selected[index] ?? [];
    const customText = (texts[index] ?? "").trim();
    if (prompt.options.length > 0) {
      if (customText.length > 0 && selectedList.length > 0) {
        return `${selectedList.join(", ")}, ${customText}`;
      }
      if (customText.length > 0) return customText;
      return selectedList.join(", ");
    }
    return customText;
  });
  const submittable = answers.every((answer) => answer.length > 0);

  return (
    <div className="my-2 rounded-2xl border border-accent/40 bg-panel-bg/95 p-3.5 shadow-xl backdrop-blur-xl ring-1 ring-black/10 text-xs text-fg transition-all">
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent shadow-2xs">
          <QuestionIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm text-fg tracking-tight">{t("question.title")}</span>
            {expired && (
              <span className="rounded-full bg-err/10 px-2 py-0.5 text-[10px] font-medium text-err">
                {t("permission.expired")}
              </span>
            )}
          </div>

          {card.questions.map((prompt, index) => (
            <div key={`${card.requestId}-${index}`} className="mt-2.5 space-y-2">
              {prompt.header !== undefined ? (
                <span className="inline-block rounded-md bg-hover-bg/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-fg border border-card-border/60">
                  {prompt.header}
                </span>
              ) : null}
              <div className="font-medium text-xs text-fg/95 leading-relaxed">{prompt.question}</div>

              {expired ? null : prompt.options.length > 0 ? (
                <div className="space-y-1.5 pt-0.5">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {prompt.options.map((option) => {
                      const chosen = (selected[index] ?? []).includes(option.label);
                      return (
                        <button
                          key={option.label}
                          type="button"
                          aria-pressed={chosen}
                          title={option.description ?? option.label}
                          disabled={busy}
                          onClick={() => toggle(index, option.label, prompt.multiple)}
                          className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                            chosen
                              ? "border-accent bg-accent/10 shadow-xs text-fg ring-1 ring-accent/30"
                              : "border-card-border/80 bg-card-bg/60 text-muted-fg hover:bg-hover-bg hover:text-fg hover:border-card-border"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-${
                              prompt.multiple ? "xs" : "full"
                            } border ${
                              chosen
                                ? "border-accent bg-accent text-accent-fg"
                                : "border-muted-fg/40 bg-transparent"
                            } text-[9px] font-bold`}
                          >
                            {chosen ? "✓" : null}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="block font-medium text-xs text-fg">{option.label}</span>
                            {option.description !== undefined && option.description !== option.label ? (
                              <span className="mt-0.5 block text-[11px] text-muted-fg/80 leading-tight">
                                {option.description}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-1">
                    <input
                      type="text"
                      placeholder={t("question.customPlaceholder")}
                      value={texts[index] ?? ""}
                      disabled={busy}
                      onChange={(event) => setText(index, event.currentTarget.value)}
                      className="w-full rounded-xl border border-card-border/80 bg-input-card-bg px-3 py-1.5 text-xs text-fg outline-none transition-colors placeholder:text-muted-fg/50 focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 disabled:opacity-50"
                    />
                  </div>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder={t("question.answerPlaceholder")}
                  value={texts[index] ?? ""}
                  disabled={busy}
                  onChange={(event) => setText(index, event.currentTarget.value)}
                  className="w-full rounded-xl border border-card-border/80 bg-input-card-bg px-3 py-2 text-xs text-fg outline-none transition-colors placeholder:text-muted-fg/50 focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 disabled:opacity-50"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {expired ? (
        <div className="mt-3 flex justify-end gap-2 border-t border-card-border/40 pt-2.5">
          <button
            type="button"
            className="rounded-xl border border-card-border/80 bg-card-bg px-3 py-1.5 text-xs font-medium text-muted-fg hover:bg-hover-bg hover:text-fg cursor-pointer transition-colors"
            onClick={props.onDismiss}
          >
            {t("common.close")}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-card-border/40 pt-2.5">
          <button
            type="button"
            className="rounded-xl border border-card-border/80 bg-card-bg px-3 py-1.5 text-xs font-medium text-muted-fg hover:bg-hover-bg hover:text-fg cursor-pointer transition-colors"
            disabled={busy}
            onClick={props.onDismiss}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg shadow-sm hover:bg-accent-hover active:scale-98 transition-all disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            disabled={busy || !submittable}
            onClick={() => props.onSubmit(answers)}
          >
            {t("question.submit")}
          </button>
        </div>
      )}
    </div>
  );
}

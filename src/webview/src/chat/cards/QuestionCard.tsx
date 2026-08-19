import { useMemo, useState } from "react";
import { useStrings } from "../../../lib/i18n.js";
import type { QuestionCardVM } from "./cardTypes.js";

const secondaryButtonClass =
  "rounded border border-border px-2 py-1 text-xs text-fg hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
const primaryButtonClass =
  "rounded bg-accent px-2 py-1 text-xs text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

function QuestionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M6.4 6.2a1.8 1.8 0 1 1 2.6 1.6c-.62.34-1 .76-1 1.5"
        stroke="currentColor"
        strokeWidth="1.2"
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
 * Question card (todo 16). Every entry of the payload's `questions[]` renders
 * as DATA — options become selectable chips (single-select unless
 * `multiple`), questions without options get a free-form input. Submitted
 * `answers[i]` answers `questions[i]`: selected labels joined with ", " when
 * options exist, else the trimmed free-form text (the wire's frozen
 * `readonly string[]` shape; documented in the evidence log).
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
            ? labels.filter((entry) => {
                return entry !== label;
              })
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
    if (prompt.options.length > 0) return (selected[index] ?? []).join(", ");
    return (texts[index] ?? "").trim();
  });
  const submittable = answers.every((answer) => answer.length > 0);

  return (
    <div className="rounded border border-border bg-panel-bg px-3 py-2 text-xs text-fg">
      <div className="flex items-start gap-2">
        <QuestionIcon />
        <div className="min-w-0 flex-1">
          <span className="font-medium">{t("question.title")}</span>
          {card.questions.map((prompt, index) => (
            <div key={`${card.requestId}-${index}`} className="mt-2">
              {prompt.header !== undefined ? (
                <div className="mb-1 text-muted-fg">{prompt.header}</div>
              ) : null}
              <div className="mb-1">{prompt.question}</div>
              {expired ? null : prompt.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
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
                        className={`rounded border px-2 py-1 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                          chosen
                            ? "border-accent bg-active-bg text-fg"
                            : "border-border text-muted-fg hover:bg-hover-bg hover:text-fg"
                        }`}
                      >
                        <span>{option.label}</span>
                        {option.description !== undefined && option.description !== option.label ? (
                          <span className="mt-0.5 block text-[0.9em] text-muted-fg">
                            {option.description}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  value={texts[index] ?? ""}
                  disabled={busy}
                  onChange={(event) => setText(index, event.currentTarget.value)}
                  className="w-full rounded border border-border bg-input-bg px-2 py-1 text-fg outline-none focus:border-focus-ring disabled:opacity-50"
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {expired ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-muted-fg">{t("permission.expired")}</span>
          <button type="button" className={secondaryButtonClass} onClick={props.onDismiss}>
            {t("common.close")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !submittable}
            onClick={() => props.onSubmit(answers)}
          >
            {t("question.submit")}
          </button>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={props.onDismiss}>
            {t("common.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

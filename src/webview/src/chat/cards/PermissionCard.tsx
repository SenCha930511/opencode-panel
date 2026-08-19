import type { ReactElement } from "react";
import type { PermissionResponse } from "../../../../shared/protocol.js";
import { useStrings } from "../../../lib/i18n.js";
import type { PermissionCardVM } from "./cardTypes.js";

const secondaryButtonClass =
  "rounded border border-border px-2 py-1 text-xs text-fg hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
const primaryButtonClass =
  "rounded bg-accent px-2 py-1 text-xs text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <path
        d="M4.5 7V5.5a3.5 3.5 0 1 1 7 0V7m-8 0h9A.5.5 0 0 1 13 7.5v6.001a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.5a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="10.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

export interface PermissionReplyLabels {
  readonly once: string;
  readonly always: string;
  readonly reject: string;
}

export interface PermissionReplyButtonsProps {
  readonly busy: boolean;
  readonly labels: PermissionReplyLabels;
  onReply(response: PermissionResponse): void;
}

/**
 * The three reply buttons as a HOOK-FREE subcomponent: the parent resolves
 * labels through t(), and the pure props shape lets node tests invoke this
 * function directly and walk the element tree to click every button against
 * stubs (no DOM, no renderer — button wiring is behavioral evidence).
 */
export function PermissionReplyButtons(props: PermissionReplyButtonsProps): ReactElement {
  const { busy, labels } = props;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={busy}
        onClick={() => props.onReply("once")}
      >
        {labels.once}
      </button>
      <button
        type="button"
        className={primaryButtonClass}
        disabled={busy}
        onClick={() => props.onReply("always")}
      >
        {labels.always}
      </button>
      <button
        type="button"
        className={`${secondaryButtonClass} text-err`}
        disabled={busy}
        onClick={() => props.onReply("reject")}
      >
        {labels.reject}
      </button>
    </div>
  );
}

export interface PermissionCardProps {
  readonly card: PermissionCardVM;
  onReply(response: PermissionResponse): void;
  /** Removes an EXPIRED card from the list (local only). */
  onDismiss(): void;
}

/**
 * Permission approval card (todo 16). The tool permission name is VERBATIM
 * data (never switched on), the purpose line comes from
 * `metadata.description`/patterns, and the three replies map 1:1 onto the
 * frozen wire values once/always/reject. An expired request shows the
 * `permission.expired` note with controls removed (QA failure state).
 */
export function PermissionCard(props: PermissionCardProps) {
  const { t } = useStrings();
  const { card } = props;
  const busy = card.status === "replying";
  const expired = card.status === "expired";

  return (
    <div className="rounded border border-border bg-panel-bg px-3 py-2 text-xs text-fg">
      <div className="flex items-start gap-2">
        <LockIcon />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("permission.title")}</span>
            <code className="rounded bg-hover-bg px-1 font-mono text-[0.92em] break-all">
              {card.permission}
            </code>
          </div>
          {card.purpose !== undefined && card.purpose !== card.permission ? (
            <div className="mt-1 truncate text-muted-fg">{card.purpose}</div>
          ) : null}
          {card.patterns.length > 0 ? (
            <pre className="mt-1 overflow-x-auto rounded bg-input-bg p-1.5 text-[0.92em]">
              {card.patterns.join("\n")}
            </pre>
          ) : null}
        </div>
        {expired ? (
          <button type="button" className={secondaryButtonClass} onClick={props.onDismiss}>
            {t("common.close")}
          </button>
        ) : null}
      </div>
      {expired ? (
        <div className="mt-2 text-muted-fg">{t("permission.expired")}</div>
      ) : (
        <PermissionReplyButtons
          busy={busy}
          labels={{
            once: t("permission.allowOnce"),
            always: t("permission.allowAlways"),
            reject: t("permission.reject"),
          }}
          onReply={props.onReply}
        />
      )}
    </div>
  );
}

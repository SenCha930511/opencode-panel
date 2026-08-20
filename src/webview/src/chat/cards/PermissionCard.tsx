import type { ReactElement } from "react";
import type { PermissionResponse } from "../../../../shared/protocol.js";
import { useStrings } from "../../../lib/i18n.js";
import type { PermissionCardVM } from "./cardTypes.js";

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 7V5.5a3.5 3.5 0 1 1 7 0V7m-8 0h9A.5.5 0 0 1 13 7.5v6.001a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V7.5a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
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
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-card-border/40 pt-2.5">
      <button
        type="button"
        className="rounded-xl border border-card-border/80 bg-card-bg px-3 py-1.5 text-xs font-medium text-fg hover:bg-hover-bg active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        disabled={busy}
        onClick={() => props.onReply("once")}
      >
        {labels.once}
      </button>
      <button
        type="button"
        className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg shadow-sm hover:bg-accent-hover active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        disabled={busy}
        onClick={() => props.onReply("always")}
      >
        {labels.always}
      </button>
      <button
        type="button"
        className="rounded-xl border border-err/40 bg-err/10 px-3 py-1.5 text-xs font-medium text-err hover:bg-err/20 active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
    <div className="my-2 rounded-2xl border border-warn/40 bg-panel-bg/95 p-3.5 shadow-xl backdrop-blur-xl ring-1 ring-black/10 text-xs text-fg transition-all">
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-warn/15 text-warn shadow-2xs">
          <LockIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 truncate min-w-0">
              <span className="font-semibold text-sm text-fg tracking-tight">{t("permission.title")}</span>
              <code className="rounded-md bg-hover-bg/80 border border-card-border px-1.5 py-0.5 font-mono text-[11px] text-fg/90">
                {card.permission}
              </code>
            </div>
            {expired ? (
              <button
                type="button"
                className="rounded-xl border border-card-border/80 bg-card-bg px-2.5 py-1 text-xs font-medium text-muted-fg hover:bg-hover-bg hover:text-fg cursor-pointer transition-colors"
                onClick={props.onDismiss}
              >
                {t("common.close")}
              </button>
            ) : null}
          </div>
          {card.purpose !== undefined && card.purpose !== card.permission ? (
            <div className="mt-1.5 text-xs text-muted-fg leading-relaxed">{card.purpose}</div>
          ) : null}
          {card.patterns.length > 0 ? (
            <pre className="mt-2 overflow-x-auto rounded-xl border border-card-border bg-input-card-bg p-2 font-mono text-[11px] text-fg/90 leading-normal">
              {card.patterns.join("\n")}
            </pre>
          ) : null}
        </div>
      </div>
      {expired ? (
        <div className="mt-2.5 text-muted-fg text-xs">{t("permission.expired")}</div>
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

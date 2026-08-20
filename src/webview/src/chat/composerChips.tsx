/**
 * Default attachment-chip renderer (todo 14). Todo 17 owns the real chip
 * behavior (add/remove/sensitive-path warnings); today the composer only
 * renders what it is handed through `attachments`, so the DEFAULT renderer
 * lives here, separate from the Composer orchestration file: a chip is a
 * filename label plus an optional X removal button (inline SVG — no emoji,
 * no icon dependency, matching the todo-12 sessions icon convention).
 */

import type { ReactNode } from "react";
import type { ComposerAttachment } from "./composerLogic.js";

function CloseIcon(): ReactNode {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DefaultAttachmentChip(props: {
  readonly attachment: ComposerAttachment;
  readonly onRemove: { (attachmentId: string): void } | undefined;
}): ReactNode {
  const { attachment, onRemove } = props;
  const imagePreview =
    attachment.mimeType.startsWith("image/") && attachment.url.length > 0 ? attachment.url : null; // i18n-allow-literal

  if (imagePreview !== null) {
    // Tile form: the preview carries the name (bottom-right) and the remove
    // button (top-right) as overlays.
    return (
      <span className="relative inline-flex shrink-0 overflow-hidden rounded-lg border border-card-border bg-card-bg/90 shadow-2xs">
        <img src={imagePreview} alt={attachment.name} className="h-20 w-20 object-cover" />
        <span
          title={attachment.name}
          className="absolute bottom-0 right-0 max-w-full truncate rounded-tl-md bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white/90"
        >
          {attachment.name}
        </span>
        {onRemove !== undefined && (
          <button
            type="button"
            aria-label={attachment.name}
            className="absolute top-0.5 right-0.5 rounded bg-black/60 p-0.5 text-white/80 transition-colors hover:bg-err hover:text-white"
            onClick={() => {
              onRemove(attachment.id);
            }}
          >
            <CloseIcon />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-card-border bg-card-bg/90 px-2 py-0.5 text-[11px] font-medium text-fg shadow-2xs">
      <span className="max-w-44 truncate">{attachment.name}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-fg transition-colors hover:bg-hover-bg hover:text-fg"
          onClick={() => {
            onRemove(attachment.id);
          }}
        >
          <CloseIcon />
        </button>
      )}
    </span>
  );
}

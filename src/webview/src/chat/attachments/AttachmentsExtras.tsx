// i18n-allow-literal — strings.ts is frozen for todo 17, so the attachments
// copy lives behind this pragma (the todo-11 SETTINGS_PLACEHOLDER_NOTE
// precedent); it MUST move into STRING_IDS when the table opens.
/**
 * Extras-slot composite (plan todo 17, webview side): everything Todo-17
 * mounts into Todo-14's Composer through its ONE layout seam — the `extras`
 * prop row. Renders, top to bottom:
 *
 * 1. the warn-before-send banner for sensitive chips (path-based flags only;
 *    staged chip names + reasons, per the plan);
 * 2. the @-mention palette (rows from the debounced searchFiles flow);
 * 3. the image-attach button + hidden file input.
 *
 * The composer exports no textarea seam, so input/caret and paste signals
 * are bridged through {@link ./domGlue}: listeners attach to the composer
 * textarea this row shares (found via `data-oc-composer`), feed the pure
 * {@link extractMentionQuery} + debounced search machine, and a palette pick
 * strips the `@token` back out through the controlled-input bridge. The
 * image gate fires BEFORE any request exists; gate rejections and read
 * failures land as error toasts through the app context.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useApp } from "../../app/context.js";
import { composerDisabled } from "../composerLogic.js";
import type { AttachmentsController } from "./controller.js";
import {
  findComposerTextarea,
  imageFilesFrom,
  readFileAsDataUrl,
  setTextareaValue,
} from "./domGlue.js";
import { ImageAttachmentError } from "./images.js";
import { extractMentionQuery, stripMentionToken } from "./logic.js";
import { MentionPalette } from "./MentionPalette.js";
import { createMentionSearch } from "./search.js";

const COPY = {
  bannerLead: "Sensitive files staged — review before sending:",
  imageAttachLabel: "Attach image",
  readFailed: "Could not read that image.",
} as const;

interface TextareaSignal {
  readonly text: string;
  readonly caret: number;
}

function PaperclipIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 8.5l4.95-4.95a2.12 2.12 0 013 3L7 11l-2.5 2.5a1.41 1.41 0 01-2-2L7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface AttachmentsExtrasProps {
  readonly controller: AttachmentsController;
}

export function AttachmentsExtras(props: AttachmentsExtrasProps): ReactNode {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [signal, setSignal] = useState<TextareaSignal | undefined>(undefined);

  const search = useMemo(
    () =>
      createMentionSearch({
        search: async (query) => {
          try {
            return await app.messenger.request("searchFiles", { query });
          } catch {
            // Typeahead failures degrade quietly; the composer keeps working.
            return [];
          }
        },
      }),
    [app.messenger],
  );
  const rows = useSyncExternalStore(
    (onChange) => search.onChange(onChange),
    () => search.rows,
    () => search.rows,
  );
  useEffect(() => () => search.cancel(), [search]);

  const mention =
    signal === undefined ? undefined : extractMentionQuery(signal.text, signal.caret);
  const mentionQuery = mention?.query;
  useEffect(() => {
    search.setQuery(mentionQuery);
  }, [search, mentionQuery]);

  // Locate the composer textarea once (this row shares its composer box).
  useEffect(() => {
    const root = containerRef.current;
    if (root === null) return;
    setTextarea(findComposerTextarea(root));
  }, []);

  // Caret/text signal + image pastes, bridged from the composer textarea.
  useEffect(() => {
    if (textarea === null) return;
    const emitSignal = (): void => {
      setSignal({ text: textarea.value, caret: textarea.selectionStart });
    };
    textarea.addEventListener("input", emitSignal);
    textarea.addEventListener("keyup", emitSignal);
    textarea.addEventListener("click", emitSignal);
    return () => {
      textarea.removeEventListener("input", emitSignal);
      textarea.removeEventListener("keyup", emitSignal);
      textarea.removeEventListener("click", emitSignal);
    };
  }, [textarea]);

  const ingestImageFiles = useCallback(
    (files: readonly File[]): void => {
      for (const file of files) {
        void readFileAsDataUrl(file).then(
          (dataUrl) => {
            try {
              props.controller.addImage({ name: file.name, mimeType: file.type, dataUrl });
            } catch (error) {
              if (error instanceof ImageAttachmentError) app.pushToast("error", error.message);
              else app.pushToast("error", COPY.readFailed);
            }
          },
          () => {
            app.pushToast("error", COPY.readFailed);
          },
        );
      }
    },
    [app, props.controller],
  );

  useEffect(() => {
    if (textarea === null) return;
    const onPaste = (event: ClipboardEvent): void => {
      const files = imageFilesFrom(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      ingestImageFiles(files);
    };
    textarea.addEventListener("paste", onPaste);
    return () => {
      textarea.removeEventListener("paste", onPaste);
    };
  }, [textarea, ingestImageFiles]);

  const handlePick = useCallback(
    (path: string): void => {
      props.controller.addPath(path);
      if (textarea !== null) {
        const active = extractMentionQuery(textarea.value, textarea.selectionStart);
        if (active !== undefined) {
          setTextareaValue(textarea, stripMentionToken(textarea.value, active), active.start);
        }
      }
      setSignal(undefined);
      search.cancel();
    },
    [props.controller, search, textarea],
  );

  const flagged = props.controller.chips.filter((chip) => chip.sensitive !== undefined);
  const inputDisabled = composerDisabled(app.serverStatus);

  return (
    <div ref={containerRef} data-oc-attachments-extras>
      {flagged.length > 0 && (
        <div
          data-oc-sensitive-banner
          className="mb-1 rounded-sm border border-err bg-panel-bg px-2 py-1 text-xs text-err"
        >
          <p className="font-medium">{COPY.bannerLead}</p>
          <ul className="mt-0.5">
            {flagged.map((chip) => (
              <li key={chip.id}>
                {chip.name} — {chip.sensitive}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mention !== undefined && rows.length > 0 && (
        <MentionPalette rows={rows} onPick={handlePick} />
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-oc-attach-image
          aria-label={COPY.imageAttachLabel}
          className="rounded-sm border border-border bg-panel-bg px-1.5 py-1 text-muted-fg hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
          disabled={inputDisabled}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          <PaperclipIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files !== null) {
              // No pre-filter here (unlike paste): an explicit pick of a
              // blocked format gets the gate's format toast, never silence.
              ingestImageFiles(Array.from(files));
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}

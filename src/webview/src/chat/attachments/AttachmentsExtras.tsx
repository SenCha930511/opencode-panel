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
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
import {
  baseNameOfPath,
  extractMentionQuery,
  recordMentionPath,
  replaceMentionToken,
} from "./logic.js";
import { MentionPalette } from "./MentionPalette.js";
import { createMentionSearch } from "./search.js";

const COPY = {
  bannerLead: "Sensitive files staged — review before sending:",
  imageAttachLabel: "Attach image",
  readFailed: "Could not read that file.",
} as const;

interface TextareaSignal {
  readonly text: string;
  readonly caret: number;
}

function PlusIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 2.5h6l3.5 3.5v7.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.5 2.5v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImageIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor" />
      <path d="M13.5 10.5l-3.5-3.5-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AtIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M11 8v1.5a1.5 1.5 0 0 0 3 0V8a6 6 0 1 0-2.5 4.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
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
    const searchToken = mentionQuery === undefined ? undefined : (mentionQuery.length === 0 ? "*" : mentionQuery);
    search.setQuery(searchToken);
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

  // Drag-and-drop file ingestion: images attach, workspace/code files insert as @mentions.
  useEffect(() => {
    const host = containerRef.current?.closest("[data-oc-composer]");
    if (!host) return;

    const onDragOver = (event: Event): void => {
      const e = event as DragEvent;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const onDrop = (event: Event): void => {
      const e = event as DragEvent;
      e.preventDefault();
      if (textarea === null) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      const imageFiles: File[] = [];
      const nonImageMentions: string[] = [];

      for (const file of files) {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
          imageFiles.push(file);
        } else {
          const filePath = (file as any).path;
          let target = file.name;
          if (typeof filePath === "string" && filePath.length > 0) {
            const parts = filePath.replace(/\\/g, "/").split("/");
            target = parts[parts.length - 1] || file.name;
            recordMentionPath(target, filePath);
          }
          nonImageMentions.push(`@${target}`);
        }
      }

      if (imageFiles.length > 0) {
        ingestImageFiles(imageFiles);
      }

      if (files.length === 0 && e.dataTransfer) {
        const uriList = e.dataTransfer.getData("text/uri-list");
        const plainText = e.dataTransfer.getData("text/plain");
        const raw = uriList || plainText || "";
        if (raw.length > 0) {
          const lines = raw.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
          for (const line of lines) {
            let clean = line;
            if (clean.startsWith("file://")) {
              try {
                clean = decodeURIComponent(new URL(clean).pathname);
              } catch {
                clean = clean.replace(/^file:\/\//, "");
              }
            }
            const parts = clean.replace(/\\/g, "/").split("/");
            const target = parts[parts.length - 1] || clean;
            if (target.length > 0) {
              recordMentionPath(target, clean);
              nonImageMentions.push(`@${target}`);
            }
          }
        }
      }

      if (nonImageMentions.length > 0) {
        const insertion = nonImageMentions.join(" ") + " ";
        const current = textarea.value;
        const prefix = current.length > 0 && !current.endsWith(" ") ? " " : "";
        const next = `${current}${prefix}${insertion}`;
        setTextareaValue(textarea, next, next.length);
        textarea.focus();
      }
    };

    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);
    return () => {
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
    };
  }, [textarea, ingestImageFiles]);

  const handlePick = useCallback(
    (path: string): void => {
      const fileName = baseNameOfPath(path);
      recordMentionPath(fileName, path);
      if (textarea !== null) {
        const active = extractMentionQuery(textarea.value, textarea.selectionStart);
        if (active !== undefined) {
          const { newText, newCaret } = replaceMentionToken(textarea.value, active, fileName);
          setTextareaValue(textarea, newText, newCaret);
        } else {
          const current = textarea.value;
          const prefix = current.length > 0 && !current.endsWith(" ") ? " " : "";
          const insert = `${prefix}@${fileName} `;
          setTextareaValue(textarea, `${current}${insert}`, current.length + insert.length);
        }
        textarea.focus();
      }
      setSignal(undefined);
      search.cancel();
    },
    [search, textarea],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const ingestGeneralFiles = useCallback(
    (files: readonly File[]): void => {
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          ingestImageFiles([file]);
          continue;
        }
        void readFileAsDataUrl(file).then(
          (dataUrl) => {
            props.controller.add({
              name: file.name,
              mimeType: file.type || "text/plain",
              url: dataUrl,
            });
          },
          () => {
            app.pushToast("error", COPY.readFailed);
          },
        );
      }
    },
    [app, ingestImageFiles, props.controller],
  );

  const flagged = props.controller.chips.filter((chip) => chip.sensitive !== undefined);
  const inputDisabled = composerDisabled(app.serverStatus);

  return (
    <div ref={containerRef} data-oc-attachments-extras className="flex items-center">
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
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-oc-attach-image
              aria-label={COPY.imageAttachLabel}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-card-border bg-card-bg/90 text-muted-fg transition-all hover:bg-hover-bg hover:text-fg hover:border-focus-ring/60 shadow-2xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              disabled={inputDisabled}
            >
              <PlusIcon />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={8}
              className="z-50 min-w-44 rounded-xl border border-card-border bg-panel-bg p-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-black/10 text-xs"
            >
              <DropdownMenu.Item
                className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg outline-none"
                onSelect={() => {
                  fileInputRef.current?.click();
                }}
              >
                <FileIcon />
                <span>選擇檔案...</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg outline-none"
                onSelect={() => {
                  imageInputRef.current?.click();
                }}
              >
                <ImageIcon />
                <span>附加圖片...</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-hover-bg outline-none"
                onSelect={() => {
                  if (textarea !== null) {
                    const current = textarea.value;
                    const prefix = current.length > 0 && !current.endsWith(" ") ? " " : "";
                    setTextareaValue(textarea, `${current}${prefix}@`, current.length + prefix.length + 1);
                    textarea.focus();
                  }
                }}
              >
                <AtIcon />
                <span>提及工作區檔案 (@)</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files !== null) {
              ingestGeneralFiles(Array.from(files));
            }
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files !== null) {
              ingestImageFiles(Array.from(files));
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}

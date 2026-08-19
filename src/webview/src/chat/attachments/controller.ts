// i18n-allow-literal — no display copy in this module.
/**
 * Attachment chip controller (plan todo 17, webview side): the DOM-free
 * owner of the staged-chip list Todo-14's Composer renders. Composer's
 * contract is PARENT-OWNED chips (`attachments` + `onRemoveAttachment`
 * props), so this module IS that parent state: chips keyed by id,
 * add/remove/clear, subscribers re-render on change.
 *
 * EVENT WIRING (two host pushes land here):
 * - `attachments.add` (ATTACHMENTS_ADD_EVENT, parsed in ./constants): the
 *   editor context-menu commands stage a chip; the sensitive reason arrives
 *   WITH the push (the host already flagged it).
 * - clear-on-send: a proven send flips the session to `busy` (todo-9 SSE
 *   lifecycle), so chips clear on the busy transition — failed sends never
 *   reach busy and keep their chips, matching the composer's draft-retention
 *   contract. A prompt started elsewhere (TUI, second window) also clears
 *   staging; that is documented and harmless.
 *
 * The factory is React-free (fully node-testable); `useAttachments` in
 * ./useAttachments.ts is the one-line hook wrapper.
 */

import { isRecord } from "../../../../shared/protocol.js";
import { SESSION_STATUS_EVENT_TYPE, type ChatEventSource } from "../events.js";
import { ATTACHMENTS_ADD_EVENT, parseAttachmentPush, type StagedAttachment } from "./constants.js";
import { attachmentFromImageData, type ImageInput } from "./images.js";
import { chipFromPath } from "./logic.js";

export interface AttachmentsControllerDeps {
  /** Event channel; omit for a standalone controller (tests). */
  readonly events?: ChatEventSource;
  /** Default true: clear staged chips on the session busy transition. */
  readonly clearOnBusy?: boolean;
  readonly idgen?: { (): string };
}

export interface AttachmentsController {
  readonly chips: readonly StagedAttachment[];
  /** Stage a host-pushed (or locally built) chip verbatim. `sensitive` wins. */
  add(input: {
    readonly name: string;
    readonly mimeType: string;
    readonly url: string;
    readonly sensitive?: string;
  }): StagedAttachment;
  /** Stage a chip for a server workspace path (palette pick). */
  addPath(path: string): StagedAttachment;
  /** Gate + stage a pasted/picked image; throws ImageAttachmentError. */
  addImage(input: ImageInput): StagedAttachment;
  remove(id: string): void;
  clear(): void;
  subscribe(listener: { (): void }): { (): void };
  dispose(): void;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

function isBusyStatus(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isRecord(payload.status)) return payload.status.type === "busy";
  return payload.status === "busy";
}

export function createAttachmentsController(
  deps: AttachmentsControllerDeps = {},
): AttachmentsController {
  const idgen = deps.idgen ?? defaultId;
  const listeners = new Set<() => void>();
  let chips: readonly StagedAttachment[] = [];

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const stage = (chip: StagedAttachment): StagedAttachment => {
    chips = [...chips.filter((existing) => existing.id !== chip.id), chip];
    emit();
    return chip;
  };

  const unsubscribe = deps.events?.subscribeEvent((event) => {
    if (event.type === ATTACHMENTS_ADD_EVENT) {
      const push = parseAttachmentPush(event.payload);
      if (push === undefined) return;
      stage({ id: idgen(), ...push.attachment, ...(push.sensitive === undefined ? {} : { sensitive: push.sensitive }) });
      return;
    }
    if (event.type === SESSION_STATUS_EVENT_TYPE && deps.clearOnBusy !== false && isBusyStatus(event.payload)) {
      if (chips.length > 0) {
        chips = [];
        emit();
      }
    }
  });

  return {
    get chips() {
      return chips;
    },
    add(input) {
      const staged = {
        id: idgen(),
        name: input.name,
        mimeType: input.mimeType,
        url: input.url,
        ...(input.sensitive === undefined ? {} : { sensitive: input.sensitive }),
      };
      return stage(staged);
    },
    addPath(path) {
      return stage(chipFromPath(path, idgen()));
    },
    addImage(input) {
      return stage(attachmentFromImageData(input, idgen()));
    },
    remove(id) {
      const next = chips.filter((chip) => chip.id !== id);
      if (next.length === chips.length) return;
      chips = next;
      emit();
    },
    clear() {
      if (chips.length === 0) return;
      chips = [];
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubscribe?.();
      listeners.clear();
    },
  };
}

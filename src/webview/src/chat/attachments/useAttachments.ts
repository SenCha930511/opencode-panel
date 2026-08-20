// i18n-allow-literal — no display copy in this module.
/**
 * React seam (plan todo 17): `useAttachments` wraps the DOM-free
 * {@link createAttachmentsController} for the composing orchestrator. The
 * chips flow into Todo-14 Composer's controlled `attachments` /
 * `onRemoveAttachment` props VERBATIM — the composer stays untouched:
 *
 * ```tsx
 * const attachments = useAttachments();
 * <ChatDock composer={{
 *   attachments: attachments.chips,
 *   onRemoveAttachment: attachments.remove,
 *   extras: <AttachmentsExtras controller={attachments} />,
 * }} />
 * ```
 *
 * (Full contract: ./index.ts header.)
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getWebviewMessenger } from "../../../lib/messenger.js";
import { createMessengerEventSource } from "../events.js";
import {
  createAttachmentsController,
  type AttachmentsController,
} from "./controller.js";

export function useAttachments(
  options: {
    readonly events?: NonNullable<Parameters<typeof createAttachmentsController>[0]>["events"];
    readonly idgen?: () => string;
  } = {},
): AttachmentsController {
  const { events, idgen } = options;
  const controller = useMemo(() => {
    // Lazy default: the singleton messenger resolves here (first effect
    // window), never at module import — the chatContext.ts precedent.
    const source = events ?? createMessengerEventSource(getWebviewMessenger());
    return createAttachmentsController({
      events: source,
      ...(idgen === undefined ? {} : { idgen }),
    });
  }, [events, idgen]);

  useEffect(() => () => controller.dispose(), [controller]);

  // Chips are read through `controller.chips` by consumers; this store
  // subscription only re-renders. The identity IS the snapshot: the
  // controller swaps the array on every mutation.
  useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.chips,
    () => controller.chips,
  );
  return controller;
}

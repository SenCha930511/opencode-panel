/**
 * Session-menu row model + items renderer (plan todo 19, webview side):
 * {@link sessionMenuModel} computes row visibility/enabledness from the
 * resolved message-op availability + session presence (pure, asserted in
 * node tests); {@link SessionMenuItems} renders the Radix items inside a
 * DropdownMenu.Content in production AND under an open Root in SSR
 * assertions, so the labels arrive resolved and this needs no provider.
 */

import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { MessageOpAvailability } from "./logic.js";

export type SessionMenuAction = "summarize" | "share";

export interface SessionMenuModel {
  readonly summarize: boolean;
  readonly share: boolean;
}

// The shell + export rows were retired (user-facing menu now summarizes and
// shares only); their wire infra stays for the command-palette shell entry.
export function sessionMenuModel(input: {
  readonly availability: MessageOpAvailability;
  readonly hasSession: boolean;
}): SessionMenuModel {
  return {
    summarize: input.hasSession && input.availability.summarize,
    share: input.hasSession,
  };
}

export interface SessionMenuItemLabels {
  readonly summarize: string;
  readonly share: string;
}

export const MENU_ITEM_CLASS =
  "cursor-default select-none rounded px-2 py-1 text-xs text-fg outline-none data-disabled:text-muted-fg data-highlighted:bg-hover-bg";

export function SessionMenuItems(props: {
  readonly model: SessionMenuModel;
  readonly labels: SessionMenuItemLabels;
  onSelect(action: SessionMenuAction): void;
}): ReactNode {
  const items: ReactNode[] = [];
  if (props.model.summarize) {
    items.push(
      <DropdownMenu.Item
        key="summarize"
        className={MENU_ITEM_CLASS}
        onSelect={() => props.onSelect("summarize")}
      >
        {props.labels.summarize}
      </DropdownMenu.Item>,
    );
  }
  if (props.model.share) {
    items.push(
      <DropdownMenu.Item
        key="share"
        className={MENU_ITEM_CLASS}
        onSelect={() => props.onSelect("share")}
      >
        {props.labels.share}
      </DropdownMenu.Item>,
    );
  }
  return <>{items}</>;
}

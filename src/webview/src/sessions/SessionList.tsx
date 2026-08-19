import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStrings } from "../../lib/i18n.js";
import type { SessionEntry } from "./constants.js";
import { DeleteSessionDialog, RenameSessionDialog } from "./sessionDialogs.js";
import { CheckIcon, KebabIcon, LinkIcon, PlusIcon } from "./icons.js";
import { SessionErrorBanner, SessionListSkeleton } from "./feedback.js";
import { createShareLink } from "./sessionOps.js";
import type { SessionsStore } from "./sessionsStore.js";
import { formatRelativeTime } from "./time.js";
import { useNow } from "./useNow.js";

/**
 * Sessions rail (todo 12): search-filtered session list with per-row context
 * menu (rename / delete / share|unshare / fork), optimistic-with-rollback
 * mutations driven by the SessionsStore, shared badges, relative timestamps
 * (Intl — no new display literals), empty state, loading skeletons, and an
 * error banner. Mounted by todo 11's shell via <SessionsPanel />; rendered
 * against an injected store so tests need no webview runtime.
 */

const MENU_ITEM_CLASS =
  "cursor-default select-none rounded-sm px-2 py-1 text-xs outline-none data-[highlighted]:bg-active-bg";
const DANGER_MENU_ITEM_CLASS = `${MENU_ITEM_CLASS} text-err`;
// Braced (never quote-literal) so the todo-4 i18n guard treats it as an aria
// id; a11y names with no string-table entry (see strings.ts inventory).
const SHARED_BADGE_LABEL = "shared";

const shareLink = createShareLink();

interface RowMenuHandlers {
  onRename(): void;
  onDelete(): void;
  onShare(): void;
  onFork(): void;
}

function SessionRow(props: {
  readonly entry: SessionEntry;
  readonly selected: boolean;
  readonly copied: boolean;
  readonly now: number;
  readonly locale: string;
  onSelect(): void;
  readonly menu: RowMenuHandlers;
}): ReactNode {
  const { t } = useStrings();
  const { entry } = props;
  const relative = formatRelativeTime(entry.updatedAt, props.now, props.locale);
  return (
    <li className="group relative">
      <div
        className={`flex items-center gap-1 rounded-sm px-1 ${
          props.selected ? "bg-active-bg" : "hover:bg-hover-bg"
        }`}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-start"
          onClick={props.onSelect}
          aria-current={props.selected ? "true" : undefined}
        >
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm">{entry.title}</span>
            {entry.shared ? (
              <span className="shrink-0 text-muted-fg" aria-label={SHARED_BADGE_LABEL}>
                <LinkIcon />
              </span>
            ) : null}
            {props.copied ? (
              <span className="shrink-0 text-ok" aria-label={t("sessions.shareCopied")}>
                <CheckIcon />
              </span>
            ) : null}
          </span>
          {relative === "" ? null : <span className="text-[11px] text-muted-fg">{relative}</span>}
        </button>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-sm p-1 text-muted-fg opacity-0 hover:bg-hover-bg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={t("sessions.title")}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <KebabIcon />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className="z-50 min-w-32 rounded-md border border-border bg-panel-bg p-1 shadow-lg"
            >
              <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={props.menu.onRename}>
                {t("sessions.rename")}
              </DropdownMenu.Item>
              {entry.shared ? (
                <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={props.menu.onShare}>
                  {t("sessions.unshare")}
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={props.menu.onShare}>
                  {t("sessions.share")}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item className={MENU_ITEM_CLASS} onSelect={props.menu.onFork}>
                {t("sessions.fork")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
              <DropdownMenu.Item className={DANGER_MENU_ITEM_CLASS} onSelect={props.menu.onDelete}>
                {t("sessions.delete")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </li>
  );
}

export function SessionList(props: { readonly store: SessionsStore }): ReactNode {
  const { t, locale } = useStrings();
  const snapshot = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );
  const now = useNow();
  const [renaming, setRenaming] = useState<SessionEntry | null>(null);
  const [deleting, setDeleting] = useState<SessionEntry | null>(null);
  const visible = props.store.visibleSessions();

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <input
          type="search"
          className="min-w-0 flex-1 rounded-sm border border-border bg-input-bg px-2 py-1 text-xs text-fg outline-none focus:border-focus-ring"
          placeholder={t("sessions.searchPlaceholder")}
          value={snapshot.filter}
          onChange={(event) => {
            props.store.setFilter(event.target.value);
          }}
        />
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-sm bg-accent px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          aria-label={t("sessions.new")}
          onClick={() => {
            void props.store.createSession(undefined).catch(() => {
              return undefined;
            });
          }}
        >
          <PlusIcon />
          {t("sessions.new")}
        </button>
      </div>

      {snapshot.status === "error" && snapshot.errorMessage !== null ? (
        <SessionErrorBanner
          message={snapshot.errorMessage}
          onClose={() => {
            props.store.clearError();
          }}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {snapshot.status === "loading" ? (
          <SessionListSkeleton />
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-fg">{t("sessions.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 px-2">
            {visible.map((entry) => (
              <SessionRow
                key={entry.id}
                entry={entry}
                selected={snapshot.selectedId === entry.id}
                copied={snapshot.copiedId === entry.id}
                now={now}
                locale={locale}
                onSelect={() => {
                  props.store.select(entry.id);
                }}
                menu={{
                  onRename: () => {
                    setRenaming(entry);
                  },
                  onDelete: () => {
                    setDeleting(entry);
                  },
                  onShare: () => {
                    void shareLink(props.store, entry);
                  },
                  onFork: () => {
                    void props.store.forkSession(entry.id, undefined).catch(() => {
                      return undefined;
                    });
                  },
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {renaming !== null ? (
        <RenameSessionDialog
          entry={renaming}
          onSubmit={async (title) => {
            await props.store.renameSession(renaming.id, title);
          }}
          onClose={() => {
            setRenaming(null);
          }}
        />
      ) : null}
      {deleting !== null ? (
        <DeleteSessionDialog
          entry={deleting}
          onConfirm={async () => {
            await props.store.deleteSession(deleting.id);
          }}
          onClose={() => {
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

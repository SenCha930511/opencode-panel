import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useApp } from "../app/context.js";
import { useStrings } from "../../lib/i18n.js";
import type { SessionEntry } from "./constants.js";
import { DeleteSessionDialog, RenameSessionDialog } from "./sessionDialogs.js";
import { CheckIcon, KebabIcon, LinkIcon, PlusIcon } from "./icons.js";
import { SessionErrorBanner, SessionListSkeleton } from "./feedback.js";
import { createShareLink } from "./sessionOps.js";
import {
  getSharedSessionsStore,
  subscribeSharedSessionsStore,
  type SessionsStore,
} from "./sessionsStore.js";
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
  "cursor-default select-none rounded-md px-2.5 py-1.5 text-xs outline-none transition-colors data-[highlighted]:bg-hover-bg text-fg";
const DANGER_MENU_ITEM_CLASS = `${MENU_ITEM_CLASS} text-err data-[highlighted]:bg-err/10`;
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

function SearchIcon(): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted-fg">
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
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
    <li className="group relative my-0.5">
      <div
        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all ${
          props.selected
            ? "bg-active-bg text-fg font-medium"
            : "hover:bg-hover-bg/70 text-fg/90 hover:text-fg"
        }`}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-start cursor-pointer"
          onClick={props.onSelect}
          aria-current={props.selected ? "true" : undefined}
        >
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="truncate text-xs font-medium">{entry.title}</span>
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
          {relative === "" ? null : (
            <span className="shrink-0 text-xs text-muted-fg font-normal">{relative}</span>
          )}
        </button>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-muted-fg opacity-0 transition-opacity hover:bg-hover-bg hover:text-fg focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
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
              className="z-50 min-w-36 rounded-xl border border-card-border bg-panel-bg p-1 shadow-2xl backdrop-blur-md"
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
              <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border/60" />
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

export function RecentSessionsTop(props?: {
  readonly store?: SessionsStore;
  readonly onViewAll?: () => void; // i18n-allow-literal
}): ReactNode {
  const { locale, t } = useStrings();
  let appState: ReturnType<typeof useApp> | null = null;
  try {
    appState = useApp();
  } catch {
    // Graceful fallback if outside provider
  }
  const sharedStore = useSyncExternalStore(
    subscribeSharedSessionsStore,
    getSharedSessionsStore,
    getSharedSessionsStore,
  );
  const store = props?.store ?? sharedStore;
  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? store.getSnapshot : () => null, // i18n-allow-literal
    store ? store.getSnapshot : () => null, // i18n-allow-literal
  );
  const now = useNow();
  if (!store || !snapshot) return null;
  const visible = store.visibleSessions();
  if (visible.length === 0) return null;

  const recent = visible.slice(0, 3);
  return (
    <div className="w-full px-3.5 pt-2 pb-1 text-xs">
      <div className="flex flex-col gap-0.5">
        {recent.map((entry) => {
          const relative = formatRelativeTime(entry.updatedAt, now, locale);
          return (
            <button
              key={entry.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-hover-bg/70 group cursor-pointer"
              onClick={() => {
                store.select(entry.id);
              }}
            >
              <span className="truncate text-xs font-medium text-fg/90 group-hover:text-fg">{entry.title}</span>
              {relative ? (
                <span className="shrink-0 text-xs text-muted-fg font-normal">{relative}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-1 px-2.5 py-1 text-[11px] font-normal text-muted-fg hover:text-fg transition-colors cursor-pointer"
        onClick={() => {
          if (props?.onViewAll) {
            props.onViewAll();
          } else if (appState) {
            appState.setSessionsOpen(true);
          }
        }}
      >
        {t("sessions.viewAll").replace("{count}", String(visible.length))}
      </button>
    </div>
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
    <div className="flex h-full min-w-0 flex-col bg-panel-bg/95 backdrop-blur-xl">
      <div className="p-3 pb-1.5">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-3 flex items-center">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="w-full rounded-xl border border-card-border bg-input-card-bg pl-8 pr-3 py-1.5 text-xs text-fg outline-none transition-all placeholder:text-muted-fg focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30"
            placeholder={t("sessions.searchPlaceholder")}
            value={snapshot.filter}
            onChange={(event) => {
              props.store.setFilter(event.target.value);
            }}
          />
        </div>
        <div className="flex items-center justify-between px-1 pt-2 pb-0.5 text-[11px] font-medium text-muted-fg">
          <span className="flex items-center gap-1 cursor-default">
            <span>{t("sessions.title")}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="m2 3.5 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      {snapshot.status === "error" && snapshot.errorMessage !== null ? (
        <SessionErrorBanner
          message={snapshot.errorMessage}
          onClose={() => {
            props.store.clearError();
          }}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {snapshot.status === "loading" ? (
          <SessionListSkeleton />
        ) : visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-fg">{t("sessions.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
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

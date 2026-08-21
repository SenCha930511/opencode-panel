// i18n-allow-literal — no display copy in this module: wire codes and error
// text are machine data that surfaces through t() banners elsewhere.
/**
 * Config-file draft store (plan T3): one lane per managed slot keyed
 * `"file:scope"`, lazy loads with in-flight dedup, local JSONC draft
 * editing via the shared jsonc-parser core (comments, key order, and
 * unknown keys survive by construction), mtime-guarded saves, and the
 * host `[<code>]` error taxonomy (`mtime-mismatch` → conflict, anything
 * else → saveError).
 *
 * SEND SEAM: loads and saves ride the injected requester — the messenger
 * `request` DIRECTLY, never the toasting `send` — because save must
 * branch on the `[mtime-mismatch]` prefix exactly like `runSecret` in
 * SettingsPage.tsx catches RemoteError. A rejected load keeps the slot
 * unloaded and records the message in saveError (the only error surface
 * in the pinned slot contract).
 *
 * Components bind through useSyncExternalStore; tests drive the store
 * against a loopback WebviewPort — no DOM anywhere in this module.
 */

import { applyJsoncEdit, type JsoncPath } from "../../../shared/configJsonc.js";
import {
  type ConfigFileId,
  type ConfigScope,
  type FromWebviewProtocol,
  type FromWebviewResponse,
} from "../../../shared/protocol.js";
import {
  CREATE_TEMPLATES,
  emptySlot,
  errorMessage,
  materialize,
  parseErrorOf,
  parseReadReply,
  parseWriteReply,
  type ConfigSlot,
  type SlotState,
} from "./configFilesWire.js";

/** The messenger request seam (direct request, errors throw RemoteError). */
export type ConfigRequester = <K extends keyof FromWebviewProtocol>(
  type: K,
  payload: FromWebviewProtocol[K],
) => Promise<FromWebviewResponse[K]>;

export type ConfigSlotId = `${ConfigFileId}:${ConfigScope}`;

export interface ConfigFilesView {
  readonly slots: Readonly<Record<ConfigSlotId, ConfigSlot>>;
}

type Listener = () => void;

export class ConfigFilesStore {
  private readonly request: ConfigRequester;
  private states: Record<ConfigSlotId, SlotState> = {
    "opencode:global": emptySlot(),
    "opencode:project": emptySlot(),
    "omo:global": emptySlot(),
    "omo:project": emptySlot(),
  };
  private readonly inFlight = new Map<ConfigSlotId, Promise<void>>();
  private readonly listeners = new Set<Listener>();
  private view: ConfigFilesView;

  constructor(request: ConfigRequester) {
    this.request = request;
    this.view = this.buildView();
  }

  getSnapshot = (): ConfigFilesView => this.view;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  slot(file: ConfigFileId, scope: ConfigScope): ConfigSlot {
    return this.view.slots[slotKeyOf(file, scope)];
  }

  /** Ensure-loaded: a loaded slot is a no-op; concurrent loads dedup. */
  load(file: ConfigFileId, scope: ConfigScope): Promise<void> {
    if (this.states[slotKeyOf(file, scope)].loaded) return Promise.resolve();
    return this.requestLoad(file, scope);
  }

  /** Force re-read: discards the draft and adopts the fresh disk text. */
  reload(file: ConfigFileId, scope: ConfigScope): Promise<void> {
    return this.requestLoad(file, scope);
  }

  /** Local JSONC edit on the draft; parse errors recompute in place. */
  editField(file: ConfigFileId, scope: ConfigScope, path: JsoncPath, value: unknown): void {
    const key = slotKeyOf(file, scope);
    const current = this.states[key];
    if (!current.loaded) return;
    const nextText = applyJsoncEdit(current.draftText, path, value);
    if (nextText === current.draftText) return;
    this.patchSlot(key, { draftText: nextText, parseError: parseErrorOf(nextText) });
  }

  /**
   * mtime-guarded write of the draft. `{force:true}` omits
   * expectedMtimeMs to break past the host guard after a conflict.
   */
  async save(file: ConfigFileId, scope: ConfigScope, options?: { readonly force?: boolean }): Promise<boolean> {
    const key = slotKeyOf(file, scope);
    const current = this.states[key];
    if (!current.loaded || current.saving) return false;
    if (current.parseError !== null) {
      this.patchSlot(key, { saveError: current.parseError });
      return false;
    }
    if (current.draftText === current.baseText && options?.force !== true) return false;
    this.patchSlot(key, { saving: true, saveError: null });
    const force = options?.force === true;
    try {
      const reply = parseWriteReply(
        await this.request("configFileWrite", {
          file,
          scope,
          rawText: current.draftText,
          ...(force ? {} : { expectedMtimeMs: current.mtimeMs }),
        }),
      );
      if (reply === undefined) {
        this.patchSlot(key, { saving: false, saveError: "[invalid-payload] malformed configFileWrite reply" });
        return false;
      }
      this.patchSlot(key, {
        saving: false,
        baseText: current.draftText,
        mtimeMs: reply.mtimeMs,
        exists: true,
        legacyNoticePath: null,
        conflict: false,
        saveError: null,
      });
      return true;
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("[mtime-mismatch]")) {
        this.patchSlot(key, { saving: false, conflict: true });
      } else {
        this.patchSlot(key, { saving: false, saveError: message });
      }
      return false;
    }
  }

  /** Drop the draft back to the base text (disk conflict untouched). */
  revert(file: ConfigFileId, scope: ConfigScope): void {
    const key = slotKeyOf(file, scope);
    const current = this.states[key];
    if (!current.loaded) return;
    this.patchSlot(key, {
      draftText: current.baseText,
      parseError: parseErrorOf(current.baseText),
      saveError: null,
    });
  }

  /** Fill the create template; only for a loaded slot whose file is missing. */
  beginCreate(file: ConfigFileId, scope: ConfigScope): void {
    const key = slotKeyOf(file, scope);
    const current = this.states[key];
    if (!current.loaded || current.exists) return;
    const template = CREATE_TEMPLATES[file];
    this.patchSlot(key, { draftText: template, parseError: parseErrorOf(template) });
  }

  private requestLoad(file: ConfigFileId, scope: ConfigScope): Promise<void> {
    const key = slotKeyOf(file, scope);
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;
    const promise = this.request("configFileRead", { file, scope })
      .then((raw) => {
        const reply = parseReadReply(raw);
        if (reply === undefined) {
          this.patchSlot(key, { saveError: "[invalid-payload] malformed configFileRead reply" });
          return;
        }
        this.patchSlot(key, {
          path: reply.path,
          exists: reply.exists,
          baseText: reply.rawText,
          draftText: reply.rawText,
          mtimeMs: reply.mtimeMs,
          parseError: reply.parseError,
          legacyNoticePath: reply.legacyNoticePath ?? null,
          loaded: true,
          saving: false,
          conflict: false,
          saveError: null,
        });
      })
      .catch((error: unknown) => {
        this.patchSlot(key, { saving: false, saveError: errorMessage(error) });
      })
      .then(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private patchSlot(key: ConfigSlotId, patch: Partial<SlotState>): void {
    this.states = { ...this.states, [key]: { ...this.states[key], ...patch } };
    this.emit();
  }

  private buildView(): ConfigFilesView {
    return {
      slots: {
        "opencode:global": materialize(this.states["opencode:global"]),
        "opencode:project": materialize(this.states["opencode:project"]),
        "omo:global": materialize(this.states["omo:global"]),
        "omo:project": materialize(this.states["omo:project"]),
      },
    };
  }

  private emit(): void {
    this.view = this.buildView();
    for (const listener of this.listeners) listener();
  }
}

export function slotKeyOf(file: ConfigFileId, scope: ConfigScope): ConfigSlotId {
  return `${file}:${scope}`;
}

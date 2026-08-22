// i18n-allow-literal — machine data lanes only: JSON subtree text, entry key
// strings, and enum values render through {value} expressions; all human copy
// arrives via useStrings().t() or pre-translated label props.
/**
 * omo.jsonc bespoke section components (plan T4b) — the editors the W3
 * declarative widgets cannot express safely: keyed agent/category records
 * with an ordered mixed-type `models` chain, the seven disabled_* chip
 * multi-selects, number-keyed concurrency maps, the boolean|object
 * runtime_fallback union, freeform JSON subtrees (unknown shapes must never
 * be coerced through the string-only KV/list editors or their entries would
 * be dropped on commit), and the shared-base section editing TOP-LEVEL keys
 * OUTSIDE the [opencode] block (plus $schema/_migrations read-only rows).
 *
 * CYCLE SAFETY: omoSpec.ts imports these components at module scope, so this
 * module may only reference omoSpec bindings (OMO_DISABLED_FIELDS,
 * OMO_SHARED_BASE_KEYS) inside function bodies — never at module top level.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { parseJsonc } from "../../../shared/configJsonc.js";
import { isRecord } from "../../../shared/protocol.js";
import type { StringId } from "../../../shared/strings.js";
import { useStrings } from "../../lib/i18n.js";
import type { SpecComponentContext } from "./configFormRenderer.js";
import type { SpecField } from "./configSpecDispatch.js";
import { SpecFieldControl, valueAt } from "./configSpecDispatch.js";
import { FieldRow, INPUT_CLASS, NumberInput, TextInput, Toggle } from "./configFields.js";
import type { ConfigSlot } from "./configFilesWire.js";
import {
  ChipMultiSelect,
  RecordsTable,
  StringListEditor,
  type RecordsColumn,
} from "./configEditors/index.js";
import { ADD_BUTTON_CLASS, RemoveButton } from "./configEditors/common.js";
import { OMO_DISABLED_FIELDS, OMO_SHARED_BASE_KEYS } from "./omoSpec.js";

const B: readonly [string] = ["[opencode]"];

/** Amber notice chrome shared by the omo tab + bespoke sections. */
export const OMO_NOTICE_CLASS =
  "rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400";

const INFO_NOTICE_CLASS =
  "rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-[11px] leading-relaxed text-info";

type Commit = (path: readonly string[], value: unknown) => void;

function commitOf(context: SpecComponentContext): Commit {
  return (path, value) => {
    context.store.editField(context.file, context.scope, path, value);
  };
}

function slotDisabled(slot: ConfigSlot): boolean {
  return slot.saving;
}

function asStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function recordsOf(raw: unknown): Readonly<Record<string, Record<string, unknown>>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value)) entries[key] = value;
  }
  return entries;
}

function numberRecordOf(raw: unknown): Readonly<Record<string, number>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") entries[key] = value;
  }
  return entries;
}

/** Declarative spec fields rendered inside a bespoke component section. */
function SpecRows(props: {
  readonly fields: readonly SpecField[];
  readonly tree: unknown;
  readonly disabled: boolean;
  readonly onCommit: Commit;
}): ReactNode {
  return (
    <>
      {props.fields.map((field) => (
        <FieldRow key={field.path.join("/")} labelId={field.id}>
          <SpecFieldControl
            field={field}
            raw={valueAt(props.tree, field.path)}
            disabled={props.disabled}
            onCommit={(value) => {
              props.onCommit(field.path, value);
            }}
          />
        </FieldRow>
      ))}
    </>
  );
}

function normalizeJsonText(text: string): string | null {
  if (text.trim().length === 0) return null;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Raw JSON subtree editor: the safe lane for config values whose full shape
 * is undocumented (openclaw gateways, claude_code, task, teams, ...). Commits
 * ONLY well-formed JSON, so an in-progress edit can never corrupt the draft.
 */
function JsonTreeEditor(props: {
  readonly label: string;
  readonly value: unknown;
  readonly disabled: boolean;
  onCommit(value: unknown): void;
}): ReactNode {
  const serialized = useMemo(
    () => (props.value === undefined ? "" : JSON.stringify(props.value, null, 2)),
    [props.value],
  );
  const [text, setText] = useState(serialized);
  useEffect(() => {
    if (normalizeJsonText(text) === normalizeJsonText(serialized)) return;
    setText(serialized);
  }, [serialized]);
  const invalid = text.trim().length > 0 && normalizeJsonText(text) === null;
  return (
    <textarea
      aria-label={props.label}
      className={`${INPUT_CLASS} resize-y font-mono text-[11px] leading-relaxed${invalid ? " border-err/60" : ""}`}
      rows={4}
      disabled={props.disabled}
      value={text}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim().length === 0) return;
        try {
          props.onCommit(JSON.parse(next));
        } catch {
          // Local text lane only; commits fire exclusively for parsed JSON.
        }
      }}
    />
  );
}

/** Record<string, number> editor (background_task concurrency maps). */
function NumberKVEditor(props: {
  readonly label: string;
  readonly value: Readonly<Record<string, number>>;
  readonly disabled: boolean;
  onCommit(next: Readonly<Record<string, number>>): void;
}): ReactNode {
  const { t } = useStrings();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState(0);
  const add = (): void => {
    const key = newKey.trim();
    if (key.length === 0) return;
    props.onCommit({ ...props.value, [key]: newValue });
    setNewKey("");
    setNewValue(0);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(props.value).map(([key, value]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="flex-1 truncate rounded-xl border border-card-border/60 bg-card-bg/60 px-3 py-1.5 font-mono text-xs text-fg/90">
            {key}
          </span>
          <div className="flex-1">
            <NumberInput
              label={key}
              disabled={props.disabled}
              value={value}
              onCommit={(next) => {
                props.onCommit({ ...props.value, [key]: next });
              }}
            />
          </div>
          <RemoveButton
            disabled={props.disabled}
            onRemove={() => {
              const { [key]: _removed, ...rest } = props.value;
              props.onCommit(rest);
            }}
          />
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={t("cfg.kv.key")}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={newKey}
          spellCheck={false}
          onChange={(event) => {
            setNewKey(event.target.value);
          }}
        />
        <div className="w-28">
          <NumberInput label={t("cfg.kv.value")} disabled={props.disabled} value={newValue} onCommit={setNewValue} />
        </div>
        <button type="button" className={ADD_BUTTON_CLASS} disabled={props.disabled || newKey.trim().length === 0} onClick={add}>
          {t("cfg.kv.add")}
        </button>
      </div>
    </div>
  );
}

/**
 * Ordered model-chain editor: string entries are editable/removable rows;
 * per-model OBJECT entries render read-only in place (never dropped, never
 * reordered) — the chain's position semantics survive every commit.
 */
function ModelsChainEditor(props: {
  readonly label: string;
  readonly value: unknown;
  readonly disabled: boolean;
  onCommit(next: readonly unknown[]): void;
}): ReactNode {
  const { t } = useStrings();
  const [draft, setDraft] = useState("");
  const items: readonly unknown[] = Array.isArray(props.value) ? props.value : [];
  const add = (): void => {
    const item = draft.trim();
    if (item.length === 0) return;
    props.onCommit([...items, item]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((entry, index) => (
        <div key={String(index)} className="flex items-center gap-1.5">
          {typeof entry === "string" ? (
            <>
              <TextInput
                label={props.label}
                disabled={props.disabled}
                value={entry}
                onCommit={(next) => {
                  const copy = [...items];
                  copy[index] = next;
                  props.onCommit(copy);
                }}
              />
              <RemoveButton
                disabled={props.disabled}
                onRemove={() => {
                  props.onCommit(items.filter((_, removed) => removed !== index));
                }}
              />
            </>
          ) : (
            <span className="flex-1 truncate rounded-xl border border-card-border/60 bg-card-bg/60 px-3 py-1.5 font-mono text-[11px] text-muted-fg">
              {JSON.stringify(entry)}
            </span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={props.label}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || draft.trim().length === 0}
          onClick={add}
        >
          {t("cfg.list.add")}
        </button>
      </div>
    </div>
  );
}

/** Detail-lane chrome mirroring the RecordsTable column cell style. */
function DetailRow(props: { readonly labelId: StringId; readonly children: ReactNode }): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">{t(props.labelId)}</span>
      {props.children}
    </div>
  );
}

type Patch = Record<string, unknown>;
type CommitPatch = (patch: Patch) => void;

/** Agent entry detail lane: models chain, skills, description, prompts. */
function AgentDetail(props: {
  readonly row: Record<string, unknown>;
  readonly commitPatch: CommitPatch;
  readonly disabled: boolean;
}): ReactNode {
  const { t } = useStrings();
  const { row, commitPatch, disabled } = props;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-card-border/40 bg-panel-bg/40 p-2.5">
      <DetailRow labelId="cfg.f.models">
        <ModelsChainEditor
          label={t("cfg.f.models")}
          value={row.models}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ models: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.skills">
        <StringListEditor
          label={t("cfg.f.skills")}
          value={asStringArray(row.skills)}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ skills: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.description">
        <TextInput
          label={t("cfg.f.description")}
          value={typeof row.description === "string" ? row.description : ""}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ description: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.prompt">
        <TextInput
          label={t("cfg.f.prompt")}
          value={typeof row.prompt === "string" ? row.prompt : ""}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ prompt: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.promptAppend">
        <TextInput
          label={t("cfg.f.promptAppend")}
          value={typeof row.prompt_append === "string" ? row.prompt_append : ""}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ prompt_append: next });
          }}
        />
      </DetailRow>
    </div>
  );
}

/** Category entry detail lane: models chain, description, append, prompt cap. */
function CategoryDetail(props: {
  readonly row: Record<string, unknown>;
  readonly commitPatch: CommitPatch;
  readonly disabled: boolean;
}): ReactNode {
  const { t } = useStrings();
  const { row, commitPatch, disabled } = props;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-card-border/40 bg-panel-bg/40 p-2.5">
      <DetailRow labelId="cfg.f.models">
        <ModelsChainEditor
          label={t("cfg.f.models")}
          value={row.models}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ models: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.description">
        <TextInput
          label={t("cfg.f.description")}
          value={typeof row.description === "string" ? row.description : ""}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ description: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.promptAppend">
        <TextInput
          label={t("cfg.f.promptAppend")}
          value={typeof row.prompt_append === "string" ? row.prompt_append : ""}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ prompt_append: next });
          }}
        />
      </DetailRow>
      <DetailRow labelId="cfg.f.maxPromptTokens">
        <NumberInput
          label={t("cfg.f.maxPromptTokens")}
          value={typeof row.max_prompt_tokens === "number" ? row.max_prompt_tokens : 0}
          disabled={disabled}
          onCommit={(next) => {
            commitPatch({ max_prompt_tokens: next });
          }}
        />
      </DetailRow>
    </div>
  );
}

function renderAgentDetail(row: Record<string, unknown>, commitPatch: CommitPatch, disabled: boolean): ReactNode {
  return <AgentDetail row={row} commitPatch={commitPatch} disabled={disabled} />;
}

function renderCategoryDetail(row: Record<string, unknown>, commitPatch: CommitPatch, disabled: boolean): ReactNode {
  return <CategoryDetail row={row} commitPatch={commitPatch} disabled={disabled} />;
}

interface RecordsBlockProps {
  readonly context: SpecComponentContext;
  readonly path: readonly string[];
  readonly labelId: StringId;
  readonly columns: readonly RecordsColumn[];
  readonly detail: (row: Record<string, unknown>, commitPatch: CommitPatch, disabled: boolean) => ReactNode; // i18n-allow-literal
  readonly buildRow: () => Record<string, unknown>; // i18n-allow-literal
}

/** Keyed-record editor bound to one absolute path in the draft. */
function RecordsBlock(props: RecordsBlockProps): ReactNode {
  const { t } = useStrings();
  const { context } = props;
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  return (
    <RecordsTable<Record<string, unknown>>
      label={t(props.labelId)}
      columns={props.columns}
      entries={recordsOf(valueAt(tree, props.path))}
      disabled={disabled}
      buildRow={props.buildRow}
      renderDetail={(_name, row, commitPatch) => props.detail(row, commitPatch, disabled)}
      onCommit={(next) => {
        context.store.editField(context.file, context.scope, props.path, next);
      }}
    />
  );
}

const AGENT_COLUMNS: readonly RecordsColumn[] = [
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "reasoning", label: "cfg.f.reasoning", kind: "text" },
  { key: "temperature", label: "cfg.f.temperature", kind: "number" },
  { key: "top_p", label: "cfg.f.topP", kind: "number" },
  { key: "mode", label: "cfg.f.mode", kind: "select", options: ["subagent", "primary", "all"] },
  { key: "disable", label: "cfg.f.disable", kind: "toggle" },
  { key: "color", label: "cfg.f.color", kind: "text" },
  { key: "category", label: "cfg.f.category", kind: "text" },
];

const CATEGORY_COLUMNS: readonly RecordsColumn[] = [
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "reasoning", label: "cfg.f.reasoning", kind: "text" },
  { key: "temperature", label: "cfg.f.temperature", kind: "number" },
  { key: "top_p", label: "cfg.f.topP", kind: "number" },
  { key: "max_tokens", label: "cfg.f.maxTokens", kind: "number" },
  { key: "disable", label: "cfg.f.disable", kind: "toggle" },
];

const MODEL_CATALOG_COLUMNS: readonly RecordsColumn[] = [
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "reasoning", label: "cfg.f.reasoning", kind: "text" },
];

const SHARED_AGENT_COLUMNS: readonly RecordsColumn[] = [
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "reasoning", label: "cfg.f.reasoning", kind: "text" },
  { key: "temperature", label: "cfg.f.temperature", kind: "number" },
  { key: "disable", label: "cfg.f.disable", kind: "toggle" },
];

function buildEmptyRecord(): Record<string, unknown> {
  return { model: "" };
}

function buildModelCatalogRow(): Record<string, unknown> {
  return { model: "", reasoning: "" };
}

/** Tier-1: [opencode].agents records (models chain + skills in the detail lane). */
export function AgentsRecords(context: SpecComponentContext): ReactNode {
  return (
    <RecordsBlock
      context={context}
      path={[...B, "agents"]}
      labelId="cfg.sec.omo.agents"
      columns={AGENT_COLUMNS}
      detail={renderAgentDetail}
      buildRow={buildEmptyRecord}
    />
  );
}

/** Tier-1: [opencode].categories records (models chain + delegation detail). */
export function CategoriesRecords(context: SpecComponentContext): ReactNode {
  return (
    <RecordsBlock
      context={context}
      path={[...B, "categories"]}
      labelId="cfg.sec.omo.categories"
      columns={CATEGORY_COLUMNS}
      detail={renderCategoryDetail}
      buildRow={buildEmptyRecord}
    />
  );
}

/** Tier-1: the seven disabled_* chip multi-selects (known enums + free text). */
export function DisabledChips(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  return (
    <>
      {OMO_DISABLED_FIELDS.map((field) => (
        <FieldRow key={field.key} labelId={field.label}>
          <ChipMultiSelect
            label={t(field.label)}
            options={field.options}
            value={asStringArray(valueAt(tree, [...B, field.key]))}
            disabled={disabled}
            onCommit={(next) => {
              commit([...B, field.key], next);
            }}
          />
        </FieldRow>
      ))}
    </>
  );
}

const BACKGROUND_TASK_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.defaultConcurrency", path: [...B, "background_task", "defaultConcurrency"], kind: "number" },
  { id: "cfg.f.maxDepth", path: [...B, "background_task", "maxDepth"], kind: "number" },
  { id: "cfg.f.staleTimeoutMs", path: [...B, "background_task", "staleTimeoutMs"], kind: "number" },
  { id: "cfg.f.messageStalenessTimeoutMs", path: [...B, "background_task", "messageStalenessTimeoutMs"], kind: "number" },
  { id: "cfg.f.taskTtlMs", path: [...B, "background_task", "taskTtlMs"], kind: "number" },
  { id: "cfg.f.sessionGoneTimeoutMs", path: [...B, "background_task", "sessionGoneTimeoutMs"], kind: "number" },
  { id: "cfg.f.taskCleanupDelayMs", path: [...B, "background_task", "taskCleanupDelayMs"], kind: "number" },
  { id: "cfg.f.syncPollTimeoutMs", path: [...B, "background_task", "syncPollTimeoutMs"], kind: "number" },
  { id: "cfg.f.maxToolCalls", path: [...B, "background_task", "maxToolCalls"], kind: "number" },
  { id: "cfg.f.enabled", path: [...B, "background_task", "circuitBreaker", "enabled"], kind: "toggle" },
  { id: "cfg.f.maxToolCalls", path: [...B, "background_task", "circuitBreaker", "maxToolCalls"], kind: "number" },
  {
    id: "cfg.f.consecutiveThreshold",
    path: [...B, "background_task", "circuitBreaker", "consecutiveThreshold"],
    kind: "number",
  },
];

/** Tier-2: background_task scalars + provider/model concurrency number maps. */
export function BackgroundTaskFields(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  return (
    <>
      <SpecRows fields={BACKGROUND_TASK_FIELDS} tree={tree} disabled={disabled} onCommit={commit} />
      <FieldRow labelId="cfg.f.providerConcurrency">
        <NumberKVEditor
          label={t("cfg.f.providerConcurrency")}
          value={numberRecordOf(valueAt(tree, [...B, "background_task", "providerConcurrency"]))}
          disabled={disabled}
          onCommit={(next) => {
            commit([...B, "background_task", "providerConcurrency"], next);
          }}
        />
      </FieldRow>
      <FieldRow labelId="cfg.f.modelConcurrency">
        <NumberKVEditor
          label={t("cfg.f.modelConcurrency")}
          value={numberRecordOf(valueAt(tree, [...B, "background_task", "modelConcurrency"]))}
          disabled={disabled}
          onCommit={(next) => {
            commit([...B, "background_task", "modelConcurrency"], next);
          }}
        />
      </FieldRow>
    </>
  );
}

const RUNTIME_FALLBACK_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.enabled", path: [...B, "runtime_fallback", "enabled"], kind: "toggle" },
  { id: "cfg.f.maxFallbackAttempts", path: [...B, "runtime_fallback", "max_fallback_attempts"], kind: "number" },
  { id: "cfg.f.cooldownSeconds", path: [...B, "runtime_fallback", "cooldown_seconds"], kind: "number" },
  { id: "cfg.f.timeoutSeconds", path: [...B, "runtime_fallback", "timeout_seconds"], kind: "number" },
  { id: "cfg.f.notifyOnFallback", path: [...B, "runtime_fallback", "notify_on_fallback"], kind: "toggle" },
  {
    id: "cfg.f.restorePrimaryAfterCooldown",
    path: [...B, "runtime_fallback", "restore_primary_after_cooldown"],
    kind: "toggle",
  },
];

/** Tier-2: runtime_fallback — boolean form edits the bool; object form edits fields. */
export function RuntimeFallbackFields(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  const raw = valueAt(tree, [...B, "runtime_fallback"]);
  if (typeof raw === "boolean") {
    return (
      <FieldRow labelId="cfg.f.enabled">
        <Toggle
          label={t("cfg.f.enabled")}
          value={raw}
          disabled={disabled}
          onCommit={(next) => {
            commit([...B, "runtime_fallback"], next);
          }}
        />
      </FieldRow>
    );
  }
  return (
    <>
      <SpecRows fields={RUNTIME_FALLBACK_FIELDS} tree={tree} disabled={disabled} onCommit={commit} />
      <FieldRow labelId="cfg.f.retryOnErrors">
        <JsonTreeEditor
          label={t("cfg.f.retryOnErrors")}
          value={valueAt(tree, [...B, "runtime_fallback", "retry_on_errors"])}
          disabled={disabled}
          onCommit={(next) => {
            commit([...B, "runtime_fallback", "retry_on_errors"], next);
          }}
        />
      </FieldRow>
    </>
  );
}

/** Tier-2: claude_code — all sub-keys are freeform; one safe JSON lane. */
export function ClaudeCodeFields(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  return (
    <FieldRow labelId="cfg.f.claudeCode">
      <JsonTreeEditor
        label={t("cfg.f.claudeCode")}
        value={valueAt(tree, [...B, "claude_code"])}
        disabled={disabled}
        onCommit={(next) => {
          commit([...B, "claude_code"], next);
        }}
      />
    </FieldRow>
  );
}

const OTHER_TYPED_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.enabled", path: [...B, "team_mode", "enabled"], kind: "toggle" },
  { id: "cfg.f.baseDir", path: [...B, "team_mode", "base_dir"], kind: "text" },
  { id: "cfg.f.mailboxPollIntervalMs", path: [...B, "team_mode", "mailbox_poll_interval_ms"], kind: "number" },
  { id: "cfg.f.maxMemberTurns", path: [...B, "team_mode", "max_member_turns"], kind: "number" },
  { id: "cfg.f.maxMembers", path: [...B, "team_mode", "max_members"], kind: "number" },
  { id: "cfg.f.maxMessagesPerRun", path: [...B, "team_mode", "max_messages_per_run"], kind: "number" },
  { id: "cfg.f.maxParallelMembers", path: [...B, "team_mode", "max_parallel_members"], kind: "number" },
  { id: "cfg.f.maxWallClockMinutes", path: [...B, "team_mode", "max_wall_clock_minutes"], kind: "number" },
  { id: "cfg.f.messagePayloadMaxBytes", path: [...B, "team_mode", "message_payload_max_bytes"], kind: "number" },
  { id: "cfg.f.recipientUnreadMaxBytes", path: [...B, "team_mode", "recipient_unread_max_bytes"], kind: "number" },
  { id: "cfg.f.tmuxVisualization", path: [...B, "team_mode", "tmux_visualization"], kind: "toggle" },
  { id: "cfg.f.enabled", path: [...B, "monitor", "enabled"], kind: "toggle" },
  { id: "cfg.f.allowedCommands", path: [...B, "monitor", "allowed_commands"], kind: "list" },
  { id: "cfg.f.batchMaxBytes", path: [...B, "monitor", "batch_max_bytes"], kind: "number" },
  { id: "cfg.f.batchMaxLines", path: [...B, "monitor", "batch_max_lines"], kind: "number" },
  { id: "cfg.f.pollIntervalMs", path: [...B, "monitor", "flush_interval_ms"], kind: "number" },
  { id: "cfg.f.lineMaxBytes", path: [...B, "monitor", "line_max_bytes"], kind: "number" },
  { id: "cfg.f.liveModeEnabled", path: [...B, "monitor", "live_mode_enabled"], kind: "toggle" },
  { id: "cfg.f.maxMonitorsPerSession", path: [...B, "monitor", "max_monitors_per_session"], kind: "number" },
  { id: "cfg.f.maxRuntimeMs", path: [...B, "monitor", "max_runtime_ms"], kind: "number" },
  { id: "cfg.f.patternMaxLength", path: [...B, "monitor", "pattern_max_length"], kind: "number" },
  { id: "cfg.f.ringMaxLines", path: [...B, "monitor", "ring_max_lines"], kind: "number" },
  { id: "cfg.f.autoCommit", path: [...B, "start_work", "auto_commit"], kind: "toggle" },
  { id: "cfg.f.autoStart", path: [...B, "goal", "auto_start"], kind: "toggle" },
  { id: "cfg.f.defaultMaxIterations", path: [...B, "goal", "default_max_iterations"], kind: "number" },
  { id: "cfg.f.enabled", path: [...B, "goal", "enabled"], kind: "toggle" },
  { id: "cfg.f.enabled", path: [...B, "openclaw", "enabled"], kind: "toggle" },
  { id: "cfg.f.timeoutMs", path: [...B, "babysitting", "timeout_ms"], kind: "number" },
  { id: "cfg.f.locale", path: [...B, "i18n", "locale"], kind: "text" },
  { id: "cfg.f.disabledKeywords", path: [...B, "keyword_detector", "disabled_keywords"], kind: "list" },
  { id: "cfg.f.enabledExpansions", path: [...B, "keyword_detector", "enabled_expansions"], kind: "list" },
  { id: "cfg.f.provider", path: [...B, "websearch", "provider"], kind: "text" },
  { id: "cfg.f.newTaskSystemEnabled", path: [...B, "new_task_system_enabled"], kind: "toggle" },
  { id: "cfg.f.defaultRunAgent", path: [...B, "default_run_agent"], kind: "text" },
  { id: "cfg.f.modelFallback", path: [...B, "model_fallback"], kind: "toggle" },
  { id: "cfg.f.autoUpdate", path: [...B, "auto_update"], kind: "toggle" },
  { id: "cfg.f.agentOrder", path: [...B, "agent_order"], kind: "list" },
];

const OTHER_JSON_FIELDS: readonly { readonly labelId: StringId; readonly path: readonly string[] }[] = [
  { labelId: "cfg.f.ralphLoop", path: [...B, "ralph_loop"] },
  { labelId: "cfg.f.gateways", path: [...B, "openclaw", "gateways"] },
  { labelId: "cfg.f.hooks", path: [...B, "openclaw", "hooks"] },
  { labelId: "cfg.f.replyListener", path: [...B, "openclaw", "replyListener"] },
  { labelId: "cfg.f.sidebar", path: [...B, "tui", "sidebar"] },
  { labelId: "cfg.f.goal", path: [...B, "default_mode", "goal"] },
  { labelId: "cfg.f.ultrawork", path: [...B, "default_mode", "ultrawork"] },
  { labelId: "cfg.f.agentDefinitions", path: [...B, "agent_definitions"] },
  { labelId: "cfg.f.skills", path: [...B, "skills"] },
  { labelId: "cfg.f.task", path: [...B, "task"] },
  { labelId: "cfg.f.team", path: [...B, "teams"] },
];

/** Tier-2: the long tail of small omo blocks (typed fields + JSON lanes + model catalog). */
export function OtherAdvancedFields(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  return (
    <>
      <SpecRows fields={OTHER_TYPED_FIELDS} tree={tree} disabled={disabled} onCommit={commit} />
      {OTHER_JSON_FIELDS.map((field) => (
        <FieldRow key={field.path.join("/")} labelId={field.labelId}>
          <JsonTreeEditor
            label={t(field.labelId)}
            value={valueAt(tree, field.path)}
            disabled={disabled}
            onCommit={(next) => {
              commit(field.path, next);
            }}
          />
        </FieldRow>
      ))}
      <FieldRow labelId="cfg.f.models">
        <RecordsTable<Record<string, unknown>>
          label={t("cfg.f.models")}
          columns={MODEL_CATALOG_COLUMNS}
          entries={recordsOf(valueAt(tree, [...B, "models"]))}
          disabled={disabled}
          buildRow={buildModelCatalogRow}
          onCommit={(next) => {
            commit([...B, "models"], next);
          }}
        />
      </FieldRow>
    </>
  );
}

const SHARED_CODEGRAPH_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.enabled", path: ["codegraph", "enabled"], kind: "toggle" },
  { id: "cfg.f.autoProvision", path: ["codegraph", "auto_provision"], kind: "toggle" },
  { id: "cfg.f.daemon", path: ["codegraph", "daemon"], kind: "toggle" },
  { id: "cfg.f.telemetry", path: ["codegraph", "telemetry"], kind: "toggle" },
  { id: "cfg.f.installDir", path: ["codegraph", "install_dir"], kind: "text" },
  { id: "cfg.f.watchDebounceMs", path: ["codegraph", "watch_debounce_ms"], kind: "number" },
  { id: "cfg.f.sessionStartCooldownMs", path: ["codegraph", "session_start_cooldown_ms"], kind: "number" },
  { id: "cfg.f.excludedRoots", path: ["codegraph", "excluded_roots"], kind: "list" },
];

const SHARED_GIT_MASTER_FIELDS: readonly SpecField[] = [
  { id: "cfg.f.commitFooter", path: ["git_master", "commit_footer"], kind: "text" },
  { id: "cfg.f.includeCoAuthoredBy", path: ["git_master", "include_co_authored_by"], kind: "toggle" },
  { id: "cfg.f.gitEnvPrefix", path: ["git_master", "git_env_prefix"], kind: "text" },
];

const SHARED_JSON_KEYS = ["memory", "task", "teams", "telemetry"] as const;

type SharedJsonKey = (typeof SHARED_JSON_KEYS)[number];

const SHARED_JSON_LABELS: Readonly<Record<SharedJsonKey, StringId>> = {
  memory: "cfg.f.memory",
  task: "cfg.f.task",
  teams: "cfg.f.team",
  telemetry: "cfg.f.telemetry",
};

/** Read-only display row for $schema / _migrations (never editable). */
function ReadOnlyRow(props: { readonly labelId: StringId; readonly value: string }): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="text-xs font-medium text-fg/90">{t(props.labelId)}</span>
      <code className="rounded-lg border border-card-border/60 bg-card-bg/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-fg">
        {props.value}
      </code>
    </div>
  );
}

/**
 * Tier-2: the shared base — top-level keys OUTSIDE the [opencode] block,
 * shown (and edited) only when already present; the resolution-order note
 * explains who wins. $schema/_migrations render as read-only display rows.
 */
export function SharedBaseSection(context: SpecComponentContext): ReactNode {
  const { t } = useStrings();
  const tree = useMemo(() => parseJsonc(context.slot.draftText).value, [context.slot.draftText]);
  const disabled = slotDisabled(context.slot);
  const commit = commitOf(context);
  const root: Readonly<Record<string, unknown>> = isRecord(tree) ? tree : {};
  const present = (key: string): boolean => OMO_SHARED_BASE_KEYS.includes(key) && key in root;
  return (
    <>
      <p className={INFO_NOTICE_CLASS}>{t("cfg.notice.sharedBase")}</p>
      {typeof root.$schema === "string" ? <ReadOnlyRow labelId="cfg.f.schema" value={root.$schema} /> : null}
      {Array.isArray(root._migrations) ? (
        <ReadOnlyRow labelId="cfg.f.migrations" value={asStringArray(root._migrations).join(", ")} />
      ) : null}
      {present("agents") ? (
        <FieldRow labelId="cfg.f.agents">
          <RecordsBlock
            context={context}
            path={["agents"]}
            labelId="cfg.f.agents"
            columns={SHARED_AGENT_COLUMNS}
            detail={renderAgentDetail}
            buildRow={buildEmptyRecord}
          />
        </FieldRow>
      ) : null}
      {present("categories") ? (
        <FieldRow labelId="cfg.f.categories">
          <RecordsBlock
            context={context}
            path={["categories"]}
            labelId="cfg.f.categories"
            columns={CATEGORY_COLUMNS}
            detail={renderCategoryDetail}
            buildRow={buildEmptyRecord}
          />
        </FieldRow>
      ) : null}
      {present("models") ? (
        <FieldRow labelId="cfg.f.models">
          <RecordsTable<Record<string, unknown>>
            label={t("cfg.f.models")}
            columns={MODEL_CATALOG_COLUMNS}
            entries={recordsOf(valueAt(tree, ["models"]))}
            disabled={disabled}
            buildRow={buildModelCatalogRow}
            onCommit={(next) => {
              commit(["models"], next);
            }}
          />
        </FieldRow>
      ) : null}
      {present("codegraph") ? <SpecRows fields={SHARED_CODEGRAPH_FIELDS} tree={tree} disabled={disabled} onCommit={commit} /> : null}
      {present("git_master") ? <SpecRows fields={SHARED_GIT_MASTER_FIELDS} tree={tree} disabled={disabled} onCommit={commit} /> : null}
      {SHARED_JSON_KEYS.filter(present).map((key) => (
        <FieldRow key={key} labelId={SHARED_JSON_LABELS[key]}>
          <JsonTreeEditor
            label={t(SHARED_JSON_LABELS[key])}
            value={valueAt(tree, [key])}
            disabled={disabled}
            onCommit={(next) => {
              commit([key], next);
            }}
          />
        </FieldRow>
      ))}
    </>
  );
}

/** Read-only banner rendered by the tab when the root `profiles` key exists. */
export function ProfilesNotice(): ReactNode {
  const { t } = useStrings();
  return <p className={OMO_NOTICE_CLASS}>{t("cfg.notice.profiles")}</p>;
}

/** Read-only banner rendered by the tab when the host reports a legacy config. */
export function LegacyNotice(props: { readonly path: string }): ReactNode {
  const { t } = useStrings();
  return <p className={OMO_NOTICE_CLASS}>{t("cfg.notice.legacy").replace("{path}", props.path)}</p>;
}

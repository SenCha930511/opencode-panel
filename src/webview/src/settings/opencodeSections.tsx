/**
 * Bespoke config sections for the opencode.json tab (plan T4a): the complex
 * record groups a flat declarative spec cannot express — the permission
 * block (default shorthand + per-tool actions + bash pattern map), agent /
 * mcp / provider records (type-conditional mcp, masked env/headers, oauth
 * tri-state, provider models with cost/limit/modalities), command records,
 * formatter/lsp boolean-or-record gates, string|git|local references, the
 * boolean tools map, experimental policies (array of objects), and the
 * read-only $schema display. Declarative field lists themselves stay in
 * opencodeSpec.ts and are re-rendered here through the shared dispatch.
 *
 * Import cycle note: this module imports field-list DATA from
 * opencodeSpec.ts while the spec imports these components — deferred use
 * (component bodies run at render, never at module evaluation) keeps the
 * cycle safe. All display copy rides t(); select options are raw config
 * tokens (machine values), matching the W3 Select behavior.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isRecord } from "../../../shared/protocol.js";
import { isSecretPath, parseJsonc } from "../../../shared/configJsonc.js";
import type { StringId } from "../../../shared/strings.js";
import { useStrings } from "../../lib/i18n.js";
import { useCapabilitySnapshot } from "../chat/pickers/capabilityStore.js";
import type { SpecComponentContext } from "./configFormRenderer.js";
import { SpecFieldControl, valueAt, type SpecField } from "./configSpecDispatch.js";
import { FieldRow, INPUT_CLASS, MaskedInput, NumberInput, Select, TextInput, Toggle } from "./configFields.js";
import {
  ADD_BUTTON_CLASS,
  ChipMultiSelect,
  KVMapEditor,
  RecordsTable,
  RemoveButton,
  StringListEditor,
  type RecordsColumn,
} from "./configEditors/index.js";
import {
  EXPERIMENTAL_FIELDS,
  GENERAL_FIELDS_HEAD,
  GENERAL_FIELDS_TAIL,
  TOOLS_FIELDS,
} from "./opencodeSpec.js";

type Ctx = SpecComponentContext;

// ---------------------------------------------------------------------------
// Coercion + commit helpers.
// ---------------------------------------------------------------------------

function asString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function asNumber(raw: unknown): number {
  return typeof raw === "number" ? raw : 0;
}

function asStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string"); // i18n-allow-literal
}

function asStringRecord(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") entries[key] = value;
  }
  return entries;
}

function asRecordEntries(raw: unknown): Readonly<Record<string, Record<string, unknown>>> {
  if (!isRecord(raw)) return {};
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value)) entries[key] = value;
  }
  return entries;
}

function edit(ctx: Ctx, path: readonly string[], value: unknown): void {
  ctx.store.editField(ctx.file, ctx.scope, path, value);
}

/** Parsed draft tree of the section slot (recomputed per draft change). */
function useDraftTree(ctx: Ctx): unknown {
  return useMemo(() => parseJsonc(ctx.slot.draftText).value, [ctx.slot.draftText]); // i18n-allow-literal — code-only expression, no display copy
}

/** Capability-snapshot provider ids (chips options; empty when no push yet). */
function useProviderIds(): readonly string[] {
  const snapshot = useCapabilitySnapshot();
  return snapshot?.providers.map((provider) => provider.id) ?? []; // i18n-allow-literal — code-only expression, no display copy
}

/** Rename a record key in place, preserving entry order. */
function renameKey(entries: Readonly<Record<string, Record<string, unknown>>>, from: string, to: string): Record<string, Record<string, unknown>> {
  const renamed: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(entries)) {
    renamed[key === from ? to : key] = value;
  }
  return renamed;
}

function removeKey<T>(entries: Readonly<Record<string, T>>, name: string): Record<string, T> {
  const { [name]: _removed, ...rest } = entries;
  return rest;
}

/** Render declarative spec fields through the shared W3 dispatch. */
function DeclarativeFields(props: { readonly ctx: Ctx; readonly tree: unknown; readonly fields: readonly SpecField[] }): ReactNode {
  return (
    <>
      {props.fields.map((field) => (
        <FieldRow key={field.path.join("/")} labelId={field.id}>
          <SpecFieldControl
            field={field}
            raw={valueAt(props.tree, field.path)}
            disabled={props.ctx.slot.saving}
            onCommit={(value) => {
              edit(props.ctx, field.path, value);
            }}
          />
        </FieldRow>
      ))}
    </>
  );
}

/** Micro-label used inside record cards (RecordsTable cell style). */
function CardField(props: { readonly labelId: StringId; readonly children: ReactNode }): ReactNode {
  const { t } = useStrings();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">{t(props.labelId)}</span>
      {props.children}
    </div>
  );
}

/** Card chrome shared by the bespoke record editors (RecordsTable look). */
function RecordCard(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-card-border/60 bg-card-bg/60 p-2.5">
      {props.children}
    </div>
  );
}

/** Name/add lane shared by the bespoke keyed-record editors. */
function AddEntryLane(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly exists: (name: string) => boolean; // i18n-allow-literal
  readonly onAdd: (name: string) => void; // i18n-allow-literal
}): ReactNode {
  const { t } = useStrings();
  const [draft, setDraft] = useState("");
  const name = draft.trim();
  return (
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
          if (event.key === "Enter" && name.length > 0 && !props.exists(name)) {
            props.onAdd(name);
            setDraft("");
          }
        }}
      />
      <button
        type="button"
        className={ADD_BUTTON_CLASS}
        disabled={props.disabled || name.length === 0 || props.exists(name)}
        onClick={() => {
          props.onAdd(name);
          setDraft("");
        }}
      >
        {t("cfg.records.add")}
      </button>
    </div>
  );
}

/** Number-or-false input (provider timeout triple): "false" or a decimal. */
function NumberOrFalseInput(props: {
  readonly label: string;
  readonly value: number | false | undefined;
  readonly disabled: boolean;
  onCommit(value: number | false): void;
}): ReactNode {
  const toText = (value: number | false | undefined): string =>
    value === false ? "false" : typeof value === "number" ? String(value) : "";
  const [text, setText] = useState(toText(props.value));
  useEffect(() => {
    if (text === "false" && props.value === false) return;
    if (text.trim().length > 0 && Number(text) === props.value) return;
    if (text.trim().length === 0 && props.value === undefined) return;
    setText(toText(props.value));
  }, [props.value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={props.label}
      className={INPUT_CLASS}
      disabled={props.disabled}
      value={text}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === "false") props.onCommit(false);
        else if (/^\d+$/.test(trimmed)) props.onCommit(Number(trimmed));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// General section (autoupdate bool|"notify" + provider chips).
// ---------------------------------------------------------------------------

const AUTOUPDATE_OPTIONS = ["true", "false", "notify"] as const;

function AutoupdateControl(props: { readonly raw: unknown; readonly disabled: boolean; onCommit(value: unknown): void }): ReactNode {
  const { t } = useStrings();
  const value = props.raw === true ? "true" : props.raw === false ? "false" : asString(props.raw);
  return (
    <Select
      label={t("cfg.f.autoupdate")}
      disabled={props.disabled}
      value={value}
      options={AUTOUPDATE_OPTIONS}
      onCommit={(next) => {
        props.onCommit(next === "true" ? true : next === "false" ? false : next);
      }}
    />
  );
}

export function GeneralSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const providerIds = useProviderIds();
  const disabled = ctx.slot.saving;
  return (
    <>
      <DeclarativeFields ctx={ctx} tree={tree} fields={GENERAL_FIELDS_HEAD} />
      <FieldRow labelId="cfg.f.autoupdate">
        <AutoupdateControl
          raw={valueAt(tree, ["autoupdate"])}
          disabled={disabled}
          onCommit={(value) => {
            edit(ctx, ["autoupdate"], value);
          }}
        />
      </FieldRow>
      <DeclarativeFields ctx={ctx} tree={tree} fields={GENERAL_FIELDS_TAIL} />
      <FieldRow labelId="cfg.f.enabledProviders">
        <ChipMultiSelect
          label={t("cfg.f.enabledProviders")}
          disabled={disabled}
          options={providerIds}
          value={asStringArray(valueAt(tree, ["enabled_providers"]))}
          onCommit={(value) => {
            edit(ctx, ["enabled_providers"], value);
          }}
        />
      </FieldRow>
      <FieldRow labelId="cfg.f.disabledProviders">
        <ChipMultiSelect
          label={t("cfg.f.disabledProviders")}
          disabled={disabled}
          options={providerIds}
          value={asStringArray(valueAt(tree, ["disabled_providers"]))}
          onCommit={(value) => {
            edit(ctx, ["disabled_providers"], value);
          }}
        />
      </FieldRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Permission block (also reused as the per-agent permission sub-editor).
// ---------------------------------------------------------------------------

const PERMISSION_ACTIONS = ["ask", "allow", "deny"] as const;

const PERMISSION_TOOLS: ReadonlyArray<{ readonly key: string; readonly label: StringId }> = [
  { key: "read", label: "cfg.f.read" },
  { key: "edit", label: "cfg.f.edit" },
  { key: "glob", label: "cfg.f.glob" },
  { key: "grep", label: "cfg.f.grep" },
  { key: "list", label: "cfg.f.list" },
  { key: "bash", label: "cfg.f.bash" },
  { key: "task", label: "cfg.f.task" },
  { key: "webfetch", label: "cfg.f.webfetch" },
  { key: "websearch", label: "cfg.f.websearch" },
  { key: "todowrite", label: "cfg.f.todowrite" },
  { key: "question", label: "cfg.f.question" },
  { key: "skill", label: "cfg.f.skill" },
  { key: "lsp", label: "cfg.f.lsp" },
  { key: "doom_loop", label: "cfg.f.doomLoop" },
  { key: "external_directory", label: "cfg.f.externalDirectory" },
];

/** Bash-style pattern → action map editor (values are enum selects). */
function ActionMapEditor(props: {
  readonly label: string;
  readonly value: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  onCommit(next: Readonly<Record<string, string>>): void;
}): ReactNode {
  const { t } = useStrings();
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<string>("ask");
  const pattern = newPattern.trim();
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(props.value).map(([key, action]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="flex-1 truncate rounded-xl border border-card-border/60 bg-card-bg/60 px-3 py-1.5 font-mono text-xs text-fg/90">
            {key}
          </span>
          <div className="flex-1">
            <Select
              label={key}
              disabled={props.disabled}
              value={action}
              options={PERMISSION_ACTIONS}
              onCommit={(next) => {
                props.onCommit({ ...props.value, [key]: next });
              }}
            />
          </div>
          <RemoveButton
            disabled={props.disabled}
            onRemove={() => {
              props.onCommit(removeKey(props.value, key));
            }}
          />
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={t("cfg.f.pattern")}
          className={INPUT_CLASS}
          disabled={props.disabled}
          value={newPattern}
          spellCheck={false}
          onChange={(event) => {
            setNewPattern(event.target.value);
          }}
        />
        <div className="flex-1">
          <Select
            label={t("cfg.f.action")}
            disabled={props.disabled}
            value={newAction}
            options={PERMISSION_ACTIONS}
            onCommit={setNewAction}
          />
        </div>
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || pattern.length === 0 || pattern in props.value}
          onClick={() => {
            props.onCommit({ ...props.value, [pattern]: newAction });
            setNewPattern("");
            setNewAction("ask");
          }}
        >
          {t("cfg.kv.add")}
        </button>
      </div>
    </div>
  );
}

export interface PermissionEditorProps {
  readonly ctx: Ctx;
  /** Base path of the permission block (["permission"] or an agent's). */
  readonly base: readonly string[];
  readonly raw: unknown;
}

/**
 * Permission rule set editor: the bare-string shorthand (applies to every
 * tool) drives the default-action select — when the object form is in use
 * no single default exists, so the select locks rather than destroying the
 * per-tool map; per-tool selects edit each tool's action, and a bash object
 * form edits as a pattern → action map.
 */
export function PermissionEditor(props: PermissionEditorProps): ReactNode {
  const { t } = useStrings();
  const { ctx, base, raw } = props;
  const disabled = ctx.slot.saving;
  const objectForm = isRecord(raw) ? raw : undefined;
  return (
    <div className="flex flex-col gap-2">
      <FieldRow labelId="cfg.f.permissionDefault">
        <Select
          label={t("cfg.f.permissionDefault")}
          disabled={disabled || objectForm !== undefined}
          value={asString(raw)}
          options={PERMISSION_ACTIONS}
          onCommit={(value) => {
            edit(ctx, base, value);
          }}
        />
      </FieldRow>
      {PERMISSION_TOOLS.map((tool) => {
        const value = objectForm?.[tool.key];
        return (
          <FieldRow key={tool.key} labelId={tool.label}>
            {tool.key === "bash" && isRecord(value) ? (
              <ActionMapEditor
                label={t(tool.label)}
                disabled={disabled}
                value={asStringRecord(value)}
                onCommit={(next) => {
                  edit(ctx, [...base, "bash"], next);
                }}
              />
            ) : (
              <Select
                label={t(tool.label)}
                disabled={disabled}
                value={asString(value)}
                options={PERMISSION_ACTIONS}
                onCommit={(next) => {
                  edit(ctx, [...base, tool.key], next);
                }}
              />
            )}
          </FieldRow>
        );
      })}
    </div>
  );
}

export function PermissionSection(ctx: Ctx): ReactNode {
  const tree = useDraftTree(ctx);
  return <PermissionEditor ctx={ctx} base={["permission"]} raw={valueAt(tree, ["permission"])} />;
}

// ---------------------------------------------------------------------------
// Agents.
// ---------------------------------------------------------------------------

const AGENT_COLUMNS: readonly RecordsColumn[] = [
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "variant", label: "cfg.f.variant", kind: "text" },
  { key: "temperature", label: "cfg.f.temperature", kind: "number" },
  { key: "top_p", label: "cfg.f.topP", kind: "number" },
  { key: "prompt", label: "cfg.f.prompt", kind: "text" },
  { key: "description", label: "cfg.f.description", kind: "text" },
  { key: "mode", label: "cfg.f.mode", kind: "select", options: ["subagent", "primary", "all"] },
  { key: "hidden", label: "cfg.f.hidden", kind: "toggle" },
  { key: "disable", label: "cfg.f.disable", kind: "toggle" },
  { key: "color", label: "cfg.f.color", kind: "text" },
  { key: "steps", label: "cfg.f.steps", kind: "number" },
];

export function AgentsRecords(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const entries = asRecordEntries(valueAt(tree, ["agent"]));
  return (
    <RecordsTable<Record<string, unknown>>
      label={t("cfg.sec.oc.agents")}
      disabled={ctx.slot.saving}
      columns={AGENT_COLUMNS}
      entries={entries}
      buildRow={() => ({})}
      renderDetail={(name, row) => <PermissionEditor ctx={ctx} base={["agent", name, "permission"]} raw={row["permission"]} />}
      onCommit={(next) => {
        edit(ctx, ["agent"], next);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// MCP servers (type-conditional local/remote + oauth tri-state).
// ---------------------------------------------------------------------------

const MCP_TYPES = ["local", "remote"] as const;

function OauthEditor(props: { readonly ctx: Ctx; readonly base: readonly string[]; readonly raw: unknown }): ReactNode {
  const { t } = useStrings();
  const { ctx, base, raw } = props;
  const disabled = ctx.slot.saving;
  const mode = isRecord(raw) ? "custom" : raw === false ? "disabled" : "auto";
  const oauth = isRecord(raw) ? raw : {};
  return (
    <div className="flex flex-col gap-2">
      <CardField labelId="cfg.f.oauth">
        <Select
          label={t("cfg.f.oauth")}
          disabled={disabled}
          value={mode}
          options={["auto", "custom", "disabled"]}
          onCommit={(next) => {
            if (next === "auto") edit(ctx, base, undefined);
            else if (next === "disabled") edit(ctx, base, false);
            else if (!isRecord(raw)) edit(ctx, base, {});
          }}
        />
      </CardField>
      {mode === "custom" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CardField labelId="cfg.f.clientId">
            <TextInput
              label={t("cfg.f.clientId")}
              disabled={disabled}
              value={asString(oauth["clientId"])}
              onCommit={(value) => {
                edit(ctx, [...base, "clientId"], value);
              }}
            />
          </CardField>
          <CardField labelId="cfg.f.clientSecret">
            <MaskedInput
              label={t("cfg.f.clientSecret")}
              disabled={disabled}
              isSet={asString(oauth["clientSecret"]).length > 0}
              onCommit={(value) => {
                edit(ctx, [...base, "clientSecret"], value);
              }}
            />
          </CardField>
          <CardField labelId="cfg.f.scope">
            <TextInput
              label={t("cfg.f.scope")}
              disabled={disabled}
              value={asString(oauth["scope"])}
              onCommit={(value) => {
                edit(ctx, [...base, "scope"], value);
              }}
            />
          </CardField>
          <CardField labelId="cfg.f.callbackPort">
            <NumberInput
              label={t("cfg.f.callbackPort")}
              disabled={disabled}
              value={asNumber(oauth["callbackPort"])}
              onCommit={(value) => {
                edit(ctx, [...base, "callbackPort"], value);
              }}
            />
          </CardField>
          <CardField labelId="cfg.f.redirectUri">
            <TextInput
              label={t("cfg.f.redirectUri")}
              disabled={disabled}
              value={asString(oauth["redirectUri"])}
              onCommit={(value) => {
                edit(ctx, [...base, "redirectUri"], value);
              }}
            />
          </CardField>
        </div>
      ) : null}
    </div>
  );
}

export function McpRecords(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const disabled = ctx.slot.saving;
  const entries = asRecordEntries(valueAt(tree, ["mcp"]));
  const commitMap = (next: Readonly<Record<string, Record<string, unknown>>>): void => {
    edit(ctx, ["mcp"], next);
  };
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(entries).map(([name, row]) => {
        const base = ["mcp", name] as const;
        const type = asString(row["type"]);
        return (
          <RecordCard key={name}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 font-mono">
                <TextInput
                  label={t("cfg.sec.oc.mcp")}
                  disabled={disabled}
                  value={name}
                  onCommit={(next) => {
                    const trimmed = next.trim();
                    if (trimmed.length === 0 || trimmed === name || trimmed in entries) return;
                    commitMap(renameKey(entries, name, trimmed));
                  }}
                />
              </div>
              <RemoveButton
                disabled={disabled}
                onRemove={() => {
                  commitMap(removeKey(entries, name));
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CardField labelId="cfg.f.type">
                <Select
                  label={t("cfg.f.type")}
                  disabled={disabled}
                  value={type}
                  options={MCP_TYPES}
                  onCommit={(value) => {
                    edit(ctx, [...base, "type"], value);
                  }}
                />
              </CardField>
              <CardField labelId="cfg.f.enabled">
                <Toggle
                  label={t("cfg.f.enabled")}
                  disabled={disabled}
                  value={row["enabled"] === true}
                  onCommit={(value) => {
                    edit(ctx, [...base, "enabled"], value);
                  }}
                />
              </CardField>
              <CardField labelId="cfg.f.timeout">
                <NumberInput
                  label={t("cfg.f.timeout")}
                  disabled={disabled}
                  value={asNumber(row["timeout"])}
                  onCommit={(value) => {
                    edit(ctx, [...base, "timeout"], value);
                  }}
                />
              </CardField>
              {type === "local" ? (
                <CardField labelId="cfg.f.cwd">
                  <TextInput
                    label={t("cfg.f.cwd")}
                    disabled={disabled}
                    value={asString(row["cwd"])}
                    onCommit={(value) => {
                      edit(ctx, [...base, "cwd"], value);
                    }}
                  />
                </CardField>
              ) : null}
              {type === "remote" ? (
                <CardField labelId="cfg.f.url">
                  <TextInput
                    label={t("cfg.f.url")}
                    disabled={disabled}
                    value={asString(row["url"])}
                    onCommit={(value) => {
                      edit(ctx, [...base, "url"], value);
                    }}
                  />
                </CardField>
              ) : null}
            </div>
            {type === "local" ? (
              <>
                <CardField labelId="cfg.f.command">
                  <StringListEditor
                    label={t("cfg.f.command")}
                    disabled={disabled}
                    value={asStringArray(row["command"])}
                    onCommit={(value) => {
                      edit(ctx, [...base, "command"], value);
                    }}
                  />
                </CardField>
                <CardField labelId="cfg.f.environment">
                  <KVMapEditor
                    label={t("cfg.f.environment")}
                    disabled={disabled}
                    value={asStringRecord(row["environment"])}
                    masked={true}
                    onCommit={(value) => {
                      edit(ctx, [...base, "environment"], value);
                    }}
                  />
                </CardField>
              </>
            ) : null}
            {type === "remote" ? (
              <>
                <CardField labelId="cfg.f.headers">
                  <KVMapEditor
                    label={t("cfg.f.headers")}
                    disabled={disabled}
                    value={asStringRecord(row["headers"])}
                    masked={true}
                    onCommit={(value) => {
                      edit(ctx, [...base, "headers"], value);
                    }}
                  />
                </CardField>
                <OauthEditor ctx={ctx} base={[...base, "oauth"]} raw={row["oauth"]} />
              </>
            ) : null}
          </RecordCard>
        );
      })}
      <AddEntryLane
        label={t("cfg.sec.oc.mcp")}
        disabled={disabled}
        exists={(name) => name in entries}
        onAdd={(name) => {
          commitMap({ ...entries, [name]: {} });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers (options block + nested models sub-table).
// ---------------------------------------------------------------------------

const MODEL_STATUS_OPTIONS = ["active", "alpha", "beta", "deprecated"] as const;
const MODALITY_OPTIONS = ["text", "audio", "image", "video", "pdf"] as const;

/** interleaved: boolean | string | { field } — text lane with coercion. */
function InterleavedInput(props: {
  readonly label: string;
  readonly value: unknown;
  readonly disabled: boolean;
  onCommit(value: unknown): void;
}): ReactNode {
  const toText = (value: unknown): string =>
    value === true ? "true" : value === false ? "false" : typeof value === "string" ? value : "";
  const [text, setText] = useState(toText(props.value));
  useEffect(() => {
    if (text === "true" && props.value === true) return;
    if (text === "false" && props.value === false) return;
    if (text === props.value) return;
    setText(toText(props.value));
  }, [props.value]);
  return (
    <input
      type="text"
      aria-label={props.label}
      className={INPUT_CLASS}
      disabled={props.disabled || isRecord(props.value)}
      value={isRecord(props.value) ? "" : text}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === "true") props.onCommit(true);
        else if (trimmed === "false") props.onCommit(false);
        else props.onCommit(next);
      }}
    />
  );
}

function CostEditor(props: { readonly ctx: Ctx; readonly base: readonly string[]; readonly raw: unknown }): ReactNode {
  const { t } = useStrings();
  const { ctx, base, raw } = props;
  const disabled = ctx.slot.saving;
  const cost = isRecord(raw) ? raw : {};
  const over = isRecord(cost["context_over_200k"]) ? cost["context_over_200k"] : {};
  const cells: ReadonlyArray<{ readonly path: readonly string[]; readonly label: StringId; readonly raw: unknown }> = [
    { path: [...base, "input"], label: "cfg.f.input", raw: cost["input"] },
    { path: [...base, "output"], label: "cfg.f.output", raw: cost["output"] },
    { path: [...base, "cache_read"], label: "cfg.f.cacheRead", raw: cost["cache_read"] },
    { path: [...base, "cache_write"], label: "cfg.f.cacheWrite", raw: cost["cache_write"] },
    { path: [...base, "context_over_200k", "input"], label: "cfg.f.input", raw: over["input"] },
    { path: [...base, "context_over_200k", "output"], label: "cfg.f.output", raw: over["output"] },
    { path: [...base, "context_over_200k", "cache_read"], label: "cfg.f.cacheRead", raw: over["cache_read"] },
    { path: [...base, "context_over_200k", "cache_write"], label: "cfg.f.cacheWrite", raw: over["cache_write"] },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">{t("cfg.f.cost")}</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.slice(0, 4).map((cell) => (
          <CardField key={cell.path.join("/")} labelId={cell.label}>
            <NumberInput
              label={t(cell.label)}
              disabled={disabled}
              value={asNumber(cell.raw)}
              onCommit={(value) => {
                edit(ctx, cell.path, value);
              }}
            />
          </CardField>
        ))}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">
        {t("cfg.f.contextOver200k")}
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.slice(4).map((cell) => (
          <CardField key={cell.path.join("/")} labelId={cell.label}>
            <NumberInput
              label={t(cell.label)}
              disabled={disabled}
              value={asNumber(cell.raw)}
              onCommit={(value) => {
                edit(ctx, cell.path, value);
              }}
            />
          </CardField>
        ))}
      </div>
    </div>
  );
}

function ModelEditor(props: { readonly ctx: Ctx; readonly providerName: string; readonly name: string; readonly row: Record<string, unknown> }): ReactNode {
  const { t } = useStrings();
  const { ctx, providerName, name, row } = props;
  const disabled = ctx.slot.saving;
  const base = ["provider", providerName, "models", name] as const;
  const limit = isRecord(row["limit"]) ? row["limit"] : {};
  const variants = isRecord(row["variants"]) ? row["variants"] : {};
  const variantBooleans: Record<string, boolean> = {};
  for (const [variantName, variant] of Object.entries(variants)) {
    variantBooleans[variantName] = isRecord(variant) && variant["disabled"] === true;
  }
  const textCell = (key: string, labelId: StringId): ReactNode => (
    <CardField labelId={labelId}>
      <TextInput
        label={t(labelId)}
        disabled={disabled}
        value={asString(row[key])}
        onCommit={(value) => {
          edit(ctx, [...base, key], value);
        }}
      />
    </CardField>
  );
  const toggleCell = (key: string, labelId: StringId): ReactNode => (
    <CardField labelId={labelId}>
      <Toggle
        label={t(labelId)}
        disabled={disabled}
        value={row[key] === true}
        onCommit={(value) => {
          edit(ctx, [...base, key], value);
        }}
      />
    </CardField>
  );
  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {textCell("id", "cfg.f.id")}
        {textCell("name", "cfg.f.name")}
        {textCell("family", "cfg.f.family")}
        {textCell("release_date", "cfg.f.releaseDate")}
        <CardField labelId="cfg.f.status">
          <Select
            label={t("cfg.f.status")}
            disabled={disabled}
            value={asString(row["status"])}
            options={MODEL_STATUS_OPTIONS}
            onCommit={(value) => {
              edit(ctx, [...base, "status"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.interleaved">
          <InterleavedInput
            label={t("cfg.f.interleaved")}
            disabled={disabled}
            value={row["interleaved"]}
            onCommit={(value) => {
              edit(ctx, [...base, "interleaved"], value);
            }}
          />
        </CardField>
        {toggleCell("attachment", "cfg.f.attachment")}
        {toggleCell("reasoning", "cfg.f.reasoning")}
        {toggleCell("temperature", "cfg.f.temperature")}
        {toggleCell("tool_call", "cfg.f.toolCall")}
        {toggleCell("experimental", "cfg.f.experimental")}
      </div>
      <CostEditor ctx={ctx} base={[...base, "cost"]} raw={row["cost"]} />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">{t("cfg.f.limit")}</span>
        <div className="grid grid-cols-3 gap-2">
          {(["context", "input", "output"] as const).map((key) => {
            const labelId: StringId = key === "context" ? "cfg.f.context" : key === "input" ? "cfg.f.input" : "cfg.f.output";
            return (
              <CardField key={key} labelId={labelId}>
                <NumberInput
                  label={t(labelId)}
                  disabled={disabled}
                  value={asNumber(limit[key])}
                  onCommit={(value) => {
                    edit(ctx, [...base, "limit", key], value);
                  }}
                />
              </CardField>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CardField labelId="cfg.f.modalities">
          <ChipMultiSelect
            label={t("cfg.f.modalities")}
            disabled={disabled}
            options={MODALITY_OPTIONS}
            value={asStringArray(isRecord(row["modalities"]) ? row["modalities"]["input"] : undefined)}
            onCommit={(value) => {
              edit(ctx, [...base, "modalities", "input"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.modalities">
          <ChipMultiSelect
            label={t("cfg.f.modalities")}
            disabled={disabled}
            options={MODALITY_OPTIONS}
            value={asStringArray(isRecord(row["modalities"]) ? row["modalities"]["output"] : undefined)}
            onCommit={(value) => {
              edit(ctx, [...base, "modalities", "output"], value);
            }}
          />
        </CardField>
      </div>
      <CardField labelId="cfg.f.options">
        <KVMapEditor
          label={t("cfg.f.options")}
          disabled={disabled}
          value={asStringRecord(row["options"])}
          maskEntry={(key) => isSecretPath([...base, "options", key])}
          onCommit={(value) => {
            edit(ctx, [...base, "options"], value);
          }}
        />
      </CardField>
      <CardField labelId="cfg.f.headers">
        <KVMapEditor
          label={t("cfg.f.headers")}
          disabled={disabled}
          value={asStringRecord(row["headers"])}
          masked={true}
          onCommit={(value) => {
            edit(ctx, [...base, "headers"], value);
          }}
        />
      </CardField>
      <CardField labelId="cfg.f.variants">
        <BooleanMapEditor
          label={t("cfg.f.variants")}
          disabled={disabled}
          value={variantBooleans}
          onCommit={(next) => {
            const rebuilt: Record<string, unknown> = {};
            for (const [variantName, flag] of Object.entries(next)) {
              rebuilt[variantName] = { disabled: flag };
            }
            edit(ctx, [...base, "variants"], rebuilt);
          }}
        />
      </CardField>
    </>
  );
}

/** Boolean-valued map editor (tools map, model variants). */
function BooleanMapEditor(props: {
  readonly label: string;
  readonly value: Readonly<Record<string, boolean>>;
  readonly disabled: boolean;
  onCommit(next: Readonly<Record<string, boolean>>): void;
}): ReactNode {
  const { t } = useStrings();
  const [draft, setDraft] = useState("");
  const name = draft.trim();
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(props.value).map(([key, flag]) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="flex-1 truncate rounded-xl border border-card-border/60 bg-card-bg/60 px-3 py-1.5 font-mono text-xs text-fg/90">
            {key}
          </span>
          <Toggle
            label={key}
            disabled={props.disabled}
            value={flag}
            onCommit={(next) => {
              props.onCommit({ ...props.value, [key]: next });
            }}
          />
          <RemoveButton
            disabled={props.disabled}
            onRemove={() => {
              props.onCommit(removeKey(props.value, key));
            }}
          />
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
        />
        <button
          type="button"
          className={ADD_BUTTON_CLASS}
          disabled={props.disabled || name.length === 0 || name in props.value}
          onClick={() => {
            props.onCommit({ ...props.value, [name]: true });
            setDraft("");
          }}
        >
          {t("cfg.kv.add")}
        </button>
      </div>
    </div>
  );
}

function ProviderOptionsEditor(props: { readonly ctx: Ctx; readonly base: readonly string[]; readonly raw: unknown }): ReactNode {
  const { t } = useStrings();
  const { ctx, base, raw } = props;
  const disabled = ctx.slot.saving;
  const options = isRecord(raw) ? raw : {};
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">{t("cfg.f.options")}</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CardField labelId="cfg.f.apiKey">
          <MaskedInput
            label={t("cfg.f.apiKey")}
            disabled={disabled}
            isSet={asString(options["apiKey"]).length > 0}
            onCommit={(value) => {
              edit(ctx, [...base, "apiKey"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.baseURL">
          <TextInput
            label={t("cfg.f.baseURL")}
            disabled={disabled}
            value={asString(options["baseURL"])}
            onCommit={(value) => {
              edit(ctx, [...base, "baseURL"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.enterpriseUrl">
          <TextInput
            label={t("cfg.f.enterpriseUrl")}
            disabled={disabled}
            value={asString(options["enterpriseUrl"])}
            onCommit={(value) => {
              edit(ctx, [...base, "enterpriseUrl"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.setCacheKey">
          <Toggle
            label={t("cfg.f.setCacheKey")}
            disabled={disabled}
            value={options["setCacheKey"] === true}
            onCommit={(value) => {
              edit(ctx, [...base, "setCacheKey"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.timeout">
          <NumberOrFalseInput
            label={t("cfg.f.timeout")}
            disabled={disabled}
            value={typeof options["timeout"] === "number" || options["timeout"] === false ? options["timeout"] : undefined}
            onCommit={(value) => {
              edit(ctx, [...base, "timeout"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.headerTimeout">
          <NumberOrFalseInput
            label={t("cfg.f.headerTimeout")}
            disabled={disabled}
            value={
              typeof options["headerTimeout"] === "number" || options["headerTimeout"] === false
                ? options["headerTimeout"]
                : undefined
            }
            onCommit={(value) => {
              edit(ctx, [...base, "headerTimeout"], value);
            }}
          />
        </CardField>
        <CardField labelId="cfg.f.chunkTimeout">
          <NumberInput
            label={t("cfg.f.chunkTimeout")}
            disabled={disabled}
            value={asNumber(options["chunkTimeout"])}
            onCommit={(value) => {
              edit(ctx, [...base, "chunkTimeout"], value);
            }}
          />
        </CardField>
      </div>
    </div>
  );
}

export function ProviderRecords(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const disabled = ctx.slot.saving;
  const entries = asRecordEntries(valueAt(tree, ["provider"]));
  const commitMap = (next: Readonly<Record<string, Record<string, unknown>>>): void => {
    edit(ctx, ["provider"], next);
  };
  const listField = (base: readonly string[], key: string, labelId: StringId, raw: unknown): ReactNode => (
    <CardField labelId={labelId}>
      <StringListEditor
        label={t(labelId)}
        disabled={disabled}
        value={asStringArray(raw)}
        onCommit={(value) => {
          edit(ctx, [...base, key], value);
        }}
      />
    </CardField>
  );
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(entries).map(([name, row]) => {
        const base = ["provider", name] as const;
        const models = asRecordEntries(row["models"]);
        return (
          <RecordCard key={name}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 font-mono">
                <TextInput
                  label={t("cfg.sec.oc.providers")}
                  disabled={disabled}
                  value={name}
                  onCommit={(next) => {
                    const trimmed = next.trim();
                    if (trimmed.length === 0 || trimmed === name || trimmed in entries) return;
                    commitMap(renameKey(entries, name, trimmed));
                  }}
                />
              </div>
              <RemoveButton
                disabled={disabled}
                onRemove={() => {
                  commitMap(removeKey(entries, name));
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CardField labelId="cfg.f.name">
                <TextInput
                  label={t("cfg.f.name")}
                  disabled={disabled}
                  value={asString(row["name"])}
                  onCommit={(value) => {
                    edit(ctx, [...base, "name"], value);
                  }}
                />
              </CardField>
              <CardField labelId="cfg.f.api">
                <TextInput
                  label={t("cfg.f.api")}
                  disabled={disabled}
                  value={asString(row["api"])}
                  onCommit={(value) => {
                    edit(ctx, [...base, "api"], value);
                  }}
                />
              </CardField>
              <CardField labelId="cfg.f.npm">
                <TextInput
                  label={t("cfg.f.npm")}
                  disabled={disabled}
                  value={asString(row["npm"])}
                  onCommit={(value) => {
                    edit(ctx, [...base, "npm"], value);
                  }}
                />
              </CardField>
            </div>
            {listField(base, "env", "cfg.f.env", row["env"])}
            {listField(base, "whitelist", "cfg.f.whitelist", row["whitelist"])}
            {listField(base, "blacklist", "cfg.f.blacklist", row["blacklist"])}
            <ProviderOptionsEditor ctx={ctx} base={[...base, "options"]} raw={row["options"]} />
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-fg/70">
                {t("cfg.f.models")}
              </span>
              {Object.entries(models).map(([modelName, modelRow]) => {
                const modelBase = [...base, "models"] as const;
                return (
                  <RecordCard key={modelName}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 font-mono">
                        <TextInput
                          label={t("cfg.f.models")}
                          disabled={disabled}
                          value={modelName}
                          onCommit={(next) => {
                            const trimmed = next.trim();
                            if (trimmed.length === 0 || trimmed === modelName || trimmed in models) return;
                            edit(ctx, modelBase, renameKey(models, modelName, trimmed));
                          }}
                        />
                      </div>
                      <RemoveButton
                        disabled={disabled}
                        onRemove={() => {
                          edit(ctx, modelBase, removeKey(models, modelName));
                        }}
                      />
                    </div>
                    <ModelEditor ctx={ctx} providerName={name} name={modelName} row={modelRow} />
                  </RecordCard>
                );
              })}
              <AddEntryLane
                label={t("cfg.f.models")}
                disabled={disabled}
                exists={(modelName) => modelName in models}
                onAdd={(modelName) => {
                  edit(ctx, [...base, "models"], { ...models, [modelName]: {} });
                }}
              />
            </div>
          </RecordCard>
        );
      })}
      <AddEntryLane
        label={t("cfg.sec.oc.providers")}
        disabled={disabled}
        exists={(name) => name in entries}
        onAdd={(name) => {
          commitMap({ ...entries, [name]: {} });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commands / formatter / lsp / references.
// ---------------------------------------------------------------------------

const COMMAND_COLUMNS: readonly RecordsColumn[] = [
  { key: "template", label: "cfg.f.template", kind: "text" },
  { key: "description", label: "cfg.f.description", kind: "text" },
  { key: "agent", label: "cfg.f.agent", kind: "text" },
  { key: "model", label: "cfg.f.model", kind: "model" },
  { key: "variant", label: "cfg.f.variant", kind: "text" },
  { key: "subtask", label: "cfg.f.subtask", kind: "toggle" },
];

export function CommandRecords(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const entries = asRecordEntries(valueAt(tree, ["command"]));
  return (
    <RecordsTable<Record<string, unknown>>
      label={t("cfg.sec.oc.commands")}
      disabled={ctx.slot.saving}
      columns={COMMAND_COLUMNS}
      entries={entries}
      buildRow={() => ({})}
      onCommit={(next) => {
        edit(ctx, ["command"], next);
      }}
    />
  );
}

interface ObjectRecordsSectionSpec {
  readonly sectionId: StringId;
  readonly path: readonly string[];
  readonly columns: readonly RecordsColumn[];
  readonly detail: (ctx: Ctx, name: string, row: Record<string, unknown>, commitPatch: (patch: Record<string, unknown>) => void) => ReactNode; // i18n-allow-literal
}

/** Shared boolean-or-record gate (formatter, lsp). */
function BooleanOrRecordsSection(ctx: Ctx, spec: ObjectRecordsSectionSpec): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const raw = valueAt(tree, spec.path);
  if (isRecord(raw)) {
    return (
      <RecordsTable<Record<string, unknown>>
        label={t(spec.sectionId)}
        disabled={ctx.slot.saving}
        columns={spec.columns}
        entries={asRecordEntries(raw)}
        buildRow={() => ({})}
        renderDetail={(name, row, commitPatch) => spec.detail(ctx, name, row, commitPatch)}
        onCommit={(next) => {
          edit(ctx, spec.path, next);
        }}
      />
    );
  }
  return (
    <FieldRow labelId={spec.sectionId === "cfg.sec.oc.formatter" ? "cfg.f.formatter" : "cfg.f.lsp"}>
      <Toggle
        label={t(spec.sectionId === "cfg.sec.oc.formatter" ? "cfg.f.formatter" : "cfg.f.lsp")}
        disabled={ctx.slot.saving}
        value={raw !== false}
        onCommit={(value) => {
          edit(ctx, spec.path, value);
        }}
      />
    </FieldRow>
  );
}

export function FormatterSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  return BooleanOrRecordsSection(ctx, {
    sectionId: "cfg.sec.oc.formatter",
    path: ["formatter"],
    columns: [{ key: "disabled", label: "cfg.f.disabled", kind: "toggle" }],
    detail: (detailCtx, name, row, commitPatch) => (
      <>
        <FieldRow labelId="cfg.f.command">
          <StringListEditor
            label={t("cfg.f.command")}
            disabled={detailCtx.slot.saving}
            value={asStringArray(row["command"])}
            onCommit={(value) => {
              commitPatch({ command: value });
            }}
          />
        </FieldRow>
        <FieldRow labelId="cfg.f.environment">
          <KVMapEditor
            label={t("cfg.f.environment")}
            disabled={detailCtx.slot.saving}
            value={asStringRecord(row["environment"])}
            maskEntry={(key) => isSecretPath(["formatter", name, "environment", key])}
            onCommit={(value) => {
              commitPatch({ environment: value });
            }}
          />
        </FieldRow>
        <FieldRow labelId="cfg.f.extensions">
          <StringListEditor
            label={t("cfg.f.extensions")}
            disabled={detailCtx.slot.saving}
            value={asStringArray(row["extensions"])}
            onCommit={(value) => {
              commitPatch({ extensions: value });
            }}
          />
        </FieldRow>
      </>
    ),
  });
}

export function LspSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  return BooleanOrRecordsSection(ctx, {
    sectionId: "cfg.sec.oc.lsp",
    path: ["lsp"],
    columns: [{ key: "disabled", label: "cfg.f.disabled", kind: "toggle" }],
    detail: (detailCtx, name, row, commitPatch) => (
      <>
        <FieldRow labelId="cfg.f.command">
          <StringListEditor
            label={t("cfg.f.command")}
            disabled={detailCtx.slot.saving}
            value={asStringArray(row["command"])}
            onCommit={(value) => {
              commitPatch({ command: value });
            }}
          />
        </FieldRow>
        <FieldRow labelId="cfg.f.extensions">
          <StringListEditor
            label={t("cfg.f.extensions")}
            disabled={detailCtx.slot.saving}
            value={asStringArray(row["extensions"])}
            onCommit={(value) => {
              commitPatch({ extensions: value });
            }}
          />
        </FieldRow>
        <FieldRow labelId="cfg.f.env">
          <KVMapEditor
            label={t("cfg.f.env")}
            disabled={detailCtx.slot.saving}
            value={asStringRecord(row["env"])}
            maskEntry={(key) => isSecretPath(["lsp", name, "env", key])}
            onCommit={(value) => {
              commitPatch({ env: value });
            }}
          />
        </FieldRow>
        <FieldRow labelId="cfg.f.initialization">
          <KVMapEditor
            label={t("cfg.f.initialization")}
            disabled={detailCtx.slot.saving}
            value={asStringRecord(row["initialization"])}
            onCommit={(value) => {
              commitPatch({ initialization: value });
            }}
          />
        </FieldRow>
      </>
    ),
  });
}

const REFERENCE_KINDS = ["string", "git", "local"] as const;

export function ReferencesRecords(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const disabled = ctx.slot.saving;
  const raw = isRecord(valueAt(tree, ["references"])) ? (valueAt(tree, ["references"]) as Record<string, unknown>) : {};
  const commitMap = (next: Readonly<Record<string, unknown>>): void => {
    edit(ctx, ["references"], next);
  };
  const kindOf = (value: unknown): string => {
    if (typeof value === "string") return "string";
    if (isRecord(value) && "repository" in value) return "git";
    return "local";
  };
  const convert = (kind: string): unknown => {
    if (kind === "string") return "";
    if (kind === "git") return { repository: "" };
    return { path: "" };
  };
  const deep = (name: string, key: string): readonly string[] => ["references", name, key];
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(raw).map(([name, value]) => {
        const kind = kindOf(value);
        const objectForm = isRecord(value) ? value : {};
        const textField = (key: string, labelId: StringId): ReactNode => (
          <CardField labelId={labelId}>
            <TextInput
              label={t(labelId)}
              disabled={disabled}
              value={asString(objectForm[key])}
              onCommit={(next) => {
                edit(ctx, deep(name, key), next);
              }}
            />
          </CardField>
        );
        return (
          <RecordCard key={name}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 font-mono">
                <TextInput
                  label={t("cfg.sec.oc.references")}
                  disabled={disabled}
                  value={name}
                  onCommit={(next) => {
                    const trimmed = next.trim();
                    if (trimmed.length === 0 || trimmed === name || trimmed in raw) return;
                    const renamed: Record<string, unknown> = {};
                    for (const [key, entry] of Object.entries(raw)) {
                      renamed[key === name ? trimmed : key] = entry;
                    }
                    commitMap(renamed);
                  }}
                />
              </div>
              <RemoveButton
                disabled={disabled}
                onRemove={() => {
                  commitMap(removeKey(raw, name));
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CardField labelId="cfg.f.kind">
                <Select
                  label={t("cfg.f.kind")}
                  disabled={disabled}
                  value={kind}
                  options={REFERENCE_KINDS}
                  onCommit={(next) => {
                    if (next !== kind) edit(ctx, ["references", name], convert(next));
                  }}
                />
              </CardField>
              {kind === "string" ? (
                <CardField labelId="cfg.kv.value">
                  <TextInput
                    label={t("cfg.kv.value")}
                    disabled={disabled}
                    value={asString(value)}
                    onCommit={(next) => {
                      edit(ctx, ["references", name], next);
                    }}
                  />
                </CardField>
              ) : null}
              {kind === "git" ? textField("repository", "cfg.f.repository") : null}
              {kind === "git" ? textField("branch", "cfg.f.branch") : null}
              {kind === "local" ? textField("path", "cfg.f.path") : null}
              {kind === "string" ? null : textField("description", "cfg.f.description")}
              {kind === "string" ? null : (
                <CardField labelId="cfg.f.hidden">
                  <Toggle
                    label={t("cfg.f.hidden")}
                    disabled={disabled}
                    value={objectForm["hidden"] === true}
                    onCommit={(next) => {
                      edit(ctx, deep(name, "hidden"), next);
                    }}
                  />
                </CardField>
              )}
            </div>
          </RecordCard>
        );
      })}
      <AddEntryLane
        label={t("cfg.sec.oc.references")}
        disabled={disabled}
        exists={(name) => name in raw}
        onAdd={(name) => {
          commitMap({ ...raw, [name]: "" });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools map + tool_output bounds; experimental (+ policies array).
// ---------------------------------------------------------------------------

export function ToolsSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const raw = isRecord(valueAt(tree, ["tools"])) ? (valueAt(tree, ["tools"]) as Record<string, unknown>) : {};
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    flags[key] = value === true;
  }
  return (
    <>
      <FieldRow labelId="cfg.f.tools">
        <BooleanMapEditor
          label={t("cfg.f.tools")}
          disabled={ctx.slot.saving}
          value={flags}
          onCommit={(next) => {
            edit(ctx, ["tools"], next);
          }}
        />
      </FieldRow>
      <DeclarativeFields ctx={ctx} tree={tree} fields={TOOLS_FIELDS} />
    </>
  );
}

const POLICY_ACTIONS = ["provider.use"] as const;
const POLICY_EFFECTS = ["allow", "deny"] as const;

export function ExperimentalSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const disabled = ctx.slot.saving;
  const rawPolicies = valueAt(tree, ["experimental", "policies"]);
  const policies = Array.isArray(rawPolicies) ? rawPolicies.filter(isRecord) : [];
  const commitPolicies = (next: readonly Record<string, unknown>[]): void => {
    edit(ctx, ["experimental", "policies"], next);
  };
  return (
    <>
      <DeclarativeFields ctx={ctx} tree={tree} fields={EXPERIMENTAL_FIELDS} />
      <FieldRow labelId="cfg.f.policies">
        <div className="flex flex-col gap-2">
          {policies.map((policy, index) => (
            <div key={`${String(index)}:${asString(policy["resource"])}`} className="flex items-center gap-1.5">
              <div className="flex-1">
                <Select
                  label={t("cfg.f.action")}
                  disabled={disabled}
                  value={asString(policy["action"])}
                  options={POLICY_ACTIONS}
                  onCommit={(value) => {
                    const next = [...policies];
                    next[index] = { ...policy, action: value };
                    commitPolicies(next);
                  }}
                />
              </div>
              <div className="flex-1">
                <Select
                  label={t("cfg.f.effect")}
                  disabled={disabled}
                  value={asString(policy["effect"])}
                  options={POLICY_EFFECTS}
                  onCommit={(value) => {
                    const next = [...policies];
                    next[index] = { ...policy, effect: value };
                    commitPolicies(next);
                  }}
                />
              </div>
              <div className="flex-1">
                <TextInput
                  label={t("cfg.f.resource")}
                  disabled={disabled}
                  value={asString(policy["resource"])}
                  onCommit={(value) => {
                    const next = [...policies];
                    next[index] = { ...policy, resource: value };
                    commitPolicies(next);
                  }}
                />
              </div>
              <RemoveButton
                disabled={disabled}
                onRemove={() => {
                  commitPolicies(policies.filter((_, entry) => entry !== index)); // i18n-allow-literal
                }}
              />
            </div>
          ))}
          <div>
            <button
              type="button"
              className={ADD_BUTTON_CLASS}
              disabled={disabled}
              onClick={() => {
                commitPolicies([...policies, { action: "provider.use", effect: "allow", resource: "" }]);
              }}
            >
              {t("cfg.records.add")}
            </button>
          </div>
        </div>
      </FieldRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// $schema read-only display.
// ---------------------------------------------------------------------------

export function SchemaMetaSection(ctx: Ctx): ReactNode {
  const { t } = useStrings();
  const tree = useDraftTree(ctx);
  const raw = valueAt(tree, ["$schema"]);
  const migrations = valueAt(tree, ["_migrations"]);
  return (
    <>
      <FieldRow labelId="cfg.f.schema">
        <input
          type="text"
          aria-label={t("cfg.f.schema")}
          className={INPUT_CLASS}
          disabled={true}
          readOnly={true}
          value={asString(raw)}
          spellCheck={false}
        />
      </FieldRow>
      {migrations === undefined ? null : (
        <FieldRow labelId="cfg.f.migrations">
          <input
            type="text"
            aria-label={t("cfg.f.migrations")}
            className={INPUT_CLASS}
            disabled={true}
            readOnly={true}
            value={JSON.stringify(migrations)}
            spellCheck={false}
          />
        </FieldRow>
      )}
    </>
  );
}

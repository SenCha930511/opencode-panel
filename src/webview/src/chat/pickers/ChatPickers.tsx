/**
 * Agent + model picker chips (plan todo 15), self-contained for chat-section
 * composition.
 *
 * COMPOSITION CONTRACT for T14's composer: mount {@link ChatPickers} as a
 * sibling row directly ABOVE the textarea in the chat section (the dropdowns
 * open upward); nothing else is required — the row reads the capability
 * store itself and writes selections into chat/composerState.ts keyed by the
 * todo-13 active session. Menus are pointer-driven; the composer owns all
 * textarea key handling.
 *
 * HIDE RULES (todo-15 QA / defensive rendering): the agent dropdown renders
 * NOTHING when the server advertises no agents (old-server scenario — and
 * chat/composerState.ts then also omits `agent` from prompts, its QA twin);
 * the model dropdown renders nothing when no provider group carries models;
 * provider groups without models are hidden rather than rendered empty. No
 * provider or agent name is ever invented — everything rendered is pushed
 * data (custom/OMO agent names appear verbatim, badged via the data heuristic
 * in pickers/logic.ts).
 */

import { useEffect, useState, type ReactNode } from "react";
import { useStrings } from "../../../lib/i18n.js";
import { useApp } from "../../app/context.js";
import { useActiveSession } from "../activeSession.js";
import {
  setAgentSelection,
  setModelSelection,
  usePickerSelection,
} from "../composerState.js";
import type { AgentEntry, ProviderEntry } from "./constants.js";
import { attachCapabilityStore, useCapabilitySnapshot } from "./capabilityStore.js";
import { agentRows, resolveInitialModel } from "./logic.js";
import { PickerDropdown, type PickerGroup, type PickerRow } from "./PickerDropdown.js";

// ---------------------------------------------------------------------------
// Agent dropdown (hides entirely on an empty agent list — QA rule).

export interface AgentPickerProps {
  readonly agents: readonly AgentEntry[];
  readonly value?: string;
  onPick(name: string): void;
  /** Test seam: SSR suites render the menu deterministically open. */
  readonly initialOpen?: boolean;
}

function RobotIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5V4M5 1.5h6M6 8h.01M10 8h.01M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5L9.5 6L14 7.5L9.5 9L8 13.5L6.5 9L2 7.5L6.5 6L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentPicker(props: AgentPickerProps): ReactNode {
  const { t } = useStrings();
  const [open, setOpen] = useState(props.initialOpen === true);
  if (props.agents.length === 0) return null;
  const rows: PickerRow[] = agentRows(props.agents).map((row) => ({
    key: row.entry.name,
    primary: row.entry.name,
    ...(row.entry.mode === undefined ? {} : { secondary: row.entry.mode }),
    ...(row.custom ? { badge: t("picker.agent.customBadge") } : {}),
    selected: row.entry.name === props.value,
  }));
  const fullTooltip = props.value ? `${t("picker.agent.title")}: ${props.value}` : undefined;
  return (
    <PickerDropdown
      title={t("picker.agent.title")}
      icon={<RobotIcon />}
      groups={[{ rows }]}
      open={open}
      {...(props.value === undefined
        ? {}
        : { currentLabel: props.value, displayLabel: props.value })}
      {...(fullTooltip === undefined ? {} : { tooltip: fullTooltip })}
      onToggle={() => {
        setOpen((current) => !current);
      }}
      onClose={() => {
        setOpen(false);
      }}
      onPick={(key) => {
        setOpen(false);
        props.onPick(key);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Model dropdown, grouped by provider (groups without models hidden).

export interface ModelPickerProps {
  readonly providers: readonly ProviderEntry[];
  /** Effective current value "provider/model" (selection or server default). */
  readonly value?: string;
  onPick(id: string): void;
  /** Test seam: SSR suites render the menu deterministically open. */
  readonly initialOpen?: boolean;
}

export function ModelPicker(props: ModelPickerProps): ReactNode {
  const { t } = useStrings();
  const [open, setOpen] = useState(props.initialOpen === true);
  const groups: PickerGroup[] = [];
  let currentModelName: string | undefined;
  let currentProviderName: string | undefined;
  for (const provider of props.providers) {
    if (provider.models.length === 0) continue;
    groups.push({
      label: provider.name,
      rows: provider.models.map((model) => {
        const key = `${provider.id}/${model.id}`;
        const isSelected = key === props.value || model.id === props.value;
        if (isSelected) {
          currentModelName = model.name;
          currentProviderName = provider.name;
        }
        return { key, primary: model.name, secondary: model.id, selected: isSelected };
      }),
    });
  }
  if (groups.length === 0) return null;

  // Short display label: prefer model.name or the last segment after '/'
  let shortLabel: string | undefined;
  if (currentModelName) {
    shortLabel = currentModelName;
  } else if (props.value) {
    shortLabel = props.value.includes("/") ? props.value.split("/").pop() : props.value;
  }

  // Full tooltip on mouse hover
  const fullTooltip = props.value
    ? currentProviderName && currentModelName
      ? `${currentProviderName} / ${currentModelName} (${props.value})`
      : props.value
    : undefined;

  return (
    <PickerDropdown
      title={t("picker.model.title")}
      icon={<SparkleIcon />}
      groups={groups}
      open={open}
      {...(props.value === undefined ? {} : { currentLabel: props.value })}
      {...(shortLabel === undefined ? {} : { displayLabel: shortLabel })}
      {...(fullTooltip === undefined ? {} : { tooltip: fullTooltip })}
      onToggle={() => {
        setOpen((current) => !current);
      }}
      onClose={() => {
        setOpen(false);
      }}
      onPick={(key) => {
        setOpen(false);
        props.onPick(key);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The T14 mount point: both pickers over the live stores.

export function ChatPickers(): ReactNode {
  const { messenger } = useApp();
  const sessionId = useActiveSession();
  const snapshot = useCapabilitySnapshot();
  const selection = usePickerSelection(sessionId ?? "");

  useEffect(() => {
    attachCapabilityStore(messenger);
  }, [messenger]);

  if (snapshot === undefined) return null;
  const showAgent = snapshot.agents.length > 0;
  const showModel = snapshot.providers.some((provider) => provider.models.length > 0);
  if (!showAgent && !showModel) return null;

  const modelValue =
    selection.model ??
    resolveInitialModel({
      providers: snapshot.providers,
      defaultModels: snapshot.defaultModels,
      ...(snapshot.defaultModel === undefined ? {} : { defaultModel: snapshot.defaultModel }),
    });

  return (
    <div data-oc="chat-pickers" className="flex items-center gap-1.5 min-w-0">
      <AgentPicker
        agents={snapshot.agents}
        {...(selection.agent === undefined ? {} : { value: selection.agent })}
        onPick={(name) => {
          setAgentSelection(sessionId ?? "", name);
        }}
      />
      <ModelPicker
        providers={snapshot.providers}
        {...(modelValue === undefined ? {} : { value: modelValue })}
        onPick={(id) => {
          setModelSelection(sessionId ?? "", id);
        }}
      />
    </div>
  );
}

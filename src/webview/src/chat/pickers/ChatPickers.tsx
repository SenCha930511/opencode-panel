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
  return (
    <PickerDropdown
      title={t("picker.agent.title")}
      groups={[{ rows }]}
      open={open}
      {...(props.value === undefined ? {} : { currentLabel: props.value })}
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
  for (const provider of props.providers) {
    if (provider.models.length === 0) continue;
    groups.push({
      label: provider.name,
      rows: provider.models.map((model) => {
        const key = `${provider.id}/${model.id}`;
        return { key, primary: model.name, secondary: model.id, selected: key === props.value };
      }),
    });
  }
  if (groups.length === 0) return null;
  return (
    <PickerDropdown
      title={t("picker.model.title")}
      groups={groups}
      open={open}
      {...(props.value === undefined ? {} : { currentLabel: props.value })}
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
    <div data-oc="chat-pickers" className="flex flex-wrap items-center gap-1 px-2 pb-1">
      <AgentPicker
        agents={snapshot.agents}
        {...(selection.agent === undefined ? {} : { value: selection.agent })}
        onPick={(name) => {
          if (sessionId === undefined) return;
          setAgentSelection(sessionId, name);
        }}
      />
      <ModelPicker
        providers={snapshot.providers}
        {...(modelValue === undefined ? {} : { value: modelValue })}
        onPick={(id) => {
          if (sessionId === undefined) return;
          setModelSelection(sessionId, id);
        }}
      />
    </div>
  );
}

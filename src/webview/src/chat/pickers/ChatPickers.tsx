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

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isRecord } from "../../../../shared/protocol.js";
import { useStrings } from "../../../lib/i18n.js";
import { useApp } from "../../app/context.js";
import { useActiveSession } from "../activeSession.js";
import {
  setAgentSelection,
  setModelSelection,
  usePickerSelection,
} from "../composerState.js";
import { useChatStore } from "../MessageList.js";
import type { MessageStore } from "../messageStore.js";
import type { MessageVM } from "../types.js";
import type { AgentEntry, ProviderEntry } from "./constants.js";
import { attachCapabilityStore, useCapabilitySnapshot } from "./capabilityStore.js";
import { agentRows, isCustomAgent, resolveInitialModel } from "./logic.js";
import { PickerDropdown, type PickerGroup, type PickerRow } from "./PickerDropdown.js";

export function extractSessionAgentAndModel(
  messages: readonly MessageVM[] | undefined,
): { agent?: string; model?: string } {
  if (!messages || messages.length === 0) return {};
  let agent: string | undefined;
  let model: string | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !msg.info) continue;
    const info = msg.info;

    if (!agent) {
      if (typeof info.agent === "string" && info.agent.length > 0) {
        agent = info.agent;
      } else if (typeof info.agentID === "string" && info.agentID.length > 0) {
        agent = info.agentID;
      } else if (typeof info.mode === "string" && info.mode.length > 0) {
        agent = info.mode;
      }
    }

    if (!model) {
      if (typeof info.model === "string" && info.model.length > 0) {
        model = info.model;
      } else if (isRecord(info.model)) {
        const prov =
          typeof info.model.providerID === "string"
            ? info.model.providerID
            : typeof info.model.provider === "string"
              ? info.model.provider
              : "";
        const mid =
          typeof info.model.modelID === "string"
            ? info.model.modelID
            : typeof info.model.model === "string"
              ? info.model.model
              : typeof info.model.id === "string"
                ? info.model.id
                : "";
        if (prov && mid) model = `${prov}/${mid}`;
        else if (mid) model = mid;
      } else if (typeof info.providerID === "string" && typeof info.modelID === "string") {
        model = `${info.providerID}/${info.modelID}`;
      } else if (typeof info.modelID === "string" && info.modelID.length > 0) {
        model = info.modelID;
      }
    }

    if (agent && model) break;
  }

  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
  };
}

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
  readonly value?: string | undefined;
  readonly initialOpen?: boolean;
  readonly locked?: boolean;
  readonly lockedReason?: string;
  onPick(id: string): void;
  onLockedClick?(): void;
}

export function ModelPicker(props: ModelPickerProps): ReactNode {
  const { t } = useStrings();
  const [open, setOpen] = useState(props.initialOpen ?? false);

  let currentProviderName: string | undefined;
  let currentModelName: string | undefined;

  const groups: PickerGroup[] = [];
  for (const provider of props.providers) {
    if (provider.models.length === 0) continue;
    groups.push({
      label: provider.name,
      rows: provider.models.map((model) => {
        const rowKey = `${provider.id}/${model.id}`;
        const isSelected = props.value === rowKey;
        if (isSelected) {
          currentProviderName = provider.name;
          currentModelName = model.name;
        }
        return {
          key: rowKey,
          primary: model.name,
          secondary: model.id,
          selected: isSelected,
        };
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
  const fullTooltip = props.locked && props.lockedReason
    ? props.lockedReason
    : props.value
      ? currentProviderName && currentModelName
        ? `${currentProviderName} / ${currentModelName} (${props.value})`
        : props.value
      : undefined;

  return (
    <PickerDropdown
      title={t("picker.model.title")}
      icon={<SparkleIcon />}
      align="end"
      groups={groups}
      open={open}
      {...(props.locked === undefined ? {} : { locked: props.locked })}
      {...(props.onLockedClick === undefined ? {} : { onLockedClick: props.onLockedClick })}
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
        if (props.locked) return;
        setOpen(false);
        props.onPick(key);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
export interface ChatPickersProps {
  readonly store?: MessageStore;
}

export function ChatPickers(props?: ChatPickersProps): ReactNode {
  const app = useApp();
  const { t } = useStrings();
  const sessionId = useActiveSession();
  const snapshot = useCapabilitySnapshot();
  const selection = usePickerSelection(sessionId ?? "");
  const chatState = props?.store ? useChatStore(props.store) : undefined;

  useEffect(() => {
    attachCapabilityStore(app.messenger);
  }, [app.messenger]);

  const sessionDefaults = useMemo(
    // i18n-allow-literal — code selector, not display copy
    () => extractSessionAgentAndModel(chatState?.messages),
    [chatState?.messages],
  );

  if (snapshot === undefined) return null;
  const showAgent = snapshot.agents.length > 0;
  const showModel = snapshot.providers.some((provider) => provider.models.length > 0);
  if (!showAgent && !showModel) return null;

  const activeAgent = selection.agent ?? sessionDefaults.agent;
  // i18n-allow-literal — code lookup, not display copy
  const currentAgentEntry = snapshot.agents.find((a) => a.name === activeAgent);
  const isLockedAgent = currentAgentEntry?.model !== undefined && currentAgentEntry.model.length > 0;
  const lockedModelId = currentAgentEntry?.model;

  const modelValue =
    (isLockedAgent ? lockedModelId : undefined) ??
    selection.model ??
    sessionDefaults.model ??
    resolveInitialModel({
      providers: snapshot.providers,
      defaultModels: snapshot.defaultModels,
      ...(snapshot.defaultModel === undefined ? {} : { defaultModel: snapshot.defaultModel }),
    });

  const hasCustomAgent = activeAgent !== undefined && isCustomAgent(activeAgent);

  return (
    <div data-oc="chat-pickers" className="flex items-center gap-1 min-w-0 flex-1 overflow-visible">
      <AgentPicker
        agents={snapshot.agents}
        {...(activeAgent === undefined ? {} : { value: activeAgent })}
        onPick={(name) => {
          setAgentSelection(sessionId ?? "", name);
          // i18n-allow-literal — code lookup, not display copy
          const pickedAgent = snapshot.agents.find((a) => a.name === name);
          if (pickedAgent?.model) {
            app.pushToast(
              "info",
              t("picker.agent.lockedToast")
                .replace("{name}", name)
                .replace("{model}", pickedAgent.model),
            );
          } else if (isCustomAgent(name)) {
            app.pushToast(
              "info",
              t("picker.agent.customPickedToast").replace("{name}", name),
            );
          }
        }}
      />
      <ModelPicker
        providers={snapshot.providers}
        locked={isLockedAgent}
        {...(isLockedAgent
          ? {
              lockedReason: t("picker.model.lockedReason")
                .replace("{name}", activeAgent ?? "")
                .replace("{model}", lockedModelId ?? ""),
            }
          : {})}
        onLockedClick={() => {
          app.pushToast(
            "info",
            t("picker.model.lockedToast")
              .replace("{name}", activeAgent ?? "")
              .replace("{model}", lockedModelId ?? ""),
          );
        }}
        {...(modelValue === undefined ? {} : { value: modelValue })}
        onPick={(id) => {
          setModelSelection(sessionId ?? "", id);
          if (hasCustomAgent) {
            app.pushToast(
              "warning",
              t("picker.model.pickedWarningToast")
                .replace("{model}", id.split("/").pop() ?? id)
                .replace("{name}", activeAgent ?? ""),
            );
          }
        }}
      />
    </div>
  );
}

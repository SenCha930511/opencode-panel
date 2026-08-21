/**
 * Declarative config-form renderer (plan T3): a tab ships a spec
 * (sections → fields → paths); this component binds it to a
 * ConfigFilesStore slot — reading the current value out of the parsed
 * draft text, dispatching the widget per field kind (configSpecDispatch),
 * and piping commits into store.editField. When the slot carries a
 * parseError the renderer outputs nothing at all: the read-only
 * banner/preview fallback is the tab's job. Tier-1 sections render open;
 * tier-2 into their own collapsed AdvancedSection under one heading.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { ConfigFileId, ConfigScope } from "../../../shared/protocol.js";
import { parseJsonc } from "../../../shared/configJsonc.js";
import type { StringId } from "../../../shared/strings.js";
import { useStrings } from "../../lib/i18n.js";
import {
  SpecFieldControl,
  valueAt,
  type SpecField,
} from "./configSpecDispatch.js";
import { AdvancedSection, FieldRow, Section } from "./configFields.js";
import { slotKeyOf, type ConfigFilesStore } from "./configFilesStore.js";
import { type ConfigSlot } from "./configFilesWire.js";

export type { SpecColumn, SpecColumnKind, SpecField, SpecFieldKind } from "./configSpecDispatch.js";

/** Context handed to bespoke section components (the W4 escape hatch). */
export interface SpecComponentContext {
  readonly store: ConfigFilesStore;
  readonly file: ConfigFileId;
  readonly scope: ConfigScope;
  readonly slot: ConfigSlot;
}

export interface SpecSection {
  /** Section title id (cfg.sec.*). */
  readonly id: StringId;
  readonly tier: 1 | 2;
  readonly fields?: readonly SpecField[];
  readonly component?: (context: SpecComponentContext) => ReactNode; // i18n-allow-literal
}

export function ConfigFormRenderer(props: {
  readonly store: ConfigFilesStore;
  readonly file: ConfigFileId;
  readonly scope: ConfigScope;
  readonly sections: readonly SpecSection[];
}): ReactNode {
  const { t } = useStrings();
  const view = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot);
  const slot: ConfigSlot = view.slots[slotKeyOf(props.file, props.scope)];
  const tree = useMemo(() => parseJsonc(slot.draftText).value, [slot.draftText]); // i18n-allow-literal
  if (!slot.loaded || slot.parseError !== null) return null;
  const disabled = slot.saving;
  const renderSection = (section: SpecSection): ReactNode => {
    const content =
      section.component !== undefined
        ? section.component({ store: props.store, file: props.file, scope: props.scope, slot })
        : (section.fields ?? []).map((field) => (
            <FieldRow key={field.path.join("/")} labelId={field.id}>
              <SpecFieldControl
                field={field}
                raw={valueAt(tree, field.path)}
                disabled={disabled}
                onCommit={(value) => {
                  props.store.editField(props.file, props.scope, field.path, value);
                }}
              />
            </FieldRow>
          ));
    return section.tier === 1 ? (
      <Section key={section.id} titleId={section.id}>
        {content}
      </Section>
    ) : (
      <AdvancedSection key={section.id} titleId={section.id}>
        {content}
      </AdvancedSection>
    );
  };
  const tier1 = props.sections.filter((section) => section.tier === 1); // i18n-allow-literal
  const tier2 = props.sections.filter((section) => section.tier === 2); // i18n-allow-literal
  return (
    <>
      {tier1.map(renderSection)}
      {tier2.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-fg/80">
            {t("cfg.advanced.title")}
          </h3>
          {tier2.map(renderSection)}
        </div>
      )}
    </>
  );
}

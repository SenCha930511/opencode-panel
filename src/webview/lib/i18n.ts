import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { InitPayload } from "../../shared/protocol.js";
import { en, translateWithFallback, type StringId } from "../../shared/strings.js";

/**
 * Webview i18n binding over the host-injected string table.
 *
 * The host resolves the display locale and injects exactly one full table
 * (keyed by StringId) plus the locale tag in the `init` payload; this module
 * turns that payload into a React context. `t()` delegates to the shared
 * `translateWithFallback` core, so a missing key degrades id -> injected
 * table -> bundled English table -> the id itself (never a crash, never a
 * blank string).
 *
 * Written without JSX on purpose: the root NodeNext tsconfig (which has no
 * `jsx` compiler option) pull-compiles this file through the vitest suites,
 * keeping the provider under `tsc --noEmit` coverage. Vite/TSX components
 * consume `useStrings()` exactly the same either way.
 */

/** The subset of the host `init` payload this provider consumes. */
export type InitStrings = Pick<InitPayload, "locale" | "strings">;

export interface StringsValue {
  /** BCP-47-ish tag the host resolved (currently "en" or "zh-TW"). */
  readonly locale: string;
  readonly t: (id: StringId) => string;
}

/**
 * Pure factory behind the provider — the unit-testable core: bind an init
 * payload to a `t()` with the full fallback chain.
 */
export function createStringsValue(init: InitStrings): StringsValue {
  return {
    locale: init.locale,
    t: (id) => translateWithFallback(init.strings, id),
  };
}

const StringsContext = createContext<StringsValue | null>(null);

/** English-table value used when a component renders outside a provider. */
const fallbackValue: StringsValue = createStringsValue({ locale: "en", strings: en });

export function StringsProvider(props: {
  readonly init: InitStrings;
  readonly children: ReactNode;
}): ReactNode {
  const value = useMemo(
    () => createStringsValue(props.init),
    [props.init.locale, props.init.strings],
  );
  return createElement(StringsContext.Provider, { value }, props.children);
}

export function useStrings(): StringsValue {
  return useContext(StringsContext) ?? fallbackValue;
}

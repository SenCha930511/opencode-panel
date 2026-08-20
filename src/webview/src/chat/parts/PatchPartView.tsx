import type { ReactNode } from "react";
import type { PartVM } from "../types.js";

type PatchPart = Extract<PartVM, { kind: "patch" }>;

/**
 * Patch part: RETIRED — the "開啟差異比對" entry is removed after repeated
 * fork-runtime failures of the native diff call (the changed-file rows in
 * the dock still summarize edits and open the actual file). The component
 * stays as the exhaustively-mapped dispatch target for `kind: "patch"` and
 * deliberately renders nothing.
 */
export function PatchPartView(_props: { readonly part: PatchPart }): ReactNode {
  return null;
}

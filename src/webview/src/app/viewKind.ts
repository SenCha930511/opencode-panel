/**
 * View-kind discriminator (fix: duplicated stacked blocks). Both contributed
 * sidebar views (chat + sessions) load this same bundle; the host shell
 * stamps `globalThis.__OPENCODE_PANEL_VIEW__` before the bundle runs (see
 * src/providers/html.ts) so the app knows which surface to mount.
 *
 * Defensive by contract: only the exact host-stamped values select a
 * surface. An absent global (node/SSR, where the host shell never ran) or an
 * unknown/future value both fall back to the full chat app, matching the
 * pre-discriminator behavior; tests set the global explicitly to exercise
 * the sessions branch.
 */

export type PanelViewKind = "chat" | "sessions" | "settings";

export function currentViewKind(): PanelViewKind {
  if (globalThis.__OPENCODE_PANEL_VIEW__ === "sessions") return "sessions";
  if (globalThis.__OPENCODE_PANEL_VIEW__ === "settings") return "settings";
  return "chat";
}

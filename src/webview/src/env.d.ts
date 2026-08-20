/// <reference types="vite/client" />

// Compile-time constant inlined by vite.config.ts `define` (and esbuild on
// the host side). Dev-only branches key off this and tree-shake out in
// production builds.
declare const __DEV__: boolean;

// View-kind stamp injected by the host shell before the bundle runs (see
// src/providers/html.ts; mirrored in src/globals.d.ts for the host project).
// Read defensively via app/viewKind.ts — unknown values fall back to chat.
declare var __OPENCODE_PANEL_VIEW__: string | undefined;

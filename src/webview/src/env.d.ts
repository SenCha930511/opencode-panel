/// <reference types="vite/client" />

// Compile-time constant inlined by vite.config.ts `define` (and esbuild on
// the host side). Dev-only branches key off this and tree-shake out in
// production builds.
declare const __DEV__: boolean;

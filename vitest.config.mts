import { defineConfig } from "vitest/config";

// Compile-time dev gate mirrored from esbuild.config.mjs `define.__DEV__` so
// provider modules evaluate the same branch tests assert on (see
// src/globals.d.ts). Tests decide production shell behavior through the
// builder's explicit `dev` input, never through this flag.
export default defineConfig({
  define: {
    __DEV__: "true",
  },
});

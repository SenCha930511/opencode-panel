import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// Compile-time dev gate mirrored from esbuild.config.mjs `define.__DEV__` so
// provider modules evaluate the same branch tests assert on (see
// src/globals.d.ts). Tests decide production shell behavior through the
// builder's explicit `dev` input, never through this flag.
export default defineConfig({
  define: {
    __DEV__: "true",
  },
  resolve: {
    alias: {
      // Unit specs for the vscode-backed adapter factories resolve `vscode`
      // to a recording in-test stub instead of the extension-host runtime.
      vscode: path.join(repoRoot, "src/host/__tests__/vscodeStub.ts"),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      // The @vscode/test-electron mocha graph (todo 24) imports `vscode` and
      // runs only inside a real extension host — never in the vitest program.
      "src/test/suite/**",
      // The downloaded VS Code app bundle cached by the harness carries
      // upstream *.test.* files of its own — never sweep the cache in.
      "**/.vscode-test/**",
    ],
  },
});

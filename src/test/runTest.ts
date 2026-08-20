/**
 * Todo-24 launcher (docs-canonical @vscode/test-electron `runTests` shape).
 * Bundled to `dist/test/runTest.js` (CJS) by `esbuild.config.mjs --test`;
 * executed by `npm run test`.
 *
 * The launch args keep the run hermetic: no GPU/sandbox requirements, no
 * other extensions, and an isolated user-data/extensions dir under
 * `.vscode-test/sandbox/` so settings writes never touch the developer's
 * real VS Code profile. OPENCODE_PANEL_TEST_PORT travels into the extension
 * host through `extensionTestsEnv` so the todo-24 activation seam and the
 * in-suite mock bind the same fixed port.
 */
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

export const DEFAULT_TEST_PORT = "4099";

async function main(): Promise<void> {
  // dist/test/runTest.js → __dirname is <repo>/dist/test.
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  const downloadRoot = path.join(extensionDevelopmentPath, ".vscode-test");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      ...process.env,
      OPENCODE_PANEL_TEST_PORT: process.env.OPENCODE_PANEL_TEST_PORT ?? DEFAULT_TEST_PORT,
    },
    launchArgs: [
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      `--user-data-dir=${path.join(downloadRoot, "sandbox", "user-data")}`,
      `--extensions-dir=${path.join(downloadRoot, "sandbox", "extensions")}`,
    ],
  });
}

void main().catch((error: unknown) => {
  console.error("todo-24 harness: runTests failed:", error);
  process.exitCode = 1;
});

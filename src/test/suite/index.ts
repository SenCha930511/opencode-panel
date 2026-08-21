/**
 * Todo-24 mocha index (docs-canonical @vscode/test-electron contract): the
 * extension host requires this bundle and calls `run(testsRoot, callback)`.
 * esbuild flattens the suite, so registration is explicit — the dynamic
 * imports run only AFTER `pre-require` installs the BDD globals, and order
 * pins execution (old-server LAST: it restarts the mock pinned at
 * OLD_SERVER_VERSION). `timeout: 30s` is the plan-mandated hang guard: the
 * QA failure case (dead port) must report a clean attach failure well inside
 * 30s rather than time the test out.
 */
import * as path from "node:path";
import Mocha from "mocha";

export function run(testsRoot: string, callback: (error: unknown, failures?: number) => void): void {
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    timeout: 30_000,
  });
  mocha.suite.emit("pre-require", globalThis, path.basename(testsRoot), mocha);
  const load = async (): Promise<void> => {
    await import("./activation.test.js");
    await import("./chatRoundTrip.test.js");
    await import("./permissionFlow.test.js");
    await import("./settingsRoundTrip.test.js");
    await import("./configFileRoundTrip.test.js");
    await import("./oldServer.test.js");
  };
  load().then(
    () => {
      try {
        mocha.run((failures: number) => {
          callback(null, failures);
        });
      } catch (error: unknown) {
        callback(error);
      }
    },
    (error: unknown) => {
      callback(error);
    },
  );
}

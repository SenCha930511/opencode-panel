import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const test = process.argv.includes("--test");

// jsonc-parser 3.x ships an AMD/UMD `main` (lib/umd/main.js) whose factory
// receives the runtime `require`; esbuild therefore cannot statically resolve
// its internal "./impl/*" and the CJS bundle crashes at runtime with
// "Cannot find module './impl/format'" on extension activation. Aliasing the
// specifier to the ESM entry (lib/esm/main.js) lets esbuild inline it
// statically. Applies to the dev/test bundle AND the production bundle so
// both exercise the same resolution.
const bundleAliases = { "jsonc-parser": "jsonc-parser/lib/esm/main.js" };

// Todo-24 integration-test bundles: the DEV extension (with the todo-10/24
// `_test` recorder) + the @vscode/test-electron harness. outbase "src"
// yields dist/extension.js, dist/test/runTest.js, dist/test/suite/index.js.
if (test) {
  await esbuild.build({
    entryPoints: ["src/extension.ts", "src/test/runTest.ts", "src/test/suite/index.ts"],
    bundle: true,
    outdir: "dist",
    outbase: "src",
    external: ["vscode", "mocha", "@vscode/test-electron"],
    alias: bundleAliases,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    minify: false,
    define: { __DEV__: "true" },
    logLevel: "info",
  });
  process.exit(0);
}

// Emits the `[watch] build started|finished` markers the built-in
// `$esbuild-watch` problem matcher keys on (tasks.json watch task).
/** @type {import("esbuild").Plugin} */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`[ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  alias: bundleAliases,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: production,
  define: {
    // Tree-shaken away in production; webview providers use this in todo 10.
    __DEV__: JSON.stringify(!production),
  },
  plugins: watch ? [esbuildProblemMatcherPlugin] : [],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

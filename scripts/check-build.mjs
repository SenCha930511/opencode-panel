import { stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Build artifact assertion gate (plan todo 2 acceptance):
//  - dist/extension.js exists and is non-empty (host bundle, esbuild)
//  - media/webview/main.js exists and is non-empty (webview bundle, Vite)
//  - media/webview/main.css exists (Tailwind via @tailwindcss/vite)
//  - webview main.js must NOT contain `eval(` (webviews forbid unsafe-eval)
const artifacts = [
  { url: new URL("../dist/extension.js", import.meta.url), howto: "npm run build" },
  { url: new URL("../media/webview/main.js", import.meta.url), howto: "npm run build:webview" },
  { url: new URL("../media/webview/main.css", import.meta.url), howto: "npm run build:webview" },
];

const problems = [];

for (const { url, howto } of artifacts) {
  const path = fileURLToPath(url);
  try {
    const info = await stat(url);
    if (!info.isFile() || info.size === 0) {
      problems.push(`FAIL: ${path} is empty or not a regular file`);
      console.error(`FAIL: ${path} is empty or not a regular file — rebuild via \`${howto}\``);
    } else {
      console.log(`OK:   ${path} (${info.size} bytes)`);
    }
  } catch {
    problems.push(`FAIL: ${path} not found`);
    console.error(`FAIL: ${path} not found — build it first via \`${howto}\``);
  }
}

if (problems.length === 0) {
  const mainJs = await readFile(new URL("../media/webview/main.js", import.meta.url), "utf8");
  if (mainJs.includes("eval(")) {
    problems.push("FAIL: media/webview/main.js contains eval(");
    console.error(
      "FAIL: media/webview/main.js contains `eval(` — webview CSP forbids unsafe-eval; remove the offending dependency/plugin",
    );
  } else {
    console.log("OK:   media/webview/main.js contains no eval(");
  }
}

if (problems.length > 0) {
  console.error(`check-build: FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("check-build: OK");

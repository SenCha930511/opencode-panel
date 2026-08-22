import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// i18n-allow-literal — CLI contract assertions carry script output literals.
/**
 * Generator drift contract (plan todo 21): package.json's
 * contributes.configuration is the single source of truth. `--check` must
 * stay green on the real manifest and must FAIL on both drift classes:
 * (a) a manifest key the generator's FIELD_UI table does not classify, and
 * (b) a byte drift between the manifest and the committed schema (edited
 * manifest without re-running the generator). Runs the real CLI through
 * spawnSync — no unit-level reimplementation.
 */

// vitest runs from the repository root (npm run test:unit), as does every
// documented script invocation; the CLI under test resolves paths the same way.
const root = process.cwd();
const SCRIPT = join(root, "scripts/gen-settings-schema.mjs");
const MANIFEST = join(root, "package.json");

interface ManifestShape {
  readonly contributes?: {
    readonly configuration?: { readonly properties?: Record<string, Record<string, unknown>> };
  };
  readonly [key: string]: unknown;
}

interface CheckRun {
  readonly status: number | null;
  readonly output: string;
}

function runCheck(manifestPath?: string): CheckRun {
  const args = [SCRIPT, "--check", ...(manifestPath === undefined ? [] : ["--manifest", manifestPath])];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function manifestCopyWith(mutate: (manifest: ManifestShape) => void): string {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestShape;
  mutate(manifest);
  const dir = mkdtempSync(join(tmpdir(), "gen-settings-schema-qa-"));
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

describe("gen-settings-schema --check", () => {
  it("exits 0 when the generated schema matches the real manifest", () => {
    // Given/When: the repo manifest
    const run = runCheck();
    // Then: green, naming the field count
    expect(run.status).toBe(0);
    expect(run.output).toContain("OK");
  });

  it("exits 1 on a manifest copy carrying an unclassified fake key", () => {
    // Given: a manifest copy with one extra opencodeChatSidebar.* key
    const fake = manifestCopyWith((manifest) => {
      const properties = manifest.contributes?.configuration?.properties;
      if (properties === undefined) throw new Error("manifest fixture lacks configuration properties");
      properties["opencodeChatSidebar.qaFakeKey"] = {
        type: "string",
        default: "x",
        markdownDescription: "%opencodeChatSidebar.config.qaFakeKey.markdownDescription%",
      };
    });
    // When
    const run = runCheck(fake);
    // Then: the drift contract refuses the unclassified key
    expect(run.status).toBe(1);
    expect(run.output).toContain("qaFakeKey");
  });

  it("exits 1 when a manifest default changed without regenerating the schema", () => {
    // Given: a manifest copy whose chatFontSize default drifts from the committed schema
    const drifted = manifestCopyWith((manifest) => {
      const properties = manifest.contributes?.configuration?.properties;
      const chatFontSize = properties?.["opencodeChatSidebar.chatFontSize"];
      if (properties === undefined || chatFontSize === undefined) {
        throw new Error("manifest fixture lacks the chatFontSize key");
      }
      properties["opencodeChatSidebar.chatFontSize"] = { ...chatFontSize, default: 1 };
    });
    // When
    const run = runCheck(drifted);
    // Then: byte drift between manifest and committed schema fails the check
    expect(run.status).toBe(1);
    expect(run.output).toContain("schema drift detected");
  });
});

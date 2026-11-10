import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { VERSION } from "./version";

const dir = mkdtempSync(join(tmpdir(), "grindlog-version-"));
let builds = 0;
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Bundles a tiny entry that re-exports the version, the way the compiled exe would, and loads it. */
async function bundled(define?: Record<string, string>): Promise<string | null> {
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, `export { VERSION } from ${JSON.stringify(join(import.meta.dirname, "version.ts"))};\n`);
  // A fresh folder per build: import() caches by URL.
  const name = `out${String(++builds)}`;
  const result = await Bun.build({ entrypoints: [entry], outdir: join(dir, name), target: "bun", define });
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  return ((await import(pathToFileURL(join(dir, name, "entry.js")).href)) as { VERSION: string | null }).VERSION;
}

describe("version", () => {
  test("an unbundled run with nothing defined has no version", () => {
    expect(VERSION).toBeNull();
  });

  test("a build that defines GRINDLOG_VERSION carries it", async () => {
    expect(await bundled({ GRINDLOG_VERSION: '"0.3.1"' })).toBe("0.3.1");
  });

  test("a build without the define has no version", async () => {
    expect(await bundled()).toBeNull();
  });

  test("an empty define is no version, not an empty one", async () => {
    expect(await bundled({ GRINDLOG_VERSION: '""' })).toBeNull();
  });
});

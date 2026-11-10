import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { APP_NAME, CHANNEL } from "./channel";

const dir = mkdtempSync(join(tmpdir(), "grindlog-channel-"));
let builds = 0;
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Bundles a tiny entry that re-exports the channel, the way the compiled exe would, and loads it. */
async function bundled(define?: Record<string, string>): Promise<{ CHANNEL: string; APP_NAME: string }> {
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, `export { APP_NAME, CHANNEL } from ${JSON.stringify(join(import.meta.dirname, "channel.ts"))};\n`);
  // A fresh folder per build: import() caches by URL.
  const name = `out${String(++builds)}`;
  const result = await Bun.build({ entrypoints: [entry], outdir: join(dir, name), target: "bun", define });
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  const mod = (await import(pathToFileURL(join(dir, name, "entry.js")).href)) as { CHANNEL: string; APP_NAME: string };
  return { CHANNEL: mod.CHANNEL, APP_NAME: mod.APP_NAME };
}

describe("channel", () => {
  test("an unbundled run with nothing defined is dev", () => {
    expect(CHANNEL).toBe("dev");
    expect(APP_NAME).toBe("Grindlog Dev");
  });

  test("a build that defines GRINDLOG_CHANNEL as prod is prod", async () => {
    expect(await bundled({ GRINDLOG_CHANNEL: '"prod"' })).toEqual({ CHANNEL: "prod", APP_NAME: "Grindlog" });
  });

  test("a build without the define is dev", async () => {
    expect(await bundled()).toEqual({ CHANNEL: "dev", APP_NAME: "Grindlog Dev" });
  });

  test("any defined value other than prod is dev", async () => {
    expect(await bundled({ GRINDLOG_CHANNEL: '"production"' })).toEqual({ CHANNEL: "dev", APP_NAME: "Grindlog Dev" });
  });
});

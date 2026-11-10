// An update while the dashboard is open: the tracker restarts as another release, and every open
// tab, all sharing one SharedWorker, reloads into the new build exactly once. The `update` stack
// starts the tracker as release e2e-a, so the restart's version change has a baseline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.use({ seed: "update" });

const LIVE = /^(connected|waiting for game)$/;
/** Long enough for a reload loop to show itself: a status arrives within a second of each load. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 3000));
const marked = (page: Page) => page.evaluate(() => (globalThis as { __beforeUpdate?: boolean }).__beforeUpdate === true);
/** Every release_recompute line in the tracker's log, as parsed JSON. */
const recomputeLines = (dataDir: string) =>
  readFileSync(join(dataDir, "logs", "tracker.log"), "utf8")
    .split("\n")
    .filter((l) => l.includes("release_recompute_"))
    .map((l) => JSON.parse(l) as { event: string; [k: string]: unknown });

test("every open tab reloads once when the tracker comes back as another release", async ({ context, stack }) => {
  const pages = [await context.newPage(), await context.newPage()];
  const paths: string[] = [];
  for (const page of pages) {
    page.on("console", (msg) => {
      if (msg.text().includes("events/path")) paths.push(msg.text());
    });
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: LIVE })).toBeVisible();
    await page.evaluate(() => {
      (globalThis as { __beforeUpdate?: boolean }).__beforeUpdate = true;
    });
  }
  // One worker for both tabs: the old worker alone hears the new version and must reach every old tab.
  expect(paths).toHaveLength(2);
  expect(paths.every((p) => p.includes("shared_worker"))).toBe(true);
  const loads = pages.map(() => 0);
  pages.forEach((page, i) => page.on("load", () => void (loads[i] = (loads[i] ?? 0) + 1)));

  // The first start's recompute ends before the restart, so the restart runs from e2e-a's marker.
  const doneCount = () => recomputeLines(stack.dataDir).filter((l) => l.event === "release_recompute_done").length;
  await expect.poll(doneCount, { timeout: 15_000 }).toBe(1);
  await stack.restart("e2e-b");

  for (const page of pages) {
    await expect.poll(() => marked(page).catch(() => true), { timeout: 15_000 }).toBe(false);
    await expect(page.getByRole("status").filter({ hasText: LIVE })).toBeVisible();
  }
  // Once: no second reload once the new build has its baseline.
  await settle();
  expect(loads).toEqual([1, 1]);

  // The restart recomputed history under the new release, and the first start had too.
  await expect.poll(doneCount, { timeout: 15_000 }).toBe(2);
  const lines = recomputeLines(stack.dataDir);
  expect(lines.find((l) => l.event === "release_recompute_started" && l.from === "e2e-a")).toMatchObject({ to: "e2e-b" });
  expect(lines.filter((l) => l.event === "release_recompute_done").map((l) => [l.to, l.failed, l.markerWritten])).toEqual([
    ["e2e-a", 0, true],
    ["e2e-b", 0, true],
  ]);
});

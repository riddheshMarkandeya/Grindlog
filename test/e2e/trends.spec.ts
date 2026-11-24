// The Trends page against the rich seed: 33 matches at today, last month and the month before. Its
// checks don't depend on the run's date: every quick pick and stepper shows its title line and then
// either the tiles and charts or the empty-period note, and last month is reached from the current
// month's strip cell.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const THEMES = ["carbon", "slate", "oled"] as const;
const title = (page: Page) => page.getByRole("heading", { level: 2 });
const tiles = (page: Page) => page.getByRole("group", { name: "Metric to chart" });
const emptyPeriod = (page: Page) => page.getByText("No matches in this period with these filters.");
/** Stats and tiles, or the empty-period note, once the period has loaded. */
const loaded = (page: Page) => expect(tiles(page).or(emptyPeriod(page))).toBeVisible();
const bigChart = (page: Page) => page.getByRole("heading", { level: 3, name: /^Win % · / });
const wlChart = (page: Page) => page.getByRole("heading", { level: 3, name: /^Wins and losses · / });
/** Both charts, or the empty-period note. */
async function charted(page: Page) {
  await loaded(page);
  if (await emptyPeriod(page).isVisible()) return;
  await expect(bigChart(page)).toBeVisible();
  await expect(wlChart(page)).toBeVisible();
}
const strip = (page: Page) => page.getByRole("group", { name: /^Seasons and months of / });

/** Last month, from the current month's strip cell (later months are disabled) and ‹. */
async function lastMonth(page: Page) {
  await page.goto("/trends");
  await strip(page).getByRole("button", { name: /^[A-Z][a-z]{2}$/ }).and(page.locator(":enabled")).last().click();
  await expect(page).toHaveURL(/kind=month/);
  await page.getByRole("button", { name: "Earlier month" }).click();
  await loaded(page);
}

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("every quick pick shows its title line, pressed, then its stats or the empty-period note", async ({ page }) => {
  await page.goto("/trends");
  const picks = page.getByRole("group", { name: "Quick periods" });
  await expect(picks.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Last 7 days", "Last 30 days", "This week", "Last week", "This year", "All time"]) {
    await picks.getByRole("button", { name }).click();
    await expect(picks.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    await expect(title(page)).toHaveText(name);
    await charted(page);
  }
  await expect(page.getByText(/nothing earlier/)).toBeVisible();
});

test("while the next period loads, the old one stays dimmed under aria-busy, without the old compared text", async ({ page }) => {
  await page.goto("/trends");
  await charted(page);
  const region = page.locator("[class*=period][aria-busy]");
  const titleLine = page.locator("[class*=head] .muted");
  const before = await titleLine.textContent();
  expect(before).toMatch(/compared with|had no matches|nothing earlier/);
  // Hold the next period's request, so the page sits in its loading state.
  const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
  await page.route("**/api/period?*", async (route) => { await held; await route.continue(); }, { times: 1 });
  await page.getByRole("group", { name: "Quick periods" }).getByRole("button", { name: "All time" }).click();
  await expect(title(page)).toHaveText("All time");
  await expect(region).toHaveAttribute("aria-busy", "true");
  await expect(bigChart(page)).toBeVisible();
  await expect(titleLine).not.toHaveText(before ?? "");
  release(undefined);
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText(/nothing earlier/)).toBeVisible();
});

test("the current month's strip cell, then ‹, reaches last month with its stats and the ⚑ note", async ({ page }) => {
  await lastMonth(page);
  await expect(page.getByText("1 left early, counted as a loss", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ matches · \d+ sessions/)).toBeVisible();
  await expect(tiles(page)).toBeVisible();
  // The month pressed on the strip follows the period.
  await expect(strip(page).locator("[aria-pressed=true]")).toHaveCount(1);
});

test("the steppers: a week, a month and a season each show their title, then charts or the empty note", async ({ page }) => {
  await page.goto("/trends");
  await page.getByRole("group", { name: "Quick periods" }).getByRole("button", { name: "This week" }).click();
  await page.getByRole("button", { name: "Earlier week" }).click();
  await expect(title(page)).toHaveText("Last week");
  await charted(page);
  await lastMonth(page);
  await charted(page);
  await strip(page).getByRole("button", { name: "S24" }).click();
  await expect(title(page)).toHaveText("Season 24");
  await charted(page);
  await page.getByRole("button", { name: "Earlier season" }).click();
  await expect(title(page)).toHaveText("Season 23");
  await charted(page);
});

test("last month opens By match with the auto note; By date sticks until a quick pick", async ({ page }) => {
  await lastMonth(page);
  await expect(bigChart(page)).toHaveText("Win % · rolling 20 matches");
  await expect(page.getByText(/^Only 2 days with matches here, so this shows a rolling average of 20 matches/)).toBeVisible();
  const xAxis = page.getByRole("group", { name: "X axis" });
  await expect(xAxis.getByRole("button", { name: "By match" })).toHaveAttribute("aria-pressed", "true");
  await xAxis.getByRole("button", { name: "By date" }).click();
  await expect(page).toHaveURL(/x=date/);
  await expect(bigChart(page)).toHaveText("Win % · per day");
  await expect(page.getByText(/^Only 2 days/)).toHaveCount(0);
  await page.getByRole("group", { name: "Quick periods" }).getByRole("button", { name: "Last 30 days" }).click();
  await expect(page).not.toHaveURL(/x=/);
});

test("By date a day's point sits over its W/L bar, and the W/L chart doesn't move between modes", async ({ page }) => {
  await lastMonth(page);
  const column = page.getByRole("link", { name: /Open its recap\.$/ }).first();
  const byMatch = await column.boundingBox();
  await page.getByRole("group", { name: "X axis" }).getByRole("button", { name: "By date" }).click();
  await expect(page).toHaveURL(/x=date/);
  const [bar, dot] = [await column.boundingBox(), await page.locator("svg[role=img]:not(.lucide) circle").first().boundingBox()];
  // Sideways only: By match's auto note above the charts goes, so they move up.
  expect([bar?.x, bar?.width]).toEqual([byMatch?.x, byMatch?.width]);
  expect((dot?.x ?? NaN) + (dot?.width ?? NaN) / 2).toBeCloseTo((bar?.x ?? NaN) + (bar?.width ?? NaN) / 2, 0);
});

test("a day's W/L column opens that day's first session's recap under the filter", async ({ page }) => {
  await lastMonth(page);
  // Day 12 is the only 2–2 day last month.
  await page.getByRole("link", { name: /: 2 wins, 2 losses\. Open its recap\.$/ }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a\?filter=ranked$/);
  await expect(page.getByRole("img", { name: "2 wins, 2 losses" })).toContainText(/4 matches/i);
});

test("on all time a month's W/L column opens that month", async ({ page }) => {
  await page.goto("/trends?kind=all");
  await charted(page);
  const link = page.getByRole("link", { name: /Open that month\.$/ }).first();
  const month = (await link.getAttribute("aria-label"))?.split(":")[0] ?? "";
  await link.click();
  await expect(page).toHaveURL(/kind=month/);
  await expect(title(page)).toHaveText(month);
  await charted(page);
});

test("Clutch: its tiles over last month's ranked matches, and the best comeback opens its match", async ({ page }) => {
  await lastMonth(page);
  const clutch = page.getByRole("region", { name: "Clutch" });
  await expect(clutch.getByRole("heading", { level: 3, name: "Clutch" })).toBeVisible();
  // Day 12's 3–2 win from 0–2 down and 2–3 loss after leading 2–0, plus the 4–1 hat-trick win.
  await expect(clutch.getByText("won 1 of 1 after going 2+ down")).toBeVisible();
  await expect(clutch.getByText("lost 1 of 2 after going 2+ up")).toBeVisible();
  await expect(clutch.getByText("1 won, 0 lost").first()).toBeAttached();
  await clutch.getByRole("link", { name: "Best: won 3–2 from 0–2" }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-first-a\/match\/e2e-first-a\?filter=ranked$/);
});

test("Tilt: below Clutch, a verdict, both charts with match counts; the seed is too small to judge", async ({ page }) => {
  await page.goto("/trends?kind=all");
  await loaded(page);
  const tilt = page.getByRole("region", { name: "Tilt" });
  await expect(tilt.getByRole("heading", { level: 3, name: "Tilt" })).toBeVisible();
  await expect(tilt.getByText(/^Too few matches to tell yet: \d+ in all/)).toBeVisible();
  await expect(tilt.getByText("By game in the session")).toBeVisible();
  await expect(tilt.getByText("After…")).toBeVisible();
  // Each axis label carries its match count beneath it.
  await expect(tilt.getByText(/^1–3\d+ match(es)?$/)).toBeVisible();
  await expect(tilt.getByText(/^3\+ losses\d+ match(es)?$/)).toBeVisible();
  // Screen readers get one line per column instead of the marks.
  await expect(tilt.getByText(/^In games 1–3: \d+% won, \d+ of \d+ match(es)?$/)).toBeAttached();
  const clutchBox = await page.getByRole("region", { name: "Clutch" }).boundingBox();
  const tiltBox = await tilt.boundingBox();
  expect(tiltBox?.y ?? 0).toBeGreaterThan(clutchBox?.y ?? Infinity);
});

test("a tile selects the metric in the URL", async ({ page }) => {
  await page.goto("/trends?kind=all");
  await tiles(page).getByRole("button", { name: /^Saves \/ game/ }).click();
  await expect(page).toHaveURL(/metric=saves/);
  await expect(tiles(page).getByRole("button", { name: /^Saves \/ game/ })).toHaveAttribute("aria-pressed", "true");
  await expect(tiles(page).getByRole("button", { name: /^Win %/ })).toHaveAttribute("aria-pressed", "false");
});

test("at 320px the page has no sideways scroll; only the strip scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/trends?kind=all");
  await loaded(page);
  // A string expression: the root tsconfig has no DOM lib for a page-side function.
  expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBe(0);
});

test("axe: Trends in every theme has no violations", async ({ page }) => {
  for (const path of ["/trends", "/trends?kind=all"]) {
    await page.goto(path);
    await loaded(page);
    for (const theme of THEMES) {
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});

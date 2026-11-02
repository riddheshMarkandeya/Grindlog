// The "with teammate" filter against the friends seed: last month, a 22-match session (e2e-fr-00)
// with Sammy on your team in its first four and on the other team in the fifth, and a 2-match
// session (e2e-nofr-a) with no friend. Opal, a friend only ever on the other team, is never offered.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openCard, shareDialog } from "./share-card";

test.use({ seed: "friends" });

const THEMES = ["carbon", "slate", "oled"] as const;
const SAM = "Steam%7Ce2e-sam%7C0";
const withSelect = (page: Page) => page.getByLabel("With");
const bug = (page: Page, name: string) => page.getByRole("img", { name, exact: true });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("the recap's With: the session's friends only, filters the matches, and keeps focus", async ({ page }) => {
  await page.goto("/recap/e2e-fr-00");
  await expect(bug(page, "14 wins, 8 losses")).toBeVisible();
  const select = withSelect(page);
  await expect(select.locator("option")).toHaveText(["Anyone", "Soloqueue", "Sammy"]);

  await select.selectOption({ label: "Sammy" });
  await expect(page).toHaveURL(new RegExp(`/recap/e2e-fr-00\\?filter=everything&with=${SAM}$`));
  await expect(bug(page, "2 wins, 2 losses")).toBeVisible();
  await expect(select).toBeFocused();

  // Sammy on the other team in the fifth match doesn't count against soloqueue.
  await select.selectOption({ label: "Soloqueue" });
  await expect(page).toHaveURL(/\/recap\/e2e-fr-00\?filter=everything&with=solo$/);
  await expect(bug(page, "12 wins, 6 losses")).toBeVisible();
  await expect(select).toBeFocused();

  // The filter rides along to the matches page.
  await page.getByRole("link", { name: "Matches & numbers" }).click();
  await expect(page).toHaveURL(/\/recap\/e2e-fr-00\/matches\?filter=everything&with=solo$/);
});

test("a session with no friend: With is disabled, and a link naming one goes back to Anyone", async ({ page }) => {
  await page.goto("/recap/e2e-nofr-a");
  await expect(withSelect(page)).toBeDisabled();

  await page.goto(`/recap/e2e-nofr-a?filter=everything&with=${SAM}`);
  await expect(page).toHaveURL(/\/recap\/e2e-nofr-a\?filter=everything$/);
  await expect(bug(page, "1 win, 1 loss")).toBeVisible();
  await expect(withSelect(page)).toHaveValue("anyone");

  // Soloqueue stays, as paging under it lands on sessions like this one, and can go back to Anyone.
  await page.goto("/recap/e2e-nofr-a?filter=everything&with=solo");
  await expect(bug(page, "1 win, 1 loss")).toBeVisible();
  await expect(page).toHaveURL(/with=solo$/);
  await expect(withSelect(page)).toBeEnabled();
});

test("a playlist without the friend resets With, and focus stays on the playlist select", async ({ page }) => {
  await page.goto(`/recap/e2e-fr-00?filter=everything&with=${SAM}`);
  await expect(bug(page, "2 wins, 2 losses")).toBeVisible();
  const playlist = page.getByLabel("Playlist");
  await playlist.focus();
  await playlist.selectOption("11");
  await expect(page).toHaveURL(/\/recap\/e2e-fr-00\?filter=11$/);
  await expect(bug(page, "0 wins, 1 loss")).toBeVisible();
  await expect(playlist).toBeFocused();
});

test("the share card's label names the friend by nickname", async ({ page }) => {
  await page.goto(`/recap/e2e-fr-00?filter=everything&with=${SAM}`);
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=pill]")).toHaveText("with Sammy");
});

test("Trends lists only friends ever on your team (not Opal); picking one goes in the URL, and an id that isn't one goes back to Anyone", async ({ page }) => {
  await page.goto("/trends?kind=all");
  const select = withSelect(page);
  await expect(select.locator("option")).toHaveText(["Anyone", "Soloqueue", "Sammy"]);
  // Focused first, as a click would: Trends has no rule that moves focus to a select, it keeps it.
  await select.focus();
  await select.selectOption({ label: "Sammy" });
  await expect(page).toHaveURL(new RegExp(`with=${SAM}`));
  // The controls stay mounted while the filtered period loads, so focus stays; the playlist's too.
  await expect(page.getByRole("heading", { level: 3, name: /^Win % · / })).toBeVisible();
  await expect(select).toBeFocused();
  const playlist = page.getByLabel("Playlist");
  await playlist.focus();
  await playlist.selectOption("everything");
  await expect(page.getByRole("heading", { level: 3, name: /^Win % · / })).toBeVisible();
  await expect(playlist).toBeFocused();

  await page.goto("/trends?kind=all&with=Steam%7Cnobody%7C0");
  await expect(page).not.toHaveURL(/with=/);
  await expect(withSelect(page)).toHaveValue("anyone");
});

test("at 320px the bars with both filters fit without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of [`/recap/e2e-fr-00?filter=everything&with=${SAM}`, `/trends?kind=all&with=${SAM}`]) {
    await page.goto(path);
    await expect(withSelect(page)).toBeVisible();
    await expect(page.getByLabel("Playlist")).toBeVisible();
    expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), path).toBe(0);
  }
});

test("axe: the recap and Trends under With, in every theme", async ({ page }) => {
  for (const path of [`/recap/e2e-fr-00?filter=everything&with=${SAM}`, "/recap/e2e-nofr-a", `/trends?kind=all&with=${SAM}`]) {
    await page.goto(path);
    await expect(withSelect(page)).toBeVisible();
    for (const theme of THEMES) {
      // A string expression: the root tsconfig has no DOM lib for a page-side function.
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});

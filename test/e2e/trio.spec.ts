// The With list's two-friend ticks against the trio seed: Kim and Lee together, Max never with them.
// Recap greys from the session's matches, Trends from the Friends page's pairs.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { option, options, withButton } from "./dropdown";
import { expect, test } from "./fixtures";

test.use({ seed: "trio" });

const THEMES = ["carbon", "slate", "oled"] as const;
const KIM = "Epic%7Ce2e-kim%7C0";
const LEE = "Epic%7Ce2e-lee%7C0";
/** A greyed option's reason, its description. */
const reason = (page: Page, name: string) => option(page, name).locator("[slot=description]");

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

for (const [where, path, never] of [
  ["Recap", "/recap/e2e-trio-0?filter=everything", "Not on your team with Kim this session"],
  ["Trends", "/trends?kind=all", "Not enough matches with Kim on your team"],
] as const) {
  test(`${where}: two ticks make a trio, the list stays open, and friends who can't join are greyed with why`, async ({ page }) => {
    const toggles: string[] = [];
    page.on("console", (m) => { if (m.text().includes("[grindlog] with/toggle")) toggles.push(m.text()); });
    await page.goto(path);
    await withButton(page).click();
    await expect(options(page)).toHaveText(["Anyone", "Soloqueue", "Kim", "Lee", "Max"]);

    await option(page, "Kim").click();
    await expect(page).toHaveURL(new RegExp(`with=${KIM}$`));
    await expect(withButton(page)).toHaveText("Kim");
    // Still open for the second tick, through the reload of the page under it.
    await expect(option(page, "Kim")).toHaveAttribute("aria-selected", "true");
    await expect(option(page, "Max")).toHaveAttribute("aria-disabled", "true");
    await expect(reason(page, "Max")).toHaveText(never);
    await expect(option(page, "Lee")).not.toHaveAttribute("aria-disabled", "true");

    await option(page, "Lee").click();
    await expect(page).toHaveURL(new RegExp(`with=${KIM}%2C${LEE}$`));
    await expect(withButton(page)).toHaveText("Kim + Lee");
    // The button's name carries the value, not just "With".
    await expect(withButton(page)).toHaveAccessibleName("Kim + Lee With");
    await expect(reason(page, "Max")).toHaveText("Two friends at most");
    await expect(option(page, "Max")).toHaveAttribute("aria-disabled", "true");

    // The open list passes axe too, in every theme.
    for (const theme of THEMES) {
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }

    // Unticking both is Anyone.
    await option(page, "Kim").click();
    await expect(withButton(page)).toHaveText("Lee");
    await option(page, "Lee").click();
    await expect(page).not.toHaveURL(/with=/);
    await expect(withButton(page)).toHaveText("Anyone");
    expect(toggles).toHaveLength(4);
  });
}

test("Soloqueue clears the ticks and closes the list; Esc closes it without a change; focus goes back to the button", async ({ page }) => {
  await page.goto(`/trends?kind=all&with=${KIM}%2C${LEE}`);
  await expect(withButton(page)).toHaveText("Kim + Lee");
  await withButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(option(page, "Kim")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(withButton(page)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`with=${KIM}%2C${LEE}$`));

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(option(page, "Anyone")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/with=solo$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(withButton(page)).toHaveText("Soloqueue");
  await expect(withButton(page)).toBeFocused();
});

test("clicking the With already set is no change: the list closes and the URL (x axis included) stays", async ({ page }) => {
  await page.goto("/trends?kind=all&x=date");
  await expect(withButton(page)).toHaveText("Anyone");
  await withButton(page).click();
  await option(page, "Anyone").click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/\/trends\?kind=all&x=date$/);
});

test("Recap while a tick loads: the old With's matches don't grey anyone but the cap, and Share hides", async ({ page }) => {
  const share = page.getByRole("button", { name: "Share", exact: true });
  /** Holds the next detail load under `with`, to look at the page while it's placeholder data. */
  const hold = async (with_: string) => {
    const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
    await page.route(`**/api/sessions/*with=${with_}`, async (route) => { await held; await route.continue(); }, { times: 1 });
    return () => { release(undefined); };
  };

  // From Soloqueue (no friend in its matches), greying from them would wrongly grey Lee.
  await page.goto("/recap/e2e-trio-0?filter=everything&with=solo");
  let release = await hold(KIM);
  await withButton(page).click();
  await option(page, "Kim").click();
  await expect(withButton(page)).toHaveText("Kim");
  await expect(option(page, "Lee")).not.toHaveAttribute("aria-disabled", "true");
  release();
  await expect(reason(page, "Max")).toHaveText("Not on your team with Kim this session");
  await page.keyboard.press("Escape");

  // From Anyone, Share (which would carry Anyone's stats under "with Kim") hides until Kim's land.
  await page.goto("/recap/e2e-trio-0?filter=everything");
  await expect(share).toBeVisible();
  release = await hold(KIM);
  await withButton(page).click();
  await option(page, "Kim").click();
  await expect(withButton(page)).toHaveText("Kim");
  await expect(share).toHaveCount(0);
  release();
  await expect(share).toBeVisible();
});

test("at 320px the open list fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/recap/e2e-trio-0?filter=everything", "/trends?kind=all"]) {
    await page.goto(path);
    await withButton(page).click();
    const box = await page.getByRole("listbox").boundingBox();
    expect(box, path).not.toBeNull();
    expect(box?.x ?? -1, path).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0), path).toBeLessThanOrEqual(320);
    await page.keyboard.press("Escape");
    expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), path).toBe(0);
  }
});

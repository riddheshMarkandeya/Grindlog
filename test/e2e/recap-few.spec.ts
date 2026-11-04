// The recap against the `few` seed, whose third match has your player on no team.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.use({ seed: "few" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

const team = (page: Page, name: string | RegExp) => page.locator("div").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) }).last();

test("a match with you on no team names the game's teams, in no side colour", async ({ page }) => {
  await page.goto("/recap/e2e-few-a/match/e2e-few-noteam?filter=everything");
  await expect(page.getByRole("heading", { name: "Blue team · won" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Orange team · lost" })).toBeVisible();
  await expect(team(page, "Blue team · won")).not.toHaveClass(/blue/);
  await expect(team(page, "Orange team · lost")).not.toHaveClass(/orange/);
});

test("a match with you on a team keeps the side colour, so the check above can fail", async ({ page }) => {
  await page.goto("/recap/e2e-few-a/match/e2e-few-a?filter=everything");
  await expect(team(page, /^Your team/)).toHaveClass(/blue/);
  await expect(team(page, /^Opponents/)).toHaveClass(/orange/);
});

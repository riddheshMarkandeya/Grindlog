// The recap's "Is this you?" card, against the `guess` seed's own stack: `rich` plus two pending
// guesses, CardYes then CardLater.
import { DISMISSED_KEY } from "../../src/web/logic/guess";
import { expect, test } from "./fixtures";

test.use({ seed: "guess" });

/** The browser's line for a save this spec fails on purpose. */
const MEANT = /^Failed to load resource: .* 500 .*\/api\/ids/;

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !MEANT.test(e))).toEqual([]);
});

// First, while both guesses are pending; it saves nothing and undoes its dismissal.
test("a failed answer offers Retry for that guess only: dismissing it leaves no error on the next", async ({ page }) => {
  await page.route("**/api/ids?*", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
  await page.goto("/recap");
  try {
    const card = page.getByRole("region", { name: "Is this you?" });
    await card.getByRole("button", { name: "Not me" }).click();
    await expect(card).toContainText("Couldn't save");
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toContainText("CardLater");
    await expect(card).not.toContainText("Couldn't save");
  } finally {
    // Even on a failure, so the next tests aren't left with a dismissal they didn't make.
    await page.evaluate((key) => { localStorage.removeItem(key); }, DISMISSED_KEY);
  }
});

test("the card asks about each unanswered guess: an answer moves to the next, and a dismissal survives a reload", async ({ page }) => {
  await page.goto("/recap");
  const card = page.getByRole("region", { name: "Is this you?" });
  await expect(card).toContainText("CardYes");
  await expect(card).toContainText("Steam");
  await card.getByRole("button", { name: "That's me" }).click();
  await expect(card).toContainText("CardLater");
  await expect(card.getByRole("button", { name: "That's me" })).toBeFocused();
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.locator("[data-session]")).toBeVisible();
  await expect(card).toBeHidden();
  // The answer was saved: Settings › You lists CardYes as you, and CardLater still waiting.
  await page.goto("/settings");
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByRole("listitem").filter({ hasText: "CardYes" })).not.toContainText("Waiting for you");
  await expect(you.getByRole("listitem").filter({ hasText: "CardLater" })).toContainText("Waiting for you");
});

test("the card fits at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  // Undo the first test's dismissal, so a guess shows.
  await page.evaluate((key) => { localStorage.removeItem(key); }, DISMISSED_KEY);
  await page.goto("/recap");
  await expect(page.getByRole("region", { name: "Is this you?" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

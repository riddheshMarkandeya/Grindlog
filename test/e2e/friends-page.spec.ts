// The Friends page against the friends seed: Sammy together 5–4 (2v2, 3v3 and Private 2v2) and
// head-to-head 7–6 (13 matches, two pages); Opal, a friend only ever on the other team; Kim, Lee and
// Max suggested. One stack for the file, and the tests run in order, but a failure restarts it freshly
// seeded, so no test counts on an earlier one's writes.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Its own seed name: it writes, and the friends spec shares the "friends" stack.
test.use({ seed: "friends-page" });

const THEMES = ["carbon", "slate", "oled"] as const;
const SAM = "/friends/Steam%7Ce2e-sam%7C0";
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const add = (page: Page, name: string) => page.getByText(`teamed up with ${name}`).locator("xpath=..").getByRole("button", { name: "Add friend" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("the landing: a card per friend with both records, a banner per suggestion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Friends", exact: true }).click();
  await expect(h1(page)).toHaveText("Friends");
  const sam = page.getByRole("link", { name: /^Sammy/ });
  await expect(sam).toContainText("SamInGame · Steam");
  await expect(sam).toContainText("5 won, 4 lost");
  await expect(sam).toContainText("7 won, 6 lost");
  await expect(page.getByRole("link", { name: /^Opal/ })).toContainText("not yet");
  await expect(page.getByText(/You've teamed up with/)).toHaveText([/with Kim in 3 matches over 2 sessions/, /with Lee in 3 matches/, /with Max in 3 matches/]);
});

test("add moves focus to the next banner, the one before after the last; never suggest, then suggest again", async ({ page }) => {
  await page.goto("/friends");
  await add(page, "Lee").click();
  await expect(page.getByText("Added Lee")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Lee/ })).toBeVisible();
  await expect(add(page, "Max")).toBeFocused();
  await add(page, "Max").click();
  await expect(page.getByText("Added Max")).toBeVisible();
  await expect(add(page, "Kim")).toBeFocused();

  await page.getByRole("button", { name: "Never suggest" }).click();
  await expect(page.getByText(/You've teamed up with/)).toHaveCount(0);
  await expect(h1(page)).toBeFocused();
  const never = page.getByText("Players you said never to suggest");
  await never.click();
  await page.getByRole("button", { name: "Suggest again" }).click();
  await expect(add(page, "Kim")).toBeVisible();
  await expect(never).toHaveCount(0);
  await expect(h1(page)).toBeFocused();

  // Lee and Max are now offered by the recap's With on a session they're in.
  await page.goto("/recap/e2e-pair-0");
  await expect(page.getByLabel("With").locator("option")).toHaveText(["Anyone", "Soloqueue", "Lee", "Max"]);
});

test("a friend: scorebug, both zones, the mode switch, the pager and a match link", async ({ page }) => {
  await page.goto("/friends");
  await page.getByRole("link", { name: /^Sammy/ }).click();
  await expect(page).toHaveURL(new RegExp(`${SAM}$`));
  await expect(h1(page)).toHaveText("Sammy");
  await expect(h1(page)).toBeFocused();
  await expect(page.getByRole("img", { name: "Together 5 won, 4 lost; head-to-head 7 won, 6 lost" })).toBeVisible();
  await expect(page.getByText("seen as SamInGame")).toBeVisible();

  // 3v3 is the most-played online mode; it has no private matches, so Private is off there.
  const note = page.getByText(/^Your .* matches with them/);
  await expect(note).toContainText("Your 3v3 matches with them (4)");
  const bars = page.getByRole("img", { name: /^\w+: you \d+%/ });
  await expect(bars).toHaveCount(5);
  const labels = await Promise.all((await bars.all()).map((b) => b.getAttribute("aria-label")));
  expect(labels.map((l) => l?.split(":")[0])).toEqual(["Score", "Goals", "Assists", "Saves", "MVPs"]);
  const priv = page.getByRole("button", { name: "Private" });
  await expect(priv).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "2v2" }).click();
  await expect(note).toContainText("Your 2v2 matches with them (3)");
  await priv.click();
  await expect(note).toContainText("Your Private 2v2 matches with them (2)");
  await expect(priv).toHaveAttribute("aria-pressed", "true");
  await expect(priv).toBeFocused();

  const older = page.getByRole("button", { name: "Older →" });
  await expect(page.getByText("1–10 of 13")).toBeVisible();
  await older.click();
  await expect(page.getByText("11–13 of 13")).toBeVisible();
  await expect(older).toHaveAttribute("aria-disabled", "true");
  // By keyboard: Playwright won't click an aria-disabled button. Focus stays on it.
  await page.keyboard.press("Enter");
  await expect(page.getByText("11–13 of 13")).toBeVisible();
  await expect(older).toBeFocused();
  await page.getByRole("button", { name: "← Newer" }).click();

  const against = page.getByRole("region", { name: "On the other team" });
  await against.getByRole("row").nth(2).getByRole("link").click();
  await expect(page).toHaveURL(/\/recap\/e2e-h2h-00\/match\/e2e-h2h-11\?filter=6$/);
});

test("nickname: set, then cleared back to the name they last used", async ({ page }) => {
  await page.goto(SAM);
  await page.getByRole("button", { name: "Edit nickname" }).click();
  const input = page.getByLabel("Nickname");
  await expect(input).toBeFocused();
  await input.fill("Samwise");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(h1(page)).toHaveText("Samwise");
  await expect(page.getByText("✓ Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit nickname" })).toBeFocused();

  await page.getByRole("button", { name: "Edit nickname" }).click();
  await page.getByLabel("Nickname").fill("");
  await page.keyboard.press("Enter");
  await expect(h1(page)).toHaveText("SamInGame");
  await expect(page.getByRole("button", { name: "Set nickname" })).toBeFocused();
});

test("remove: Escape goes back; Remove returns to the landing without them", async ({ page, consoleErrors }) => {
  await page.goto("/friends");
  const opal = page.getByRole("link", { name: /^Opal/ });
  const path = await opal.getAttribute("href");
  await opal.click();
  await expect(page.getByText("You haven't teamed up with Opal yet.")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Remove friend" });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(/\/friends$/);
  await expect(page.getByText("Removed Opal")).toBeVisible();
  await expect(h1(page)).toBeFocused();
  await expect(page.getByRole("link", { name: /^Opal/ })).toHaveCount(0);

  // Back to their page in the same app (no reload): their cached page is gone, so it says so.
  await page.evaluate(`history.pushState(null, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate"))`);
  await expect(page.getByText("This player isn't one of your friends.")).toBeVisible();
  const expected = consoleErrors.findIndex((e) => /404 .*\/api\/friends\/detail/.test(e));
  expect(expected).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(expected, 1);
});

test("a link to someone who isn't a friend says so", async ({ page, consoleErrors }) => {
  await page.goto("/friends/Epic%7Ce2e-other%7C0");
  await expect(page.getByText("This player isn't one of your friends.")).toBeVisible();
  // The browser logs the expected 404 itself; anything else still fails the test.
  const expected = consoleErrors.findIndex((e) => /404 .*\/api\/friends\/detail/.test(e));
  expect(expected).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(expected, 1);
  await page.getByRole("link", { name: "See your friends" }).click();
  await expect(h1(page)).toHaveText("Friends");
});

test("at 320px neither page scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/friends", SAM]) {
    await page.goto(path);
    await expect(h1(page)).toBeVisible();
    await expect(page.getByText(/Loading/)).toHaveCount(0);
    expect(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), path).toBe(0);
  }
});

test("axe: both pages in every theme", async ({ page }) => {
  for (const path of ["/friends", SAM]) {
    await page.goto(path);
    await expect(h1(page)).toBeVisible();
    await expect(page.getByText(/Loading/)).toHaveCount(0);
    for (const theme of THEMES) {
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});

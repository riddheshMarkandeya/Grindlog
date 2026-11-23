// The header's account picker, against the `accounts` seed's own stack: `rich` (you as ME) plus ALT,
// confirmed, whose only session is e2e-alt-0 to 2. Each test leaves the setting at all accounts.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { dropdown, option, options, pick } from "./dropdown";
import { expect, test } from "./fixtures";

test.use({ seed: "accounts" });
test.describe.configure({ mode: "serial" });

const THEMES = ["carbon", "slate", "oled"] as const;
const ALT_LABEL = "AltAccount · Steam";
const picker = (page: Page) => dropdown(page.getByRole("banner"), "Account");
const session = (page: Page) => page.locator("[data-session]");
test.afterEach(async ({ consoleErrors, request }) => {
  expect((await request.post("/api/settings?account=all", { headers: { "X-Grindlog-Request": "1" } })).ok()).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("all accounts first, then each confirmed id by its latest name and platform; picking ALT shows only ALT's matches", async ({ page }) => {
  await page.goto("/recap");
  await expect(session(page)).toHaveAttribute("data-session", "e2e-seed-won");
  await expect(picker(page)).toHaveText("All accounts");
  await picker(page).click();
  await expect(options(page)).toHaveText(["All accounts", "Epic|me|0 · Epic", ALT_LABEL]);
  await option(page, ALT_LABEL).click();
  // Picked on the current session's URL, so it lands on ALT's latest session: its only one.
  await expect(session(page)).toHaveAttribute("data-session", "e2e-alt-0");
  await expect(picker(page)).toBeFocused();
  await page.goto("/recap/e2e-alt-0/matches");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("This session: ")).toBeHidden();
});

test("a switch on an older session's URL lands on the latest session, with its filter, not the gone notice", async ({ page }) => {
  await page.goto("/recap/e2e-long-00?filter=ranked");
  await expect(session(page)).toHaveAttribute("data-session", "e2e-long-00");
  await pick(page, "Account", ALT_LABEL);
  await expect(page).toHaveURL(/\/recap\/e2e-alt-0\?filter=ranked$/);
  await expect(page.getByText("This session isn't here any more.")).toBeHidden();
});

test("the keyboard picks an account and saves it; a reload keeps it; all accounts brings everything back", async ({ page, request }) => {
  await page.goto("/trends");
  await picker(page).focus();
  // ↓ opens the list on the picked one; two more down to ALT.
  await page.keyboard.press("ArrowDown");
  await expect(option(page, "All accounts")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker(page)).toHaveText(ALT_LABEL);
  await expect(picker(page)).toBeFocused();
  await expect.poll(async () => ((await (await request.get("/api/settings")).json()) as { account: string }).account).toMatch(/^Steam\|/);
  await page.reload();
  await expect(picker(page)).toHaveText(ALT_LABEL);
  await page.goto("/recap");
  await expect(session(page)).toHaveAttribute("data-session", "e2e-alt-0");
  await pick(page, "Account", "All accounts");
  await expect(session(page)).toHaveAttribute("data-session", "e2e-seed-won");
  await expect(page.getByText("This session: 1–0")).toBeVisible();
});

test("axe: the header with the picker in every theme; it fits at 320px", async ({ page }) => {
  await page.goto("/recap");
  await expect(picker(page)).toBeVisible();
  for (const theme of THEMES) {
    // A string expression: the root tsconfig has no DOM lib for a page-side function.
    await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
    const { violations } = await new AxeBuilder({ page }).include("header").analyze();
    expect(violations.map((v) => `${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(picker(page)).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

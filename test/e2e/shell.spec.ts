// The web shell against the real tracker: the rich seed, whose current session is one won match
// (chip 1–0), then a replay of the completed fixture, which the camera player loses (chip 1–1).
// Serial: the replay is one-shot.
import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { indDuration, indPos, leftOf, transitionEnd } from "./indicator";

test.describe.configure({ mode: "serial" });

const THEMES = ["carbon", "slate", "oled"] as const;
const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });
const chip = (page: Page) => page.getByText(/^This session: /);

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

test("a dev build says so, in the header, logo, favicon and tab title, so it isn't mistaken for a friend's install; a prod build doesn't", async ({ page, request }) => {
  // The web build takes its channel from this variable, as vite.config.ts reads it.
  const prod = process.env.GRINDLOG_CHANNEL === "prod";
  await page.goto("/");
  await expect(page.getByRole("banner").getByText("Dev", { exact: true })).toHaveCount(prod ? 0 : 1);
  await expect(page).toHaveTitle(prod ? "Grindlog" : "Grindlog Dev");
  const favicon = prod ? "/favicon.ico" : "/favicon-dev.ico";
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", favicon);
  expect((await request.get(favicon)).headers()["content-type"]).toMatch(/icon/);
  // The teal logo is the orange one recoloured; the colour is the only way to tell them apart.
  // A logo this small is inlined as a data URL, URL-encoded or base64.
  const logo = (await page.getByRole("banner").locator("img").first().getAttribute("src")) ?? "";
  const data = /^data:[^,]*?(;base64)?,(.*)$/s.exec(logo);
  const svg = data ? (data[1] ? atob(data[2] ?? "") : decodeURIComponent(data[2] ?? "")) : await (await request.get(logo)).text();
  expect(svg).toContain(prod ? "#d95926" : "#14b8a6");
});

test("before the match: redirect, live status, chip, navigation, deep link, not found", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/recap\/e2e-seed-won(\?filter=everything)?$/);
  await expect(status(page, "connected")).toBeVisible();
  await expect(chip(page)).toHaveText("This session: 1–0");

  for (const name of ["Trends", "Settings", "Recap"]) {
    const link = page.getByRole("link", { name, exact: true });
    await link.click();
    // Recap moves on to the latest session's page.
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}(/[^/]+)?(\\?filter=\\w+)?$`));
    await expect(link).toHaveAttribute("aria-current", "page");
  }

  // A reload on a deep link is the tracker's static fallback serving the app.
  await page.goto("/trends");
  await page.reload();
  await expect(page.getByRole("link", { name: "Trends", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/no-such-page");
  await expect(page.getByText("There's no page here.")).toBeVisible();
});

test("a header click while the start page's redirect is pending is kept", async ({ page }) => {
  // The slowed page is the race window: the click's navigation is still rendering when the held
  // latest session lands.
  test.setTimeout(60_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 10 });
  const held = new Promise<Route>((resolve) => void page.route("**/api/sessions/latest?*", resolve, { times: 1 }));
  await page.goto("/");
  const latest = await held;
  const landed = page.waitForResponse("**/api/sessions/latest?*");
  await page.getByRole("link", { name: "Friends", exact: true }).click();
  await latest.continue();
  await landed;
  // Two frames: React commits whatever the landed data renders, so a redirect would have run.
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  await expect(page).toHaveURL(/\/friends$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friends");
});

test("a redirect decided on a URL that has since moved on is skipped and logged", async ({ page }) => {
  const held = new Promise<Route>((resolve) => void page.route("**/api/sessions/latest?*", resolve, { times: 1 }));
  await page.goto("/recap");
  const latest = await held;
  // The URL moves on without the router seeing it yet: the state a click leaves between the
  // redirect's render and its effect, made to last.
  await page.evaluate(`history.pushState(null, "", "/friends")`);
  const skipped = page.waitForEvent("console", (m) => m.text().includes("[grindlog] redirect/skipped"));
  await latest.continue();
  await skipped;
  await expect(page).toHaveURL(/\/friends$/);
});

test("a second header click during the first's page transition wins", async ({ page }) => {
  await page.goto("/trends");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trends");
  const nav = page.getByRole("navigation", { name: "Pages" });
  // force: Playwright's actionability wait would otherwise hold the click until the transition ends.
  await nav.getByRole("link", { name: "Recap" }).click({ force: true });
  await page.waitForTimeout(60);
  await nav.getByRole("link", { name: "Friends" }).click({ force: true });
  await expect(page).toHaveURL(/\/friends$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friends");
});

test("the header's selection line slides to the clicked tab, and fades out on Settings", async ({ page }) => {
  await page.goto("/trends");
  const nav = page.getByRole("navigation", { name: "Pages" });
  const trends = nav.getByRole("link", { name: "Trends" });
  const friends = nav.getByRole("link", { name: "Friends" });
  // Placed at the active tab on load without sliding in, then live.
  await expect(nav).toHaveAttribute("data-ind", "live");
  expect(await indPos(nav)).toBe(await leftOf(trends));
  const slid = transitionEnd(nav);
  await friends.click();
  await slid;
  expect(await indPos(nav)).toBe(await leftOf(friends));
  await expect(nav).toHaveAttribute("data-ind", "live");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(nav).toHaveAttribute("data-ind", "none");
});

test("reduced motion: the header line jumps instead of sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/trends");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav).toHaveAttribute("data-ind", "live");
  expect(await indDuration(nav, "translate")).toBe("0s");
  expect(await page.evaluate(`matchMedia("(prefers-reduced-motion: reduce)").matches`)).toBe(true);
});

test("axe: every page in every theme has no violations", async ({ page }) => {
  for (const path of ["/recap", "/trends", "/settings", "/no-such-page"]) {
    await page.goto(path);
    await expect(status(page, "connected")).toBeVisible();
    for (const theme of THEMES) {
      // A string expression: the root tsconfig has no DOM lib for a page-side function.
      await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${path} ${theme}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
    }
  }
});

test("the replay: status follows the match; the chip and the open recap update without a reload", async ({ page, stack }) => {
  await page.goto("/recap");
  await expect(status(page, "connected")).toBeVisible();
  await expect(chip(page)).toHaveText("This session: 1–0");
  await expect(page.getByRole("img", { name: "1 win, 0 losses" })).toBeVisible();
  stack.go();
  await expect(status(page, "recording match")).toBeVisible({ timeout: 10_000 });
  await expect(status(page, "connected")).toBeVisible({ timeout: 20_000 });
  await expect(chip(page)).toHaveText("This session: 1–1");
  await expect(page.getByRole("img", { name: "1 win, 1 loss" })).toBeVisible();
});

test("Start new session: confirm, then the chip is gone and the button unavailable", async ({ page }) => {
  await page.goto("/recap");
  await expect(chip(page)).toHaveText("This session: 1–1");
  const button = page.getByRole("button", { name: "Start new session" });
  await button.click();
  await page.getByRole("group", { name: "Start new session?" }).getByRole("button", { name: "Yes" }).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-disabled", "true");
});

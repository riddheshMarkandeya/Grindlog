// The Settings page against its own copy of the rich seed (the `settings` seed gets its own stack),
// so what it saves can't reach the other specs. Each test starts from the defaults.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { dropdown, pick } from "./dropdown";
import { expect, test } from "./fixtures";
import { openCard, shareDialog } from "./share-card";
import { indPos, leftOf } from "./indicator";

test.use({ seed: "settings" });

const THEMES = ["carbon", "slate", "oled"] as const;
const DEFAULTS = "theme=carbon&clock=24h&speed=kmh&startPage=recap&recapFilter=everything&trendsFilter=ranked&rollingWindow=20&remarks=true&moodLine=true&autoSeasons=true";
const HEADER = { "X-Grindlog-Request": "1" };
// The failed saves tests bring about on purpose.
const SAVE_FAILED = /^Failed to load resource: .* (500|409|429) .*\/api\/(settings|autostart|update)/;

const put = async (request: APIRequestContext, query: string) => {
  const res = await request.post(`/api/settings?${query}`, { headers: HEADER });
  expect(res.ok()).toBe(true);
};

test.beforeEach(async ({ request }) => {
  await put(request, DEFAULTS);
});

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors.filter((e) => !SAVE_FAILED.test(e))).toEqual([]);
});

const section = (page: Page, name: string) => page.getByRole("region", { name });
const row = (page: Page, label: string) => page.locator("[class*=row]").filter({ has: page.getByText(label, { exact: true }) });
const saved = (page: Page, label: string) => row(page, label).getByRole("status");
const again = (page: Page) => page.getByRole("button", { name: "Another remark" });

test("each setting saves, says so, and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Slate" }).click();
  await expect(saved(page, "Theme")).toHaveText("✓ Saved");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "slate");
  await page.getByRole("radio", { name: "12h" }).click();
  await expect(saved(page, "Clock")).toHaveText("✓ Saved");
  await page.getByRole("radio", { name: "mph" }).click();
  await expect(saved(page, "Speed")).toHaveText("✓ Saved");
  await page.getByRole("radio", { name: "Trends" }).click();
  await expect(saved(page, "Start page")).toHaveText("✓ Saved");
  await pick(page, "Recap playlist", "Private matches");
  await expect(saved(page, "Recap playlist")).toHaveText("✓ Saved");
  await pick(page, "Trends playlist", "Everything (excl. private)");
  await expect(saved(page, "Trends playlist")).toHaveText("✓ Saved");
  const window = page.getByLabel("Trends rolling window");
  await window.fill("35");
  await window.press("Enter");
  await expect(saved(page, "Trends rolling window")).toHaveText("✓ Saved");
  await expect(window).toBeFocused();
  await page.getByRole("switch", { name: "Mood line" }).click();
  await expect(saved(page, "Mood line")).toHaveText("✓ Saved");
  await page.getByRole("switch", { name: "Add new seasons automatically" }).click();
  await expect(saved(page, "Add new seasons automatically")).toHaveText("✓ Saved");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "slate");
  await expect(page.getByRole("radio", { name: "Slate" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "12h" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "mph" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Trends" })).toBeChecked();
  await expect(dropdown(page, "Recap playlist")).toHaveText("Private matches");
  await expect(dropdown(page, "Trends playlist")).toHaveText("Everything (excl. private)");
  await expect(window).toHaveValue("35");
  await expect(page.getByRole("switch", { name: "Mood line" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Show remarks" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Add new seasons automatically" })).not.toBeChecked();
});

test("a segmented choice's pill slides to the picked option", async ({ page }) => {
  await page.goto("/settings");
  const group = page.getByRole("radiogroup", { name: "Clock" });
  await expect(group).toHaveAttribute("data-ind", "live");
  const label12 = group.locator("label").filter({ has: page.getByRole("radio", { name: "12h" }) });
  await page.getByRole("radio", { name: "12h" }).click();
  await expect.poll(() => indPos(group)).toBe(await leftOf(label12));
  // The pill is the only highlight: the picked label doesn't light up under it as well.
  await expect(label12).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("a section link focuses its heading, which scrolls into view", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Seasons" }).click();
  const heading = page.getByRole("heading", { name: "Seasons", exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(page).toHaveURL(/\/settings$/);
});

test("the theme reaches the share card", async ({ page, request }) => {
  await put(request, "theme=oled");
  await page.goto("/recap/e2e-seed-won");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "oled");
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=footer]")).toBeVisible();
  expect(await page.evaluate("getComputedStyle(document.querySelector('dialog[open] [data-part=footer]')).getPropertyValue('--page').trim()")).toBe("#000");
});

test("12h times and mph speeds on the recap", async ({ page, request }) => {
  await page.goto("/recap/e2e-long-00");
  const card = page.getByRole("link", { name: /^Match 1,/ }).first();
  await expect(card).not.toContainText(/\d:\d\d\s?[ap]\.?m/i);
  await put(request, "clock=12h&speed=mph");
  await page.reload();
  await expect(card).toContainText(/\d:\d\d\s?[ap]\.?m\.?/i);
  const extras = page.locator("section").filter({ has: page.getByRole("heading", { name: "Extras", exact: true }) });
  // 101.5 km/h; under 100, two places, as km/h has.
  await expect(extras.getByRole("listitem").filter({ hasText: "Hardest shot" })).toContainText("63.07 mph");
});

test("the start page and each page's default filter; a filter in the URL still wins", async ({ page, request }) => {
  await put(request, "startPage=trends&recapFilter=private&trendsFilter=everything");
  await page.goto("/");
  await expect(page).toHaveURL(/\/trends$/);
  await expect(dropdown(page, "Playlist")).toHaveText("Everything (excl. private)");
  await page.goto("/recap");
  await expect(page).toHaveURL(/\/recap\/e2e-private\?filter=private$/);
  await page.goto("/recap/e2e-first-a?filter=everything");
  await expect(dropdown(page, "Playlist")).toHaveText("Everything (excl. private)");
  await page.goto("/trends?filter=ranked");
  await expect(dropdown(page, "Playlist")).toHaveText("All ranked");
});

test("the rolling window: a new size reaches Trends; a bad one says why and sends nothing", async ({ page }) => {
  await page.goto("/settings");
  const window = page.getByLabel("Trends rolling window");
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/settings")) posts.push(r.url()); });
  await window.fill("4");
  await window.press("Enter");
  await expect(page.getByText("Use a whole number from 5 to 100.")).toBeVisible();
  await expect(window).toHaveAttribute("aria-invalid", "true");
  await window.press("Escape");
  await expect(window).toHaveValue("20");
  await expect(page.getByText("Use a whole number from 5 to 100.")).toHaveCount(0);
  expect(posts).toEqual([]);
  await window.fill("10");
  await window.blur();
  await expect(saved(page, "Trends rolling window")).toHaveText("✓ Saved");

  // Last month: two days with matches, so it opens By match.
  await page.goto("/trends");
  const strip = page.getByRole("group", { name: /^Seasons and months of / });
  await strip.getByRole("button", { name: /^[A-Z][a-z]{2}$/ }).and(page.locator(":enabled")).last().click();
  await page.getByRole("button", { name: "Earlier month" }).click();
  await expect(page.getByRole("heading", { level: 3, name: /^Win % · / })).toHaveText("Win % · rolling 10 matches");
  await expect(page.getByText(/so this shows a rolling average of 10 matches/)).toBeVisible();
});

test("remarks off hides the headline lines; mood off keeps the quip and ↻; mood off with no quip shows nothing", async ({ page, request }) => {
  await put(request, "remarks=false");
  await page.goto("/recap/e2e-long-00");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(again(page)).toHaveCount(0);

  const quip = { mood: { band: "good", text: "A steady night." }, quip: { trigger: "t", text: "You scored {n}.", values: { n: 3 } } };
  await page.route("**/api/sessions/*/remarks?*", (route) => route.fulfill({ json: quip }));
  await put(request, "remarks=true&moodLine=false");
  await page.reload();
  await expect(page.locator("p").filter({ has: again(page) })).toHaveText(/^You scored 3\./);
  await expect(page.getByText("A steady night.")).toHaveCount(0);

  await page.unroute("**/api/sessions/*/remarks?*");
  await page.route("**/api/sessions/*/remarks?*", (route) => route.fulfill({ json: { ...quip, quip: null } }));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(again(page)).toHaveCount(0);

  // The share card drops the mood line too.
  await openCard(page);
  await expect(shareDialog(page).locator("[data-part=mood]")).toHaveCount(0);
});

test("the mood line switch waits on remarks; its value is kept", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Show remarks" }).click();
  await expect(page.getByRole("switch", { name: "Mood line" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Mood line" })).toBeChecked();
});

test("a failed save keeps the old value and offers Retry; a working Retry hands focus back", async ({ page }) => {
  await page.goto("/settings");
  let fail = true;
  await page.route("**/api/settings?*", (route) => (route.request().method() === "POST" && fail ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.continue()));
  await page.getByRole("radio", { name: "mph" }).click();
  const retry = row(page, "Speed").getByRole("button", { name: "Retry" });
  await expect(row(page, "Speed")).toContainText("Couldn't save");
  await expect(page.getByRole("radio", { name: "km/h" })).toBeChecked();
  fail = false;
  await retry.focus();
  await retry.press("Enter");
  await expect(saved(page, "Speed")).toHaveText("✓ Saved");
  await expect(page.getByRole("radio", { name: "mph" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "mph" })).toBeFocused();

  // The window field, too, goes back to the stored value.
  fail = true;
  const window = page.getByLabel("Trends rolling window");
  await window.fill("50");
  await window.press("Enter");
  await expect(row(page, "Trends rolling window")).toContainText("Couldn't save");
  await expect(window).toHaveValue("20");
});

test("Run at Windows startup reads the real logon task: the stack's never exists, so it's unavailable", async ({ page }) => {
  await page.goto("/settings");
  const startup = row(page, "Run at Windows startup");
  await expect(page.getByRole("switch", { name: "Run at Windows startup" })).toBeDisabled();
  await expect(startup).toContainText("Couldn't find or read Grindlog's startup task on this PC.");
});

/** Answers /api/autostart from `state` (a switch sets it), or 500s a switch while `fail` is set. */
async function fakeAutostart(page: Page, start: "on" | "off") {
  const fake = { state: start, fail: false };
  await page.route("**/api/autostart*", (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fulfill({ json: { state: fake.state } });
    if (fake.fail) return route.fulfill({ status: 500, json: { error: "autostart_failed" } });
    fake.state = new URL(req.url()).searchParams.get("on") === "true" ? "on" : "off";
    return route.fulfill({ json: { state: fake.state } });
  });
  return fake;
}

test("Run at Windows startup switches off and on and says so", async ({ page }) => {
  const fake = await fakeAutostart(page, "on");
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Run at Windows startup" });
  await expect(toggle).toBeChecked();
  await expect(row(page, "Run at Windows startup")).toContainText("Starts recording when you sign in to Windows.");
  await toggle.click();
  await expect(saved(page, "Run at Windows startup")).toHaveText("✓ Saved");
  await expect(toggle).not.toBeChecked();
  expect(fake.state).toBe("off");
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(fake.state).toBe("on");
});

test("a failed Run at Windows startup switch keeps the old state and offers Retry; a working Retry hands focus back", async ({ page }) => {
  const fake = await fakeAutostart(page, "on");
  fake.fail = true;
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Run at Windows startup" });
  await toggle.click();
  await expect(row(page, "Run at Windows startup")).toContainText("Couldn't save");
  await expect(toggle).toBeChecked();
  fake.fail = false;
  const retry = row(page, "Run at Windows startup").getByRole("button", { name: "Retry" });
  await retry.focus();
  await retry.press("Enter");
  await expect(saved(page, "Run at Windows startup")).toHaveText("✓ Saved");
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeFocused();
});

test("a failed Run at Windows startup read offers Retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/autostart", (route) => (fail ? route.fulfill({ status: 500, json: { error: "internal" } }) : route.fulfill({ json: { state: "on" } })));
  await page.goto("/settings");
  const startup = section(page, "Startup");
  await expect(startup).toContainText("Couldn't load the startup setting.");
  fail = false;
  await startup.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("switch", { name: "Run at Windows startup" })).toBeChecked();
});

test("reset puts a section back, reads Defaults, and focuses its heading", async ({ page, request }) => {
  await put(request, "clock=12h");
  await page.goto("/settings");
  const appearance = section(page, "Appearance");
  await appearance.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(appearance.locator("span", { hasText: /^Defaults$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: "24h" })).toBeChecked();
  await expect(page.getByRole("heading", { level: 2, name: "Appearance" })).toBeFocused();
  await expect(section(page, "Defaults").locator("span", { hasText: /^Defaults$/ })).toBeVisible();
});

test("passes axe in every theme, and fits at 320px", async ({ page, request }) => {
  for (const theme of THEMES) {
    await put(request, `theme=${theme}`);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("radio", { name: "Carbon" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Run at Windows startup" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations, theme).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Carbon" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

const PAGE = "https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.2.0";
const UPDATE = { enabled: true, version: "0.1.0", status: "up_to_date", available: null, skipped: null, autoApply: true, installRequested: false, checkedAt: "2026-11-12T10:00:00.000Z", lastApply: null, checking: false, checkAllowedAt: null };
const READY = { ...UPDATE, status: "ready", available: { version: "0.2.0", page: PAGE } };

const ERRORS: Record<number, string> = { 409: "not_available", 429: "too_soon" };

/** Answers /api/update from `view`; the writes change it the way the tracker does, or fail with `fail`. */
async function fakeUpdate(page: Page, start: Record<string, unknown>) {
  const fake = { view: { ...start }, fail: null as null | number, installs: [] as string[], checks: 0 };
  await page.route("**/api/update**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== "POST") return route.fulfill({ json: fake.view });
    if (fake.fail !== null) return route.fulfill({ status: fake.fail, json: { error: ERRORS[fake.fail] ?? "write_failed" } });
    if (url.pathname.endsWith("/check")) {
      fake.checks++;
      fake.view = { ...fake.view, checking: true };
    } else if (url.pathname.endsWith("/auto-apply")) fake.view = { ...fake.view, autoApply: url.searchParams.get("on") === "true" };
    else {
      fake.installs.push(url.searchParams.get("version") ?? "");
      fake.view = { ...fake.view, installRequested: true };
    }
    return route.fulfill({ json: fake.view });
  });
  return fake;
}

test("Updates: the stack is a dev build, so it says it doesn't update", async ({ page }) => {
  await page.goto("/settings");
  const updates = section(page, "Updates");
  await expect(updates).toContainText("Dev builds don't update.");
  await expect(updates.getByRole("switch")).toHaveCount(0);
});

test("Updates: a dev build has no check button", async ({ page }) => {
  await page.goto("/settings");
  await expect(section(page, "Updates")).toContainText("Dev builds don't update.");
  await expect(section(page, "Updates").getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("Updates: Check now shows Checking… until the check lands, then waits out the cooldown", async ({ page }) => {
  const fake = await fakeUpdate(page, UPDATE);
  await page.goto("/settings");
  const updates = section(page, "Updates");
  const lastChecked = updates.getByText(/^Last checked/);
  const before = await lastChecked.textContent();
  const button = updates.getByRole("button", { name: "Check now" });
  await button.click();
  const checking = updates.getByRole("button", { name: "Checking…" });
  await expect(checking).toHaveAttribute("aria-disabled", "true");
  await expect(checking).toBeFocused();
  expect(fake.checks).toBe(1);
  // Pressing it while checking asks nothing more.
  // Playwright won't click an aria-disabled button; Enter on the focused one is the same press.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect(fake.checks).toBe(1);

  // The supervisor's check lands: the 3 s re-read while checking picks it up, and the cooldown holds the button.
  fake.view = { ...UPDATE, checkedAt: new Date().toISOString(), checkAllowedAt: new Date(Date.now() + 5000).toISOString() };
  await expect(button).toHaveAttribute("aria-disabled", "true", { timeout: 6000 });
  await expect(button).toBeFocused();
  await expect(lastChecked).not.toHaveText(before ?? "");
  await expect(updates).toContainText("Checked moments ago. Try again in a minute.");
  await expect(button).not.toHaveAttribute("aria-disabled", "true", { timeout: 8000 });
  await expect(updates).not.toContainText("Checked moments ago");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Updates: Check now sits beside a ready update too, and fits at 320px", async ({ page }) => {
  await fakeUpdate(page, { ...READY, autoApply: false });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  const updates = section(page, "Updates");
  await expect(updates.getByRole("button", { name: "Install 0.2.0" })).toBeVisible();
  await expect(updates.getByRole("button", { name: "Check now" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

test("Updates: a check asked too soon or that fails to ask says so", async ({ page }) => {
  const fake = await fakeUpdate(page, UPDATE);
  await page.goto("/settings");
  const updates = section(page, "Updates");
  fake.fail = 429;
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates).toContainText("Checked moments ago. Try again in a minute.");
  fake.fail = 500;
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates).toContainText("Couldn't start a check.");
});

test("Updates: each status reads as a sentence", async ({ page }) => {
  const fake = await fakeUpdate(page, UPDATE);
  const updates = section(page, "Updates");
  const cases: [Record<string, unknown>, string][] = [
    [UPDATE, "Grindlog 0.1.0 is up to date."],
    [{ ...UPDATE, status: "not_checked", checkedAt: null }, "Grindlog 0.1.0 hasn't checked for updates yet."],
    [{ ...UPDATE, status: "error" }, "Couldn't check for updates. It tries again later."],
    [{ ...UPDATE, status: "skipped", skipped: "0.3.0" }, "Update 0.3.0 was skipped: its signature didn't check out."],
    [READY, "Grindlog 0.2.0 is ready to install."],
    // How the last update ended comes first, so a failed one isn't hidden behind "up to date".
    [{ ...UPDATE, version: "0.2.0", lastApply: { outcome: "updated", from: "0.1.0", to: "0.2.0", reason: null, at: "t", page: PAGE } }, "Updated to 0.2.0."],
    [{ ...UPDATE, lastApply: { outcome: "rolled_back", from: "0.1.0", to: "0.2.0", reason: "health_check_failed", at: "t", page: PAGE } }, "Update 0.2.0 didn't start, so Grindlog went back to 0.1.0."],
    [{ ...READY, available: { version: "0.2.1", page: PAGE }, lastApply: { outcome: "rolled_back", from: "0.1.0", to: "0.2.0", reason: "low_disk", at: "t", page: PAGE } }, "Update 0.2.0 needed more disk space, so Grindlog went back to 0.1.0. Grindlog 0.2.1 is ready to install."],
  ];
  for (const [view, text] of cases) {
    fake.view = view;
    await page.goto("/settings");
    await expect(updates).toContainText(text);
  }
});

test("Updates: with auto-apply on, a ready update needs nothing and links to what changed", async ({ page }) => {
  await fakeUpdate(page, READY);
  await page.goto("/settings");
  const updates = section(page, "Updates");
  await expect(updates).toContainText("Installs on its own when Rocket League is closed.");
  await expect(updates.getByRole("button", { name: /Install/ })).toHaveCount(0);
  const link = updates.getByRole("link", { name: "What changed in 0.2.0" });
  await expect(link).toHaveAttribute("href", PAGE);
  await expect(link).toHaveAttribute("target", "_blank");
});

test("Updates: the last-update line links what changed, or the latest release to reinstall from; going back links nothing", async ({ page }) => {
  const fake = await fakeUpdate(page, UPDATE);
  const updates = section(page, "Updates");
  const last = (outcome: string, reason: string | null = null) => ({ outcome, from: "0.1.0", to: "0.2.0", reason, at: "t", page: PAGE });
  const whatChanged = updates.getByRole("link", { name: "What changed in 0.2.0" });
  const latest = updates.getByRole("link", { name: "Latest release" });

  fake.view = { ...UPDATE, version: "0.2.0", lastApply: last("updated") };
  await page.goto("/settings");
  await expect(whatChanged).toHaveAttribute("href", PAGE);
  await expect(whatChanged).toHaveAttribute("target", "_blank");
  await expect(latest).toHaveCount(0);

  fake.view = { ...UPDATE, version: "0.2.0", lastApply: last("unhealthy", "health_check_failed") };
  await page.goto("/settings");
  await expect(updates).toContainText("Update 0.2.0 may not have finished; reinstall if something's wrong.");
  await expect(latest).toHaveAttribute("href", "https://github.com/riddheshMarkandeya/Grindlog/releases/latest");
  await expect(latest).toHaveAttribute("target", "_blank");
  await expect(whatChanged).toHaveCount(0);

  for (const outcome of ["rolled_back", "rollback_failed"]) {
    fake.view = { ...UPDATE, lastApply: last(outcome, "health_check_failed") };
    await page.goto("/settings");
    await expect(updates).toContainText("went back to 0.1.0.");
    await expect(updates.getByRole("link"), outcome).toHaveCount(0);
  }

  // Updated, with the next one ready and Install shown: each version keeps its own link, and it fits at 320px.
  fake.view = { ...READY, version: "0.2.0", autoApply: false, available: { version: "0.2.1", page: `${PAGE}x` }, lastApply: last("updated") };
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/settings");
  await expect(whatChanged).toHaveAttribute("href", PAGE);
  await expect(updates.getByRole("link", { name: "What changed in 0.2.1" })).toHaveAttribute("href", `${PAGE}x`);
  await expect(updates.getByRole("button", { name: "Install 0.2.1" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

test("Updates: auto-apply switches off, then Install asks for the version and says when it happens", async ({ page }) => {
  const fake = await fakeUpdate(page, READY);
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Install updates automatically" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(saved(page, "Install updates automatically")).toHaveText("✓ Saved");
  await expect(toggle).not.toBeChecked();
  const install = page.getByRole("button", { name: "Install 0.2.0" });
  await install.click();
  const pending = section(page, "Updates").getByText("Installs when Rocket League is closed.", { exact: true });
  await expect(pending).toBeVisible();
  await expect(pending).toBeFocused();
  expect(fake.installs).toEqual(["0.2.0"]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Updates: an Install the tracker refuses says why, and Install can be pressed again", async ({ page }) => {
  const fake = await fakeUpdate(page, { ...READY, autoApply: false });
  fake.fail = 409;
  await page.goto("/settings");
  await page.getByRole("button", { name: "Install 0.2.0" }).click();
  await expect(section(page, "Updates")).toContainText("That update isn't available any more.");
  fake.fail = 500;
  await page.getByRole("button", { name: "Install 0.2.0" }).click();
  await expect(section(page, "Updates")).toContainText("Couldn't ask for the install.");
  fake.fail = null;
  await page.getByRole("button", { name: "Install 0.2.0" }).click();
  await expect(section(page, "Updates").getByText("Installs when Rocket League is closed.", { exact: true })).toBeVisible();
});

test("Updates: a failed read offers Retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/update", (route) => (fail ? route.fulfill({ status: 500, json: { error: "internal" } }) : route.fulfill({ json: UPDATE })));
  await page.goto("/settings");
  const updates = section(page, "Updates");
  await expect(updates).toContainText("Couldn't load the update status.");
  fail = false;
  await updates.getByRole("button", { name: "Retry" }).click();
  await expect(updates).toContainText("Grindlog 0.1.0 is up to date.");
});

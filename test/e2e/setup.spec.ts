// The Stats API setup card, against the `setup` seed's own stack: no matches, the stand-in Documents
// ini with PacketSendRate=0, and no game answering, so the tracker waits with a setup problem.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { REQUEST_HEADER, STATS_INI } from "../../src/shared/constants";
import { expect, test } from "./fixtures";
import { STATS_CONFIG_SUBDIR } from "./stats-config-dir";

test.use({ seed: "setup" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

const card = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Turn on Rocket League's Stats API" });

// Before the fix, which the next test makes for good.
test("passes axe in every theme with the steps open, and fits at 320px", async ({ page, request }) => {
  for (const theme of ["carbon", "slate", "oled"]) {
    expect((await request.post(`/api/settings?theme=${theme}`, { headers: { [REQUEST_HEADER]: "1" } })).ok()).toBe(true);
    await page.goto("/recap");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await card(page).getByText("Do it by hand").click();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations, theme).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/recap");
  await card(page).getByText("Do it by hand").click();
  await expect(card(page).getByRole("button", { name: "Turn it on" })).toBeVisible();
  expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
});

test("the card shows on every page; one click turns the Stats API on and changes nothing else in the file", async ({ page, stack }) => {
  const ini = join(stack.dataDir, STATS_CONFIG_SUBDIR, STATS_INI);
  const before = readFileSync(ini, "utf8");
  await page.goto("/settings");
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "setup problem" })).toBeVisible();
  await page.goto("/recap");
  await expect(card(page)).toContainText("sets PacketSendRate to 30");
  // The steps by hand name the real file.
  await card(page).getByText("Do it by hand").click();
  await expect(card(page)).toContainText(ini);
  const { violations } = await new AxeBuilder({ page }).include("main > section").analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await card(page).getByRole("button", { name: "Turn it on" }).click();
  const done = page.getByRole("region", { name: "Done" });
  await expect(done).toContainText("If Rocket League is open, restart it");
  await expect(done.getByRole("heading", { name: "Done" })).toBeFocused();
  expect(readFileSync(ini, "utf8")).toBe(before.replace("PacketSendRate=0", "PacketSendRate=30"));
  // The background recheck reaches the status: the header leaves "setup problem".
  await expect(page.getByRole("status").filter({ hasText: "waiting for game" })).toBeVisible();
  await done.getByRole("button", { name: "Dismiss" }).click();
  await expect(done).toBeHidden();
  await expect(card(page)).toBeHidden();
});

// The share card's worst case (the share seed): a live 48-match session, a 32-character name, the
// longest mood line, the longest filter label beside the name, the stood-out callout and a two-line 8th tile,
// all inside 360×480.
import { readFileSync } from "node:fs";
import { MOOD_LINES } from "../../src/server/remarks/copy";
import { expect, test } from "./fixtures";
import { filterLines, labelLines, measureCard, openCard, shareDialog } from "./share-card";

test.use({ seed: "share" });

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors).toEqual([]);
});

const LONGEST = Object.values(MOOD_LINES).flat().reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;

test("the longest of everything still fits: no overflow, the footer inside, the name cut, the filter on two lines, the line at least 48px, and it exports", async ({ page }) => {
  await page.route("**/api/sessions/*/remarks?*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { mood: { band: string; text: string } };
    await route.fulfill({ response: res, json: { ...body, mood: { ...body.mood, text: LONGEST } } });
  });
  // Both filters, with a 32-character nickname: the longest label, taking width from the name.
  await page.goto("/recap/e2e-share-00?filter=13&with=Steam%7Ce2e-sam%7C0");
  await openCard(page);
  const dialog = shareDialog(page);
  await expect(dialog.locator("[data-part=filter]")).toHaveText(`Ranked Standard · with ${"W".repeat(32)}`);
  expect(await filterLines(page)).toBe(2);
  await expect(dialog.getByText("● live")).toBeVisible();
  await expect(dialog.getByText(LONGEST)).toBeVisible();
  await expect(dialog.locator("[data-tile]")).toHaveCount(8);
  expect(await labelLines(page, "aerialTouches")).toBe(2);
  await expect(dialog.getByText("Saves:")).toBeVisible();

  const fit = await measureCard(page);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.footerRoom).toBeGreaterThanOrEqual(0);
  expect(fit.nameCut).toBe(true);
  expect(fit.nameInside).toBe(true);
  expect(fit.filterInside).toBe(true);
  expect(fit.lineHeight).toBeGreaterThanOrEqual(48);

  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download PNG" }).click()]);
  const png = readFileSync(await download.path());
  // IHDR's width and height, big-endian, right after the chunk's type.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1440]);
});

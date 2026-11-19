// The season file, against the `seasons` seed's own stack: the rich seed with GRINDLOG_SEASONS_FEED
// pointing at test/fixtures/season-file.json and the first sync brought forward, so a new season
// and a corrected start arrive with no network.
import { expect, test } from "./fixtures";

test.use({ seed: "seasons" });

test("a season in the file shows up in Settings, and an unedited seed row takes the file's corrected start", async ({ page }) => {
  await page.goto("/settings");
  const seasons = page.getByRole("region", { name: "Seasons" });
  const row = (name: string) => seasons.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  // The sync runs a moment after the tracker starts; its seasons_changed event refreshes an open page.
  await expect(row("S25")).toContainText(/9 Dec 2026|Dec 9, 2026/, { timeout: 15_000 });
  await expect(row("S23")).toContainText(/10 Jun 2026|Jun 10, 2026/);
  await expect(page.getByRole("switch", { name: "Add new seasons automatically" })).toBeChecked();
});

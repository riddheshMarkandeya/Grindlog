// The landing page's setup card screen (`bun run site:screens`). Its own file, because a seed is
// per worker: no matches and the Stats API off in the stand-in ini, so the card shows. The stand-in
// ini's path holds the temp dir, so the shot stops at the card, whose by-hand steps (with the path)
// stay folded.
import { expect, test } from "../e2e/fixtures";
import { DESKTOP, shoot } from "./shoot";

test.use({ seed: "setup", viewport: DESKTOP, deviceScaleFactor: 2 });

test("writes the setup card screen", async ({ page }) => {
  await page.goto("/recap");
  const card = page.getByRole("region", { name: "Turn on Rocket League's Stats API" });
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  if (box === null) throw new Error("the setup card has no box");
  await shoot(page, "setup", { clip: { x: 0, y: 0, width: DESKTOP.width, height: Math.ceil(box.y + box.height + 24) } });
});

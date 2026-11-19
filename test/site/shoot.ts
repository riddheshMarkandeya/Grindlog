// Shared by the landing page's screenshot specs.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

export const SITE = join(import.meta.dirname, "..", "..", "site");
export const OUT = join(SITE, "screens");
export const DESKTOP = { width: 1280, height: 800 };

/** Waits for the page's fonts and a settled frame, then writes the shot: of the page, or of `target` alone. */
export async function shoot(
  page: Page,
  name: string,
  opts: { scrollTo?: string; clip?: { x: number; y: number; width: number; height: number }; target?: Locator } = {},
) {
  await page.evaluate("document.fonts.ready.then(() => true)");
  if (opts.scrollTo) {
    // Scroll by the heading's offset, so it sits just under the top edge.
    const heading = page.getByRole("heading", { name: opts.scrollTo }).first();
    await heading.waitFor();
    const box = await heading.boundingBox();
    if (box === null) throw new Error(`"${opts.scrollTo}" has no box`);
    await page.mouse.move(DESKTOP.width / 2, 200);
    await page.mouse.wheel(0, box.y - 24);
  }
  // Charts draw after their data arrives; reduced motion keeps them from animating.
  await page.waitForTimeout(600);
  const path = join(OUT, `${name}.png`);
  if (opts.target) await opts.target.screenshot({ path });
  else await page.screenshot({ path, clip: opts.clip });
}

// Renders the icon SVGs in the installed Chrome and packs them into favicon.ico, for the browser tab,
// the Start menu shortcut and the exes. `bun run icons`; the output is committed.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "@playwright/test";

const REPO = join(import.meta.dirname, "..");
const MASTER = join(REPO, "src", "web", "assets", "icon.svg");
// Drawn on a 16 px grid, because the master's bars smear at the small sizes.
const SMALL = join(REPO, "src", "web", "assets", "icon-small.svg");
const OUT = join(REPO, "src", "web", "public", "favicon.ico");
const SIZES = [{ size: 16, svg: SMALL }, { size: 24, svg: SMALL }, ...[32, 48, 64, 128, 256].map((size) => ({ size, svg: MASTER }))];

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** An ICO whose images are PNGs: a header, one directory entry per image, then the images. */
export function packIco(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    // One byte each, where 0 means 256.
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

async function renderPng(browser: Browser, svgPath: string, size: number): Promise<Uint8Array> {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${readFileSync(svgPath, "utf8")}`);
    return await page.screenshot({ omitBackground: true });
  } finally {
    await page.close();
  }
}

if (import.meta.main) {
  // Here, so that testing packIco doesn't load Playwright.
  const { chromium } = await import("@playwright/test");
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch (err) {
    console.error(`Could not start Chrome, which renders the icons; is it installed? ${(err as Error).message}`);
    process.exit(1);
  }
  try {
    const pngs = [];
    for (const { size, svg } of SIZES) {
      pngs.push({ size, data: await renderPng(browser, svg, size) });
      console.log(`Rendered ${String(size)} px from ${svg}`);
    }
    writeFileSync(OUT, packIco(pngs));
    console.log(`Wrote ${OUT}`);
  } finally {
    await browser.close();
  }
}

// Renders the icon SVGs in the installed Chrome and packs them into favicon.ico (the browser tab and
// the release exes), a teal favicon-dev.ico plus header logo for the dev channel (its tab, header and
// exe, so it can't pass for a friend's install), and the tray's state icons. `bun run icons`; the
// output is committed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "@playwright/test";

const REPO = join(import.meta.dirname, "..");
const MASTER = join(REPO, "src", "web", "assets", "icon.svg");
// Drawn on a 16 px grid, because the master's bars smear at the small sizes.
const SMALL = join(REPO, "src", "web", "assets", "icon-small.svg");
const OUT = join(REPO, "src", "web", "public", "favicon.ico");
// In assets/, not public/: Vite copies public/ into every build, and only dev builds take these.
const DEV_OUT = join(REPO, "src", "web", "assets", "favicon-dev.ico");
const DEV_LOGO = join(REPO, "src", "web", "assets", "icon-small-dev.svg");
const SIZES = [{ size: 16, svg: SMALL }, { size: 24, svg: SMALL }, ...[32, 48, 64, 128, 256].map((size) => ({ size, svg: MASTER }))];
const TRAY_OUT = join(REPO, "src", "tray", "icons");

const PROD_LINE = "#d95926";
const TILE = "#161618";
const TRAY_CHANNELS = { prod: PROD_LINE, dev: "#14b8a6" } as const;
const TRAY_DOTS = { ready: null, active: "#3fb950", attention: "#f0a020", stopped: "#e5484d" } as const;
/** The small icon size (16 px at 100 %) at every display scale from 100 to 300 %; up to 24 is drawn from the 16 px master. */
const TRAY_SIZES = [16, 20, 24, 28, 32, 36, 40, 48];
const SMALL_MAX = 24;
// On the 16 grid: a dot over the bottom-right corner, ringed in the tile colour so it parts from the bars.
const DOT = { c: 12, r: 3.5, ring: 1 };

export interface TrayIcon { file: string; line: string; dot: string | null; sizes: number[] }

/** The tray's icons: one per channel (dev gets a teal line, so it can't pass for prod) and state. */
export function traySet(): TrayIcon[] {
  return Object.entries(TRAY_CHANNELS).flatMap(([channel, line]) =>
    Object.entries(TRAY_DOTS).map(([state, dot]) => ({ file: `${channel}-${state}.ico`, line, dot, sizes: TRAY_SIZES })),
  );
}

/** A master SVG (on a 16 or 64 grid) with the line recoloured and the state dot drawn on top. */
export function traySvg(svg: string, grid: 16 | 64, { line, dot }: { line: string; dot: string | null }): string {
  const recoloured = svg.replaceAll(PROD_LINE, line);
  if (dot === null) return recoloured;
  const k = grid / 16;
  const n = (v: number) => String(v * k);
  const circle = (r: number, fill: string) => `<circle cx="${n(DOT.c)}" cy="${n(DOT.c)}" r="${n(r)}" fill="${fill}"/>`;
  return recoloured.replace("</svg>", `${circle(DOT.r + DOT.ring, TILE)}${circle(DOT.r, dot)}</svg>`);
}

/** A master SVG in the dev channel's colour with no state dot: the dev favicon and header logo. */
export const devSvg = (svg: string): string => traySvg(svg, 16, { line: TRAY_CHANNELS.dev, dot: null });

export const ICO_HEADER_BYTES = 6;
export const ICO_ENTRY_BYTES = 16;

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

async function renderPng(browser: Browser, svg: string, size: number): Promise<Uint8Array> {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`);
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
    for (const [out, colour] of [[OUT, (svg: string) => svg], [DEV_OUT, devSvg]] as const) {
      const pngs = [];
      for (const { size, svg } of SIZES) {
        pngs.push({ size, data: await renderPng(browser, colour(readFileSync(svg, "utf8")), size) });
        console.log(`Rendered ${String(size)} px from ${svg} for ${out}`);
      }
      writeFileSync(out, packIco(pngs));
      console.log(`Wrote ${out}`);
    }
    writeFileSync(DEV_LOGO, devSvg(readFileSync(SMALL, "utf8")));
    console.log(`Wrote ${DEV_LOGO}`);
    const small = readFileSync(SMALL, "utf8");
    const master = readFileSync(MASTER, "utf8");
    mkdirSync(TRAY_OUT, { recursive: true });
    for (const icon of traySet()) {
      const frames = [];
      for (const size of icon.sizes) {
        const svg = size <= SMALL_MAX ? traySvg(small, 16, icon) : traySvg(master, 64, icon);
        frames.push({ size, data: await renderPng(browser, svg, size) });
      }
      writeFileSync(join(TRAY_OUT, icon.file), packIco(frames));
      console.log(`Wrote ${icon.file}`);
    }
  } finally {
    await browser.close();
  }
}

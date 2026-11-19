// The landing page (site/), served from disk under the Pages subpath, so an absolute asset link
// would miss. No tracker: plain Playwright, with GitHub's releases API routed per test.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SITE = join(import.meta.dirname, "..", "..", "site");
const ORIGIN = "https://site.test";
const HOME = `${ORIGIN}/Grindlog/`;
const LIVE = "https://riddheshmarkandeya.github.io/Grindlog/";
const API = "https://api.github.com/repos/riddheshMarkandeya/Grindlog/releases/latest";
const LATEST = "https://github.com/riddheshMarkandeya/Grindlog/releases/latest";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
};

type Api = { status: number; body?: unknown } | "offline";

interface Seen {
  failed: string[];
  errors: string[];
  warnings: string[];
}

/** Serves site/ at HOME (less any `blocked` file), answers the releases API with `api`, and records what went wrong. */
async function open(page: Page, api: Api, blocked?: string): Promise<Seen> {
  const seen: Seen = { failed: [], errors: [], warnings: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") seen.errors.push(msg.text());
    if (msg.type() === "warning") seen.warnings.push(msg.text());
  });
  page.on("pageerror", (err) => seen.errors.push(err.message));
  page.on("requestfailed", (req) => seen.failed.push(`${req.url()} ${req.failure()?.errorText ?? ""}`));
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().startsWith(API)) seen.failed.push(`${res.url()} ${String(res.status())}`);
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const rel = normalize(path.replace(/^\/Grindlog\//, "").replace(/^$|\/$/, "$&index.html"));
    const file = join(SITE, rel);
    if (rel === blocked) {
      await route.abort("failed");
      return;
    }
    if (!path.startsWith("/Grindlog/") || !file.startsWith(SITE + sep) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: "not found" });
      return;
    }
    await route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? "application/octet-stream", body: await readFile(file) });
  });
  await page.route(NOTE_IMG, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: await readFile(join(SITE, "og.png")) });
  });
  await page.route(API, async (route) => {
    if (api === "offline") await route.abort("internetdisconnected");
    else await route.fulfill({ status: api.status, contentType: "application/json", body: JSON.stringify(api.body ?? {}) });
  });
  await page.goto(HOME);
  return seen;
}

// GitHub's body_html puts an inline style on each image, which the CSP would refuse.
const NOTE_IMG = "https://private-user-images.githubusercontent.com/1/shot.png";
const release = {
  tag_name: "v0.1.6",
  published_at: "2026-11-20T18:00:00Z",
  body_html: `<ul><li>New seasons arrive on their own. <a href="https://github.com/x">More</a></li></ul><p><img src="${NOTE_IMG}" alt="New screen" style="max-width: 100%;"></p>`,
};
const news = (page: Page) => page.locator("#news");
const fallback = (page: Page) => news(page).getByRole("link", { name: "See what's new on GitHub →" });

test("What's new shows the latest release's tag, month and notes", async ({ page }) => {
  const seen = await open(page, { status: 200, body: release });
  await expect(news(page).getByText("v0.1.6 · Nov 2026")).toBeVisible();
  await expect(news(page).getByText("New seasons arrive on their own.")).toBeVisible();
  // A link from the notes opens in a new tab too.
  await expect(news(page).getByRole("link", { name: "More" })).toHaveAttribute("target", "_blank");
  await expect(fallback(page)).toHaveAttribute("href", LATEST);
  // The image shows, with its inline style dropped rather than refused by the CSP.
  await expect(news(page).getByRole("img", { name: "New screen" })).toBeVisible();
  await expect(news(page).locator("[style]")).toHaveCount(0);
  expect(seen.errors).toEqual([]);
});

for (const [name, api, reason] of [
  ["a rate-limited 403", { status: 403, body: { message: "API rate limit exceeded" } }, "HTTP 403"],
  ["an empty release body", { status: 200, body: { ...release, body_html: "  " } }, "no release notes"],
  ["no network", "offline", ""],
] as const) {
  test(`What's new keeps the plain link on ${name}, and says why in the console`, async ({ page }) => {
    const seen = await open(page, api);
    await expect.poll(() => seen.warnings.filter((w) => w.startsWith("[whats-new]"))).toHaveLength(1);
    expect(seen.warnings.find((w) => w.startsWith("[whats-new]"))).toContain(reason);
    await expect(news(page).getByText("Latest release")).toBeVisible();
    await expect(page.locator("#news-body")).toBeHidden();
    await expect(fallback(page)).toBeVisible();
  });
}

test("loads every asset under the subpath, with no failed request and no CSP or script error", async ({ page }) => {
  const seen = await open(page, { status: 200, body: release });
  await expect(page.getByRole("link", { name: "Download for Windows" })).toHaveAttribute("href", LATEST);
  // Bring every lazy image in.
  for (const img of await page.locator("img[loading=lazy]").all()) await img.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate("[...document.images].filter((i) => !i.complete).length")).toBe(0);
  expect(await page.evaluate("[...document.querySelectorAll('main img, header img')].filter((i) => i.naturalWidth === 0).map((i) => i.src)")).toEqual([]);
  expect(await page.evaluate("document.fonts.check('800 italic 16px \"Barlow Condensed\"')")).toBe(true);
  expect(seen.failed).toEqual([]);
  // A CSP violation logs as a console error; this also covers the JSON-LD block.
  expect(seen.errors).toEqual([]);
});

test("has the title, description, social card and alt text search and link previews need", async ({ page }) => {
  await open(page, "offline");
  await expect(page).toHaveTitle("Grindlog: free Rocket League stats tracker for your PC");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Rocket League.*Stats API/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", LIVE);
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toBe(`${LIVE}og.png`);
  expect(existsSync(join(SITE, "og.png"))).toBe(true);
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(ld ?? "")).toMatchObject({ "@type": "SoftwareApplication", downloadUrl: LATEST });
  // Every image says what it shows; the lightbox's is filled in when it opens.
  expect(await page.evaluate("[...document.querySelectorAll('img:not(#lightbox-img)')].filter((i) => !i.getAttribute('alt')?.trim()).length")).toBe(0);
});

test("every external link opens in a new tab", async ({ page }) => {
  await open(page, { status: 200, body: release });
  await expect(news(page).getByText("v0.1.6 · Nov 2026")).toBeVisible();
  const links = await page.evaluate<{ href: string; target: string | null; rel: string | null }[]>(
    "[...document.querySelectorAll('a[href^=\"http\"]')].map((a) => ({ href: a.href, target: a.getAttribute('target'), rel: a.getAttribute('rel') }))",
  );
  expect(links.length).toBeGreaterThan(5);
  for (const l of links) expect(l, l.href).toMatchObject({ target: "_blank", rel: "noopener" });
});

test("every screenshot opens full size with its caption; Esc, Close and the backdrop close it", async ({ page }) => {
  await open(page, "offline");
  const dialog = page.locator("#lightbox");
  const zooms = await page.locator(".zoom").all();
  expect(zooms.length).toBe(10);
  for (const zoom of zooms) {
    const src = await zoom.locator("img").getAttribute("src");
    const alt = await zoom.locator("img").getAttribute("alt");
    await zoom.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#lightbox-caption")).toHaveText(alt ?? "");
    await expect(page.locator("#lightbox-img")).toHaveAttribute("src", src ?? "");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  await zooms[0]?.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await zooms[0]?.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test("nothing stays hidden once scrolled past", async ({ page }) => {
  await open(page, "offline");
  for (const el of await page.locator(".reveal").all()) await el.scrollIntoViewIfNeeded();
  await expect(page.locator(".reveal:not(.in)")).toHaveCount(0);
});

test("if main.js fails to load, every block still shows", async ({ page }) => {
  await open(page, "offline", "main.js");
  const hidden = await page.evaluate<number>("[...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length");
  expect(hidden).toBe(0);
  await expect(page.locator(".reveal").first()).toBeVisible();
});

test("with reduced motion, revealed blocks fade without moving", async ({ page }) => {
  // The config turns reduced motion on for every test.
  await open(page, "offline");
  const transforms = await page.evaluate<string[]>("[...document.querySelectorAll('.reveal')].map((e) => getComputedStyle(e).transform)");
  expect(transforms.length).toBeGreaterThan(5);
  for (const t of transforms) expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(t);
});

for (const width of [320, 375]) {
  test(`fits a ${String(width)}px phone with no sideways scroll, and uses the phone crop`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await open(page, "offline");
    expect(await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")).toBe(true);
    await expect.poll(() => page.evaluate("document.querySelector('.window img').currentSrc")).toMatch(/screens\/recap-m\.png$/);
  });
}

test("passes axe", async ({ page }) => {
  await open(page, { status: 200, body: release });
  await expect(news(page).getByText("v0.1.6 · Nov 2026")).toBeVisible();
  for (const el of await page.locator(".reveal").all()) await el.scrollIntoViewIfNeeded();
  await expect(page.locator(".reveal:not(.in)")).toHaveCount(0);
  // Contrast is measured on the final colours, not mid-fade ones.
  // (A poll: waitForFunction's string form is eval, which the page's CSP blocks.)
  await expect.poll(() => page.evaluate("document.getAnimations().filter((a) => a.playState === 'running').length")).toBe(0);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});

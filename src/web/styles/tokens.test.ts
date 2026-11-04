import { describe, expect, test } from "vitest";
import css from "./tokens.css?raw";

const CSS_FILES = import.meta.glob<string>("../**/*.css", { query: "?raw", import: "default", eager: true });
const THEMES = ["carbon", "slate", "oled"];
const THEME_TOKENS = ["page", "surf", "surf2", "line", "grid", "ink", "ink2", "muted", "accent"];

function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[[\]]/g, "\\$&");
  const body = new RegExp(`(?:^|\\s)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`no block ${selector}`);
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);?/g)) tokens.set(m[1] ?? "", (m[2] ?? "").trim());
  return tokens;
}

/** The 0–255 channels of a 3- or 6-digit hex colour. */
function channels(hex: string): number[] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The text step's color-mix(in srgb, var(--x) N%, white), blended channel by channel as srgb mixing does.
function resolve(root: Map<string, string>, value: string): string {
  const mix = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+(?:\.\d+)?)%, white\)$/.exec(value);
  if (!mix) return value;
  const p = Number(mix[2]) / 100;
  const ch = channels(root.get(mix[1] ?? "") ?? "").map((v) => Math.round(v * p + 255 * (1 - p)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Hex, the colour functions and the two named colours a neutral is likeliest to be written as.
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black)(?![\w-])/g;

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme tokens", () => {
  test("the contrast helper matches known WCAG ratios", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  test("every theme defines the same tokens", () => {
    for (const theme of THEMES) expect([...block(`[data-theme=${theme}]`).keys()].sort()).toEqual([...THEME_TOKENS].sort());
  });

  test("the shared tokens live on :root", () => {
    expect([...block(":root").keys()]).toEqual(expect.arrayContaining(["blue", "orange", "win", "loss", "up", "down", "flag", "scrim", "shadow", "r", "s1", "s6"]));
  });

  test("the text step --up/--down is mixed from --win/--loss, so a :root colour override moves both", () => {
    const root = block(":root");
    expect(root.get("up")).toMatch(/^color-mix\(in srgb, var\(--win\) \d+%, white\)$/);
    expect(root.get("down")).toMatch(/^color-mix\(in srgb, var\(--loss\) \d+%, white\)$/);
  });

  test("the colour-mix resolver blends channels in srgb", () => {
    expect(resolve(new Map([["x", "#000000"]]), "color-mix(in srgb, var(--x) 50%, white)")).toBe("#808080");
    expect(resolve(new Map([["x", "#000"]]), "color-mix(in srgb, var(--x) 50%, white)")).toBe("#808080");
  });

  test("no literal colours in CSS outside tokens.css", () => {
    expect(Object.keys(CSS_FILES).length).toBeGreaterThan(5);
    const hits = Object.entries(CSS_FILES)
      .filter(([path]) => path !== "./tokens.css")
      .flatMap(([path, text]) => [...text.matchAll(LITERAL_COLOUR)].map((m) => `${path}: ${m[0]}`));
    expect(hits).toEqual([]);
  });

  test("the display face is named once, as --display in tokens.css", () => {
    expect(block(":root").get("display")).toMatch(/^Bahnschrift,/);
    // Any mention, so a font: shorthand or an inline style in a component counts too.
    const code = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    const copies = Object.entries({ ...CSS_FILES, ...code }).filter(([path, text]) => path !== "./tokens.css" && path !== "./tokens.test.ts" && text.includes("Bahnschrift")).map(([path]) => path);
    expect(copies).toEqual([]);
  });

  describe.each(THEMES)("%s contrast", (theme) => {
    const t = block(`[data-theme=${theme}]`);
    const get = (k: string) => t.get(k) ?? "";
    test.each([["ink", "page"], ["ink", "surf"], ["ink", "surf2"], ["ink2", "page"], ["ink2", "surf"], ["ink2", "surf2"], ["muted", "page"], ["muted", "surf"]])(
      "%s on %s is at least 4.5:1",
      (fg, bg) => {
        expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
      },
    );
    test.each(["up", "down"])("the %s text step is at least 4.5:1 on page and surf", (k) => {
      const root = block(":root");
      const fg = resolve(root, root.get(k) ?? "");
      for (const bg of ["page", "surf"]) expect(contrast(fg, get(bg)), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    test.each(["blue", "friend-a", "friend-b"])("page text on %s is at least 4.5:1", (k) => {
      expect(contrast(get("page"), block(":root").get(k) ?? "")).toBeGreaterThanOrEqual(4.5);
    });
    test("accent on surf is at least 3:1", () => {
      expect(contrast(get("accent"), get("surf"))).toBeGreaterThanOrEqual(3);
    });
  });
});

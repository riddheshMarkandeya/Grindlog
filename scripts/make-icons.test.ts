import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devSvg, packIco, traySet, traySvg } from "./make-icons";

const png = (size: number, bytes: number[]) => ({ size, data: Uint8Array.from(bytes) });

describe("devSvg", () => {
  const asset = (name: string) => readFileSync(join(import.meta.dirname, "..", "src", "web", "assets", name), "utf8");

  test("the committed dev logo is the small master in the dev channel's colour", () => {
    expect(devSvg(asset("icon-small.svg"))).not.toContain("#d95926");
    expect(asset("icon-small-dev.svg")).toBe(devSvg(asset("icon-small.svg")));
  });
});

describe("packIco", () => {
  const ico = Buffer.from(packIco([png(16, [1, 2, 3]), png(256, [4, 5])]));
  const entry = (i: number) => ico.subarray(6 + 16 * i, 6 + 16 * (i + 1));

  test("the header says reserved 0, type icon, and the image count", () => {
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
  });

  test("an entry holds its size in both dimensions, with no palette, 1 plane and 32 bits", () => {
    expect([...entry(0).subarray(0, 8)]).toEqual([16, 16, 0, 0, 1, 0, 32, 0]);
  });

  test("a 256 px image is stored as size 0, because the field is one byte", () => {
    expect([entry(1)[0], entry(1)[1]]).toEqual([0, 0]);
  });

  test("the first image starts after the directory, and each later one after the last", () => {
    expect([entry(0).readUInt32LE(8), entry(0).readUInt32LE(12)]).toEqual([3, 38]);
    expect([entry(1).readUInt32LE(8), entry(1).readUInt32LE(12)]).toEqual([2, 41]);
  });

  test("the images follow the directory unchanged", () => {
    expect([...ico.subarray(38)]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("traySet", () => {
  test("one icon per channel and state, named <channel>-<state>.ico", () => {
    expect(traySet().map((i) => i.file)).toEqual([
      "prod-ready.ico", "prod-active.ico", "prod-attention.ico", "prod-stopped.ico",
      "dev-ready.ico", "dev-active.ico", "dev-attention.ico", "dev-stopped.ico",
    ]);
  });

  test("prod keeps the orange line, dev is teal; ready has no dot and the others green, amber, red", () => {
    const by = (file: string) => traySet().find((i) => i.file === file);
    expect(by("prod-ready.ico")).toMatchObject({ line: "#d95926", dot: null });
    expect(by("dev-active.ico")).toMatchObject({ line: "#14b8a6", dot: "#3fb950" });
    expect(by("prod-attention.ico")).toMatchObject({ dot: "#f0a020" });
    expect(by("dev-stopped.ico")).toMatchObject({ dot: "#e5484d" });
  });

  test("each icon holds the tray's small icon size at every display scale from 100 to 300 %", () => {
    for (const icon of traySet()) expect(icon.sizes).toEqual([16, 20, 24, 28, 32, 36, 40, 48]);
  });
});

describe("traySvg", () => {
  const small = '<svg viewBox="0 0 16 16"><path stroke="#d95926"/></svg>';

  test("swaps the line colour and adds a ringed dot over the bottom-right corner, last so it's on top", () => {
    expect(traySvg(small, 16, { line: "#14b8a6", dot: "#3fb950" })).toBe(
      '<svg viewBox="0 0 16 16"><path stroke="#14b8a6"/>' +
        '<circle cx="12" cy="12" r="4.5" fill="#161618"/><circle cx="12" cy="12" r="3.5" fill="#3fb950"/></svg>',
    );
  });

  test("scales the dot by 4 on the 64 grid", () => {
    expect(traySvg('<svg viewBox="0 0 64 64"></svg>', 64, { line: "#d95926", dot: "#e5484d" })).toBe(
      '<svg viewBox="0 0 64 64"><circle cx="48" cy="48" r="18" fill="#161618"/><circle cx="48" cy="48" r="14" fill="#e5484d"/></svg>',
    );
  });

  test("no dot leaves the shape alone", () => {
    expect(traySvg(small, 16, { line: "#d95926", dot: null })).toBe(small);
  });
});

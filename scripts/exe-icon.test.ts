import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileArgs } from "./build-exe";
import { exeIconIssue, fixExeIcon, iconIssue, type IconResources, parseIco, planIconFix, readIconResources } from "./exe-icon";
import { packIco } from "./make-icons";
import { run, StepFailed } from "./steps";

const ICO = join(import.meta.dirname, "..", "src", "web", "public", "favicon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const frames = SIZES.map((size) => ({ size }));
const fullGroup = (name: string, entryOffset: number, subdir: number) => ({ name, entryOffset, subdir, entries: SIZES.map((size, i) => ({ size, iconId: i + 1 })) });
const widths = { 1: 16, 2: 24, 3: 32, 4: 48, 5: 64, 6: 128, 7: 256 };
// Bun 1.4.3's --windows-icon output, as read from a real prod exe: its own one-entry group, whose icon
// it overwrote with our 16 px frame, ahead of the group it wrote for the .ico.
const bunGroup = { name: "IDI_MYICON", entryOffset: 95911564, subdir: 368, entries: [{ size: 256, iconId: 1 }] };
const BUN_LAYOUT: IconResources = { groups: [bunGroup, fullGroup("#0", 95911572, 392)], iconWidths: widths };

describe("parseIco", () => {
  test("reads back the frame sizes packIco wrote, 256 included", () => {
    const pngs = [{ size: 16, data: Uint8Array.from([1, 2, 3]) }, { size: 256, data: Uint8Array.from([4, 5]) }];
    expect(parseIco(packIco(pngs))).toEqual([{ size: 16 }, { size: 256 }]);
  });

  test("a file that isn't an icon fails", () => {
    expect(() => parseIco(Uint8Array.from([0, 0, 2, 0, 1, 0]))).toThrow("not an .ico");
  });
});

/**
 * A minimal PE32+ by hand: one section at RVA 0x1000 (file 0x200) holding a resource directory with a
 * single RT_ICON, id 1, language 1033, whose data entry points at `dataRva`. At RVA 0x1060 sits a
 * 16 px bitmap header.
 */
function tinyPe(dataRva: number): Uint8Array {
  const b = Buffer.alloc(0x300);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x40, 0x3c);
  b.write("PE\0\0", 0x40, "latin1");
  b.writeUInt16LE(1, 0x46); // one section
  b.writeUInt16LE(0xf0, 0x54); // optional header size
  b.writeUInt16LE(0x20b, 0x58); // PE32+
  b.writeUInt32LE(0x1000, 0x58 + 112 + 2 * 8); // the resource table's RVA
  const section = 0x58 + 0xf0;
  b.write(".rsrc", section, "latin1");
  b.writeUInt32LE(0x100, section + 8);
  b.writeUInt32LE(0x1000, section + 12);
  b.writeUInt32LE(0x100, section + 16);
  b.writeUInt32LE(0x200, section + 20);
  const dir = (at: number, id: number, target: number) => {
    b.writeUInt16LE(1, 0x200 + at + 14);
    b.writeUInt32LE(id, 0x200 + at + 16);
    b.writeUInt32LE(target >>> 0, 0x200 + at + 20);
  };
  dir(0, 3, 0x80000000 | 0x18);
  dir(0x18, 1, 0x80000000 | 0x30);
  dir(0x30, 1033, 0x48);
  b.writeUInt32LE(dataRva, 0x248);
  b.writeUInt32LE(40, 0x24c);
  b.writeUInt32LE(40, 0x260);
  b.writeInt32LE(16, 0x264);
  return b;
}

describe("readIconResources", () => {
  test("reads an icon's real width from its bitmap header", () => {
    expect(readIconResources(tinyPe(0x1060))).toEqual({ groups: [], iconWidths: { 1: 16 } });
  });

  test("resource data outside the resource section fails rather than reading other bytes", () => {
    expect(() => readIconResources(tinyPe(0x5000))).toThrow("resource data at RVA 20480 is outside the resource section");
  });
});

describe("planIconFix and iconIssue", () => {
  test("a first group with every frame at its real size is right", () => {
    const resources = { groups: [fullGroup("#0", 100, 40)], iconWidths: widths };
    expect(planIconFix(resources, frames)).toEqual({ kind: "ok", first: "#0 (7 entries: 16, 24, 32, 48, 64, 128, 256)" });
    expect(iconIssue(resources, frames)).toBeNull();
  });

  test("Bun's layout repoints its group's name entry at the full group's language directory", () => {
    const reason = "the first icon group, IDI_MYICON (1 entry: declares 256, really 16), doesn't match the .ico's 16, 24, 32, 48, 64, 128, 256";
    expect(planIconFix(BUN_LAYOUT, frames)).toEqual({
      kind: "repoint",
      from: "IDI_MYICON (1 entry: declares 256, really 16)",
      to: "#0 (7 entries: 16, 24, 32, 48, 64, 128, 256)",
      offset: 95911564,
      // The subdirectory flag (high bit) with #0's offset, 392: the value the probe wrote.
      value: 0x80000188,
      reason,
    });
    expect(iconIssue(BUN_LAYOUT, frames)).toBe(reason);
  });

  test("a scaled-up 16 px frame with no good group to point at can't be fixed", () => {
    const reason = "the first icon group, IDI_MYICON (1 entry: declares 256, really 16), doesn't match the .ico's 16, 24, 32, 48, 64, 128, 256, and no other group does";
    const resources = { groups: [bunGroup], iconWidths: widths };
    expect(planIconFix(resources, frames)).toEqual({ kind: "unfixable", reason });
    expect(iconIssue(resources, frames)).toBe(reason);
  });

  test("a group missing a frame doesn't match", () => {
    const short = { ...fullGroup("#0", 100, 40), entries: fullGroup("#0", 100, 40).entries.slice(0, 6) };
    expect(iconIssue({ groups: [short], iconWidths: widths }, frames)).toBe(
      "the first icon group, #0 (6 entries: 16, 24, 32, 48, 64, 128), doesn't match the .ico's 16, 24, 32, 48, 64, 128, 256, and no other group does",
    );
  });

  test("an entry whose icon is missing says which id", () => {
    const noThree: Record<number, number> = { ...widths };
    delete noThree[3];
    expect(iconIssue({ groups: [fullGroup("#0", 100, 40)], iconWidths: noThree }, frames)).toBe(
      "the first icon group, #0 (7 entries: 16, 24, declares 32, no icon 3, 48, 64, 128, 256), doesn't match the .ico's 16, 24, 32, 48, 64, 128, 256, and no other group does",
    );
  });

  test("an exe with no icon group can't be fixed", () => {
    expect(planIconFix({ groups: [], iconWidths: {} }, frames)).toEqual({ kind: "unfixable", reason: "the exe has no icon group" });
  });
});

describe("fixExeIcon", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-exe-icon-test-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  test("a missing exe fails naming its path", async () => {
    const exe = join(dir, "missing.exe");
    const fix = fixExeIcon(exe, ICO);
    await expect(fix).rejects.toBeInstanceOf(StepFailed);
    await expect(fix).rejects.toThrow(exe);
  });

  test.skipIf(process.platform !== "win32")(
    "a compiled exe's first icon group ends up with every frame of the .ico, and the exe still runs",
    async () => {
      const entry = join(dir, "entry.ts");
      writeFileSync(entry, 'console.log("exe-icon test ran");\n');
      const exe = join(dir, "icon-test.exe");
      run([process.execPath, ...compileArgs({ entry, outfile: exe, description: "Grindlog icon test", icon: ICO, version: "0.0.1" })]);

      expect(await fixExeIcon(exe, ICO)).toMatch(/^(first group .* → repointed to |already right: )/);

      expect(await exeIconIssue(exe, ICO)).toBeNull();
      expect(readIconResources(readFileSync(exe)).groups[0]?.entries.map((e) => e.size)).toEqual(parseIco(readFileSync(ICO)).map((f) => f.size));
      expect(run([exe]).trim()).toBe("exe-icon test ran");
      expect(await fixExeIcon(exe, ICO)).toMatch(/^already right: first group /);
    },
    60_000,
  );
});

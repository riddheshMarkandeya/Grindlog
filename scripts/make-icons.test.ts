import { describe, expect, test } from "vitest";
import { packIco } from "./make-icons";

const png = (size: number, bytes: number[]) => ({ size, data: Uint8Array.from(bytes) });

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

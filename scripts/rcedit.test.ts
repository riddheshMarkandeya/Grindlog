import { describe, expect, test } from "vitest";
import { rceditArgs, sha256Matches } from "./rcedit";

describe("sha256Matches", () => {
  // SHA-256 of "abc", from FIPS 180-2's worked example.
  const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  test("accepts bytes whose hash is the pinned one, in either case", () => {
    expect(sha256Matches(new TextEncoder().encode("abc"), ABC)).toBe(true);
    expect(sha256Matches(new TextEncoder().encode("abc"), ABC.toUpperCase())).toBe(true);
  });

  test("rejects any other bytes", () => {
    expect(sha256Matches(new TextEncoder().encode("abd"), ABC)).toBe(false);
  });
});

describe("rceditArgs", () => {
  test("sets one version string on the exe in place", () => {
    expect(rceditArgs(String.raw`C:\r\grindlog.exe`, { InternalName: "grindlog" })).toEqual([String.raw`C:\r\grindlog.exe`, "--set-version-string", "InternalName", "grindlog"]);
  });
});

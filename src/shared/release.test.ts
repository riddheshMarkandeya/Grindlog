import { describe, expect, test } from "vitest";
import { compareNumeric, installerName, isNewer, parseReleaseVersion, parseTrustedComment, releasePage, RELEASES_LATEST_PAGE, trustedComment } from "./release";

describe("parseReleaseVersion", () => {
  test("a plain release is its own numeric version and not a prerelease", () => {
    expect(parseReleaseVersion("0.1.0")).toEqual({ full: "0.1.0", numeric: "0.1.0", prerelease: false });
  });

  test("a suffixed release keeps the suffix in full and drops it from numeric", () => {
    expect(parseReleaseVersion("1.12.3-rc.2")).toEqual({ full: "1.12.3-rc.2", numeric: "1.12.3", prerelease: true });
  });

  test.each(["", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-", "1.2.3 ", "1.2.3-rc 1", "01.2.3"])("rejects %j", (s) => {
    expect(() => parseReleaseVersion(s)).toThrow(/version/);
  });
});

describe("installerName", () => {
  test("names the asset with the full version", () => {
    expect(installerName("0.2.0-rc.1")).toBe("Grindlog-Setup-0.2.0-rc.1.exe");
  });
});

describe("trustedComment", () => {
  test("states the version and the file it signs", () => {
    expect(trustedComment("0.2.0")).toBe("version=0.2.0 file=Grindlog-Setup-0.2.0.exe");
  });
});

describe("isNewer", () => {
  test("compares numeric parts only, so an rc is no newer than its final", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "0.2.0-rc.1")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("compareNumeric", () => {
  test.each([
    ["0.1.0", "0.1.0", 0],
    ["0.1.0", "0.1.1", -1],
    ["0.2.0", "0.1.9", 1],
    ["0.10.0", "0.9.0", 1],
    ["1.0.0", "0.99.99", 1],
    ["2.0.0", "10.0.0", -1],
  ])("%s vs %s is %i", (a, b, want) => {
    expect(compareNumeric(a, b)).toBe(want);
  });
});

describe("parseTrustedComment", () => {
  test("reads the version and file the release build signs", () => {
    expect(parseTrustedComment(trustedComment("0.2.0"))).toEqual({ version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe" });
  });

  test("accepts minisign's tab-separated hashed suffix", () => {
    expect(parseTrustedComment("version=0.2.0 file=Grindlog-Setup-0.2.0.exe	hashed")).toEqual({ version: "0.2.0", file: "Grindlog-Setup-0.2.0.exe" });
  });

  test.each([
    "",
    "timestamp:1700000000	file:Grindlog-Setup-0.2.0.exe	hashed",
    "version=0.2.0",
    "version=0.2.0 file=Grindlog-Setup-0.2.0.exe extra",
    "version=0.2.0 file=Grindlog-Setup-0.2.0.exe	other",
    "version=0.2.0 file=Grindlog-Setup-0.2.0.exe	hashed	hashed",
    " version=0.2.0 file=Grindlog-Setup-0.2.0.exe",
    "version=0.2.0  file=Grindlog-Setup-0.2.0.exe",
  ])("rejects %j", (line) => {
    expect(parseTrustedComment(line)).toBeNull();
  });
});

describe("releasePage", () => {
  test("is the repo's tag page for the version", () => {
    expect(releasePage("0.2.0")).toBe("https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.2.0");
  });
});

describe("RELEASES_LATEST_PAGE", () => {
  test("is the repo's latest-release page", () => {
    expect(RELEASES_LATEST_PAGE).toBe("https://github.com/riddheshMarkandeya/Grindlog/releases/latest");
  });
});

import { describe, expect, test } from "vitest";
import { installerName, parseReleaseVersion, trustedComment } from "./release";

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

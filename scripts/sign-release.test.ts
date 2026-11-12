import { describe, expect, test } from "vitest";
import { draftIssue, trustedCommentLine, versionFromTag } from "./sign-release";

describe("versionFromTag", () => {
  test("a v-prefixed release version", () => {
    expect(versionFromTag("v0.2.0-rc.1")).toEqual({ full: "0.2.0-rc.1", numeric: "0.2.0", prerelease: true });
  });

  test.each(["0.2.0", "v0.2", "", "vv0.2.0"])("rejects %j", (tag) => {
    expect(() => versionFromTag(tag)).toThrow(/tag/);
  });
});

describe("draftIssue", () => {
  const name = "Grindlog-Setup-0.2.0.exe";

  test("none for a draft holding the installer", () => {
    expect(draftIssue({ isDraft: true, assets: [{ name }] }, name)).toBeNull();
  });

  test("a published release is never re-signed", () => {
    expect(draftIssue({ isDraft: false, assets: [{ name }] }, name)).toMatch(/published/);
  });

  test("a draft without the installer", () => {
    expect(draftIssue({ isDraft: true, assets: [{ name: "Grindlog-Setup-0.1.0.exe" }] }, name)).toMatch(name);
  });
});

describe("trustedCommentLine", () => {
  test("the trusted comment, with whatever minisign appended", () => {
    const sig = "untrusted comment: signature from minisign secret key\nRUQ...\ntrusted comment: version=0.2.0 file=Grindlog-Setup-0.2.0.exe\thashed\nabc==\n";
    expect(trustedCommentLine(sig)).toBe("version=0.2.0 file=Grindlog-Setup-0.2.0.exe\thashed");
  });

  test("null when there is none", () => {
    expect(trustedCommentLine("untrusted comment: x\nRUQ...\n")).toBeNull();
  });
});

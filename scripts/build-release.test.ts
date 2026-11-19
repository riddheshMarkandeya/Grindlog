import { describe, expect, test } from "vitest";
import { identity } from "../src/server/paths";
import { findIscc, isccArgs, readUpdateKey, taskTemplate } from "./build-release";
import { StepFailed } from "./steps";

describe("findIscc", () => {
  const env = { "ProgramFiles(x86)": String.raw`C:\PF86`, ProgramFiles: String.raw`C:\PF`, LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local` };
  const only = (path: string) => (p: string) => p === path;

  test("the ISCC override wins when it exists", () => {
    expect(findIscc({ ...env, ISCC: String.raw`D:\inno\ISCC.exe` }, () => true)).toBe(String.raw`D:\inno\ISCC.exe`);
  });

  test("CI's machine-wide install under Program Files (x86)", () => {
    expect(findIscc(env, only(String.raw`C:\PF86\Inno Setup 6\ISCC.exe`))).toBe(String.raw`C:\PF86\Inno Setup 6\ISCC.exe`);
  });

  test("a per-user install under LOCALAPPDATA Programs", () => {
    expect(findIscc(env, only(String.raw`C:\Users\me\AppData\Local\Programs\Inno Setup 6\ISCC.exe`))).toBe(String.raw`C:\Users\me\AppData\Local\Programs\Inno Setup 6\ISCC.exe`);
  });

  test("null when none exists or the override is missing", () => {
    expect(findIscc(env, () => false)).toBeNull();
    expect(findIscc({ ISCC: String.raw`D:\nope.exe` }, () => false)).toBeNull();
  });
});

describe("taskTemplate", () => {
  const xml = taskTemplate();

  test("has no XML declaration, so Inno can write it as UTF-8 without one", () => {
    expect(xml.startsWith("<Task ")).toBe(true);
    expect(xml).not.toContain("<?xml");
  });

  test("leaves tokens where the installer fills in the user, the exe and its folder", () => {
    expect(xml).toContain("<UserId>@@USER@@</UserId>");
    expect(xml).toContain("<Command>@@EXE@@</Command>");
    expect(xml).toContain("<WorkingDirectory>@@WORKDIR@@</WorkingDirectory>");
    expect(xml).toContain("<Arguments>--supervisor</Arguments>");
  });
});

describe("isccArgs", () => {
  const args = isccArgs({ version: { full: "0.2.0-rc.1", numeric: "0.2.0", prerelease: true }, sourceDir: String.raw`C:\r\release\app`, outDir: String.raw`C:\r\release`, iss: String.raw`C:\r\installer\grindlog.iss`, id: identity("prod") });

  test("defines the versions, the staged files' folder, the prod identity with the shortcut's stem and its app ID, and the copyright", () => {
    expect(args).toEqual([
      "/Qp",
      "/DAppVersion=0.2.0-rc.1",
      "/DAppNumericVersion=0.2.0",
      String.raw`/DSourceDir=C:\r\release\app`,
      "/DExeName=grindlog.exe",
      "/DTrayExeName=grindlog-tray.exe",
      "/DDataDirName=Grindlog",
      "/DTaskName=Grindlog",
      "/DShortcutName=Grindlog",
      "/DAppUserModelID=Grindlog.Grindlog",
      "/DAppCopyright=Copyright (c) 2026 Riddhesh Markandeya",
      String.raw`/OC:\r\release`,
      String.raw`C:\r\installer\grindlog.iss`,
    ]);
  });
});

describe("readUpdateKey", () => {
  const PUB = "untrusted comment: minisign public key 5CD2F0718BEE8E7\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n";

  test("is the key line of the minisign.pub it reads", () => {
    expect(readUpdateKey("minisign.pub", () => PUB)).toBe("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3");
  });

  test("a missing file fails the build, saying how to make the key", () => {
    const missing = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(() => readUpdateKey("minisign.pub", missing)).toThrow(StepFailed);
    expect(() => readUpdateKey("minisign.pub", missing)).toThrow(/minisign -G/);
  });

  test("a file that isn't a minisign public key fails the build", () => {
    expect(() => readUpdateKey("minisign.pub", () => "untrusted comment: x\nnot-a-key\n")).toThrow(/not a minisign public key/);
  });
});

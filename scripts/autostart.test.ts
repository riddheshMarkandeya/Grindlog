import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { iconIssue, removeShortcuts, shortcutFile, taskXml, writeShortcut } from "./autostart";

describe("taskXml", () => {
  const xml = taskXml({ userId: String.raw`PC\me`, exe: String.raw`C:\Users\A&B\bin\rltracker-supervisor.exe`, workDir: String.raw`C:\Users\A&B\bin` });

  test("declares UTF-16, which is how the file is written", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });

  test("starts the supervisor at the user's logon, unelevated, with paths XML-escaped", () => {
    expect(xml).toContain(String.raw`<LogonTrigger><Enabled>true</Enabled><UserId>PC\me</UserId></LogonTrigger>`);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain(String.raw`<Command>C:\Users\A&amp;B\bin\rltracker-supervisor.exe</Command>`);
    expect(xml).toContain(String.raw`<WorkingDirectory>C:\Users\A&amp;B\bin</WorkingDirectory>`);
  });

  test("runs one instance with no time limit, on battery too, and retries a failed start", () => {
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>");
  });
});

describe("shortcutFile", () => {
  test("an Internet Shortcut to the URL with its icon, with CRLF line ends", () => {
    const icon = String.raw`C:\bin\web\favicon.ico`;
    expect(shortcutFile("http://127.0.0.1:49100/", icon)).toBe(`[InternetShortcut]\r\nURL=http://127.0.0.1:49100/\r\nIconFile=${icon}\r\nIconIndex=0\r\n`);
  });
});

describe("iconIssue", () => {
  test("none for an ASCII path that exists", () => {
    expect(iconIssue(String.raw`C:\Users\me\favicon.ico`, true)).toBeNull();
  });

  test("a missing icon means a generic one until the next install", () => {
    expect(iconIssue(String.raw`C:\Users\me\favicon.ico`, false)).toContain("missing");
  });

  test("a non-ASCII path is flagged, since it may not survive the file's encoding", () => {
    expect(iconIssue(String.raw`C:\Users\José\favicon.ico`, true)).toContain("non-ASCII");
  });
});

describe("Start menu shortcuts", () => {
  let appData: string;
  let programs: string;

  beforeEach(() => {
    appData = mkdtempSync(join(tmpdir(), "rlt-shortcut-"));
    programs = join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
    vi.stubEnv("APPDATA", appData);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(appData, { recursive: true, force: true });
  });

  test("writing the shortcut replaces the one from before the rename and leaves others alone", () => {
    mkdirSync(programs, { recursive: true });
    writeFileSync(join(programs, "RL Tracker.url"), "old");
    writeFileSync(join(programs, "Other.url"), "other");
    writeShortcut(String.raw`C:\bin\web\favicon.ico`);
    expect(readdirSync(programs).sort()).toEqual(["Grindlog.url", "Other.url"]);
    expect(readFileSync(join(programs, "Grindlog.url"), "utf8")).toContain(String.raw`IconFile=C:\bin\web\favicon.ico`);
  });

  test("removing takes both names and leaves others alone", () => {
    mkdirSync(programs, { recursive: true });
    for (const name of ["Grindlog.url", "RL Tracker.url", "Other.url"]) writeFileSync(join(programs, name), "x");
    removeShortcuts();
    expect(readdirSync(programs)).toEqual(["Other.url"]);
  });

  test("removing is fine with nothing there", () => {
    removeShortcuts();
    expect(existsSync(programs)).toBe(false);
  });
});

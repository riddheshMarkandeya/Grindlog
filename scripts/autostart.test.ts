import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { compileArgs, iconIssue, removeShortcuts, shortcutFile, swapExe, taskXml, writeShortcut } from "./autostart";

describe("taskXml", () => {
  const xml = taskXml({ userId: String.raw`PC\me`, exe: String.raw`C:\Users\A&B\bin\grindlog-dev.exe`, args: "--supervisor", workDir: String.raw`C:\Users\A&B\bin` });

  test("declares UTF-16, which is how the file is written", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });

  test("starts the supervisor at the user's logon, unelevated, with paths XML-escaped", () => {
    expect(xml).toContain(String.raw`<LogonTrigger><Enabled>true</Enabled><UserId>PC\me</UserId></LogonTrigger>`);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain(String.raw`<Command>C:\Users\A&amp;B\bin\grindlog-dev.exe</Command>`);
    expect(xml).toContain(String.raw`<WorkingDirectory>C:\Users\A&amp;B\bin</WorkingDirectory>`);
  });

  test("passes the arguments that make the exe run as the supervisor, XML-escaped", () => {
    expect(xml).toContain("<Arguments>--supervisor</Arguments>");
    expect(taskXml({ userId: "u", exe: "e", args: "<&>", workDir: "w" })).toContain("<Arguments>&lt;&amp;&gt;</Arguments>");
  });

  test("runs one instance with no time limit, on battery too, and retries a failed start", () => {
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>");
  });
});

describe("compileArgs", () => {
  const args = compileArgs({ entry: String.raw`C:\repo\main.ts`, outfile: String.raw`C:\bin\grindlog.new.exe`, description: "Grindlog Dev", icon: String.raw`C:\repo\favicon.ico`, version: "1.2.3" });
  const flag = (name: string) => args[args.indexOf(name) + 1];

  test("a hidden-console compile of the entry to the outfile", () => {
    expect(args.slice(0, 2)).toEqual(["build", "--compile"]);
    expect(args).toContain("--windows-hide-console");
    expect(args).toContain(String.raw`C:\repo\main.ts`);
    expect(flag("--outfile")).toBe(String.raw`C:\bin\grindlog.new.exe`);
  });

  test("sets what Task Manager and the file's properties show", () => {
    expect(flag("--windows-description")).toBe("Grindlog Dev");
    // Task Manager can show either; a dev build must say so in both.
    expect(flag("--windows-title")).toBe("Grindlog Dev");
    expect(flag("--windows-publisher")).toBe("Grindlog");
    expect(flag("--windows-icon")).toBe(String.raw`C:\repo\favicon.ico`);
  });

  test("the version gets the four parts the flag takes", () => {
    expect(flag("--windows-version")).toBe("1.2.3.0");
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
    appData = mkdtempSync(join(tmpdir(), "grindlog-shortcut-"));
    programs = join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
    vi.stubEnv("APPDATA", appData);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(appData, { recursive: true, force: true });
  });

  test("writing the shortcut adds this channel's and leaves others alone, a friend's install's included", () => {
    mkdirSync(programs, { recursive: true });
    writeFileSync(join(programs, "Grindlog.url"), "prod");
    writeShortcut(String.raw`C:\bin\web\favicon.ico`);
    expect(readdirSync(programs).sort()).toEqual(["Grindlog Dev.url", "Grindlog.url"]);
    const dev = readFileSync(join(programs, "Grindlog Dev.url"), "utf8");
    expect(dev).toContain("URL=http://127.0.0.1:49102/");
    expect(dev).toContain(String.raw`IconFile=C:\bin\web\favicon.ico`);
  });

  test("removing takes only this channel's shortcut", () => {
    mkdirSync(programs, { recursive: true });
    for (const name of ["Grindlog Dev.url", "Grindlog.url", "Other.url"]) writeFileSync(join(programs, name), "x");
    removeShortcuts();
    expect(readdirSync(programs).sort()).toEqual(["Grindlog.url", "Other.url"]);
  });

  test("removing is fine with nothing there", () => {
    removeShortcuts();
    expect(existsSync(programs)).toBe(false);
  });
});

describe("swapExe", () => {
  const reason = String.raw`Could not replace C:\bin\grindlog-dev.exe: EBUSY`;
  const failing = () => Promise.reject(new Error(reason));

  test("a replaced exe is updated", async () => {
    const replace = vi.fn(() => Promise.resolve());
    expect(await swapExe("fresh", "exe", { replace, exists: () => true })).toEqual({ kind: "updated" });
    expect(replace).toHaveBeenCalledWith("fresh", "exe");
  });

  test("a failed replace over an old exe keeps it, so the install can start it again", async () => {
    expect(await swapExe("fresh", "exe", { replace: failing, exists: () => true })).toEqual({ kind: "kept_old", reason });
  });

  test("a failed replace on a first install leaves nothing to start", async () => {
    const exists = vi.fn(() => false);
    expect(await swapExe("fresh", "exe", { replace: failing, exists })).toEqual({ kind: "not_installed", reason });
    expect(exists).toHaveBeenCalledWith("exe");
  });
});

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CommandResult } from "../src/server/powershell";
import { removeShortcuts, SHORTCUT_SCRIPT, swapExe, taskXml, writeShortcut, type ShortcutRunner } from "./autostart";

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

  // A curly apostrophe: PowerShell reads it as a quote, so a path quoted into the script would break.
  const exe = String.raw`C:\Users\O’Brien\bin\grindlog-dev.exe`;
  const result = (code: number | null, stderr = "", timedOut = false): CommandResult => ({ code, stdout: "", stderr, timedOut });
  const logged = (run: ShortcutRunner) => async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await writeShortcut(exe, run);
    const text = log.mock.calls.flat().join("\n");
    log.mockRestore();
    return text;
  };

  test("writes this channel's .lnk through a constant script, the paths in env, never in the script", async () => {
    const run = vi.fn<ShortcutRunner>(() => Promise.resolve(result(0)));
    await writeShortcut(exe, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(SHORTCUT_SCRIPT, { GRINDLOG_LNK: join(programs, "Grindlog Dev.lnk"), GRINDLOG_EXE: exe, GRINDLOG_BIN: String.raw`C:\Users\O’Brien\bin` });
    expect(SHORTCUT_SCRIPT).not.toContain("O’Brien");
  });

  test("the old Internet Shortcut goes once the .lnk is written, and stays if it isn't; a friend's install's is left", async () => {
    for (const [r, left] of [[result(0), ["Grindlog.lnk"]], [result(1, "COM failed"), ["Grindlog Dev.url", "Grindlog.lnk"]]] as const) {
      mkdirSync(programs, { recursive: true });
      for (const name of ["Grindlog Dev.url", "Grindlog.lnk"]) writeFileSync(join(programs, name), "x");
      await logged(() => Promise.resolve(r))();
      expect(readdirSync(programs).sort()).toEqual(left);
    }
  });

  test("a failed write, a timeout or a PowerShell that won't start is logged with the dashboard's address and doesn't throw", async () => {
    const tail = "; the dashboard is at http://127.0.0.1:49102/";
    expect(await logged(() => Promise.resolve(result(1, "COM failed\r\n")))()).toContain(`Could not create the Start menu shortcut (exit 1: COM failed)${tail}`);
    expect(await logged(() => Promise.resolve(result(null, "", true)))()).toContain(`Could not create the Start menu shortcut (PowerShell timed out)${tail}`);
    expect(await logged(() => Promise.reject(new Error("ENOENT powershell")))()).toContain(`Could not create the Start menu shortcut (ENOENT powershell)${tail}`);
  });

  test("removing takes only this channel's shortcuts, the old Internet Shortcut included", () => {
    mkdirSync(programs, { recursive: true });
    for (const name of ["Grindlog Dev.lnk", "Grindlog Dev.url", "Grindlog.lnk", "Other.url"]) writeFileSync(join(programs, name), "x");
    removeShortcuts();
    expect(readdirSync(programs).sort()).toEqual(["Grindlog.lnk", "Other.url"]);
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

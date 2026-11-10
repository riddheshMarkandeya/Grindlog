import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CommandResult } from "./powershell";
import { createLogonTask, LogonTaskError, parseTaskState } from "./logon-task";
import { memoryLogger } from "./testing";

// Captured from `schtasks /Query /XML` through runCommand's pipe.
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../../test/fixtures", name), "utf8");

describe("parseTaskState", () => {
  test("a freshly created task has no Enabled in Settings: on", () => {
    expect(parseTaskState(fixture("logon-task-enabled.xml"))).toBe("on");
  });

  test("after /Change /DISABLE, Settings holds Enabled false: off", () => {
    expect(parseTaskState(fixture("logon-task-disabled.xml"))).toBe("off");
  });

  test("Enabled true in Settings: on", () => {
    expect(parseTaskState("<Task><Settings><Enabled>true</Enabled></Settings></Task>")).toBe("on");
  });

  test("a disabled trigger doesn't disable the task", () => {
    const xml = "<Task><Settings><Hidden>true</Hidden></Settings><Triggers><LogonTrigger><Enabled>false</Enabled></LogonTrigger></Triggers></Task>";
    expect(parseTaskState(xml)).toBe("on");
  });

  test("Enabled after a nested IdleSettings block still counts", () => {
    const xml = "<Task><Settings><IdleSettings><StopOnIdleEnd>true</StopOnIdleEnd></IdleSettings><Enabled>false</Enabled></Settings></Task>";
    expect(parseTaskState(xml)).toBe("off");
  });

  test("no Settings block: unknown", () => {
    expect(parseTaskState("<Task><Triggers/></Task>")).toBe("unknown");
    expect(parseTaskState("")).toBe("unknown");
  });
});

const done = (stdout: string, code = 0, stderr = ""): CommandResult => ({ code, stdout, stderr, timedOut: false });
const hung: CommandResult = { code: null, stdout: "", stderr: "", timedOut: true };

/** A logon task over scripted schtasks answers, keeping each argv it ran. */
function setup(...answers: (CommandResult | Error)[]) {
  const calls: string[][] = [];
  const logger = memoryLogger();
  const run = (argv: string[]) => {
    calls.push(argv);
    const next = answers.shift();
    if (next === undefined) throw new Error("no scripted answer");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { calls, logger, task: createLogonTask({ task: "GrindlogTest", logger, run }) };
}

describe("logon task get", () => {
  test("queries the named task's XML and reads its state", async () => {
    const { calls, logger, task } = setup(done(fixture("logon-task-disabled.xml")));
    expect(await task.get()).toBe("off");
    expect(calls).toEqual([["schtasks", "/Query", "/TN", "GrindlogTest", "/XML"]]);
    expect(logger.lines.find((l) => l.event === "queried")?.fields).toMatchObject({ state: "off" });
  });

  test("a missing task (or any failed query) is unavailable, with what schtasks said", async () => {
    const { logger, task } = setup(done("", 1, "ERROR: The system cannot find the file specified.\r\n"));
    expect(await task.get()).toBe("unavailable");
    expect(logger.lines.find((l) => l.event === "query_failed")?.fields).toMatchObject({ code: 1, timedOut: false, stderr: "ERROR: The system cannot find the file specified." });
  });

  test("a hung query is unavailable", async () => {
    const { logger, task } = setup(hung);
    expect(await task.get()).toBe("unavailable");
    expect(logger.events()).toContain("logon_task/query_failed");
  });

  test("schtasks that can't start is unavailable", async () => {
    const { logger, task } = setup(new Error("spawn failed"));
    expect(await task.get()).toBe("unavailable");
    expect(logger.events()).toContain("logon_task/query_failed");
  });

  test("XML without a Settings block is unavailable and flagged", async () => {
    const { logger, task } = setup(done("<Task></Task>"));
    expect(await task.get()).toBe("unavailable");
    expect(logger.events()).toContain("logon_task/unexpected_xml");
  });
});

describe("logon task set", () => {
  test("switching off disables the task, then answers what Windows now holds", async () => {
    const { calls, logger, task } = setup(done("SUCCESS"), done(fixture("logon-task-disabled.xml")));
    expect(await task.set(false)).toBe("off");
    expect(calls).toEqual([
      ["schtasks", "/Change", "/TN", "GrindlogTest", "/DISABLE"],
      ["schtasks", "/Query", "/TN", "GrindlogTest", "/XML"],
    ]);
    expect(logger.lines.find((l) => l.event === "changed")?.fields).toMatchObject({ on: false, state: "off" });
  });

  test("switching on enables it", async () => {
    const { calls, task } = setup(done("SUCCESS"), done(fixture("logon-task-enabled.xml")));
    expect(await task.set(true)).toBe("on");
    expect(calls[0]).toEqual(["schtasks", "/Change", "/TN", "GrindlogTest", "/ENABLE"]);
  });

  test("a failed change throws LogonTaskError and logs it", async () => {
    const { calls, logger, task } = setup(done("", 1, "ERROR: The specified task name does not exist."));
    await expect(task.set(true)).rejects.toBeInstanceOf(LogonTaskError);
    expect(calls).toHaveLength(1);
    expect(logger.lines.find((l) => l.event === "change_failed")?.fields).toMatchObject({ on: true, code: 1, stderr: "ERROR: The specified task name does not exist." });
  });

  test("a hung or unstartable change throws LogonTaskError", async () => {
    await expect(setup(hung).task.set(false)).rejects.toBeInstanceOf(LogonTaskError);
    await expect(setup(new Error("spawn failed")).task.set(false)).rejects.toBeInstanceOf(LogonTaskError);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ExeProcess, Probe, StopOutcome } from "./control";
import { EXIT_CONFIG_INVALID } from "./exit-codes";
import { openDashboard, quitApp, runLauncher } from "./launcher";
import { logsDir } from "./paths";
import { memoryLogger } from "./testing";

const EXE = String.raw`C:\Users\f\AppData\Local\Grindlog\bin\grindlog.exe`;
const URL = "http://127.0.0.1:49100/";

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

/** Answers probes from a script; the last answer repeats. */
function scripted(answers: [Probe, ...Probe[]]) {
  let i = 0;
  return () => Promise.resolve(answers[Math.min(i++, answers.length - 1)] ?? answers[0]);
}

describe("openDashboard", () => {
  const setup = (probes: [Probe, ...Probe[]], over: { spawn?: () => number; pidAlive?: (pid: number) => boolean } = {}) => {
    const logger = memoryLogger();
    const spawns: { cmd: string[]; cwd: string }[] = [];
    const opened: string[] = [];
    const clock = fakeClock();
    const run = () =>
      openDashboard({
        port: 49100,
        execPath: EXE,
        env: { GRINDLOG_PORT: "49100" },
        probe: scripted(probes),
        spawnDetached: (cmd, cwd) => {
          spawns.push({ cmd, cwd });
          return over.spawn ? over.spawn() : 777;
        },
        pidAlive: over.pidAlive ?? (() => true),
        openBrowser: (url) => {
          opened.push(url);
          return Promise.resolve();
        },
        ...clock,
        logger,
      });
    return { run, logger, spawns, opened, clock };
  };

  test("an app that's already running only gets the browser opened", async () => {
    const s = setup([{ pid: 42 }]);
    expect(await s.run()).toBe(0);
    expect(s.spawns).toEqual([]);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/already_running"]);
  });

  test("a tracker that's still starting isn't started again; the browser opens once it's ready", async () => {
    const s = setup(["starting", "starting", { pid: 42 }]);
    expect(await s.run()).toBe(0);
    expect(s.spawns).toEqual([]);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/waiting_for_startup", "launcher/ready"]);
  });

  test("a cold start runs the exe's supervisor from its own folder, then opens the browser once ready", async () => {
    const s = setup(["refused", "refused", "starting", { pid: 42 }]);
    expect(await s.run()).toBe(0);
    expect(s.spawns).toEqual([{ cmd: [EXE, "--supervisor"], cwd: String.raw`C:\Users\f\AppData\Local\Grindlog\bin` }]);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/starting_supervisor", "launcher/ready"]);
    expect(s.logger.lines[0]?.fields).toMatchObject({ pid: 777 });
    expect(s.logger.lines[1]?.fields).toMatchObject({ pid: 42, waitedMs: 750 });
  });

  test("a spawn that throws is logged and exits 1 without opening a browser to nothing", async () => {
    const s = setup(["refused"], {
      spawn: () => {
        throw new Error("ENOENT");
      },
    });
    expect(await s.run()).toBe(1);
    expect(s.opened).toEqual([]);
    expect(s.logger.events()).toEqual(["launcher/spawn_failed"]);
  });

  test("a tracker seen stopping (starting) that then frees the port gets a supervisor started after all", async () => {
    const s = setup(["starting", "refused", "refused", { pid: 42 }]);
    expect(await s.run()).toBe(0);
    expect(s.spawns).toHaveLength(1);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/waiting_for_startup", "launcher/starting_supervisor", "launcher/ready"]);
  });

  test("a supervisor that exits (port taken, bad config) ends the wait early; the browser still opens, exit 1", async () => {
    const s = setup(["refused"], { pidAlive: () => false });
    expect(await s.run()).toBe(1);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/starting_supervisor", "launcher/supervisor_exited"]);
    expect(s.clock.now()).toBeLessThan(1000);
  });

  test("no answer within 60 s opens the browser anyway, so the friend sees an error page, and exits 1", async () => {
    const s = setup(["refused"]);
    expect(await s.run()).toBe(1);
    expect(s.opened).toEqual([URL]);
    expect(s.logger.events()).toEqual(["launcher/starting_supervisor", "launcher/ready_timeout"]);
    expect(s.clock.now()).toBeGreaterThanOrEqual(60_000);
    expect(s.clock.now()).toBeLessThan(61_000);
  });
});

describe("quitApp", () => {
  const SELF = 1;
  const setup = (opts: { procs: ExeProcess[][]; probes: [Probe, ...Probe[]]; killFails?: number; stop?: StopOutcome[] }) => {
    const logger = memoryLogger();
    const stops: number[] = [];
    const kills: number[] = [];
    const clock = fakeClock();
    let tick = 0;
    let k = 0;
    let st = 0;
    const run = () =>
      quitApp({
        port: 49100,
        execPath: EXE,
        selfPid: SELF,
        exeProcesses: (exe) => {
          expect(exe).toBe(EXE);
          return opts.procs[Math.min(tick++, opts.procs.length - 1)] ?? [];
        },
        probe: scripted(opts.probes),
        requestStop: (port) => {
          stops.push(port);
          return Promise.resolve(opts.stop?.[Math.min(st++, opts.stop.length - 1)] ?? ({ kind: "status", status: 202 } satisfies StopOutcome));
        },
        killPid: (pid) => {
          kills.push(pid);
          if (k++ < (opts.killFails ?? 0)) throw new Error("EPERM");
        },
        ...clock,
        logger,
      });
    return { run, logger, stops, kills, clock };
  };
  const self: ExeProcess = { pid: SELF, commandLine: `"${EXE}" --quit` };
  const tracker: ExeProcess = { pid: 42, commandLine: `"${EXE}"` };
  const supervisor: ExeProcess = { pid: 41, commandLine: `"${EXE}" --supervisor` };

  test("nothing running exits 0 at once", async () => {
    const s = setup({ procs: [[self]], probes: ["refused"] });
    expect(await s.run()).toBe(0);
    expect(s.stops).toEqual([]);
    expect(s.kills).toEqual([]);
    expect(s.logger.events()).toEqual(["launcher/done"]);
  });

  test("a running tracker is asked to stop once, however many ticks it takes to exit", async () => {
    const s = setup({
      procs: [[self, supervisor, tracker], [self, supervisor, tracker], [self, supervisor, tracker], [self]],
      probes: [{ pid: 42 }],
    });
    expect(await s.run()).toBe(0);
    expect(s.stops).toEqual([49100]);
    expect(s.kills).toEqual([]);
  });

  test("a new tracker (another pid) is asked again", async () => {
    const s = setup({ procs: [[tracker], [tracker], [{ ...tracker, pid: 43 }], []], probes: [{ pid: 42 }, { pid: 42 }, { pid: 43 }] });
    expect(await s.run()).toBe(0);
    expect(s.stops).toEqual([49100, 49100]);
  });

  test("a starting tracker (no pid yet) is asked once per change into starting", async () => {
    const s = setup({
      procs: [[tracker], [tracker], [tracker], [tracker], []],
      probes: ["starting", "starting", { pid: 42 }, "starting"],
    });
    expect(await s.run()).toBe(0);
    // starting (ask), starting (no), ready 42 (ask), starting (ask: a change)
    expect(s.stops).toEqual([49100, 49100, 49100]);
  });

  test("a stop request that fails is sent again on the next tick", async () => {
    const s = setup({
      procs: [[tracker], [tracker], [tracker], []],
      probes: [{ pid: 42 }],
      stop: [{ kind: "error", message: "timeout" }, { kind: "status", status: 202 }],
    });
    expect(await s.run()).toBe(0);
    expect(s.stops).toEqual([49100, 49100]);
  });

  test("a refused port with no supervisor in the list starts no kill", async () => {
    const s = setup({ procs: [[tracker], []], probes: ["refused"] });
    expect(await s.run()).toBe(0);
    expect(s.kills).toEqual([]);
  });

  test("a refused port with a supervisor left (sleeping before a restart) ends the supervisor", async () => {
    const s = setup({ procs: [[self, supervisor], []], probes: ["refused"] });
    expect(await s.run()).toBe(0);
    expect(s.kills).toEqual([41]);
    expect(s.stops).toEqual([]);
  });

  test("a second --quit is not waited for", async () => {
    const s = setup({ procs: [[self, { pid: 8, commandLine: `"${EXE}" --quit` }]], probes: ["refused"] });
    expect(await s.run()).toBe(0);
    expect(s.kills).toEqual([]);
  });

  test("a concurrent --open is ended, so it can't hold the exe or start a supervisor after the quit", async () => {
    const open = { pid: 7, commandLine: `"${EXE}" --open` };
    const s = setup({ procs: [[self, open, tracker], [self], []], probes: [{ pid: 42 }] });
    expect(await s.run()).toBe(0);
    expect(s.kills).toEqual([7]);
    expect(s.stops).toEqual([49100]);
  });

  test("a failed kill is logged and retried on the next tick", async () => {
    const s = setup({
      procs: [[supervisor], [supervisor], []],
      probes: ["refused"],
      killFails: 1,
    });
    expect(await s.run()).toBe(0);
    expect(s.kills).toHaveLength(2);
    expect(s.logger.events()).toContain("launcher/kill_failed");
  });

  test("a kill that keeps failing is logged once per pid, and a process already gone (ESRCH) isn't a failure", async () => {
    const logger = memoryLogger();
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    let tick = 0;
    const code = await quitApp({
      port: 49100,
      execPath: EXE,
      selfPid: SELF,
      exeProcesses: () => (tick++ < 3 ? [supervisor, { ...supervisor, pid: 40 }] : []),
      probe: () => Promise.resolve("refused"),
      requestStop: () => Promise.resolve({ kind: "refused" }),
      killPid: (pid) => {
        throw pid === 40 ? gone : new Error("EPERM");
      },
      ...fakeClock(),
      logger,
    });
    expect(code).toBe(0);
    expect(logger.events()).toEqual(["launcher/kill_failed", "launcher/done"]);
    expect(logger.lines[0]?.fields).toMatchObject({ pid: 41, arg: "--supervisor" });
  });

  test("a failed process lookup is logged once per streak and never read as nothing running", async () => {
    let calls = 0;
    const logger = memoryLogger();
    const code = await quitApp({
      port: 49100,
      execPath: EXE,
      selfPid: SELF,
      exeProcesses: () => {
        if (calls++ < 2) throw new Error("CIM down");
        return [];
      },
      probe: () => Promise.resolve("refused"),
      requestStop: () => Promise.resolve({ kind: "refused" }),
      killPid: () => undefined,
      ...fakeClock(),
      logger,
    });
    expect(code).toBe(0);
    expect(calls).toBe(3);
    expect(logger.events()).toEqual(["launcher/lookup_failed", "launcher/done"]);
    expect(logger.lines.at(-1)?.fields).toMatchObject({ lookupFailures: 2 });
  });

  test("processes still there after 30 s are left alone; it logs their pids and exits 1", async () => {
    const s = setup({ procs: [[self, tracker]], probes: [{ pid: 42 }] });
    expect(await s.run()).toBe(1);
    expect(s.stops).toEqual([49100]);
    expect(s.kills).toEqual([]);
    expect(s.logger.lines.at(-1)).toMatchObject({ event: "timeout", fields: { left: [42] } });
    expect(s.clock.now()).toBeGreaterThanOrEqual(30_000);
    expect(s.clock.now()).toBeLessThan(31_000);
  });
});

describe("runLauncher", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-launcher-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a bad GRINDLOG_PORT exits config-invalid and says so in launcher.log, after its started line", async () => {
    const env = { GRINDLOG_DATA_DIR: dir, GRINDLOG_PORT: "nope" };
    expect(await runLauncher("open", env)).toBe(EXIT_CONFIG_INVALID);
    const file = join(logsDir(env), "launcher.log");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { event: string; mode?: string; channel?: string; pid?: number });
    expect(lines.map((l) => l.event)).toEqual(["started", "config_invalid"]);
    expect(lines[0]).toMatchObject({ mode: "open", channel: "dev", pid: process.pid });
  });
});

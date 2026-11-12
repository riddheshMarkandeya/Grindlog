import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED, TRAY_EXIT_BAD_ARGS, TRAY_EXIT_CRASHED, TRAY_EXIT_QUIT, TRAY_EXIT_STDIN_CLOSED } from "./exit-codes";
import type { Probe, StopOutcome } from "./control";
import { decide, decideTray, runSupervisor, trayCmd, type TrayChild } from "./supervisor";
import { memoryLogger } from "./testing";

const MIN = 60_000;

describe("decide", () => {
  test("a clean stop, a taken port and a bad config end the supervisor too", () => {
    expect(decide(EXIT_OK, 1000, null)).toEqual({ kind: "stop" });
    expect(decide(EXIT_PORT_TAKEN, 1000, 20_000)).toEqual({ kind: "stop" });
    expect(decide(EXIT_CONFIG_INVALID, 1000, null)).toEqual({ kind: "stop" });
  });

  test("a crash restarts after 5 s, labelled by its exit code", () => {
    expect(decide(1, 1000, null)).toEqual({ kind: "restart", delayMs: 5000, cause: "crash" });
    expect(decide(EXIT_START_FAILED, 1000, null)).toEqual({ kind: "restart", delayMs: 5000, cause: "start_failed" });
    // Any other code (a kill, a native crash) is a crash too.
    expect(decide(0xc0000005, 1000, null)).toMatchObject({ kind: "restart", cause: "crash" });
  });

  test("quick repeated crashes double the delay up to 5 min", () => {
    const delays: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 9; i++) {
      const d = decide(1, 1000, prev);
      if (d.kind !== "restart") throw new Error("expected a restart");
      delays.push((prev = d.delayMs));
    }
    expect(delays).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  });

  test("10 min of uptime resets the delay", () => {
    expect(decide(1, 10 * MIN, 300_000)).toMatchObject({ delayMs: 5000 });
    expect(decide(1, 10 * MIN - 1, 300_000)).toMatchObject({ delayMs: 300_000 });
  });
});

describe("runSupervisor with a real child", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-sup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A sleep that records delays and fails the test rather than loop forever. */
  const recordSleeps = (sleeps: number[]) => (ms: number) => {
    sleeps.push(ms);
    return sleeps.length > 10 ? Promise.reject(new Error("supervisor kept restarting")) : Promise.resolve();
  };

  const supervise = async (codes: string) => {
    const logger = memoryLogger();
    const counter = join(dir, "runs");
    const sleeps: number[] = [];
    const code = await runSupervisor({
      cmd: [process.execPath, join(import.meta.dirname, "../../test/exit-child.ts"), counter, codes],
      cwd: dir,
      logger,
      sleep: recordSleeps(sleeps),
    });
    return { code, logger, sleeps, runs: Number(readFileSync(counter, "utf8")) };
  };

  test("restarts after crashes with a growing delay, and stops on a clean exit", async () => {
    const { code, logger, sleeps, runs } = await supervise("1,2,0");
    expect(code).toBe(0);
    expect(runs).toBe(3);
    expect(sleeps).toEqual([5000, 10_000]);
    expect(logger.events()).toEqual([
      "supervisor/started",
      "supervisor/child_exited",
      "supervisor/restarting",
      "supervisor/child_exited",
      "supervisor/restarting",
      "supervisor/child_exited",
      "supervisor/stopped",
    ]);
    expect(logger.lines.filter((l) => l.event === "restarting").map((l) => l.fields.cause)).toEqual(["crash", "start_failed"]);
    // What a friend's log needs to say which build and Windows it ran on.
    expect(logger.lines[0]?.fields).toMatchObject({ pid: process.pid, version: null, channel: "dev", windows: expect.any(String) as unknown, bun: Bun.version });
  });

  test("a child that found the port taken isn't restarted", async () => {
    const { code, sleeps, runs } = await supervise("3");
    expect(code).toBe(3);
    expect(runs).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("a missing exe is logged and retried like a crash", async () => {
    const logger = memoryLogger();
    let spawns = 0;
    const code = await runSupervisor({
      cmd: [join(dir, "missing.exe")],
      cwd: dir,
      logger,
      sleep: recordSleeps([]),
      // Two real spawns of the missing exe, then a clean child to end the loop.
      spawn: (cmd, opts) => (spawns++ < 2 ? Bun.spawn(cmd, opts) : { pid: 0, exited: Promise.resolve(0) }),
    });
    expect(code).toBe(0);
    expect(logger.events().filter((e) => e === "supervisor/spawn_failed")).toHaveLength(2);
  });
});

describe("decideTray", () => {
  test("Quit (0) quits the app; a closed stdin (3) is just done, never a quit", () => {
    expect(decideTray(TRAY_EXIT_QUIT, 1000, 0)).toEqual({ kind: "quit" });
    expect(decideTray(TRAY_EXIT_STDIN_CLOSED, 1000, 2)).toEqual({ kind: "done" });
  });

  test("short failures restart after 5 s then 10 s, and the third in a row gives up", () => {
    expect(decideTray(TRAY_EXIT_CRASHED, 1000, 0)).toEqual({ kind: "restart", delayMs: 5000, shortFailures: 1 });
    expect(decideTray(255, 1000, 1)).toEqual({ kind: "restart", delayMs: 10_000, shortFailures: 2 });
    expect(decideTray(TRAY_EXIT_CRASHED, 1000, 2)).toEqual({ kind: "give_up", shortFailures: 3 });
  });

  test("bad arguments (2) give up at once: no retry fixes the command line", () => {
    expect(decideTray(TRAY_EXIT_BAD_ARGS, 1000, 0)).toEqual({ kind: "give_up", shortFailures: 0 });
    expect(decideTray(TRAY_EXIT_BAD_ARGS, MIN, 1)).toEqual({ kind: "give_up", shortFailures: 1 });
  });

  test("a run of a minute or more resets the count", () => {
    expect(decideTray(TRAY_EXIT_CRASHED, MIN, 2)).toEqual({ kind: "restart", delayMs: 5000, shortFailures: 0 });
    expect(decideTray(TRAY_EXIT_CRASHED, MIN - 1, 2)).toMatchObject({ kind: "give_up" });
  });
});

describe("trayCmd", () => {
  const base = { trayExe: String.raw`C:\bin\grindlog-tray.exe`, name: "Grindlog", channel: "prod" as const, logs: String.raw`C:\Users\Zoë\logs`, port: 49100 };

  test("passes everything the tray needs, so it reads no config", () => {
    expect(trayCmd({ ...base, version: "1.2.3" })).toEqual([
      String.raw`C:\bin\grindlog-tray.exe`,
      "--port",
      "49100",
      "--name",
      "Grindlog",
      "--logs",
      String.raw`C:\Users\Zoë\logs`,
      "--channel",
      "prod",
      "--release-url-prefix",
      "https://github.com/riddheshMarkandeya/Grindlog/releases/tag/",
      "--version",
      "1.2.3",
    ]);
  });

  test("leaves the version out for a dev build, which has none", () => {
    expect(trayCmd({ ...base, version: null })).not.toContain("--version");
  });
});

describe("runSupervisor with the tray", () => {
  const TRACKER_PID = 100;
  const PORT = 49102;

  interface FakeTracker {
    pid: number;
    exited: Promise<number>;
    exit: (code: number) => void;
  }
  function fakeTracker(): FakeTracker {
    let exit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      exit = resolve;
    });
    return { pid: TRACKER_PID, exited, exit };
  }

  interface FakeTray extends TrayChild {
    exit: (code: number) => void;
    write: (chunk: string) => void;
    writeErr: (chunk: string) => void;
    stdinEnded: boolean;
    killed: boolean;
  }
  /**
   * A tray whose stdout closes just before it exits, as a real one's does, unless `holdPipes` (a
   * grandchild keeping them open); `onStdinEnd` is its exit code then (null ignores it).
   */
  function fakeTray(onStdinEnd: number | null, holdPipes = false): FakeTray {
    let out: ReadableStreamDefaultController<Uint8Array> | undefined;
    let err: ReadableStreamDefaultController<Uint8Array> | undefined;
    let resolveExit: (code: number) => void = () => undefined;
    const enc = new TextEncoder();
    let done = false;
    const t: FakeTray = {
      pid: 200,
      exited: new Promise<number>((resolve) => {
        resolveExit = resolve;
      }),
      stdout: new ReadableStream({
        start: (c) => {
          out = c;
        },
      }),
      stderr: new ReadableStream({
        start: (c) => {
          err = c;
        },
      }),
      stdinEnded: false,
      killed: false,
      stdin: {
        end: () => {
          t.stdinEnded = true;
          if (onStdinEnd !== null) setTimeout(() => { t.exit(onStdinEnd); }, 0);
        },
      },
      kill: () => {
        t.killed = true;
        t.exit(1);
      },
      write: (s) => out?.enqueue(enc.encode(s)),
      writeErr: (s) => err?.enqueue(enc.encode(s)),
      exit: (code) => {
        if (done) return;
        done = true;
        if (!holdPipes) {
          out?.close();
          err?.close();
        }
        resolveExit(code);
      },
    };
    return t;
  }

  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  /** Fake processes, clock and endpoints; `trays` drive each spawned tray in turn ("enoent" throws like a missing exe). */
  function setup(opts: {
    trays: (((t: FakeTray) => unknown) | "enoent")[];
    trayStdinExit?: number | null;
    holdPipes?: boolean;
    probe?: () => Probe;
    stopOutcomes?: StopOutcome[];
    /** How the tracker reacts to an accepted stop; default exits 0. */
    onStop?: (tracker: FakeTracker) => void;
    /** Real delay for a fake sleep of `ms`, so a test can order events around it; null never resolves. */
    sleepDelay?: (ms: number) => number | null;
  }) {
    const logger = memoryLogger();
    let clock = 0;
    const sleeps: number[] = [];
    const trackers: FakeTracker[] = [];
    const trays: FakeTray[] = [];
    let traySpawns = 0;
    const stopCalls: number[] = [];
    const run = runSupervisor({
      cmd: ["tracker.exe"],
      cwd: String.raw`C:\bin`,
      logger,
      tray: { cmd: ["tray.exe"], cwd: String.raw`C:\bin`, port: PORT },
      now: () => clock,
      sleep: (ms) => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length > 400) return Promise.reject(new Error("kept sleeping"));
        const d = opts.sleepDelay ? opts.sleepDelay(ms) : 0;
        return d === null ? new Promise(() => undefined) : tick(d);
      },
      spawn: () => {
        const t = fakeTracker();
        trackers.push(t);
        return t;
      },
      spawnTray: () => {
        const script = opts.trays[traySpawns++];
        if (script === undefined) throw new Error("unexpected tray spawn");
        if (script === "enoent") throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
        const t = fakeTray(opts.trayStdinExit === undefined ? TRAY_EXIT_STDIN_CLOSED : opts.trayStdinExit, opts.holdPipes);
        trays.push(t);
        setTimeout(() => void script(t), 0);
        return t;
      },
      probe: () => Promise.resolve(opts.probe ? opts.probe() : { pid: TRACKER_PID }),
      requestStop: (port) => {
        stopCalls.push(port);
        const outcome = opts.stopOutcomes?.[stopCalls.length - 1] ?? { kind: "status", status: 202 };
        const tracker = trackers.at(-1);
        if (outcome.kind === "status" && outcome.status === 202 && tracker) {
          (opts.onStop ?? ((t) => setTimeout(() => { t.exit(0); }, 0)))(tracker);
        }
        return Promise.resolve(outcome);
      },
    });
    const tracker = () => {
      const t = trackers[0];
      if (!t) throw new Error("no tracker spawned");
      return t;
    };
    return { run, logger, sleeps, trackers, trays, stopCalls, tracker, traySpawns: () => traySpawns };
  }

  const quitClick = (t: FakeTray) => {
    t.write('{"event":"quit_clicked"}\n');
    t.exit(TRAY_EXIT_QUIT);
  };

  test("Quit in the tray stops this tracker through the endpoint and ends the run with 0", async () => {
    const s = setup({ trays: [quitClick] });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([PORT]);
    expect(s.trackers).toHaveLength(1);
    expect(s.logger.events()).toEqual([
      "supervisor/started",
      "tray/quit_clicked",
      "tray/exited",
      "supervisor/quit_requested",
      "supervisor/stop_accepted",
      "supervisor/child_exited",
      "supervisor/stopped",
    ]);
  });

  test("Quit during a restart wait cancels it, and nothing respawns", async () => {
    const s = setup({
      trays: [
        async (t) => {
          s.tracker().exit(1);
          await tick(5);
          quitClick(t);
        },
      ],
      sleepDelay: (ms) => (ms === 5000 ? null : 0),
    });
    expect(await s.run).toBe(0);
    expect(s.trackers).toHaveLength(1);
    expect(s.stopCalls).toEqual([]);
    expect(s.logger.events()).toContain("supervisor/restart_cancelled");
  });

  test("a tracker that stops on its own closes the tray's stdin and waits for it", async () => {
    const s = setup({ trays: [() => { s.tracker().exit(EXIT_OK); }] });
    expect(await s.run).toBe(EXIT_OK);
    expect(s.trays[0]?.stdinEnded).toBe(true);
    expect(s.trays[0]?.killed).toBe(false);
    expect(s.logger.events().slice(-3)).toEqual(["supervisor/child_exited", "tray/exited", "supervisor/stopped"]);
  });

  test("a tray that exits in time isn't killed, even while its held-open pipes drain past the wait", async () => {
    // The 5 s wait ends after 30 ms of real time, well inside the real 1 s drain.
    const s = setup({ trays: [() => { s.tracker().exit(EXIT_OK); }], holdPipes: true, sleepDelay: (ms) => (ms === 5000 ? 30 : 0) });
    expect(await s.run).toBe(EXIT_OK);
    expect(s.trays[0]?.killed).toBe(false);
    expect(s.logger.events().slice(-2)).toEqual(["tray/exited", "supervisor/stopped"]);
  });

  test("a tray that ignores its stdin closing is killed after 5 s", async () => {
    const s = setup({ trays: [() => { s.tracker().exit(EXIT_PORT_TAKEN); }], trayStdinExit: null });
    expect(await s.run).toBe(EXIT_PORT_TAKEN);
    expect(s.trays[0]?.killed).toBe(true);
    expect(s.sleeps).toContain(5000);
    expect(s.logger.events()).toContain("tray/killed");
    // Its exit while stopping is ignored, not treated as a crash.
    expect(s.logger.events()).not.toContain("tray/restarting");
  });

  test("a tray that exits 3 (stdin closed by someone else) is no quit: no stop request, the tracker runs on", async () => {
    const s = setup({
      trays: [
        async (t) => {
          t.exit(TRAY_EXIT_STDIN_CLOSED);
          await tick(5);
          s.tracker().exit(EXIT_OK);
        },
      ],
    });
    expect(await s.run).toBe(EXIT_OK);
    expect(s.stopCalls).toEqual([]);
    expect(s.traySpawns()).toBe(1);
    expect(s.logger.events()).not.toContain("supervisor/quit_requested");
  });

  test("Quit while the port answers another tracker's pid asks nothing of it", async () => {
    const s = setup({ trays: [quitClick], probe: () => ({ pid: 999 }) });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([]);
    expect(s.logger.lines.find((l) => l.event === "quit_foreign_tracker")?.fields).toMatchObject({ pid: TRACKER_PID, portPid: 999 });
  });

  test("a tracker that crashes mid-quit ends the run with 0 and isn't restarted", async () => {
    const s = setup({ trays: [quitClick], onStop: (t) => setTimeout(() => { t.exit(1); }, 0) });
    expect(await s.run).toBe(0);
    expect(s.trackers).toHaveLength(1);
    expect(s.logger.lines.find((l) => l.event === "child_exited")?.fields).toMatchObject({ code: 1 });
  });

  test("a stop that isn't accepted yet (refused, reset, error, 5xx, 4xx) is retried until it is", async () => {
    const s = setup({
      trays: [quitClick],
      stopOutcomes: [{ kind: "refused" }, { kind: "reset" }, { kind: "error", message: "boom" }, { kind: "status", status: 503 }, { kind: "status", status: 404 }],
    });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toHaveLength(6);
    expect(s.logger.lines.filter((l) => l.event === "quit_retrying").map((l) => l.fields)).toEqual(["refused", "reset", "error", "status 503", "status 404"].map((stop) => ({ probe: "own", stop })));
  });

  test("a port that never answers is given up on at the 30 s deadline", async () => {
    const s = setup({ trays: [quitClick], probe: () => "refused" });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([]);
    expect(s.logger.lines.find((l) => l.event === "quit_timeout")?.fields).toMatchObject({ accepted: false });
    expect(s.sleeps.reduce((a, b) => a + b, 0)).toBe(30_000);
  });

  test("a port that gives no pid (a tracker busy starting) is asked once the child has run 5 s: by then it holds the port", async () => {
    const s = setup({ trays: [quitClick], probe: () => "starting" });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([PORT]);
    expect(s.logger.lines.find((l) => l.event === "stop_accepted")?.fields).toEqual({ probe: "starting", waitedMs: 5000 });
    expect(s.logger.lines.filter((l) => l.event === "quit_retrying").map((l) => l.fields)).toEqual([{ probe: "starting" }]);
  });

  test("a port with no pid is asked at once when the child has run 5 s before the Quit", async () => {
    // The first tray's crash and 5 s restart wait age the child before the second tray's Quit.
    const s = setup({ trays: [(t) => { t.exit(TRAY_EXIT_CRASHED); }, quitClick], probe: () => "starting" });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([PORT]);
    expect(s.logger.lines.find((l) => l.event === "stop_accepted")?.fields).toEqual({ probe: "starting", waitedMs: 0 });
  });

  test("a port with no pid while the child is young may be a duplicate's tracker: not asked, and the child's port-taken exit ends the quit", async () => {
    const s = setup({
      trays: [
        async (t) => {
          quitClick(t);
          await tick(5);
          s.tracker().exit(EXIT_PORT_TAKEN);
        },
      ],
      probe: () => "starting",
      sleepDelay: (ms) => (ms === 250 ? 2 : 0),
    });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toEqual([]);
    expect(s.logger.lines.find((l) => l.event === "child_exited")?.fields).toMatchObject({ code: EXIT_PORT_TAKEN });
  });

  test("an accepted stop gets its own 30 s for the exit, however long asking took", async () => {
    const s = setup({
      trays: [quitClick],
      stopOutcomes: [{ kind: "refused" }, { kind: "refused" }],
      onStop: () => undefined,
    });
    expect(await s.run).toBe(0);
    expect(s.stopCalls).toHaveLength(3);
    expect(s.sleeps).toEqual([250, 250, 30_000]);
    expect(s.logger.lines.find((l) => l.event === "stop_accepted")?.fields).toEqual({ probe: "own", waitedMs: 500 });
    expect(s.logger.lines.find((l) => l.event === "quit_timeout")?.fields).toMatchObject({ accepted: true, waitedMs: 30_000 });
  });

  test("a tray that rejects its arguments is given up on at once, and the tracker runs on", async () => {
    const s = setup({
      trays: [
        async (t) => {
          t.exit(TRAY_EXIT_BAD_ARGS);
          await tick(5);
          s.tracker().exit(EXIT_OK);
        },
      ],
    });
    expect(await s.run).toBe(EXIT_OK);
    expect(s.traySpawns()).toBe(1);
    expect(s.logger.lines.find((l) => l.event === "gave_up")?.fields).toEqual({ code: TRAY_EXIT_BAD_ARGS, shortFailures: 0 });
  });

  test("a tray crash just before the stop decision isn't restarted once stopping", async () => {
    const s = setup({
      trays: [
        async (t) => {
          t.exit(TRAY_EXIT_CRASHED);
          await tick(1);
          s.tracker().exit(EXIT_OK);
        },
      ],
      // The tray's restart wait outlasts the tracker's exit.
      sleepDelay: (ms) => (ms === 5000 ? 30 : 0),
    });
    expect(await s.run).toBe(EXIT_OK);
    await tick(50);
    expect(s.traySpawns()).toBe(1);
  });

  test("tray failures are restarted, and three short ones in a row give up while the tracker runs on", async () => {
    const crash = (t: FakeTray) => { t.exit(TRAY_EXIT_CRASHED); };
    const s = setup({
      trays: [
        crash,
        "enoent",
        async (t) => {
          crash(t);
          await tick(5);
          s.tracker().exit(EXIT_OK);
        },
      ],
    });
    expect(await s.run).toBe(EXIT_OK);
    expect(s.trackers).toHaveLength(1);
    expect(s.sleeps).toEqual([5000, 10_000]);
    expect(s.logger.events().filter((e) => e.startsWith("tray/"))).toEqual(["tray/exited", "tray/restarting", "tray/spawn_failed", "tray/restarting", "tray/exited", "tray/gave_up"]);
  });

  test("the tray's stdout and stderr go into the log, including lines split across chunks", async () => {
    const s = setup({
      trays: [
        (t) => {
          t.write('{"event":"started","pid":5,"windowsBuild":"26200.1"}\n{"event":"quit_cl');
          t.write('icked"}\r\nnot json\n');
          t.writeErr("oops\n");
          t.write('{"event":"crashed","error":"x"}');
          t.exit(TRAY_EXIT_QUIT);
        },
      ],
    });
    await s.run;
    const tray = s.logger.lines.filter((l) => l.cat === "tray").map((l) => [l.level, l.event, l.fields]);
    // The two pipes are read side by side, so only stdout's own order is fixed.
    expect(tray.filter(([, e]) => e !== "stderr")).toEqual([
      ["info", "started", { pid: 5, windowsBuild: "26200.1" }],
      ["info", "quit_clicked", {}],
      ["info", "output", { line: "not json" }],
      ["error", "crashed", { error: "x" }],
      ["info", "exited", { pid: 200, code: 0, uptimeMs: 0 }],
    ]);
    expect(tray).toContainEqual(["warn", "stderr", { line: "oops" }]);
  });
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { applyDecision, finishInterrupted, gateTick, resumeApply, stuckApply, type GateDeps, type GateInput, type ResumeDeps } from "./gate";
import type { HealthReading } from "./health";
import { readState, writeState, type UpdateState } from "./state";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

describe("applyDecision", () => {
  const base = (over: Partial<GateInput> = {}): GateInput => ({
    state: { v: 1, skipped: [], available: { version: "0.1.1", file: "Grindlog-Setup-0.1.1.exe", verifiedAt: iso(NOW) } },
    request: { v: 1, autoApply: true },
    running: "0.1.0",
    filesPresent: true,
    now: NOW,
    live: { gameRunning: false, recording: false },
    ...over,
  });

  test("applies a verified download with auto-apply on, the game closed and nothing recording", () => {
    expect(applyDecision(base())).toEqual({ kind: "apply", to: "0.1.1" });
  });

  test("with auto-apply off it waits for the user to choose this version", () => {
    expect(applyDecision(base({ request: { v: 1, autoApply: false } }))).toEqual({ kind: "wait", reason: "not_chosen" });
    expect(applyDecision(base({ request: { v: 1, autoApply: false, install: "0.1.0" } }))).toEqual({ kind: "wait", reason: "not_chosen" });
    expect(applyDecision(base({ request: { v: 1, autoApply: false, install: "0.1.1" } }))).toEqual({ kind: "apply", to: "0.1.1" });
  });

  test.each<[string, Partial<GateInput>, string]>([
    ["nothing is available", { state: { v: 1, skipped: [] } }, "nothing"],
    ["an apply is under way", { state: { v: 1, skipped: [], available: { version: "0.1.1", file: "f", verifiedAt: "t" }, apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW), phase: "installing" } } }, "apply_in_progress"],
    ["the download's files are gone", { filesPresent: false }, "files_missing"],
    ["the game is running", { live: { gameRunning: true, recording: false } }, "game_running"],
    ["the tracker is recording", { live: { gameRunning: false, recording: true } }, "recording"],
  ])("waits when %s", (_, over, reason) => {
    expect(applyDecision(base(over))).toEqual({ kind: "wait", reason });
  });

  test("a start that didn't happen, or was cut short, under an hour ago waits out the hour so a failing stop doesn't retry every 30 s", () => {
    const last = (outcome: string, at: number): Partial<GateInput> => ({ state: { ...base().state, lastApply: { from: "0.1.0", to: "0.1.1", outcome, at: iso(at) } } });
    expect(applyDecision(base(last("not_started", NOW - 59 * MIN)))).toEqual({ kind: "wait", reason: "cooldown" });
    expect(applyDecision(base(last("interrupted", NOW - 10 * MIN)))).toEqual({ kind: "wait", reason: "cooldown" });
    expect(applyDecision(base(last("not_started", NOW - 61 * MIN)))).toEqual({ kind: "apply", to: "0.1.1" });
    expect(applyDecision(base(last("rolled_back", NOW - MIN)))).toEqual({ kind: "apply", to: "0.1.1" });
  });

  test("a download that isn't newer than this version (installed by hand since, or unhealthy here) waits for the next check to drop it", () => {
    expect(applyDecision(base({ running: "0.1.1" }))).toEqual({ kind: "wait", reason: "not_newer" });
    expect(applyDecision(base({ running: "0.2.0" }))).toEqual({ kind: "wait", reason: "not_newer" });
  });

  test("asks for the live facts only once the file checks pass", () => {
    expect(applyDecision(base({ live: undefined }))).toEqual({ kind: "check_live" });
    expect(applyDecision(base({ live: undefined, filesPresent: false }))).toEqual({ kind: "wait", reason: "files_missing" });
  });
});

describe("stuckApply", () => {
  const at = (phase: string, startedAt: number): UpdateState => ({ v: 1, skipped: [], apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(startedAt), phase } });
  test("an apply still starting or stopping 2 min after it began is stuck (its updater may never have run)", () => {
    expect(stuckApply(at("starting", NOW - 2 * MIN - 1), NOW)).toBe(true);
    expect(stuckApply(at("stopping", NOW - 5 * MIN), NOW)).toBe(true);
  });
  test("a younger one, or one past stopping, isn't", () => {
    expect(stuckApply(at("starting", NOW - MIN), NOW)).toBe(false);
    expect(stuckApply(at("installing", NOW - 30 * MIN), NOW)).toBe(false);
    expect(stuckApply({ v: 1, skipped: [] }, NOW)).toBe(false);
  });
});

let dir: string;
let upd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-gate-"));
  upd = join(dir, "update");
  mkdirSync(join(upd, "download"), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const state = () => readState(upd, memoryLogger());
const updaterExe = () => join(upd, "grindlog-updater.exe");

describe("resumeApply", () => {
  function deps(over: Partial<ResumeDeps> = {}) {
    const calls = { lookups: 0, restores: 0 };
    const d: ResumeDeps = {
      dir: upd,
      running: "0.1.0",
      logger: memoryLogger(),
      updaterRunning: () => {
        calls.lookups++;
        return false;
      },
      restore: () => {
        calls.restores++;
      },
      now: () => NOW,
      ...over,
    };
    return { d, calls };
  }
  const interrupted = (phase: string, from = "0.1.0", to = "0.1.1") => {
    writeState(upd, memoryLogger(), { available: { version: to, file: "f", verifiedAt: "t" }, apply: { from, to, startedAt: iso(NOW - 10 * MIN), phase } });
  };

  test("with no updater file and no apply it doesn't look for processes", () => {
    const { d, calls } = deps();
    expect(resumeApply(d)).toEqual({ kind: "none" });
    expect(calls.lookups).toBe(0);
  });

  test("a leftover updater file with no updater running is deleted", () => {
    writeFileSync(updaterExe(), "exe");
    const { d } = deps();
    expect(resumeApply(d)).toEqual({ kind: "none" });
    expect(existsSync(updaterExe())).toBe(false);
    expect((d.logger as ReturnType<typeof memoryLogger>).events()).toContain("update/updater_removed");
  });

  test("a running updater owns the apply: nothing is touched", () => {
    writeFileSync(updaterExe(), "exe");
    interrupted("checking");
    const { d, calls } = deps({ updaterRunning: () => true });
    expect(resumeApply(d)).toEqual({ kind: "updater_running" });
    expect(existsSync(updaterExe())).toBe(true);
    expect(state().apply).toBeDefined();
    expect(calls.restores).toBe(0);
  });

  test("a failed process lookup counts as an updater running, since clearing under a live one could move DBs twice", () => {
    interrupted("rolling_back");
    const { d } = deps({
      updaterRunning: () => {
        throw new Error("cim failed");
      },
    });
    expect(resumeApply(d)).toEqual({ kind: "updater_running" });
    expect(state().apply).toBeDefined();
    expect((d.logger as ReturnType<typeof memoryLogger>).events()).toContain("update/updater_lookup_failed");
  });

  test("interrupted with the old version running: the DBs are restored and the apply ends as interrupted", () => {
    interrupted("checking");
    const { d, calls } = deps();
    expect(resumeApply(d)).toEqual({ kind: "cleared" });
    expect(calls.restores).toBe(1);
    expect(state()).toMatchObject({ lastApply: { from: "0.1.0", to: "0.1.1", outcome: "interrupted", reason: "checking" }, available: { version: "0.1.1" } });
    expect(state().apply).toBeUndefined();
    expect(state().skipped).toEqual([]);
    expect((d.logger as ReturnType<typeof memoryLogger>).lines.find((l) => l.event === "apply_interrupted")).toMatchObject({ fields: { phase: "checking", from: "0.1.0", to: "0.1.1", running: "0.1.0" } });
  });

  test.each(["rolling_back", "checking_previous"])("interrupted during the rollback (%s): the new version is skipped too", (phase) => {
    interrupted(phase);
    const { d } = deps();
    resumeApply(d);
    expect(state().skipped).toEqual([{ version: "0.1.1", reason: "interrupted" }]);
    expect(state().available).toBeUndefined();
  });

  test("interrupted with the new version running: the apply stays, for a health check after the tracker starts", () => {
    interrupted("checking");
    const { d, calls } = deps({ running: "0.1.1" });
    expect(resumeApply(d)).toEqual({ kind: "check_health", apply: expect.objectContaining({ to: "0.1.1" }) as unknown });
    expect(calls.restores).toBe(0);
    expect(state().apply).toBeDefined();
  });

  test.each(["rolling_back", "checking_previous"])("interrupted during the rollback (%s) with the new version running: unhealthy, skipped, failed DBs kept", (phase) => {
    interrupted(phase);
    mkdirSync(join(dir, "failed-update", "0.1.1"), { recursive: true });
    const { d, calls } = deps({ running: "0.1.1" });
    expect(resumeApply(d)).toEqual({ kind: "cleared" });
    expect(calls.restores).toBe(0);
    expect(state()).toMatchObject({ lastApply: { outcome: "unhealthy", reason: phase }, skipped: [{ version: "0.1.1", reason: "interrupted" }] });
    expect(state().apply).toBeUndefined();
    expect(state().available).toBeUndefined();
    expect(existsSync(join(dir, "failed-update", "0.1.1"))).toBe(true);
  });

  test("an apply naming neither this version nor the one before it is just cleared", () => {
    interrupted("checking", "0.0.8", "0.0.9");
    const { d, calls } = deps();
    expect(resumeApply(d)).toEqual({ kind: "cleared" });
    expect(calls.restores).toBe(0);
    expect(state().apply).toBeUndefined();
  });

  test("a restore that throws is logged and the apply still ends", () => {
    interrupted("rolling_back");
    const { d } = deps({
      restore: () => {
        throw new Error("EBUSY");
      },
    });
    expect(resumeApply(d)).toEqual({ kind: "cleared" });
    expect((d.logger as ReturnType<typeof memoryLogger>).events()).toContain("update/restore_failed");
    expect(state().apply).toBeUndefined();
  });
});

describe("finishInterrupted", () => {
  const apply = { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 10 * MIN), phase: "checking" };
  const run = (answer: HealthReading) => {
    writeState(upd, memoryLogger(), { available: { version: "0.1.1", file: "f", verifiedAt: "t" }, apply });
    writeFileSync(join(upd, "download", "Grindlog-Setup-0.1.1.exe"), "x");
    let t = NOW;
    return finishInterrupted(apply, {
      dir: upd,
      dataDir: dir,
      port: 1,
      logger: memoryLogger(),
      probe: () => Promise.resolve(answer),
      now: () => t,
      sleep: (ms) => {
        t += ms;
        return Promise.resolve();
      },
    });
  };

  test("healthy: recorded as updated, with the download and rollback copies cleaned up", async () => {
    await run({ pid: 5, version: "0.1.1" });
    expect(state()).toMatchObject({ lastApply: { outcome: "updated" } });
    expect(state().apply).toBeUndefined();
    expect(state().available).toBeUndefined();
    expect(existsSync(join(upd, "download", "Grindlog-Setup-0.1.1.exe"))).toBe(false);
  });

  test("unhealthy: recorded as such, with no rollback, and the running version's download dropped so it isn't applied over itself", async () => {
    await run("refused");
    expect(state()).toMatchObject({ lastApply: { outcome: "unhealthy" } });
    expect(state().apply).toBeUndefined();
    expect(state().available).toBeUndefined();
    expect(existsSync(join(upd, "download", "Grindlog-Setup-0.1.1.exe"))).toBe(false);
  });
});

describe("gateTick", () => {
  function deps(over: Partial<GateDeps> = {}) {
    const calls = { spawned: [] as string[][], copied: [] as string[][], games: 0, restores: 0, finishing: [] as string[] };
    const d: GateDeps = {
      dir: upd,
      appExe: join(dir, "app", "grindlog.exe"),
      running: "0.1.0",
      port: 1,
      logger: memoryLogger(),
      env: { GRINDLOG_X: "1" },
      updaterRunning: () => false,
      gameRunning: () => {
        calls.games++;
        return Promise.resolve(false);
      },
      status: () => Promise.resolve({ pid: 1, version: "0.1.0", connection: "connected" }),
      copyFile: (from, to) => {
        calls.copied.push([from, to]);
      },
      spawn: (cmd) => {
        calls.spawned.push(cmd);
        return 77;
      },
      restore: () => {
        calls.restores++;
      },
      finishInterrupted: (apply) => {
        calls.finishing.push(apply.to);
      },
      now: () => NOW,
      ...over,
    };
    return { d, calls, events: () => (d.logger as ReturnType<typeof memoryLogger>).events() };
  }
  const available = () => {
    writeState(upd, memoryLogger(), { available: { version: "0.1.1", file: "Grindlog-Setup-0.1.1.exe", verifiedAt: "t" } });
    writeFileSync(join(upd, "download", "Grindlog-Setup-0.1.1.exe"), "x");
    writeFileSync(join(upd, "download", "Grindlog-Setup-0.1.1.exe.minisig"), "x");
  };

  test("records the apply, copies the exe to the updater's name and starts it on the app dir", async () => {
    available();
    const { d, calls, events } = deps();
    await gateTick(d, {});
    expect(state().apply).toEqual({ from: "0.1.0", to: "0.1.1", startedAt: iso(NOW), phase: "starting" });
    expect(calls.copied).toEqual([[d.appExe, updaterExe()]]);
    expect(calls.spawned).toEqual([[updaterExe(), "--update", "--app-dir", join(dir, "app")]]);
    expect(events()).toContain("update/apply_starting");
  });

  test("a failed spawn ends the apply as not started, so the hour's cooldown holds off the next try", async () => {
    available();
    const { d, events } = deps({
      spawn: () => {
        throw new Error("EPERM");
      },
    });
    await gateTick(d, {});
    expect(state().apply).toBeUndefined();
    expect(state()).toMatchObject({ lastApply: { outcome: "not_started", reason: "spawn_failed" } });
    expect(events()).toContain("update/apply_spawn_failed");
  });

  test("nothing available: no tasklist, no status", async () => {
    const { d, calls } = deps();
    await gateTick(d, {});
    expect(calls.games).toBe(0);
  });

  test("a wait is logged once per reason, not every tick", async () => {
    available();
    const { d, calls, events } = deps({ gameRunning: () => Promise.resolve(true) });
    const memo = {};
    await gateTick(d, memo);
    await gateTick(d, memo);
    expect(events().filter((e) => e === "update/apply_waiting")).toHaveLength(1);
    expect(calls.spawned).toEqual([]);
  });

  test("a tracker that doesn't answer doesn't count as recording, so a crash-looping one still gets fixed", async () => {
    available();
    const { d, calls } = deps({ status: () => Promise.resolve("refused") });
    await gateTick(d, {});
    expect(calls.spawned).toHaveLength(1);
  });

  test("a recording tracker waits", async () => {
    available();
    const { d, calls } = deps({ status: () => Promise.resolve({ pid: 1, version: "0.1.0", connection: "recording" }) });
    await gateTick(d, {});
    expect(calls.spawned).toEqual([]);
  });

  test("a game check that fails waits rather than risk an update mid-match", async () => {
    available();
    const { d, calls, events } = deps({ gameRunning: () => Promise.reject(new Error("tasklist")) });
    await gateTick(d, {});
    expect(calls.spawned).toEqual([]);
    expect(events()).toContain("update/game_check_failed");
  });

  test("a stuck start with no updater running is ended as not started, with the hour's cooldown", async () => {
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 3 * MIN), phase: "starting" } });
    const { d, events } = deps();
    await gateTick(d, {});
    expect(state()).toMatchObject({ lastApply: { outcome: "not_started", reason: "updater_died" } });
    expect(state().apply).toBeUndefined();
    expect(events()).toContain("update/apply_interrupted");
  });

  test("a stuck-looking start whose updater is still running, or can't be looked up, is left alone", async () => {
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 3 * MIN), phase: "stopping" } });
    await gateTick(deps({ updaterRunning: () => true }).d, {});
    expect(state().apply).toBeDefined();
    await gateTick(
      deps({
        updaterRunning: () => {
          throw new Error("cim");
        },
      }).d,
      {},
    );
    expect(state().apply).toBeDefined();
  });

  test("an updater that died after starting the new version: its health check is started once, in the background", async () => {
    available();
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 50 * MIN), phase: "checking" } });
    const { d, calls, events } = deps({ running: "0.1.1" });
    const memo = {};
    await gateTick(d, memo);
    await gateTick(d, memo);
    expect(calls.finishing).toEqual(["0.1.1"]);
    expect(calls.spawned).toEqual([]);
    expect(events()).toContain("update/apply_interrupted");
  });

  test("an updater that died while checking the old version again: ended as interrupted, the new version skipped", async () => {
    available();
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 50 * MIN), phase: "checking_previous" } });
    const { d, calls } = deps();
    await gateTick(d, {});
    expect(calls.restores).toBe(1);
    expect(state()).toMatchObject({ lastApply: { outcome: "interrupted", reason: "checking_previous" }, skipped: [{ version: "0.1.1", reason: "interrupted" }] });
    expect(state().apply).toBeUndefined();
  });

  test("past stopping with the updater still running, the tick leaves the apply alone", async () => {
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 50 * MIN), phase: "checking" } });
    const { d, calls } = deps({ running: "0.1.1", updaterRunning: () => true });
    await gateTick(d, {});
    expect(state().apply).toBeDefined();
    expect(calls.finishing).toEqual([]);
  });

  test("an apply past stopping that isn't overdue isn't looked up: a normal apply costs no PowerShell per tick", async () => {
    writeState(upd, memoryLogger(), { apply: { from: "0.1.0", to: "0.1.1", startedAt: iso(NOW - 20 * MIN), phase: "checking" } });
    let lookups = 0;
    const { d, calls } = deps({
      running: "0.1.1",
      updaterRunning: () => {
        lookups++;
        return false;
      },
    });
    await gateTick(d, {});
    expect(lookups).toBe(0);
    expect(calls.finishing).toEqual([]);
    expect(state().apply).toBeDefined();
  });
});

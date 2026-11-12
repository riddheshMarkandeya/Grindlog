import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { feed } from "./recorder/feed";
import { createRecorder } from "./recorder/recorder";
import { toRecord } from "./records/record";
import type { RecomputeOptions, RecomputeResult } from "./records/recompute";
import { createRecordWriter } from "./records/save";
import { startReleaseRecompute, type ReleaseRecomputeOptions } from "./release-recompute";
import { openStorage, type Storage } from "./storage";
import { memoryLogger, readFixture } from "./testing";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-release-recompute-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  logger = memoryLogger();
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const marker = () => storage.tracker.get<{ value: string }>("SELECT value FROM meta WHERE key = 'recomputed_version'")?.value;
const setMarker = (v: string) => storage.tracker.run("INSERT INTO meta (key, value) VALUES ('recomputed_version', ?)", v);
const line = (event: string) => logger.lines.find((l) => l.event === event);

/** A step source of n matches, `failed` of them counted as failures; counts how many steps ran. */
function fakeSteps(n: number, failed = 0) {
  const seen = { steps: 0, opts: undefined as RecomputeOptions | undefined };
  function* steps(opts: RecomputeOptions): Generator<number, RecomputeResult> {
    seen.opts = opts;
    for (let i = 0; i < n; i++) {
      seen.steps++;
      yield n - i - 1;
    }
    return { written: n - failed, skipped: {}, failed, ms: 1 };
  }
  return { steps, seen };
}

const noYield = () => Promise.resolve();

function start(over: Partial<ReleaseRecomputeOptions> = {}) {
  const done: RecomputeResult[] = [];
  const handle = startReleaseRecompute({
    storage,
    version: "0.2.0",
    isRecording: () => false,
    onDone: (result) => {
      done.push(result);
    },
    logger,
    yieldFn: noYield,
    sleep: noYield,
    ...over,
  });
  return { handle, doneCalls: () => done.length, done };
}

describe("startReleaseRecompute", () => {
  test("a dev build (no version) never steps", async () => {
    const { steps, seen } = fakeSteps(3);
    const { handle, doneCalls } = start({ version: null, steps });
    await handle.done;
    expect(seen.steps).toBe(0);
    expect(doneCalls()).toBe(0);
    expect(line("release_recompute_skipped")?.fields).toEqual({ reason: "dev" });
  });

  test("a marker equal to the version never steps", async () => {
    setMarker("0.2.0");
    const { steps, seen } = fakeSteps(3);
    const { handle, doneCalls } = start({ steps });
    await handle.done;
    expect(seen.steps).toBe(0);
    expect(doneCalls()).toBe(0);
    expect(line("release_recompute_skipped")?.fields).toEqual({ reason: "current", version: "0.2.0" });
  });

  test("a missing marker runs every match quietly, writes the marker and calls onDone once", async () => {
    const { steps, seen } = fakeSteps(3);
    const { handle, doneCalls } = start({ steps });
    await handle.done;
    expect(seen.steps).toBe(3);
    expect(seen.opts?.quietSkips).toBe(true);
    expect(marker()).toBe("0.2.0");
    expect(doneCalls()).toBe(1);
    expect(line("release_recompute_started")?.fields).toEqual({ from: null, to: "0.2.0" });
    expect(line("release_recompute_done")?.fields).toMatchObject({ from: null, to: "0.2.0", written: 3, failed: 0, markerWritten: true, activeMs: expect.any(Number) as unknown });
  });

  test("a different marker (an update or a rollback) runs and replaces it", async () => {
    setMarker("0.3.0");
    const { steps } = fakeSteps(2);
    const { handle } = start({ steps });
    await handle.done;
    expect(marker()).toBe("0.2.0");
    expect(line("release_recompute_started")?.fields).toEqual({ from: "0.3.0", to: "0.2.0" });
  });

  test("a failed match leaves the marker unwritten, and onDone still runs since others may have changed", async () => {
    setMarker("0.1.0");
    const { steps } = fakeSteps(3, 1);
    const { handle, doneCalls, done } = start({ steps });
    await handle.done;
    expect(marker()).toBe("0.1.0");
    expect(doneCalls()).toBe(1);
    expect(done[0]).toMatchObject({ failed: 1 });
    expect(line("release_recompute_done")?.fields).toMatchObject({ failed: 1, markerWritten: false });
  });

  test("a recording match pauses it between matches until recording ends", async () => {
    const { steps, seen } = fakeSteps(3);
    // Recording for the first three checks after the first match: the pause starts, waits twice, ends.
    let checks = 0;
    const isRecording = () => seen.steps === 1 && ++checks <= 3;
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    const { handle } = start({ steps, isRecording, sleep, pauseCheckMs: 1234 });
    await handle.done;
    expect(seen.steps).toBe(3);
    expect(sleeps).toEqual([1234, 1234]);
    expect(logger.events().filter((e) => e.startsWith("records/release_recompute_pa") || e.endsWith("_resumed"))).toEqual(["records/release_recompute_paused", "records/release_recompute_resumed"]);
    expect(line("release_recompute_resumed")?.fields).toEqual({ pausedMs: expect.any(Number) as unknown });
    expect(marker()).toBe("0.2.0");
  });

  test("a match already recording at startup holds back the first match until it ends", async () => {
    const { steps, seen } = fakeSteps(2);
    let checks = 0;
    const isRecording = () => seen.steps === 0 && ++checks <= 2;
    const stepsAtSleep: number[] = [];
    const sleep = () => {
      stepsAtSleep.push(seen.steps);
      return Promise.resolve();
    };
    const { handle } = start({ steps, isRecording, sleep });
    await handle.done;
    expect(stepsAtSleep).toEqual([0]);
    expect(seen.steps).toBe(2);
    expect(line("release_recompute_resumed")).toBeDefined();
  });

  test("stop() mid-run resolves after the current match, with no marker and no onDone", async () => {
    const { steps, seen } = fakeSteps(5);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // The yield after the second match waits (the first yield is the startup one), so stop() lands mid-run.
    let yields = 0;
    const yieldFn = () => (++yields === 3 ? gate : Promise.resolve());
    const { handle, doneCalls } = start({ steps, yieldFn });
    await new Promise((r) => setTimeout(r, 10));
    const stopped = handle.stop();
    release();
    await stopped;
    expect(seen.steps).toBeLessThan(5);
    expect(marker()).toBeUndefined();
    expect(doneCalls()).toBe(0);
    expect(line("release_recompute_stopped")?.fields).toEqual({ done: seen.steps });
    expect(line("release_recompute_done")).toBeUndefined();
  });

  test("stop() in the yield after the last match still finishes the run", async () => {
    const { steps } = fakeSteps(2);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Yields: the startup one, after match 1, after match 2 (the last), which waits.
    let yields = 0;
    const yieldFn = () => (++yields === 3 ? gate : Promise.resolve());
    const { handle, doneCalls } = start({ steps, yieldFn });
    await new Promise((r) => setTimeout(r, 10));
    const stopped = handle.stop();
    release();
    await stopped;
    expect(marker()).toBe("0.2.0");
    expect(doneCalls()).toBe(1);
    expect(line("release_recompute_stopped")).toBeUndefined();
    expect(line("release_recompute_done")?.fields).toMatchObject({ written: 2, markerWritten: true });
  });

  test("stop() during the startup yield logs a stop with nothing done", async () => {
    const { steps, seen } = fakeSteps(2);
    const { handle, doneCalls } = start({ steps, yieldFn: () => new Promise<void>((r) => setTimeout(r, 10)) });
    await handle.stop();
    expect(seen.steps).toBe(0);
    expect(doneCalls()).toBe(0);
    expect(line("release_recompute_stopped")?.fields).toEqual({ done: 0 });
    expect(line("release_recompute_started")).toBeUndefined();
  });

  test("stop() while paused resolves without waiting out the pause", async () => {
    const { steps } = fakeSteps(3);
    const never = () => new Promise<void>(() => undefined);
    const { handle, doneCalls } = start({ steps, isRecording: () => true, sleep: never });
    await new Promise((r) => setTimeout(r, 10));
    expect(line("release_recompute_paused")).toBeDefined();
    await handle.stop();
    expect(marker()).toBeUndefined();
    expect(doneCalls()).toBe(0);
    expect(line("release_recompute_stopped")).toBeDefined();
  });

  test("a throwing step source is logged as crashed and never rejects", async () => {
    // eslint-disable-next-line require-yield -- a source that throws before its first match
    function* steps(): Generator<number, RecomputeResult> {
      throw new Error("raw.db gone");
    }
    const { handle, doneCalls } = start({ steps });
    await expect(handle.done).resolves.toBeUndefined();
    expect(line("release_recompute_crashed")).toMatchObject({ level: "error", fields: { err: expect.any(Error) as unknown } });
    expect(marker()).toBeUndefined();
    expect(doneCalls()).toBe(0);
  });

  test("a tracker db without the meta table (the marker read throws) is logged as crashed, not thrown", async () => {
    storage.tracker.run("DROP TABLE meta");
    const { steps, seen } = fakeSteps(1);
    let done: Promise<void> = Promise.resolve();
    expect(() => {
      done = start({ steps }).handle.done;
    }).not.toThrow();
    await done;
    expect(seen.steps).toBe(0);
    expect(line("release_recompute_crashed")).toBeDefined();
  });

  test("with the real recompute, rebuilds a recorded match and writes the marker", async () => {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 42 });
    const recorder = createRecorder({ raw: storage.raw, logger: memoryLogger(), onMatchFinished: (s) => void writer.save(toRecord(s)) });
    feed(recorder, readFixture("completed"));
    recorder.flush();
    const before = storage.tracker.all("SELECT * FROM matches");
    storage.tracker.run("DELETE FROM matches");
    const { handle, doneCalls } = start();
    await handle.done;
    expect(storage.tracker.all("SELECT * FROM matches")).toEqual(before);
    expect(line("release_recompute_done")?.fields).toMatchObject({ written: 1, failed: 0, markerWritten: true });
    expect(marker()).toBe("0.2.0");
    expect(doneCalls()).toBe(1);
  });
});

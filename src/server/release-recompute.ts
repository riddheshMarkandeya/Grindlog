// After an update (or a rollback), a release build rebuilds every match record under its own
// rules, in the background: one match at a time, pausing while a match records. The version whose
// rules last finished a clean run is kept in tracker.db's meta table; a stopped run leaves it
// unwritten, so the next start reruns in full. A dev build has no version and never runs it.
import { setImmediateYield } from "./db/retention";
import type { Db } from "./db/sqlite";
import { log, type Logger } from "./log";
import { recomputeSteps, type RecomputeOptions, type RecomputeResult } from "./records/recompute";

const C = "records";
const MARKER_KEY = "recomputed_version";
const PAUSE_CHECK_MS = 5000;

const timeoutSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface ReleaseRecomputeOptions {
  storage: { raw: Db; tracker: Db };
  /** This build's release, or null for a dev build. */
  version: string | null;
  isRecording: () => boolean;
  /** Called once when a run reaches the end, failures or not: records may have changed. */
  onDone: () => void;
  logger?: Logger;
  /** Lets other work run between matches. */
  yieldFn?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  /** How often a pause checks whether recording has ended. */
  pauseCheckMs?: number;
  steps?: (opts: RecomputeOptions) => Generator<number, RecomputeResult>;
}

export interface ReleaseRecompute {
  /** Ends the run at the next match boundary (or wakes a pause) and waits for it. */
  stop(): Promise<void>;
  /** Settles when the run ends, however it ends; never rejects. */
  done: Promise<void>;
}

export function startReleaseRecompute(opts: ReleaseRecomputeOptions): ReleaseRecompute {
  const { storage, version, isRecording, onDone, logger = log, yieldFn = setImmediateYield, sleep = timeoutSleep } = opts;
  const { pauseCheckMs = PAUSE_CHECK_MS, steps = recomputeSteps } = opts;
  const { raw, tracker } = storage;
  let stopped = false;
  /** Ends the current pause wait early; each wait sets its own, so nothing piles up over a long pause. */
  let wake: () => void = () => undefined;

  // Read through a function: stop() flips the flag during an await, which TS's narrowing can't see.
  const isStopped = () => stopped;

  /** Waits while a match records; false once a stop arrives. */
  async function waitWhileRecording(): Promise<boolean> {
    if (isStopped() || !isRecording()) return !isStopped();
    const pausedAt = performance.now();
    logger.info(C, "release_recompute_paused");
    while (!isStopped() && isRecording()) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        void sleep(pauseCheckMs).then(resolve);
      });
    }
    if (isStopped()) return false;
    logger.info(C, "release_recompute_resumed", { pausedMs: Math.round(performance.now() - pausedAt) });
    return true;
  }

  async function run(to: string): Promise<void> {
    const from = tracker.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", MARKER_KEY)?.value ?? null;
    if (from === to) {
      logger.info(C, "release_recompute_skipped", { reason: "current", version: to });
      return;
    }
    logger.info(C, "release_recompute_started", { from, to });
    const gen = steps({ raw, tracker, logger, quietSkips: true });
    let activeMs = 0;
    let stepped = 0;
    let left = Number.POSITIVE_INFINITY;
    let result: RecomputeResult;
    for (;;) {
      // Checked before each match, the first included: a match may already be recording at startup.
      // Not before the final step, which only returns the result, so a stop can't discard a finished run.
      if (left > 0 && !(await waitWhileRecording())) {
        logger.info(C, "release_recompute_stopped", { done: stepped });
        return;
      }
      const t0 = performance.now();
      const next = gen.next();
      activeMs += performance.now() - t0;
      if (next.done === true) {
        result = next.value;
        break;
      }
      stepped++;
      left = next.value;
      await yieldFn();
    }
    const markerWritten = result.failed === 0;
    if (markerWritten) {
      tracker.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", MARKER_KEY, to);
    }
    logger.info(C, "release_recompute_done", { from, to, ...result, activeMs: Math.round(activeMs), markerWritten });
    onDone();
  }

  async function guarded(): Promise<void> {
    try {
      if (version === null) {
        logger.info(C, "release_recompute_skipped", { reason: "dev" });
        return;
      }
      // First a yield, so startup returns before any database work.
      await yieldFn();
      if (isStopped()) {
        logger.info(C, "release_recompute_stopped", { done: 0 });
        return;
      }
      await run(version);
    } catch (err) {
      // Broad on purpose: this runs after the host is listening, and a failed background rebuild
      // (marker read or write, raw.db) must never take the tracker down. The next start retries.
      logger.error(C, "release_recompute_crashed", { err });
    }
  }

  const running = guarded();
  return {
    done: running,
    stop: async () => {
      stopped = true;
      wake();
      await running;
    },
  };
}

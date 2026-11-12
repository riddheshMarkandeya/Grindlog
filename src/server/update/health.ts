// Whether a freshly started version of the app stays up: the updater's test of an install (and of a
// rollback), and the supervisor's after an update the updater didn't live to finish checking.
import type { StatusInfo } from "../control";

const POLL_MS = 2000;
/** One tracker process answering this long is taken as healthy: a failing start crashes within it. */
const STABLE_MS = 2 * 60 * 1000;
/** Migrations of a big raw.db can take minutes, so the whole check waits this long before failing. */
const TIMEOUT_MS = 10 * 60 * 1000;

export type HealthReading = "refused" | "starting" | StatusInfo;

export interface WaitHealthyOptions {
  port: number;
  /** The version that must answer. */
  version: string;
  probe: (port: number) => Promise<HealthReading>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type HealthResult = { ok: true; pid: number } | { ok: false; last: HealthReading };

/**
 * Polls the tracker's status until one process at `version` has answered for 2 min (healthy), or 10 min
 * pass (not). A new pid means the supervisor restarted a crashed tracker, so the 2 min start over;
 * a non-answer between two answers from the same pid (a slow request) doesn't.
 */
export async function waitHealthy({ port, version, probe, now = Date.now, sleep = Bun.sleep }: WaitHealthyOptions): Promise<HealthResult> {
  const start = now();
  // Cast, not annotated: TS narrows an annotated `= null` to null for the whole loop body.
  let seen = null as { pid: number; at: number } | null;
  for (;;) {
    const last = await probe(port);
    const t = now();
    if (typeof last !== "string") {
      if (last.version !== version) seen = null;
      else {
        seen = seen?.pid === last.pid ? seen : { pid: last.pid, at: t };
        if (t - seen.at >= STABLE_MS) return { ok: true, pid: last.pid };
      }
    }
    if (t - start >= TIMEOUT_MS) return { ok: false, last };
    await sleep(POLL_MS);
  }
}

/** A health result as log fields, the same for the updater and the supervisor. */
export function healthFields(version: string, result: HealthResult) {
  return { version, ok: result.ok, pid: result.ok ? result.pid : null, last: result.ok ? null : result.last };
}

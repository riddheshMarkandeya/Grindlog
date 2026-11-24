// Tilt: win % by a match's place in its session (game number) and by how the matches before it went
// (the losing run it follows). Game number and streak run over every match of the session the caller
// passes, whatever the page's filters; only the matches `counts` keeps land in buckets. The server
// sends the counts; the bucket maths and the verdict are shared so the web reads them the same way.
import { sum } from "./aggregate";
import type { WL } from "./clutch";
import type { Result } from "./result";

/** Standard errors below the rest of your matches for a tilt bucket to count as a drop. Four buckets
 *  are checked per view: at 2 a view with no real tilt would cry tilt ~1 time in 11, at 2.5 ~1 in 40. */
export const TILT_Z = 2.5;
/** Matches every tilt bucket needs before a firm "no sign": at 60 a ~18-point drop would show, at 30
 *  only a ~24-point one. Also the fewest matches in all before any verdict past "too few". */
export const FIRM_N = 60;
/** Below this many matches a bucket can't say anything, and is never coloured. */
export const MIN_N = 10;

export const GAME_KEYS = ["g1", "g4", "g7", "g10"] as const;
export const STREAK_KEYS = ["w", "l1", "l2", "l3"] as const;
type GameKey = (typeof GAME_KEYS)[number];
type StreakKey = (typeof STREAK_KEYS)[number];
export type BucketKey = GameKey | StreakKey;
/** The buckets that can show tilt: late in a session and after a losing run. */
export const TILT_KEYS: readonly BucketKey[] = ["g7", "g10", "l2", "l3"];

type Four = [WL, WL, WL, WL];

/** What the server sends: wins and losses per bucket, and how sessions ended. */
export interface TiltCounts {
  games: Four;
  streaks: Four;
  /** Ended sessions with a decided match. */
  sessions: number;
  /** Of those, the ones whose last decided match was a loss. */
  endedOnLoss: number;
}

/** The run of same results so far in a session. */
export interface Run {
  result: Result;
  n: number;
}

/** A session game number (from 1) to its bucket: 1–3, 4–6, 7–9, 10+. */
export function gameBucket(n: number): GameKey {
  return n <= 3 ? "g1" : n <= 6 ? "g4" : n <= 9 ? "g7" : "g10";
}

/** The run of same results just before a match to its bucket; null for the session's first decided match. */
export function streakBucket(run: Run | null): StreakKey | null {
  if (run === null) return null;
  if (run.result === "win") return "w";
  return run.n === 1 ? "l1" : run.n === 2 ? "l2" : "l3";
}

const add = (r: WL, result: Result) => {
  if (result === "win") r.w++;
  else r.l++;
};

/**
 * Each session's matches in start order. A match with no result keeps its game number but lands in
 * no bucket and neither extends nor breaks the run; `noResult` counts the kept ones (for the log).
 */
export function tiltCounts<M extends { result: Result | null }>(
  sessions: readonly { matches: readonly M[]; ended: boolean }[],
  counts: (m: M) => boolean,
): { counts: TiltCounts; noResult: number } {
  const by = Object.fromEntries([...GAME_KEYS, ...STREAK_KEYS].map((k) => [k, { w: 0, l: 0 }])) as Record<BucketKey, WL>;
  let ended = 0;
  let endedOnLoss = 0;
  let noResult = 0;
  for (const s of sessions) {
    // Cast, not annotated: an annotated `= null` narrows to null and TS loses the loop's assignments.
    let run = null as Run | null;
    for (const [i, m] of s.matches.entries()) {
      const kept = counts(m);
      if (m.result === null) {
        if (kept) noResult++;
        continue;
      }
      if (kept) {
        add(by[gameBucket(i + 1)], m.result);
        const streak = streakBucket(run);
        if (streak) add(by[streak], m.result);
      }
      run = run?.result === m.result ? { result: m.result, n: run.n + 1 } : { result: m.result, n: 1 };
    }
    if (s.ended && run !== null) {
      ended++;
      if (run.result === "loss") endedOnLoss++;
    }
  }
  return { counts: { games: [by.g1, by.g4, by.g7, by.g10], streaks: [by.w, by.l1, by.l2, by.l3], sessions: ended, endedOnLoss }, noResult };
}

/** Wilson 95% interval as [lo, hi]: sane for small counts and at 0% or 100%; the whole range with no matches. */
export function wilson(w: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

export interface TiltBucket {
  key: BucketKey;
  w: number;
  n: number;
  rate: number;
  lo: number;
  hi: number;
  /** Win rate of the other matches in the same chart. */
  restRate: number;
  /** Standard errors from the rest, on the pooled rate; 0 when either side is empty. */
  z: number;
}

export interface TiltBuckets {
  games: TiltBucket[];
  streaks: TiltBucket[];
  /** Counted matches and their wins (the game buckets hold every one). */
  n: number;
  w: number;
}

const played = (r: WL) => r.w + r.l;

function bucketsOf(keys: readonly BucketKey[], rows: readonly WL[]): TiltBucket[] {
  const totalW = sum(rows.map((r) => r.w));
  const totalN = sum(rows.map(played));
  const pool = totalN ? totalW / totalN : 0;
  return rows.map((r, i) => {
    const key = keys[i] ?? GAME_KEYS[0]; // never the fallback: keys and rows are both four long
    const n = played(r);
    const rn = totalN - n;
    const rate = n ? r.w / n : 0;
    const restRate = rn ? (totalW - r.w) / rn : rate;
    const se = Math.sqrt(pool * (1 - pool) * (1 / Math.max(1, n) + 1 / Math.max(1, rn)));
    const [lo, hi] = wilson(r.w, n);
    return { key, w: r.w, n, rate, lo, hi, restRate, z: n && rn && se ? (rate - restRate) / se : 0 };
  });
}

/** Game buckets compare against every counted match; streak buckets against those with a decided match before them. */
export function tiltBuckets(c: TiltCounts): TiltBuckets {
  return {
    games: bucketsOf(GAME_KEYS, c.games),
    streaks: bucketsOf(STREAK_KEYS, c.streaks),
    n: sum(c.games.map(played)),
    w: sum(c.games.map((r) => r.w)),
  };
}

export type TiltState = "tilt" | "nosign" | "sofar" | "few";

/** `bucket`: the dip a "tilt" names, or the thinnest tilt bucket for "few" and "sofar". */
export type TiltVerdict = { state: "nosign"; bucket: null } | { state: Exclude<TiltState, "nosign">; bucket: TiltBucket };

/** Judged on the four tilt buckets; the worst dip is the one named. */
export function tiltVerdict(b: TiltBuckets): TiltVerdict {
  const tilt = [...b.games, ...b.streaks].filter((x) => TILT_KEYS.includes(x.key));
  const thinnest = tilt.reduce((a, x) => (x.n < a.n ? x : a));
  if (b.n < FIRM_N || thinnest.n < MIN_N) return { state: "few", bucket: thinnest };
  const dip = tilt.filter((x) => x.z <= -TILT_Z).sort((x, y) => x.z - y.z)[0];
  if (dip) return { state: "tilt", bucket: dip };
  if (thinnest.n >= FIRM_N) return { state: "nosign", bucket: null };
  return { state: "sofar", bucket: thinnest };
}

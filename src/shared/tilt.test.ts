import { describe, expect, test } from "vitest";
import type { Result } from "./result";
import { gameBucket, streakBucket, tiltBuckets, tiltCounts, tiltVerdict, wilson, type TiltCounts } from "./tilt";

describe("gameBucket", () => {
  test("1–3, 4–6, 7–9, then 10 and up", () => {
    expect([1, 3, 4, 6, 7, 9, 10, 25].map(gameBucket)).toEqual(["g1", "g1", "g4", "g4", "g7", "g7", "g10", "g10"]);
  });
});

describe("streakBucket", () => {
  test("none before the first decided match, then after a win or 1, 2, 3+ losses", () => {
    expect(streakBucket(null)).toBeNull();
    expect(streakBucket({ result: "win", n: 4 })).toBe("w");
    expect(streakBucket({ result: "loss", n: 1 })).toBe("l1");
    expect(streakBucket({ result: "loss", n: 2 })).toBe("l2");
    expect(streakBucket({ result: "loss", n: 3 })).toBe("l3");
    expect(streakBucket({ result: "loss", n: 7 })).toBe("l3");
  });
});

interface M { result: Result | null; c: boolean }
const W: M = { result: "win", c: true };
const L: M = { result: "loss", c: true };
const N: M = { result: null, c: true };
/** Decided but filtered out: still numbers and streaks, lands in no bucket. */
const wOut: M = { result: "win", c: false };
const lOut: M = { result: "loss", c: false };
const run = (sessions: { matches: M[]; ended?: boolean }[]) => tiltCounts(sessions.map((s) => ({ matches: s.matches, ended: s.ended ?? true })), (m) => m.c);
const wl = (w: number, l: number) => ({ w, l });
const ZERO = wl(0, 0);

describe("tiltCounts", () => {
  test("game number buckets count every decided counted match", () => {
    const { counts } = run([{ matches: [W, L, W, L, L, W, W, W, L, L, W] }]);
    expect(counts.games).toEqual([wl(2, 1), wl(1, 2), wl(2, 1), wl(1, 1)]);
  });

  test("each match after the first lands in one streak bucket; a win resets the run", () => {
    // W L L L L W L: after-win ×2 (L, L), after 1 loss (L), after 2 (L), after 3+ (L, W).
    const { counts } = run([{ matches: [W, L, L, L, L, W, L] }]);
    expect(counts.streaks).toEqual([wl(0, 2), wl(0, 1), wl(0, 1), wl(1, 1)]);
  });

  test("a no-result match keeps its game number but neither extends nor breaks the streak", () => {
    // L N L L: the second L is game 3 and comes after 1 loss (N skipped); the third is game 4, after 2.
    const { counts, noResult } = run([{ matches: [L, N, L, L] }]);
    expect(counts.games).toEqual([wl(0, 2), wl(0, 1), ZERO, ZERO]);
    expect(counts.streaks).toEqual([ZERO, wl(0, 1), wl(0, 1), ZERO]);
    expect(noResult).toBe(1);
  });

  test("a filtered-out match still advances the game number and the streak", () => {
    const { counts } = run([{ matches: [lOut, lOut, wOut, L] }]);
    expect(counts.games).toEqual([ZERO, wl(0, 1), ZERO, ZERO]);
    expect(counts.streaks).toEqual([wl(0, 1), ZERO, ZERO, ZERO]);
  });

  test("streaks start over in each session", () => {
    const { counts } = run([{ matches: [L, L] }, { matches: [L] }]);
    expect(counts.streaks).toEqual([ZERO, wl(0, 1), ZERO, ZERO]);
    expect(counts.games[0]).toEqual(wl(0, 3));
  });

  test("ended on a loss: by each session's last decided match, any filter; the unended session and one with no decided match left out", () => {
    const { counts } = run([
      { matches: [W, lOut] },
      { matches: [L, wOut, N] },
      { matches: [N] },
      { matches: [L], ended: false },
    ]);
    expect(counts.sessions).toBe(2);
    expect(counts.endedOnLoss).toBe(1);
  });
});

describe("wilson", () => {
  test("no matches gives the whole range", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
  test("0 of 10 and 10 of 10 stay inside 0–100% and aren't zero-width", () => {
    const [lo0, hi0] = wilson(0, 10);
    expect(lo0).toBe(0);
    expect(hi0).toBeCloseTo(0.2775, 3);
    const [lo1, hi1] = wilson(10, 10);
    expect(lo1).toBeCloseTo(0.7225, 3);
    expect(hi1).toBe(1);
  });
  test("5 of 10 is about 24–76%", () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
  });
});

/** Counts from [won, played] pairs, as the prototype's demo slides wrote them. */
const pairs = (games: [number, number][], streaks: [number, number][]): TiltCounts => ({
  games: games.map(([w, n]) => wl(w, n - w)) as TiltCounts["games"],
  streaks: streaks.map(([w, n]) => wl(w, n - w)) as TiltCounts["streaks"],
  sessions: 0,
  endedOnLoss: 0,
});
const verdictOf = (c: TiltCounts) => tiltVerdict(tiltBuckets(c));

describe("tiltBuckets", () => {
  test("game buckets against all counted matches, streak buckets against those with a match before", () => {
    const b = tiltBuckets(pairs([[52, 90], [46, 82], [38, 77], [38, 106]], [[90, 164], [44, 85], [17, 40], [11, 38]]));
    expect(b.n).toBe(355);
    expect(b.w).toBe(174);
    const g10 = b.games[3];
    expect(g10?.key).toBe("g10");
    expect(g10?.rate).toBeCloseTo(38 / 106, 6);
    expect(g10?.restRate).toBeCloseTo(136 / 249, 6);
    // Pooled 174/355: se = √(p(1−p)(1/106 + 1/249)) ≈ 0.0580, z ≈ −3.24.
    expect(g10?.z).toBeCloseTo(-3.24, 1);
    const l3 = b.streaks[3];
    expect(l3?.restRate).toBeCloseTo(151 / 289, 6);
    expect(l3?.z).toBeCloseTo(-2.7, 1);
  });

  test("an empty bucket has rate 0, the whole range and z 0", () => {
    const b = tiltBuckets(pairs([[5, 10], [0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]]));
    expect(b.games[1]).toMatchObject({ n: 0, rate: 0, lo: 0, hi: 1, z: 0 });
  });
});

describe("tiltVerdict", () => {
  test("a dip past 2.5 SE names the worst of the tilt buckets that pass", () => {
    // g10 (z ≈ −3.24) and 3+ losses (z ≈ −2.70) both pass; g10 is worse.
    const v = verdictOf(pairs([[52, 90], [46, 82], [38, 77], [38, 106]], [[90, 164], [44, 85], [17, 40], [11, 38]]));
    expect(v.state).toBe("tilt");
    expect(v.bucket?.key).toBe("g10");
  });

  test("no clear sign once every tilt bucket has 60+", () => {
    const v = verdictOf(pairs([[45, 90], [41, 82], [37, 77], [52, 106]], [[72, 150], [40, 82], [31, 64], [29, 61]]));
    expect(v).toEqual({ state: "nosign", bucket: null });
  });

  test("no sign so far names the thinnest tilt bucket", () => {
    const v = verdictOf(pairs([[28, 54], [27, 55], [30, 50], [22, 45]], [[52, 103], [26, 48], [12, 22], [9, 13]]));
    expect(v.state).toBe("sofar");
    expect(v.bucket?.key).toBe("l3");
  });

  test("too few when a tilt bucket is under 10, even with 60 in all", () => {
    const v = verdictOf(pairs([[7, 18], [3, 9], [2, 9], [9, 24]], [[6, 19], [5, 13], [1, 6], [4, 14]]));
    expect(v.state).toBe("few");
    expect(v.bucket?.key).toBe("l2");
  });

  test("too few under 60 counted matches, even with every tilt bucket at 10", () => {
    const streaks: [number, number][] = [[10, 20], [5, 10], [5, 10], [5, 10]];
    expect(verdictOf(pairs([[10, 20], [10, 19], [5, 10], [5, 10]], streaks)).state).toBe("few");
    expect(verdictOf(pairs([[10, 21], [10, 19], [5, 10], [5, 10]], streaks)).state).toBe("sofar");
  });
});

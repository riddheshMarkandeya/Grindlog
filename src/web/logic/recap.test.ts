import { describe, expect, test } from "vitest";
import type { AggregateWire, MatchDetail, MyMatchWire } from "../../shared/schemas/responses";
import {
  extrasCards,
  flagLines,
  flagShort,
  highlights,
  isDense,
  letter,
  matchLabel,
  perGameCards,
  playlistRows,
  recapPath,
  resultWord,
  scoreboardTeams,
  scoreFor,
  stoodOut,
  stoodOutNote,
  tilesFor,
  vsAverage,
  vsAvgText,
  winPctDelta,
  winPctVs,
} from "./recap";

const KMH = { clock: "24h", speed: "kmh" } as const;
import { clock } from "./format";

const agg = (over: Partial<AggregateWire>): AggregateWire => ({
  matches: 4, wins: 3, losses: 1, noResult: 0, winPct: 0.75, leftEarly: 0, mvps: 2,
  totals: { goals: 4, assists: 1, saves: 3, shots: 10, demos: 0, score: 1600 },
  perGame: { goals: 1, assists: 0.25, saves: 0.75, shots: 2.5, demos: 0, score: 400 },
  shootingPct: 0.4, bestWinStreak: 3, bestLossStreak: 1, endedOn: { result: "win", length: 2 },
  extrasMatches: 0, hardestShotKmh: null, fastestGoalKmh: null, woodworkHits: null, aerialTouches: null, boostAvg: null, supersonicShare: null, emptyBoostShare: null,
  statfeed: {},
  ...over,
});
const none = agg({ matches: 0, wins: null, losses: null, winPct: null, mvps: null, shootingPct: null, bestWinStreak: null, bestLossStreak: null, endedOn: null });

describe("vsAvgText", () => {
  test("up or down: the amount, then the average it's against", () => {
    expect(vsAvgText("up", "5 pts", "52%")).toEqual({ dir: "up", amount: "5 pts", rest: "vs 30-day avg (52%)" });
    expect(vsAvgText("down", "12%", "3.2")).toEqual({ dir: "down", amount: "12%", rest: "vs 30-day avg (3.2)" });
  });
  test("same: no amount; the ≈ is drawn by the caller", () => {
    expect(vsAvgText("same", "0 pts", "40%")).toEqual({ dir: "same", amount: null, rest: "30-day avg (40%)" });
    // A per-game stat under 3% off is "same", so it shows no amount either.
    const vs = vsAverage(1.024, 1);
    expect(vs && vsAvgText(vs.dir, `${String(Math.abs(vs.pct))}%`, "1").amount).toBeNull();
  });
});

describe("winPctVs", () => {
  test("points against the 30-day win %, either way, or level with it", () => {
    expect(winPctVs(agg({ winPct: 0.57 }), agg({ winPct: 0.52 }))).toEqual({ dir: "up", amount: "5 pts", rest: "vs 30-day avg (52%)" });
    expect(winPctVs(agg({ winPct: 0.4 }), agg({ winPct: 0.523 }))).toEqual({ dir: "down", amount: "12 pts", rest: "vs 30-day avg (52%)" });
    expect(winPctVs(agg({ winPct: 0.52 }), agg({ winPct: 0.521 }))).toEqual({ dir: "same", amount: null, rest: "30-day avg (52%)" });
  });
  test("nothing to compare: null", () => {
    expect(winPctVs(agg({}), none)).toBeNull();
  });
});

describe("winPctDelta", () => {
  test("points against the 30-day win %", () => {
    expect(winPctDelta(agg({}), agg({ winPct: 0.5 }))).toEqual({ points: 25, avg: 50 });
    expect(winPctDelta(agg({ winPct: 0.4 }), agg({ winPct: 0.523 }))).toEqual({ points: -12, avg: 52 });
  });

  test("nothing to compare: no baseline matches, or no decided match", () => {
    expect(winPctDelta(agg({}), none)).toBeNull();
    expect(winPctDelta(agg({ winPct: null }), agg({}))).toBeNull();
  });
});

test("a result's letter and word, a dash for no result", () => {
  expect([letter("win"), letter("loss"), letter(null)]).toEqual(["W", "L", "–"]);
  expect([resultWord("win"), resultWord("loss"), resultWord(null)]).toEqual(["win", "loss", "no result"]);
});

describe("tilesFor", () => {
  test("streak, finished on, shooting against the average, your MVPs", () => {
    expect(tilesFor(agg({}), agg({ shootingPct: 0.3 }))).toEqual([
      { id: "streak", label: "Best win streak", value: "3", icon: "streak" },
      { id: "ended", label: "Finished on", value: "2 wins" },
      { id: "shooting", label: "Shooting %", value: "40%", icon: "shooting", vs: { avg: "30%", dir: "up", points: 10 } },
      { id: "mvps", label: "MVPs", value: "×2", icon: "mvp" },
    ]);
  });

  test("a tile with nothing to show is left out, never a zero", () => {
    expect(tilesFor(agg({ bestWinStreak: 0, mvps: 0, shootingPct: null, endedOn: { result: "loss", length: 4 } }), none)).toEqual([{ id: "ended", label: "Finished on", value: "4 losses" }]);
    expect(tilesFor(agg({ endedOn: { result: "loss", length: 1 } }), none).find((t) => t.id === "ended")?.value).toBe("1 loss");
    expect(tilesFor(agg({ endedOn: { result: "win", length: 1 } }), none).find((t) => t.id === "ended")?.value).toBe("1 win");
    expect(tilesFor(none, none)).toEqual([]);
  });

  test("shooting without a baseline has no comparison; level with it is 'same'", () => {
    expect(tilesFor(agg({}), none).find((t) => t.id === "shooting")).toEqual({ id: "shooting", label: "Shooting %", value: "40%", icon: "shooting" });
    expect(tilesFor(agg({}), agg({ shootingPct: 0.401 })).find((t) => t.id === "shooting")?.vs).toEqual({ avg: "40%", dir: "same", points: 0 });
    expect(tilesFor(agg({}), agg({ shootingPct: 0.45 })).find((t) => t.id === "shooting")?.vs).toEqual({ avg: "45%", dir: "down", points: -5 });
  });
});

describe("scoreFor", () => {
  const m = (teamNum: number | null, s0: number | null, s1: number | null) => ({ scoreTeam0: s0, scoreTeam1: s1, me: teamNum === null ? null : { teamNum } }) as unknown as MyMatchWire;
  test("your team first", () => {
    expect(scoreFor(m(0, 3, 1))).toBe("3–1");
    expect(scoreFor(m(1, 3, 1))).toBe("1–3");
  });
  test("team 0 first when your team is unknown; nothing without a score", () => {
    expect(scoreFor(m(null, 2, 4))).toBe("2–4");
    expect(scoreFor(m(0, null, null))).toBeNull();
  });
});

test("match cards get dense above 24 matches", () => {
  expect(isDense(24)).toBe(false);
  expect(isDense(25)).toBe(true);
});

test("a session's path carries the filter only when it isn't the default", () => {
  expect(recapPath("ABC", "everything")).toBe("/recap/ABC?filter=everything");
  expect(recapPath("ABC", { playlist: 53 })).toBe("/recap/ABC?filter=53");
  expect(recapPath(null, "ranked")).toBe("/recap?filter=ranked");
});

test("the teammate filter rides along encoded, left out for anyone", () => {
  const sam = { friends: ["Epic|sam|0"] };
  expect(recapPath("ABC", "everything", "overview", sam)).toBe("/recap/ABC?filter=everything&with=Epic%7Csam%7C0");
  expect(recapPath("ABC", "ranked", { match: "G" }, "solo")).toBe("/recap/ABC/match/G?filter=ranked&with=solo");
  expect(recapPath(null, "ranked", "overview", "anyone")).toBe("/recap?filter=ranked");
});

test("the matches page and a match's page, under the same filter", () => {
  expect(recapPath("ABC", "everything", "matches")).toBe("/recap/ABC/matches?filter=everything");
  expect(recapPath("ABC", "ranked", { match: "G/1 2" })).toBe("/recap/ABC/match/G%2F1%202?filter=ranked");
  expect(recapPath("ABC", "everything", "overview")).toBe("/recap/ABC?filter=everything");
});

describe("flagLines", () => {
  test("a leave says how it was counted: a loss with no winner, a win the score had decided", () => {
    expect(flagLines(["left"], "loss")).toEqual(["You left before the end — counted as a loss."]);
    expect(flagLines(["left", "winner_decided"], "win")).toEqual(["You left before the end — counted as a win, which the score had already decided."]);
  });

  test("a lost ending: counted by the result, or no result after a restart", () => {
    expect(flagLines(["lost_ending"], "loss")).toEqual(["The tracker lost this match's ending — counted as a loss."]);
    expect(flagLines(["lost_ending"], null)).toEqual(["The tracker lost this match's ending, so there's no result."]);
  });

  test("with no result, a leave can't say the score decided it, so the decided winner gets its own line", () => {
    expect(flagLines(["left", "winner_decided"], null)).toEqual([
      "You left before the end.",
      "The game didn't report a winner — it was taken from the score, which had already decided it.",
    ]);
  });

  test("a decided winner on its own gets its own line", () => {
    expect(flagLines(["winner_decided"], "win")).toEqual(["The game didn't report a winner — it was taken from the score, which had already decided it."]);
  });

  test("one line per other reason, in order", () => {
    expect(flagLines(["joined", "mvp_inferred", "check_failed"], "win")).toEqual([
      "You joined in progress — counted as a full game.",
      "MVP inferred: no MVP award fired, so it went to the top score on the winning team.",
      "A data check failed on this match, so some numbers may be off.",
    ]);
    expect(flagLines([], "win")).toEqual([]);
  });
});

test("flagShort: the reasons in a few words, null when not flagged", () => {
  expect(flagShort(["left", "winner_decided", "mvp_inferred"])).toBe("flagged: you left early, winner taken from the score, MVP inferred");
  expect(flagShort(["lost_ending", "joined", "check_failed"])).toBe("flagged: ending not recorded, joined in progress, a data check failed");
  expect(flagShort([])).toBeNull();
});

test("matchLabel: number, time, result, score, playlist, then MVP and flags when they apply", () => {
  const m = { startedAt: 1_700_000_000_000, result: "win", playlistId: 11, me: { playerKey: "me", teamNum: 1 }, mvpKey: "me", flags: ["mvp_inferred"], scoreTeam0: 1, scoreTeam1: 3 } as unknown as MyMatchWire;
  const t = clock(m.startedAt, "24h");
  expect(matchLabel(m, 2, "24h")).toBe(`Match 2, ${t}, win, 3–1, Ranked Doubles, MVP, flagged: MVP inferred`);
  expect(matchLabel({ ...m, mvpKey: "other", flags: [], result: null, scoreTeam0: null }, 1, "24h")).toBe(`Match 1, ${t}, no result, Ranked Doubles`);
  expect(matchLabel(m, 2, "12h")).toContain(clock(m.startedAt, "12h"));
});

describe("scoreboardTeams", () => {
  type P = MatchDetail["players"][number];
  const p = (name: string, teamNum: number | null, score: number): P => ({ name, teamNum, score, isMe: false }) as P;
  test("your team first, then the opponents, each by score", () => {
    const teams = scoreboardTeams([p("a", 0, 100), p("b", 1, 300), p("c", 1, 500), p("d", 0, 400)], 1);
    expect(teams.map((t) => [t.side, t.players.map((x) => x.name)])).toEqual([
      ["yours", ["c", "b"]],
      ["opponents", ["d", "a"]],
    ]);
  });

  test("a player with no team is set apart; an empty team is left out", () => {
    const teams = scoreboardTeams([p("a", 0, 100), p("x", null, 50)], 0);
    expect(teams.map((t) => [t.side, t.players.map((x) => x.name)])).toEqual([
      ["yours", ["a"]],
      ["unknown", ["x"]],
    ]);
  });

  test("with no team for you, blue then orange", () => {
    const teams = scoreboardTeams([p("o", 1, 10), p("b", 0, 20)], null);
    expect(teams.map((t) => [t.side, t.teamNum])).toEqual([
      ["blue", 0],
      ["orange", 1],
    ]);
  });
});

describe("vsAverage", () => {
  test("whole-percent change with its direction", () => {
    expect(vsAverage(1.4, 1.04)).toEqual({ pct: 35, dir: "up" });
    expect(vsAverage(0.72, 1)).toEqual({ pct: -28, dir: "down" });
  });
  test("under 3% either way is 'same'; 3% is not", () => {
    expect(vsAverage(1.029, 1)).toEqual({ pct: 3, dir: "up" });
    expect(vsAverage(1.024, 1)).toEqual({ pct: 2, dir: "same" });
    expect(vsAverage(0.976, 1)).toEqual({ pct: -2, dir: "same" });
  });
  test("no fair ratio without an average or with a zero one", () => {
    expect(vsAverage(1, null)).toBeNull();
    expect(vsAverage(1, 0)).toBeNull();
  });
});

describe("perGameCards", () => {
  const base = agg({ perGame: { goals: 0.8, assists: 0.25, saves: 1.5, shots: 2.5, demos: 0, score: 400 } });
  test("the six stats in order, per game and total, against the average", () => {
    expect(perGameCards(agg({}), base)).toEqual([
      { id: "score", label: "Score", icon: "score", perGame: 400, total: 1600, avg: 400, vs: { pct: 0, dir: "same" } },
      { id: "goals", label: "Goals", icon: "goal", perGame: 1, total: 4, avg: 0.8, vs: { pct: 25, dir: "up" } },
      { id: "assists", label: "Assists", icon: "assist", perGame: 0.25, total: 1, avg: 0.25, vs: { pct: 0, dir: "same" } },
      { id: "saves", label: "Saves", icon: "save", perGame: 0.75, total: 3, avg: 1.5, vs: { pct: -50, dir: "down" } },
      { id: "shots", label: "Shots", icon: "shot", perGame: 2.5, total: 10, avg: 2.5, vs: { pct: 0, dir: "same" } },
      { id: "demos", label: "Demos", icon: "demo", perGame: 0, total: 0, avg: 0, vs: null },
    ]);
  });
  test("no baseline: no comparison; a stat with no value is left out", () => {
    expect(perGameCards(agg({}), none).every((c) => c.vs === null)).toBe(true);
    const nulls = { goals: null, assists: null, saves: null, shots: null, demos: null, score: null };
    expect(perGameCards(agg({ perGame: nulls, totals: nulls }), base)).toEqual([]);
  });
});

describe("stoodOut", () => {
  const base = agg({ perGame: { goals: 1, assists: 1, saves: 1, shots: 1, demos: 0, score: 400 } });
  const at = (over: Partial<AggregateWire["perGame"]>) => agg({ perGame: { goals: 1, assists: 1, saves: 1, shots: 1, demos: 2, score: 400, ...over } });
  test("no baseline: the panel is hidden", () => {
    expect(stoodOut(agg({}), none)).toBeNull();
  });
  test("10% either way on the shown percent; 9% is close to average", () => {
    expect(stoodOut(at({ goals: 1.096, saves: 0.904 }), base)?.map((s) => [s.id, s.vs.pct])).toEqual([["goals", 10], ["saves", -10]]);
    expect(stoodOut(at({ goals: 1.094, saves: 0.906 }), base)).toEqual([]);
  });
  test("biggest first, at most three; a zero average is skipped", () => {
    const out = stoodOut(at({ goals: 1.2, assists: 0.5, saves: 1.3, shots: 1.15, score: 500 }), base);
    expect(out?.map((s) => s.id)).toEqual(["assists", "saves", "score"]);
    expect(out?.[0]).toEqual({ id: "assists", label: "Assists", icon: "assist", perGame: 0.5, avg: 1, vs: { pct: -50, dir: "down" } });
  });
});

describe("stoodOutNote", () => {
  test("its rank by size, the change, and the rule", () => {
    expect(stoodOutNote(0, { pct: 79, dir: "up" })).toBe("Your biggest change from your 30-day average this session: up 79%. Up to 3 stats 10% or more off average are marked.");
    expect(stoodOutNote(1, { pct: -12, dir: "down" })).toBe("Your 2nd-biggest change from your 30-day average this session: down 12%. Up to 3 stats 10% or more off average are marked.");
    expect(stoodOutNote(2, { pct: 10, dir: "up" })).toMatch(/^Your 3rd-biggest change .*: up 10%\./);
  });
});

describe("playlistRows", () => {
  test("one row per playlist, named; win % null without a decided match", () => {
    expect(playlistRows([
      { playlistId: 11, aggregate: agg({ wins: 3, losses: 1, winPct: 0.75, perGame: { ...agg({}).perGame, goals: 1.25 } }) },
      { playlistId: null, aggregate: agg({ wins: 0, losses: 0, winPct: null }) },
    ])).toEqual([
      { playlistId: 11, name: "Ranked Doubles", wins: 3, losses: 1, winPct: 75 },
      { playlistId: null, name: "Unknown playlist", wins: 0, losses: 0, winPct: null },
    ]);
  });
  test("an empty aggregate's null record stays null, not a made-up 0–0", () => {
    expect(playlistRows([{ playlistId: 11, aggregate: agg({}) }, { playlistId: 13, aggregate: none }])?.[1]).toMatchObject({ wins: null, losses: null });
  });
  test("one playlist: nothing to break down", () => {
    expect(playlistRows([{ playlistId: 11, aggregate: agg({}) }])).toBeNull();
  });
});

describe("extrasCards", () => {
  const extras = { extrasMatches: 3, hardestShotKmh: 131.46, fastestGoalKmh: 98.7, woodworkHits: 0, aerialTouches: 12, boostAvg: 41.6, supersonicShare: 0.123, emptyBoostShare: 0.087 };
  type MeOver = Partial<NonNullable<MyMatchWire["me"]>>;
  const match = (me: MeOver | null, goals: MyMatchWire["goals"] = []) =>
    ({ me: me === null ? null : { woodworkHits: 0, hardestShotKmh: 80, ...me }, goals }) as unknown as MyMatchWire;
  const second = match({ hardestShotKmh: 131.46 }, [{ speedKmh: 98.7, ownGoal: false }]);
  const three = [match({}), second, match({ hardestShotKmh: 131.46 })];

  test("in the map's order; a measured zero is kept; 'match N' with more than one match", () => {
    expect(extrasCards(agg(extras), three, KMH)).toEqual([
      { id: "hardest", label: "Hardest shot", value: "131", unit: "km/h", sub: "match 2", icon: "hardest" },
      { id: "fastest", label: "Fastest goal", value: "98.7", unit: "km/h", sub: "match 2", icon: "fastest" },
      { id: "woodwork", label: "Crossbar hits", value: "0", unit: null, sub: null, icon: "crossbar" },
      { id: "boost", label: "Avg boost", value: "42", unit: null, sub: "your car", icon: "boost" },
      { id: "supersonic", label: "Supersonic", value: "12", unit: "%", sub: "of time played", icon: "supersonic" },
      { id: "empty", label: "Empty tank", value: "9", unit: "%", sub: "time on 0 boost", icon: "empty" },
      { id: "aerial", label: "Aerial touches", value: "12", unit: null, sub: "yours, in the air", icon: "aerial" },
    ]);
  });

  test("speeds in the speed setting's unit", () => {
    const [hardest, fastest] = extrasCards(agg(extras), three, { ...KMH, speed: "mph" });
    expect([hardest?.value, hardest?.unit, fastest?.value, fastest?.unit]).toEqual(["81.69", "mph", "61.33", "mph"]);
  });

  test("a null value is left out; no extras at all is []", () => {
    const ids = extrasCards(agg({ ...extras, fastestGoalKmh: null, boostAvg: null, supersonicShare: null, emptyBoostShare: null }), three, KMH).map((c) => c.id);
    expect(ids).toEqual(["hardest", "woodwork", "aerial"]);
    expect(extrasCards(agg({}), three, KMH)).toEqual([]);
  });

  test("no 'match N' for a single match", () => {
    expect(extrasCards(agg(extras), [second], KMH)[0]?.sub).toBeNull();
  });

  test("'match N' looks only at matches with extras; own goals don't count as fastest", () => {
    const ms = [match({ hardestShotKmh: 131.46, woodworkHits: null }, [{ speedKmh: 98.7, ownGoal: false }]), match({}, [{ speedKmh: 98.7, ownGoal: true }]), match({ hardestShotKmh: 131.46 }, [{ speedKmh: 98.7, ownGoal: false }])];
    const subs = extrasCards(agg(extras), ms, KMH).slice(0, 2).map((c) => c.sub);
    expect(subs).toEqual(["match 3", "match 3"]);
  });
});

describe("highlights", () => {
  test("in a fixed order, only those that happened; unknown events ignored", () => {
    expect(highlights({ LowFive: 1, HatTrick: 2, LongGoal: 1, Goal: 9, Savior: 0, Unheard: 4 })).toEqual([
      { event: "HatTrick", label: "Hat tricks", count: 2 },
      { event: "LongGoal", label: "Long goal awards", count: 1 },
      { event: "LowFive", label: "Low fives", count: 1 },
    ]);
    expect(highlights({})).toEqual([]);
    expect(highlights({ AerialGoal: 1 })).toEqual([{ event: "AerialGoal", label: "Aerial goal awards", count: 1 }]);
  });
});

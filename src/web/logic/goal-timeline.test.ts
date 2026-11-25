import { describe, expect, test } from "vitest";
import type { MatchDetail } from "../../shared/schemas/responses";
import { countNote, pack, readOut, shortName, timelineFor } from "./goal-timeline";

type Player = MatchDetail["players"][number];
type Goal = MatchDetail["goals"][number];
type Moment = NonNullable<MatchDetail["moments"]>[number];
interface Clock {
  seconds: number;
  overtime: boolean;
}

const reg = (seconds: number): Clock => ({ seconds, overtime: false });
const ot = (seconds: number): Clock => ({ seconds, overtime: true });

const player = (name: string, teamNum: number | null, extra: Partial<Player> = {}): Player =>
  ({ playerKey: `k-${name}`, name, teamNum, isMe: false, goals: 0, assists: 0, saves: 0, shots: 0, score: 0, ...extra }) as Player;

const goal = (idx: number, scorer: string, teamNum: number, clock: Clock | null): Goal =>
  ({ idx, teamNum, scorerKey: `k-${scorer}`, scorerName: scorer, assisterKey: null, assisterName: null, ownGoal: false, clock }) as Goal;

const moment = (idx: number, kind: Moment["kind"], who: string, clock: Clock | null, goalIdx: number | null = null): Moment => ({
  idx,
  kind,
  playerKey: `k-${who}`,
  clock,
  goalIdx,
});

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("expected a value");
  return x;
}

type MatchPart = Partial<MatchDetail["match"]>;

/** A 1v1 Ranked Duel, 1–0 to you at 4:00 left, with your shot paired to the goal and an opponent's save. */
function detail(match: MatchPart = {}, rest: Partial<Omit<MatchDetail, "match">> = {}): MatchDetail {
  return {
    match: {
      guid: "G",
      startedAt: 0,
      endedAt: 1,
      playlistId: 10,
      arena: null,
      endKind: "completed",
      closedVia: "destroyed",
      joinedInProgress: false,
      overtime: false,
      scoreTeam0: 1,
      scoreTeam1: 0,
      winnerTeamNum: 0,
      mvpKey: null,
      checkFlags: [],
      regulationSeconds: 300,
      endClock: reg(0),
      ...match,
    },
    players: [player("Me", 0, { isMe: true, goals: 1, shots: 1 }), player("Opp", 1, { saves: 1 })],
    goals: [goal(0, "Me", 0, reg(240))],
    moments: [moment(0, "shot", "Me", reg(241), 0), moment(1, "save", "Opp", reg(200))],
    result: "win",
    sessionKey: null,
    ...rest,
  };
}

describe("timelineFor: hidden", () => {
  const base = detail();
  test("the base detail is shown", () => {
    expect(timelineFor(base)).not.toBeNull();
  });

  test.each<[string, MatchDetail]>([
    ["a playlist outside the timeline set (Private)", detail({ playlistId: 6 })],
    ["no playlist", detail({ playlistId: null })],
    ["joined in progress", detail({ joinedInProgress: true })],
    ["no regulation length", detail({ regulationSeconds: null })],
    ["orphaned", detail({ endKind: "orphaned" })],
    ["a forfeit with no end clock", detail({ endKind: "early_end", endClock: null })],
    ["a match you left with no end clock", detail({ endKind: "left", endClock: null })],
    ["moments not recomputed yet", detail({}, { moments: null })],
    ["a goal with no clock", detail({}, { goals: [goal(0, "Me", 0, null)] })],
    ["a moment with no clock", detail({}, { moments: [moment(0, "save", "Opp", null)] })],
    ["a player with no team", detail({}, { players: [...base.players, player("Ghost", null)] })],
    ["spectated: no player is you", detail({}, { players: [player("A", 0), player("B", 1)] })],
    ["a goal whose scorer has no row", detail({}, { goals: [goal(0, "Stranger", 0, reg(240))] })],
    ["a moment whose player has no row", detail({}, { moments: [moment(0, "save", "Stranger", reg(10))] })],
    // Its icon would sit on one side's row while the score counts it for the other.
    ["a goal credited to the scorer's opponents", detail({}, { goals: [goal(0, "Opp", 0, reg(240))] })],
  ])("%s", (_, d) => {
    expect(timelineFor(d)).toBeNull();
  });

  test.each(["forfeit_end_clocked", "moments_clocked", "moments_match_statfeed", "goals_clocked", "goals_placed", "goals_per_team_equal_score", "clock_overtime_flagged"])(
    "the check flag %s",
    (flag) => {
      expect(timelineFor(detail({ checkFlags: [flag] }))).toBeNull();
    },
  );

  test("an unrelated check flag doesn't hide it", () => {
    expect(timelineFor(detail({ checkFlags: ["statfeed_matches_scoreboard"] }))).not.toBeNull();
  });
});

describe("timelineFor: rows and marks", () => {
  // A 2v2 Ranked Doubles, 2–1 to you after overtime: you score at 4:00 left (your shot paired),
  // Opp1 at 1:23 left with no shot counted, your mate wins it 0:30 into overtime.
  const d = detail(
    { playlistId: 11, overtime: true, scoreTeam0: 2, scoreTeam1: 1, endClock: ot(31) },
    {
      players: [
        player("Opp2", 1, { score: 100 }),
        player("Mate", 0, { score: 50 }),
        player("Opp1", 1, { score: 300 }),
        player("Me", 0, { isMe: true, score: 10 }),
      ],
      goals: [goal(0, "Me", 0, reg(240)), goal(1, "Opp1", 1, reg(83)), goal(2, "Mate", 0, ot(30))],
      moments: [
        moment(0, "shot", "Me", reg(241), 0),
        moment(1, "epic_save", "Opp2", reg(44)),
        moment(2, "shot", "Opp2", reg(20)),
        moment(3, "assist", "Me", ot(30)),
        moment(4, "save", "Mate", reg(5)),
        moment(5, "shot", "Mate", ot(29), 2),
      ],
    },
  );
  const tl = must(timelineFor(d));

  test("you, then teammates, then opponents by score, each with its side", () => {
    expect(tl.rows.map((r) => [r.name, r.yours, r.isMe])).toEqual([
      ["Me", true, true],
      ["Mate", true, false],
      ["Opp1", false, false],
      ["Opp2", false, false],
    ]);
  });

  test("marks at seconds since kickoff, in time order; a shot that became a goal isn't drawn", () => {
    const marks = (name: string) => must(tl.rows.find((r) => r.name === name)).marks.map((m) => [m.kind, m.t]);
    expect(marks("Me")).toEqual([["goal", 60], ["assist", 330]]);
    expect(marks("Mate")).toEqual([["save", 295], ["goal", 330]]);
    expect(marks("Opp1")).toEqual([["goal", 217]]);
    expect(marks("Opp2")).toEqual([["epic_save", 256], ["shot", 280]]);
  });

  test("each mark's hover: clock, kind, player, and for a goal the score after it", () => {
    const titles = tl.rows.flatMap((r) => r.marks.map((m) => m.title));
    expect(titles).toEqual([
      "4:00 · Goal · Me · 1–0",
      "+0:30 · Assist · Me",
      "0:05 · Save · Mate",
      "+0:30 · Goal · Mate · 2–1",
      "1:23 · Goal · Opp1 · 1–1 · Not counted as a shot",
      "0:44 · Save (epic) · Opp2",
      "0:20 · Shot · Opp2",
    ]);
  });

  test("a goal knows whether the game counted it as a shot", () => {
    const goals = tl.rows.flatMap((r) => r.marks.filter((m) => m.kind === "goal").map((m) => [m.title.split(" · ")[2], m.countedAsShot]));
    expect(goals).toEqual([["Me", true], ["Mate", true], ["Opp1", false]]);
  });
});

describe("timelineFor: axis, stop and score", () => {
  test("a regulation match runs to its regulation length, minute ticks as the clock showed them, and no stop", () => {
    const tl = must(timelineFor(detail()));
    expect(tl.end).toBe(300);
    expect(tl.overtime).toBe(false);
    expect(tl.stop).toBeNull();
    expect(tl.ticks).toEqual([
      { t: 0, label: "5:00" },
      { t: 60, label: "4:00" },
      { t: 120, label: "3:00" },
      { t: 180, label: "2:00" },
      { t: 240, label: "1:00" },
      { t: 300, label: "0:00" },
    ]);
  });

  test("Honor Duel's 3:00 axis", () => {
    const tl = must(timelineFor(detail({ playlistId: 53, regulationSeconds: 180 }, { goals: [], moments: [] })));
    expect([tl.end, tl.ticks.map((k) => k.label)]).toEqual([180, ["3:00", "2:00", "1:00", "0:00"]]);
  });

  test("overtime runs to the end clock or the last mark, whichever is later, with a tick per overtime minute", () => {
    const winner = goal(0, "Me", 0, ot(75));
    const at = (endClock: Clock | null) => must(timelineFor(detail({ overtime: true, endClock }, { goals: [winner], moments: [] })));
    expect(at(ot(76)).end).toBe(376);
    expect(at(null).end).toBe(375);
    expect(at(ot(76)).overtime).toBe(true);
    expect(at(ot(76)).ticks.slice(-2)).toEqual([
      { t: 300, label: "0:00" },
      { t: 360, label: "+1:00" },
    ]);
  });

  test("a forfeit stops at its end clock with the clock in its label, hatching what wasn't played", () => {
    const tl = must(timelineFor(detail({ endKind: "early_end", endClock: reg(44) }, { moments: [] })));
    expect(tl.stop).toEqual({ t: 256, label: "Forfeit · 0:44", hatch: true });
    expect(tl.end).toBe(300);
  });

  test("leaving stops at the end clock; in overtime there's no fixed end to hatch up to", () => {
    expect(must(timelineFor(detail({ endKind: "left", endClock: reg(100) }, { moments: [] }))).stop).toEqual({ t: 200, label: "You left", hatch: true });
    const inOt = must(timelineFor(detail({ endKind: "left", overtime: true, endClock: ot(20) }, { moments: [] })));
    expect([inOt.stop, inOt.end]).toEqual([{ t: 320, label: "You left", hatch: false }, 320]);
  });

  test("the running score at each goal, yours first, and which side scored", () => {
    const d = detail(
      { scoreTeam0: 1, scoreTeam1: 2, winnerTeamNum: 1 },
      { goals: [goal(0, "Opp", 1, reg(250)), goal(1, "Me", 0, reg(120)), goal(2, "Opp", 1, reg(3))], moments: [] },
    );
    expect(must(timelineFor(d)).scores).toEqual([
      { t: 50, us: 0, them: 1, yours: false, title: "4:10 · Goal · Opp · 0–1 · Not counted as a shot" },
      { t: 180, us: 1, them: 1, yours: true, title: "2:00 · Goal · Me · 1–1 · Not counted as a shot" },
      { t: 297, us: 1, them: 2, yours: false, title: "0:03 · Goal · Opp · 1–2 · Not counted as a shot" },
    ]);
  });
});

describe("readOut", () => {
  test("every mark in time order, a goal before the moments at its second", () => {
    // Your teammate's goal and your assist at the same reading; your row comes first, the goal reads first.
    const d = detail(
      {},
      {
        players: [player("Me", 0, { isMe: true, assists: 1 }), player("Mate", 0, { goals: 1, shots: 1 }), player("Opp", 1, { saves: 1 })],
        goals: [goal(0, "Mate", 0, reg(150))],
        moments: [moment(0, "assist", "Me", reg(150)), moment(1, "shot", "Mate", reg(150), 0), moment(2, "save", "Opp", reg(200))],
      },
    );
    expect(readOut(must(timelineFor(d)))).toEqual(["3:20 · Save · Opp", "2:30 · Goal · Mate · 1–0", "2:30 · Assist · Me"]);
  });

  test("overtime starts before the marks at its second; a stop reads after the marks at its second", () => {
    const d = detail(
      { overtime: true, endKind: "left", endClock: ot(10) },
      { goals: [goal(0, "Me", 0, ot(0))], moments: [moment(0, "save", "Opp", ot(10))] },
    );
    expect(readOut(must(timelineFor(d)))).toEqual(["Overtime", "+0:00 · Goal · Me · 1–0 · Not counted as a shot", "+0:10 · Save · Opp", "You left"]);
  });

  test("a goal at regulation's 0:00 reads before overtime starts, an overtime mark at +0:00 after", () => {
    const d = detail(
      { overtime: true, scoreTeam1: 1, endClock: ot(5) },
      { goals: [goal(0, "Opp", 1, reg(0)), goal(1, "Me", 0, ot(0))], moments: [moment(0, "save", "Opp", ot(0))] },
    );
    expect(readOut(must(timelineFor(d)))).toEqual([
      "0:00 · Goal · Opp · 0–1 · Not counted as a shot",
      "Overtime",
      "+0:00 · Goal · Me · 1–1 · Not counted as a shot",
      "+0:00 · Save · Opp",
    ]);
  });

  test("a forfeit's stop reads with its clock", () => {
    const d = detail({ endKind: "early_end", endClock: reg(100) });
    expect(readOut(must(timelineFor(d))).at(-1)).toBe("Forfeit · 1:40");
  });
});

describe("shortName", () => {
  test("a name that fits is kept; a longer one is cut to fit with an ellipsis", () => {
    expect(shortName("Rocinante", 9)).toBe("Rocinante");
    expect(shortName("Rocinante_", 9)).toBe("Rocinant…");
  });

  test("cuts by character, never through an emoji's surrogate pair", () => {
    expect(shortName("Player😀xyz", 8)).toBe("Player😀…");
  });
});

describe("pack", () => {
  const at = (...xs: number[]) => xs.map((x) => ({ x, w: 10 }));
  test("nothing packs into no lanes", () => {
    expect(pack([], 3)).toEqual({ lanes: [], count: 0 });
  });

  test("items at least the gap apart share a lane; closer, or touching, step to the next", () => {
    // Centred items 10 wide: the first ends at 5, so the next may start at 8 (x = 13).
    expect(pack(at(0, 13), 3)).toEqual({ lanes: [0, 0], count: 1 });
    expect(pack(at(0, 12), 3)).toEqual({ lanes: [0, 1], count: 2 });
    expect(pack(at(0, 10), 3)).toEqual({ lanes: [0, 1], count: 2 });
  });

  test("equal x stacks a lane each; a later item takes the lowest lane that's free", () => {
    expect(pack(at(50, 50, 50, 80), 3)).toEqual({ lanes: [0, 1, 2, 0], count: 3 });
    expect(pack(at(0, 5, 20), 3)).toEqual({ lanes: [0, 1, 0], count: 2 });
  });

  test("widths count: a wide item pushes a narrow neighbour down", () => {
    expect(pack([{ x: 0, w: 40 }, { x: 22, w: 4 }], 3)).toEqual({ lanes: [0, 1], count: 2 });
    expect(pack([{ x: 0, w: 4 }, { x: 22, w: 4 }], 3)).toEqual({ lanes: [0, 0], count: 1 });
  });
});

describe("countNote", () => {
  const shots = (n: number) => Array.from({ length: n }, (_, i) => moment(i, "shot", "Me", reg(200)));

  test("null when every kind's recorded moments equal the scoreboard, epic saves counted as saves", () => {
    expect(countNote(detail())).toBeNull();
    const d = detail({}, { moments: [moment(0, "shot", "Me", reg(241), 0), moment(1, "epic_save", "Opp", reg(200))] });
    expect(countNote(d)).toBeNull();
  });

  test("a kind that's off names both counts", () => {
    const d = detail({}, { players: [player("Me", 0, { isMe: true, shots: 7 }), player("Opp", 1, { shots: 4 })], moments: shots(12) });
    expect(countNote(d)).toBe("The scoreboard has 11 shots; 12 shots were recorded.");
  });

  test("one of a kind reads in the singular; each kind that's off gets its sentence, shots, saves then assists", () => {
    const d = detail(
      {},
      {
        players: [player("Me", 0, { isMe: true, shots: 1, assists: 2 }), player("Opp", 1, { saves: 2 })],
        moments: [moment(0, "shot", "Me", reg(241), 0), moment(1, "save", "Opp", reg(200)), moment(2, "assist", "Me", reg(100))],
      },
    );
    expect(countNote(d)).toBe("The scoreboard has 2 saves; 1 save was recorded. The scoreboard has 2 assists; 1 assist was recorded.");
  });

  test("no moments yet: nothing to compare", () => {
    expect(countNote(detail({}, { moments: null }))).toBeNull();
  });
});

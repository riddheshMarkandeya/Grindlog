import { describe, expect, test } from "vitest";
import { buildPlay } from "./play";
import type { StoredEvent } from "./store";
import type { MatchSummary, RosterEntry } from "./summary";

let seq = 0;
const at = (ts: number, name: string, data: Record<string, unknown> = {}): StoredEvent => ({ seq: seq++, ts, name, data });

// A (team 0) and B (team 1) are the default pair; C is A's teammate.
const PEOPLE = {
  A: { Name: "A", PrimaryId: "Epic|A|0", Shortcut: 1, TeamNum: 0 },
  B: { Name: "B", PrimaryId: "Epic|B|0", Shortcut: 2, TeamNum: 1 },
  C: { Name: "C", PrimaryId: "Epic|C|0", Shortcut: 3, TeamNum: 0 },
} as const;
type Who = keyof typeof PEOPLE;
const ref = (who: Who) => {
  const { Name, Shortcut, TeamNum } = PEOPLE[who];
  return { Name, Shortcut, TeamNum };
};
const key = (who: Who) => PEOPLE[who].PrimaryId;

const summary = (over: Partial<MatchSummary> = {}): Pick<MatchSummary, "roster" | "joinedInProgress"> => ({
  roster: Object.values(PEOPLE).map((p) => ({ key: p.PrimaryId, name: p.Name, teamNum: p.TeamNum }) as RosterEntry),
  joinedInProgress: false,
  ...over,
});

interface Car {
  boost?: number;
  supersonic?: boolean;
  hasCar?: boolean;
}
/** A state with A and C carrying car state (your team) and B without; `score` is the scoreboard. */
const state = (ts: number, cars: Partial<Record<Who, Car>> = { A: {} }, game: Record<string, unknown> = {}, score: [number, number] = [0, 0]) =>
  at(ts, "UpdateState", {
    Players: (Object.keys(PEOPLE) as Who[]).map((w) => {
      const car = cars[w];
      const p: Record<string, unknown> = { ...PEOPLE[w] };
      if (car && car.hasCar !== false) p.bHasCar = true;
      if (car?.boost) p.Boost = car.boost;
      if (car?.supersonic) p.bSupersonic = true;
      return p;
    }),
    Game: { Teams: [{ TeamNum: 0, Score: score[0] }, { TeamNum: 1, Score: score[1] }], ...game },
  });
const hit = (ts: number, who: Who[], speed = 50, loc = { X: 0, Y: 0, Z: 93 }) =>
  at(ts, "BallHit", { Players: who.map(ref), Ball: { PreHitSpeed: 0, PostHitSpeed: speed, Location: loc } });
const statfeed = (ts: number, eventName: string, who: Who) => at(ts, "StatfeedEvent", { EventName: eventName, MainTarget: ref(who) });
const goal = (ts: number, scorer: Who | null, last: Who, speed = 80, assister: Who | null = null) =>
  at(ts, "GoalScored", {
    GoalSpeed: speed,
    Scorer: scorer ? ref(scorer) : { Name: "", Shortcut: 0, TeamNum: 255 },
    Assister: assister ? ref(assister) : { Name: "", Shortcut: 0, TeamNum: 255 },
    BallLastTouch: { Player: ref(last), Speed: speed },
  });
const crossbar = (ts: number, who: Who) => at(ts, "CrossbarHit", { BallLocation: { X: 0, Y: 5000, Z: 600 }, BallLastTouch: { Player: ref(who), Speed: 60 } });

/** Each car's summed weight, boost-weighted sum and supersonic weight, by player key. */
function cars(events: StoredEvent[], s = summary()) {
  const out: Record<string, { ms: number; boostMs: number; superMs: number }> = {};
  for (const c of buildPlay(events, s).samples) {
    const o = (out[c.key] ??= { ms: 0, boostMs: 0, superMs: 0 });
    o.ms += c.weightMs;
    o.boostMs += c.boost * c.weightMs;
    if (c.supersonic) o.superMs += c.weightMs;
  }
  return out;
}

describe("buildPlay: phases and car samples", () => {
  test("samples count in play only: countdown, replay, pause and the end are left out", () => {
    const events = [
      at(0, "CountdownBegin"),
      state(100, { A: { boost: 10 } }),
      at(1000, "RoundStarted"),
      state(1000, { A: { boost: 20 } }),
      state(1500, { A: { boost: 40, supersonic: true } }),
      state(2000, { A: { boost: 40 } }),
      at(2100, "MatchPaused"),
      state(2200, { A: { boost: 90 } }),
      at(2300, "MatchUnpaused"),
      state(2400, { A: { boost: 60 } }),
      state(2900, { A: { boost: 60 } }),
      goal(3000, "A", "A"),
      state(3100, { A: { boost: 99 } }, { bReplay: true }),
      at(4000, "CountdownBegin"),
      state(4100, { A: { boost: 99 } }),
      at(5000, "RoundStarted"),
      state(5000, { A: {} }),
      state(5400, { A: {} }),
      at(5500, "MatchEnded"),
      state(5600, { A: { boost: 99 } }),
    ];
    // Stretches: 1000–2000 (pause ends it, its last state weighs 0), 2400–2900 (the goal ends it), 5000–5400.
    expect(cars(events)).toEqual({ [key("A")]: { ms: 1000 + 500 + 400, boostMs: 20 * 500 + 40 * 500 + 60 * 500, superMs: 500 } });
    expect(buildPlay(events, summary()).facts.playMs).toBe(1100 + 700 + 500);
  });

  test("a gap over the cap weighs the cap; a player without a car adds nothing", () => {
    const events = [at(0, "RoundStarted"), state(0, { A: { boost: 50 }, C: { hasCar: false } }), state(3000, { A: {} }), state(3500, { A: {} })];
    expect(cars(events)).toEqual({ [key("A")]: { ms: 1000 + 500, boostMs: 50 * 1000, superMs: 0 } });
  });

  test("joined in progress starts in play", () => {
    const events = [state(0, { A: { boost: 10 } }), state(500, { A: {} })];
    expect(cars(events, summary({ joinedInProgress: true }))).toEqual({ [key("A")]: { ms: 500, boostMs: 5000, superMs: 0 } });
    expect(cars(events)).toEqual({});
  });

  test("nothing after MatchEnded counts, even a RoundStarted", () => {
    const events = [at(0, "RoundStarted"), at(10, "MatchEnded"), at(20, "RoundStarted"), state(30, { A: {} }), state(530, { A: {} }), hit(600, ["A"])];
    const play = buildPlay(events, summary());
    expect(play.samples).toEqual([]);
    expect(play.touches).toEqual({});
  });

  test("a clock stepping back gives no negative time", () => {
    const events = [at(5000, "RoundStarted"), state(5000, { A: {} }), state(4000, { A: {} }), state(4500, { A: {} }), at(4600, "MatchEnded")];
    const play = buildPlay(events, summary());
    expect(play.samples.map((s) => s.weightMs)).toEqual([0, 500]);
    expect(play.facts.playMs).toBe(0);
  });
});

const touchCount = (events: StoredEvent[]) => Object.fromEntries(Object.entries(buildPlay(events, summary()).touches).map(([k, t]) => [k, t.length]));

describe("buildPlay: hits and touches", () => {
  test("every player a hit lists is a hitter, with the hit's speed and ball location", () => {
    const events = [at(0, "RoundStarted"), hit(100, ["A", "B"], 70, { X: 1, Y: 2, Z: 3 }), statfeed(200, "Shot", "A"), statfeed(300, "Shot", "B")];
    const play = buildPlay(events, summary());
    expect(play.touches).toEqual({ [key("A")]: [{ x: 1, y: 2, z: 3, team: 0 }], [key("B")]: [{ x: 1, y: 2, z: 3, team: 1 }] });
    expect(play.hardestShot).toEqual({ [key("A")]: 70, [key("B")]: 70 });
  });

  test("a player's hits within 1 s merge into one touch unless someone else touched in between", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"]),
      hit(300, ["A"]), // merged
      hit(1100, ["A"]), // 1 s after the counted one
      hit(1200, ["B"]),
      hit(1300, ["A"]), // B touched since
      hit(1400, ["A"]), // merged
    ];
    expect(touchCount(events)).toEqual({ [key("A")]: 3, [key("B")]: 1 });
  });

  test("a touch carries the hitter's team at that hit, so a switch mid-match is framed by the new team", () => {
    const switchedState = at(1000, "UpdateState", { Players: [{ ...PEOPLE.A, TeamNum: 1 }, PEOPLE.B, PEOPLE.C], Game: {} });
    const events = [at(0, "RoundStarted"), hit(100, ["A"]), switchedState, at(2000, "BallHit", { Players: [{ ...ref("A"), TeamNum: 1 }], Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 93 } } })];
    expect(buildPlay(events, summary()).touches[key("A")]).toMatchObject([{ team: 0 }, { team: 1 }]);
  });

  test("hits outside play are ignored", () => {
    const events = [hit(0, ["A"]), at(10, "RoundStarted"), goal(20, "A", "A"), hit(30, ["A"]), at(40, "CountdownBegin"), hit(50, ["A"])];
    expect(touchCount(events)).toEqual({});
  });

  test("an unknown hitter is counted as unresolved and keeps its team", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 1 };
    const events = [at(0, "RoundStarted"), at(10, "BallHit", { Players: [stranger], Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } }), goal(20, "B", "B")];
    const play = buildPlay(events, summary());
    expect(play.facts.unresolved.hit).toBe(1);
    expect(play.touches).toEqual({});
    // Its team still makes it the goal's origin.
    expect(play.goals).toMatchObject([{ teamNum: 1, toucherKey: null, pos: { x: 0, y: 0, z: 0 }, ownGoal: false }]);
  });
});

describe("buildPlay: shots and woodwork", () => {
  test("a shot's speed is the shooter's last hit since the kickoff; a shot without one is counted", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"], 90),
      hit(200, ["B"], 40),
      statfeed(1500, "Shot", "A"), // arrives late, after B's touch
      statfeed(1600, "Shot", "C"), // C never touched
      goal(2000, "B", "B"),
      at(3000, "CountdownBegin"),
      at(4000, "RoundStarted"),
      statfeed(4100, "Shot", "A"), // A's touch was before this kickoff
    ];
    const play = buildPlay(events, summary());
    expect(play.hardestShot[key("A")]).toBe(90);
    expect(play.facts.shotsWithoutTouch).toBe(2);
  });

  test("woodwork counts once per second, in play only", () => {
    const events = [
      at(0, "RoundStarted"),
      crossbar(100, "A"),
      crossbar(600, "A"), // rolling along the bar
      crossbar(1200, "B"),
      goal(2000, "A", "A"),
      crossbar(2500, "A"), // the replay
    ];
    const play = buildPlay(events, summary());
    expect(play.woodwork).toEqual({ [key("A")]: 1, [key("B")]: 1 });
  });
});

const goalsOf = (events: StoredEvent[]) => buildPlay(events, summary()).goals;

describe("buildPlay: goals", () => {
  test("the origin is the scoring team's last touch; a later touch by the other team deflects it", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"], 95, { X: 300, Y: 1120, Z: 93 }),
      hit(200, ["B"], 60, { X: 0, Y: 4000, Z: 93 }),
      goal(300, "A", "B", 110, "C"),
    ];
    const play = buildPlay(events, summary());
    expect(play.goals).toEqual([
      {
        teamNum: 0,
        scorerKey: key("A"),
        assisterKey: key("C"),
        toucherKey: key("A"),
        pos: { x: 300, y: 1120, z: 93 },
        distance: Math.hypot(300, 4000), // 5120 − 1120
        speedKmh: 110,
        deflected: true,
        aerial: false,
        ownGoal: false,
        clock: null,
      },
    ]);
    expect(play.hardestShot[key("A")]).toBe(95);
    expect(play.facts.lastTouchDisagrees).toBe(0);
  });

  test("a 50/50 origin isn't a deflection, and its scoring-team hitter is the toucher", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["B", "A"]), goal(200, "A", "A")]);
    expect(g).toMatchObject({ toucherKey: key("A"), deflected: false, ownGoal: false });
  });

  test("team 1 attacks −Y", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["B"], 50, { X: 0, Y: -1120, Z: 93 }), goal(200, "B", "B")]);
    expect(g).toMatchObject({ teamNum: 1, distance: 4000 });
  });

  test("no touch by the scoring team since the kickoff makes an own goal", () => {
    const [g] = goalsOf([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "CountdownBegin"), at(300, "RoundStarted"), hit(400, ["B"]), goal(500, "A", "B")]);
    expect(g).toMatchObject({ teamNum: 0, toucherKey: null, pos: null, distance: null, deflected: false, ownGoal: true });
  });

  test("a goal the scoreboard credits against its scorer's team is an own goal with no point", () => {
    const events = [
      at(0, "RoundStarted"),
      state(5, {}, {}, [0, 0]),
      hit(100, ["A"], 90, { X: 0, Y: 1000, Z: 93 }),
      hit(200, ["B"], 70),
      goal(300, "B", "B"), // B put it in their own net
      state(400, {}, {}, [1, 0]),
    ];
    const play = buildPlay(events, summary());
    expect(play.goals).toMatchObject([{ teamNum: 0, scorerKey: key("B"), toucherKey: null, pos: null, distance: null, deflected: false, ownGoal: true }]);
    expect(play.hardestShot).toEqual({});
  });

  test("a goal whose scorer doesn't resolve gets no point, whatever the scoreboard says, and is counted", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const events = [
      at(0, "RoundStarted"),
      state(50, {}, {}, [0, 0]),
      hit(100, ["B"]),
      goal(200, null, "B"), // empty scorer
      state(300, {}, {}, [1, 0]),
      at(400, "RoundStarted"),
      hit(500, ["A"]),
      at(600, "GoalScored", { GoalSpeed: 80, Scorer: stranger, BallLastTouch: { Player: ref("A") } }), // not on the roster
      at(700, "RoundStarted"),
      hit(800, ["A"]),
      goal(900, "A", "A"),
    ];
    const play = buildPlay(events, summary());
    expect(play.goals).toMatchObject([{ teamNum: 0, scorerKey: key("A") }]);
    expect(play.facts.droppedGoals).toBe(2);
  });

  test("a hit's players entry that isn't an object is counted unresolved, but isn't a hitter", () => {
    const hitBy = (ts: number, players: unknown[]) => at(ts, "BallHit", { Players: players, Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } });
    const play = buildPlay([at(0, "RoundStarted"), hitBy(100, [null, ref("A")]), hitBy(150, [null]), goal(200, "A", "A")], summary());
    expect(Object.keys(play.touches)).toEqual([key("A")]);
    expect(play.facts.unresolved.hit).toBe(2);
    // A kept null entry after the origin would be a team-less hitter, i.e. a deflection.
    expect(play.goals[0]?.deflected).toBe(false);
  });

  test("a dropped goal still checks the game's last touch against the hits", () => {
    const disagrees = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, null, "B")], summary());
    expect(disagrees.facts).toMatchObject({ droppedGoals: 1, lastTouchDisagrees: 1 });
    const agrees = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, null, "A")], summary());
    expect(agrees.facts).toMatchObject({ droppedGoals: 1, lastTouchDisagrees: 0 });
  });

  test("a goal's last touch is compared only when both it and the last hit are known", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const hitBy = (ts: number, players: unknown[]) => at(ts, "BallHit", { Players: players, Ball: { PostHitSpeed: 1, Location: { X: 0, Y: 0, Z: 0 } } });
    const disagreements = (events: StoredEvent[], joinedInProgress = false) => buildPlay(events, summary({ joinedInProgress })).facts.lastTouchDisagrees;
    // Unknown: the game's last touch doesn't resolve, or is missing; the last hitter doesn't resolve,
    // or the last hit names nobody; joined in progress, no hit seen yet.
    expect(disagreements([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: stranger } })])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hit(100, ["A"]), at(200, "GoalScored", { Scorer: ref("A") })])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [stranger]), goal(200, "A", "A")])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [null]), goal(200, "A", "A")])).toBe(0);
    expect(disagreements([at(0, "RoundStarted"), hitBy(100, [ref("A"), null]), goal(200, "A", "B")])).toBe(0);
    expect(disagreements([goal(200, "A", "A")], true)).toBe(0);
    // Known: from a seen kickoff with no hit since, or joined in progress with a hit seen.
    expect(disagreements([at(0, "RoundStarted"), goal(200, "A", "A")])).toBe(1);
    expect(disagreements([hit(100, ["A"]), goal(200, "A", "B")], true)).toBe(1);
  });

  test("a reference naming a player off the roster is counted unresolved, by kind; a missing one isn't", () => {
    const stranger = { Name: "Z", Shortcut: 9, TeamNum: 0 };
    const kickoff = (ts: number, rest: StoredEvent[]) => [at(ts, "RoundStarted"), hit(ts + 100, ["A"]), ...rest];
    const events = [
      ...kickoff(0, [
        at(200, "StatfeedEvent", { EventName: "Shot", MainTarget: stranger }),
        at(250, "CrossbarHit", { BallLastTouch: { Player: stranger } }),
        at(300, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: stranger } }),
      ]),
      // Kickoffs 5 s apart, clear of the woodwork window.
      ...kickoff(5000, [
        at(5200, "StatfeedEvent", { EventName: "Shot" }),
        at(5250, "CrossbarHit", {}),
        at(5300, "GoalScored", { Scorer: ref("A") }),
      ]),
      ...kickoff(10_000, [
        at(10_200, "StatfeedEvent", { EventName: "Shot", MainTarget: "Z" }),
        at(10_250, "CrossbarHit", { BallLastTouch: { Player: "Z" } }),
        at(10_300, "GoalScored", { Scorer: ref("A"), BallLastTouch: { Player: "Z" } }),
      ]),
    ];
    const { facts } = buildPlay(events, summary());
    expect(facts.unresolved).toEqual({ hit: 0, woodwork: 1, shot: 1, lastTouch: 1 });
    expect(facts.lastTouchDisagrees).toBe(0);
  });

  test("joined in progress, a goal before the first kickoff without a scoring-team hit isn't an own goal", () => {
    const events = [hit(100, ["B"]), goal(200, "A", "B")];
    const [g] = buildPlay(events, summary({ joinedInProgress: true })).goals;
    expect(g).toMatchObject({ teamNum: 0, toucherKey: null, pos: null, ownGoal: false });
  });

  test("an AerialGoal statfeed marks the scorer's next goal aerial, once", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(100, ["A"]),
      statfeed(150, "AerialGoal", "A"),
      goal(200, "A", "A"),
      at(300, "RoundStarted"),
      hit(400, ["A"]),
      goal(500, "A", "A"),
    ];
    expect(goalsOf(events).map((g) => g.aerial)).toEqual([true, false]);
  });

  test("a last touch the hits don't show is counted", () => {
    const play = buildPlay([at(0, "RoundStarted"), hit(100, ["A"]), goal(200, "A", "C")], summary());
    expect(play.facts.lastTouchDisagrees).toBe(1);
  });
});

describe("buildPlay: a goal's team, from the scoreboard", () => {
  const score = (ts: number, s: [number, number]) => state(ts, {}, {}, s);
  const clock = (ts: number, seconds: number) => at(ts, "ClockUpdatedSeconds", { TimeSeconds: seconds, bOvertime: false });
  const teamOf = (events: StoredEvent[], joinedInProgress = false) => {
    const play = buildPlay(events, summary({ joinedInProgress }));
    return { teams: play.goals.map((g) => g.teamNum), fromScorer: play.facts.goalsTeamFromScorer };
  };

  test("the team whose score rose by 1 gets the goal, even when the step comes after it and isn't the scorer's", () => {
    const events = [score(0, [2, 0]), at(10, "RoundStarted"), hit(20, ["B"]), goal(30, "B", "B"), score(40, [3, 0]), at(100, "RoundStarted")];
    expect(teamOf(events)).toEqual({ teams: [0], fromScorer: 0 });
  });

  test("a step before the GoalScored, within the stretch, counts too", () => {
    const events = [at(0, "RoundStarted"), score(5, [0, 0]), hit(20, ["B"]), score(25, [1, 0]), goal(30, "B", "B"), at(100, "RoundStarted")];
    expect(teamOf(events)).toEqual({ teams: [0], fromScorer: 0 });
  });

  test("no scoreboard, no rise, or both teams rising falls back to the scorer's team, counted", () => {
    expect(teamOf([at(0, "RoundStarted"), hit(20, ["B"]), goal(30, "B", "B")])).toEqual({ teams: [1], fromScorer: 1 });
    expect(teamOf([at(0, "RoundStarted"), score(5, [1, 1]), goal(30, "B", "B"), score(40, [1, 1])])).toEqual({ teams: [1], fromScorer: 1 });
    expect(teamOf([at(0, "RoundStarted"), score(5, [1, 1]), goal(30, "B", "B"), score(40, [2, 2])])).toEqual({ teams: [1], fromScorer: 1 });
  });

  test("a rise of 2 falls back", () => {
    expect(teamOf([at(0, "RoundStarted"), score(5, [0, 0]), goal(30, "B", "B"), score(40, [2, 0])])).toEqual({ teams: [1], fromScorer: 1 });
  });

  test("two goals with no kickoff between them: the second falls back", () => {
    const events = [at(0, "RoundStarted"), score(5, [0, 0]), goal(10, "A", "A"), score(15, [1, 0]), goal(20, "B", "B"), score(25, [1, 1])];
    expect(teamOf(events)).toEqual({ teams: [0, 1], fromScorer: 1 });
  });

  test("joined in progress, the first scoreboard is the baseline before the first kickoff", () => {
    const events = [score(0, [1, 1]), hit(10, ["B"]), goal(20, "B", "B"), score(30, [2, 1]), at(100, "RoundStarted")];
    expect(teamOf(events, true)).toEqual({ teams: [0], fromScorer: 0 });
  });

  test("joined in progress, a first goal with no scoring-team hit settled at the next kickoff isn't an own goal", () => {
    const events = [score(0, [1, 1]), hit(10, ["B"]), goal(20, "A", "B"), score(30, [2, 1]), at(100, "RoundStarted")];
    expect(buildPlay(events, summary({ joinedInProgress: true })).goals).toMatchObject([{ teamNum: 0, ownGoal: false }]);
  });

  test("the goal's clock is the reading at the GoalScored, not a later one before it settles", () => {
    const events = [at(0, "RoundStarted"), score(5, [0, 0]), clock(10, 200), goal(20, "A", "A"), clock(30, 199), score(40, [1, 0]), at(100, "RoundStarted")];
    expect(buildPlay(events, summary()).goals.map((g) => g.clock)).toEqual([{ seconds: 200, overtime: false }]);
  });

  test("the last goal settles at MatchEnded and at the end of events; a rise after MatchEnded isn't read", () => {
    const ended = [at(0, "RoundStarted"), score(5, [0, 0]), goal(10, "B", "B"), score(15, [1, 0]), at(20, "MatchEnded")];
    expect(teamOf(ended)).toEqual({ teams: [0], fromScorer: 0 });
    const left = [at(0, "RoundStarted"), score(5, [0, 0]), goal(10, "B", "B"), score(15, [1, 0])];
    expect(teamOf(left)).toEqual({ teams: [0], fromScorer: 0 });
    const late = [at(0, "RoundStarted"), score(5, [0, 0]), goal(10, "B", "B"), at(20, "MatchEnded"), score(25, [1, 0])];
    expect(teamOf(late)).toEqual({ teams: [1], fromScorer: 1 });
  });

  test("a shot pairs with its goal when the goal before it settles at this GoalScored", () => {
    const events = [
      at(0, "RoundStarted"),
      hit(5, ["A"]),
      statfeed(6, "Shot", "A"),
      goal(10, "A", "A"),
      hit(12, ["B"]), // no kickoff seen between the goals
      statfeed(13, "Shot", "B"),
      goal(20, "B", "B"),
    ];
    expect(buildPlay(events, summary()).moments.filter((m) => m.kind === "shot").map((m) => m.goalIdx)).toEqual([0, 1]);
  });
});

describe("buildPlay: goal clock", () => {
  const clock = (ts: number, seconds: unknown, overtime?: unknown) => at(ts, "ClockUpdatedSeconds", { TimeSeconds: seconds, bOvertime: overtime });
  const clocks = (events: StoredEvent[]) => buildPlay(events, summary()).goals.map((g) => g.clock);

  test("a goal's clock is the last reading before it; a later one isn't used", () => {
    const events = [at(0, "RoundStarted"), clock(10, 299, false), clock(20, 252, false), hit(30, ["A"]), goal(40, "A", "A"), clock(50, 251, false)];
    expect(clocks(events)).toEqual([{ seconds: 252, overtime: false }]);
  });

  test("a state's own TimeSeconds is ignored", () => {
    const events = [at(0, "RoundStarted"), clock(10, 100, false), state(20, { A: {} }, { TimeSeconds: 99 }), goal(30, "A", "A")];
    expect(clocks(events)).toEqual([{ seconds: 100, overtime: false }]);
  });

  test("an overtime reading sets the flag; a reading without a numeric TimeSeconds is skipped", () => {
    const events = [at(0, "RoundStarted"), clock(10, 0, false), clock(20, 14, true), clock(30, null, true), goal(40, "A", "A")];
    expect(clocks(events)).toEqual([{ seconds: 14, overtime: true }]);
  });

  test("a goal with no reading before it has a null clock and is counted", () => {
    const play = buildPlay([at(0, "RoundStarted"), goal(10, "A", "A"), clock(20, 200, false), goal(30, "B", "B")], summary());
    expect(play.goals.map((g) => g.clock)).toEqual([null, { seconds: 200, overtime: false }]);
    expect(play.facts.goalsWithoutClock).toBe(1);
  });

  test("regulation length is the largest regulation reading, up to a whole minute; overtime readings and a lone 0 are left out", () => {
    const reg = (...readings: [number, boolean][]) => buildPlay(readings.map(([s, ot], i) => clock(i, s, ot)), summary()).regulationSeconds;
    expect(reg([299, false], [120, false])).toBe(300);
    expect(reg([180, false])).toBe(180);
    expect(reg([372, false])).toBe(420);
    expect(reg([299, false], [400, true])).toBe(300);
    expect(reg([400, true])).toBeNull();
    // Joined at the very end, the only reading is the reset to 0.
    expect(reg([0, false])).toBeNull();
    expect(reg()).toBeNull();
    // A negative reading is flagged by clock_non_negative; it gives no length either.
    expect(reg([-1, false])).toBeNull();
  });

  test("a reading after MatchEnded changes neither a goal's clock nor the regulation length", () => {
    const play = buildPlay([at(0, "RoundStarted"), clock(10, 180, false), goal(20, "A", "A"), at(30, "MatchEnded"), clock(40, 300, false), goal(50, "B", "B")], summary());
    expect(play.goals.map((g) => g.clock)).toEqual([{ seconds: 180, overtime: false }]);
    expect(play.regulationSeconds).toBe(180);
  });

  test("a reading whose bOvertime isn't a boolean is counted", () => {
    const play = buildPlay([at(0, "RoundStarted"), clock(10, 299, false), clock(20, 200), clock(30, 199, "yes"), clock(40, 14, true)], summary());
    expect(play.facts.clockReadingsWithoutOvertimeFlag).toBe(2);
  });
});

describe("buildPlay: timeline moments and the end clock", () => {
  const clock = (ts: number, seconds: number, overtime = false) => at(ts, "ClockUpdatedSeconds", { TimeSeconds: seconds, bOvertime: overtime });
  const unresolved = (ts: number, eventName: string) =>
    at(ts, "StatfeedEvent", { EventName: eventName, MainTarget: { Name: "Ghost", Shortcut: 99, TeamNum: 0 } });
  const moments = (events: StoredEvent[]) => buildPlay(events, summary()).moments;

  test("each kind is recorded with the last reading before it; EpicSave becomes epic_save", () => {
    const events = [
      at(0, "RoundStarted"),
      clock(10, 290),
      statfeed(20, "Shot", "A"),
      clock(30, 280),
      statfeed(40, "Save", "B"),
      statfeed(50, "EpicSave", "B"),
      statfeed(60, "Assist", "C"),
      statfeed(70, "Demolish", "A"),
    ];
    expect(moments(events)).toEqual([
      { kind: "shot", key: key("A"), clock: { seconds: 290, overtime: false }, goalIdx: null },
      { kind: "save", key: key("B"), clock: { seconds: 280, overtime: false }, goalIdx: null },
      { kind: "epic_save", key: key("B"), clock: { seconds: 280, overtime: false }, goalIdx: null },
      { kind: "assist", key: key("C"), clock: { seconds: 280, overtime: false }, goalIdx: null },
    ]);
  });

  test("a moment outside live play is still recorded (a shot in the countdown)", () => {
    const events = [at(0, "CountdownBegin"), clock(5, 300), statfeed(10, "Shot", "A")];
    expect(moments(events).map((m) => m.kind)).toEqual(["shot"]);
  });

  test("an unresolved target is skipped", () => {
    expect(moments([at(0, "RoundStarted"), clock(5, 200), unresolved(10, "Save")])).toEqual([]);
  });

  test("a moment before the clock's first tick reads the regulation length: the clock starts at the first touch", () => {
    const play = buildPlay([at(0, "RoundStarted"), statfeed(10, "Shot", "A"), clock(20, 299), statfeed(30, "Save", "B")], summary());
    expect(play.moments.map((m) => m.clock)).toEqual([
      { seconds: 300, overtime: false },
      { seconds: 299, overtime: false },
    ]);
    expect(play.facts.momentsWithoutClock).toBe(0);
  });

  test("joined in progress, or with no regulation reading, a moment with no reading has a null clock and is counted", () => {
    const events = [at(0, "RoundStarted"), statfeed(10, "Save", "B"), clock(20, 100), statfeed(30, "Save", "B")];
    const joined = buildPlay(events, summary({ joinedInProgress: true }));
    expect(joined.moments.map((m) => m.clock)).toEqual([null, { seconds: 100, overtime: false }]);
    expect(joined.facts.momentsWithoutClock).toBe(1);
    const noReading = buildPlay([at(0, "RoundStarted"), statfeed(10, "Save", "B"), clock(20, 0)], summary());
    expect(noReading.moments.map((m) => m.clock)).toEqual([null]);
    expect(noReading.facts.momentsWithoutClock).toBe(1);
  });

  test("a first reading that isn't the start tick leaves the earlier moments null and counted: early readings went missing", () => {
    // 280 makes the regulation length 300, but 20 s of play passed without a reading.
    const late = buildPlay([at(0, "RoundStarted"), statfeed(10, "Shot", "A"), clock(20, 280), clock(30, 299)], summary());
    expect(late.moments.map((m) => m.clock)).toEqual([null]);
    expect(late.facts.momentsWithoutClock).toBe(1);
    // 298 is still within 2 s of the start.
    const start = buildPlay([at(0, "RoundStarted"), statfeed(10, "Shot", "A"), clock(20, 298)], summary());
    expect(start.moments.map((m) => m.clock)).toEqual([{ seconds: 300, overtime: false }]);
  });

  test("statfeeds after the first Win aren't recorded, and the end clock is the reading before it", () => {
    const play = buildPlay(
      [at(0, "RoundStarted"), clock(10, 44), statfeed(20, "Shot", "A"), unresolved(30, "Win"), clock(40, 0), statfeed(50, "Save", "B"), at(60, "MatchEnded")],
      summary(),
    );
    expect(play.moments.map((m) => m.kind)).toEqual(["shot"]);
    expect(play.endClock).toEqual({ seconds: 44, overtime: false });
    // The first Win sets the cut whether or not its target resolves.
    expect(play.facts.sawWin).toBe(true);
  });

  test("with no Win the end clock is the last reading, and with no readings it is null", () => {
    const left = buildPlay([at(0, "RoundStarted"), clock(10, 120), clock(20, 15, true)], summary());
    expect(left.endClock).toEqual({ seconds: 15, overtime: true });
    expect(left.facts.sawWin).toBe(false);
    expect(buildPlay([at(0, "RoundStarted"), statfeed(10, "Shot", "A")], summary()).endClock).toBeNull();
  });

  test("statfeeds after MatchEnded aren't recorded", () => {
    expect(moments([at(0, "RoundStarted"), clock(5, 10), at(10, "MatchEnded"), statfeed(20, "Shot", "A")])).toEqual([]);
  });

  describe("pairing a shot with its goal", () => {
    const paired = (events: StoredEvent[]) => moments(events).map((m) => m.goalIdx);

    test("a shot pairs with its scorer's goal", () => {
      expect(paired([at(0, "RoundStarted"), clock(5, 200), hit(10, ["A"]), statfeed(11, "Shot", "A"), goal(12, "A", "A")])).toEqual([0]);
    });

    test("a shot before the kickoff doesn't pair", () => {
      const events = [at(0, "RoundStarted"), clock(5, 200), statfeed(10, "Shot", "A"), at(20, "RoundStarted"), hit(30, ["A"]), goal(31, "A", "A")];
      expect(paired(events)).toEqual([null]);
    });

    test("two shots then a goal pair the later one; another player's shot doesn't pair", () => {
      const events = [at(0, "RoundStarted"), clock(5, 200), statfeed(10, "Shot", "A"), statfeed(11, "Shot", "C"), statfeed(12, "Shot", "A"), goal(13, "A", "A")];
      expect(paired(events)).toEqual([null, null, 0]);
    });

    test("a goal with no shot leaves every shot unpaired; the next goal's index counts it", () => {
      const events = [
        at(0, "RoundStarted"),
        clock(5, 200),
        statfeed(10, "Shot", "B"),
        goal(11, "A", "A"),
        at(20, "RoundStarted"),
        statfeed(21, "Shot", "B"),
        goal(22, "B", "B"),
      ];
      expect(paired(events)).toEqual([null, 1]);
    });

    test("a dropped goal pairs nothing", () => {
      expect(paired([at(0, "RoundStarted"), clock(5, 200), statfeed(10, "Shot", "A"), goal(11, null, "A")])).toEqual([null]);
    });
  });
});

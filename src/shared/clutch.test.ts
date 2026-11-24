import { describe, expect, test } from "vitest";
import { clutchCounts, clutchStats, goalOrder, matchClutch, type ClutchGoal, type ClutchMatch } from "./clutch";

let n = 0;
/** A counted match by default: Ranked Doubles, you on team 0, a 3–2 win with no goals given. */
const match = (over: Partial<ClutchMatch> = {}): ClutchMatch => ({
  guid: `G${String(++n)}`,
  startedAt: 1000 + n,
  playlistId: 11,
  endKind: "completed",
  overtime: false,
  scoreTeam0: 3,
  scoreTeam1: 2,
  result: "win",
  me: { teamNum: 0 },
  ...over,
});

/** Goals for `m` in scoring order, each the team that scored it. */
const goals = (m: ClutchMatch, teams: readonly number[]): ClutchGoal[] => teams.map((teamNum, idx) => ({ matchGuid: m.guid, idx, teamNum }));

describe("clutchCounts", () => {
  test.each([
    [1, true], // casual
    [11, true], // ranked
    [27, true], // ranked extra
    [22, true], // tournament
    [34, true], // official tournament
    [17, false], // casual extra
    [33, false], // LTM
    [6, false], // private
    [8, false], // offline
    [999, false], // unknown id
    [null, false],
  ] as const)("playlist %s counts: %s", (id, counts) => {
    expect(clutchCounts(id)).toBe(counts);
  });
});

describe("goalOrder", () => {
  test("a 3–2 win from 0–2 down: conceded first, the deficit and its score when first reached", () => {
    const m = match();
    expect(goalOrder(m, goals(m, [1, 1, 0, 0, 0]))).toEqual({ firstMine: false, maxDeficit: 2, deficitAt: "0–2", maxLead: 1, leadAt: "3–2" });
  });

  test("scores are yours first when you're on team 1, and goals arrive out of idx order", () => {
    const m = match({ me: { teamNum: 1 }, scoreTeam0: 1, scoreTeam1: 3 });
    const g = goals(m, [1, 1, 1, 0]).reverse();
    expect(goalOrder(m, g)).toEqual({ firstMine: true, maxDeficit: 0, deficitAt: null, maxLead: 3, leadAt: "3–0" });
  });

  test("the max is taken where it was first reached", () => {
    const m = match({ scoreTeam0: 2, scoreTeam1: 2 });
    expect(goalOrder(m, goals(m, [1, 0, 0, 1]))?.leadAt).toBe("2–1");
    expect(goalOrder(m, goals(m, [1, 0, 0, 1]))?.deficitAt).toBe("0–1");
  });

  test("other matches' goals are ignored", () => {
    const m = match({ scoreTeam0: 1, scoreTeam1: 0 });
    const other = match();
    expect(goalOrder(m, [...goals(other, [1, 1]), ...goals(m, [0])])?.firstMine).toBe(true);
  });

  test("0–0 with no goals: nobody scored first, never behind or ahead", () => {
    const m = match({ scoreTeam0: 0, scoreTeam1: 0 });
    expect(goalOrder(m, [])).toEqual({ firstMine: null, maxDeficit: 0, deficitAt: null, maxLead: 0, leadAt: null });
  });

  test("null when the goals per team aren't the final score (a joined match, or a mis-credited goal)", () => {
    const m = match({ scoreTeam0: 3, scoreTeam1: 7 });
    expect(goalOrder(m, goals(m, [0, 0, 1, 1, 1, 1, 1, 1, 1, 1]))).toBeNull();
  });

  test("null with no team or no score", () => {
    expect(goalOrder(match({ me: null }), [])).toBeNull();
    expect(goalOrder(match({ me: { teamNum: null } }), [])).toBeNull();
    expect(goalOrder(match({ scoreTeam0: null }), [])).toBeNull();
  });
});

describe("matchClutch", () => {
  test("not counted (null): an undecided match, no team, or an uncounted playlist", () => {
    expect(matchClutch(match({ result: null }), [])).toBeNull();
    expect(matchClutch(match({ me: null, result: null }), [])).toBeNull();
    expect(matchClutch(match({ playlistId: 33 }), [])).toBeNull();
  });

  test("a 1-goal overtime win is a 1-goal game and OT", () => {
    const m = match({ overtime: true });
    expect(matchClutch(m, goals(m, [0, 1, 1, 0, 0]))).toMatchObject({ oneGoal: true, ot: true, ff: false });
  });

  test("a win from 2 down is a comeback from that score; from 1 down it isn't", () => {
    const two = match();
    expect(matchClutch(two, goals(two, [1, 1, 0, 0, 0]))?.comebackFrom).toBe("0–2");
    const one = match();
    expect(matchClutch(one, goals(one, [1, 0, 1, 0, 0]))?.comebackFrom).toBeNull();
  });

  test("a loss after 2 up is a blown lead from that score", () => {
    const m = match({ result: "loss", scoreTeam0: 2, scoreTeam1: 3 });
    expect(matchClutch(m, goals(m, [0, 0, 1, 1, 1]))).toMatchObject({ blownFrom: "2–0", comebackFrom: null });
  });

  test("a forfeit and a match you left both count; the forfeit is FF", () => {
    expect(matchClutch(match({ endKind: "early_end" }), [])?.ff).toBe(true);
    expect(matchClutch(match({ endKind: "left", result: "loss", scoreTeam0: 0, scoreTeam1: 1 }), [])).not.toBeNull();
  });

  test("a win that finished behind (they quit while ahead) is no comeback; a loss that finished ahead no blown lead", () => {
    const quit = match({ endKind: "early_end", scoreTeam0: 0, scoreTeam1: 7 });
    expect(matchClutch(quit, goals(quit, [1, 1, 1, 1, 1, 1, 1]))).toMatchObject({ swings: false, comebackFrom: null, ff: true });
    const left = match({ endKind: "left", result: "loss", scoreTeam0: 3, scoreTeam1: 0 });
    expect(matchClutch(left, goals(left, [0, 0, 0]))).toMatchObject({ swings: false, blownFrom: null });
    const tied = match({ endKind: "early_end", scoreTeam0: 0, scoreTeam1: 0 });
    expect(matchClutch(tied, [])?.swings).toBe(true);
  });

  test("goals that don't match the score: no order, no swing, still a 1-goal game", () => {
    const m = match({ scoreTeam0: 4, scoreTeam1: 3 });
    expect(matchClutch(m, goals(m, [1, 1, 1]))).toMatchObject({ order: null, oneGoal: true, comebackFrom: null });
  });
});

describe("clutchStats", () => {
  test("null when no match counts", () => {
    expect(clutchStats([match({ playlistId: 6 }), match({ result: null })], [])).toBeNull();
  });

  test("records over counted matches only; an undecided one is in nothing", () => {
    const won = match(); // 3–2, order unknown: kept in 1-goal, skipped for order
    const otLoss = match({ result: "loss", overtime: true, scoreTeam0: 1, scoreTeam1: 2 });
    const ff = match({ endKind: "early_end", scoreTeam0: 0, scoreTeam1: 0 });
    const undecided = match({ result: null, scoreTeam0: 1, scoreTeam1: 2 });
    const priv = match({ playlistId: 6 });
    const g = [...goals(otLoss, [0, 1, 1])];
    const r = clutchStats([won, otLoss, ff, undecided, priv], g);
    expect(r?.skipped).toEqual([won.guid]);
    expect(r?.stats).toMatchObject({
      matches: 3,
      skippedOrder: 1,
      oneGoal: { w: 1, l: 1 },
      oneGoalNoOt: { w: 1, l: 0 },
      overtime: { w: 0, l: 1 },
      scoredFirst: { w: 0, l: 1 },
      concededFirst: { w: 0, l: 0 },
      forfeits: { w: 1, l: 0 },
    });
  });

  test("comebacks and blown leads out of the matches 2+ down or up; the ladder buckets 1, 2 and 3+", () => {
    const from1 = match(); // 1 down, won: ladder only
    const from2 = match();
    const from4 = match({ scoreTeam0: 5, scoreTeam1: 4 });
    const lost2Down = match({ result: "loss", scoreTeam0: 0, scoreTeam1: 2 });
    const blew3 = match({ result: "loss", scoreTeam0: 3, scoreTeam1: 4 });
    const g = [
      ...goals(from1, [1, 0, 0, 1, 0]),
      ...goals(from2, [1, 1, 0, 0, 0]),
      ...goals(from4, [1, 1, 1, 1, 0, 0, 0, 0, 0]),
      ...goals(lost2Down, [1, 1]),
      ...goals(blew3, [0, 0, 0, 1, 1, 1, 1]),
    ];
    const s = clutchStats([from1, from2, from4, lost2Down, blew3], g)?.stats;
    expect(s?.comebacks).toEqual({ n: 2, of: 3 });
    expect(s?.blownLeads).toEqual({ n: 1, of: 1 });
    expect(s?.ladder.down).toEqual([
      { w: 1, l: 1 }, // from1 won, blew3 lost
      { w: 1, l: 1 },
      { w: 1, l: 0 },
    ]);
    expect(s?.ladder.up).toEqual([
      { w: 3, l: 0 }, // from1, from2 and from4 each led by 1 at most
      { w: 0, l: 0 },
      { w: 0, l: 1 },
    ]);
    expect(s?.best).toEqual({ guid: from4.guid, startedAt: from4.startedAt, score: "5–4", at: "0–4", by: 4 });
    expect(s?.worst).toEqual({ guid: blew3.guid, startedAt: blew3.startedAt, score: "3–4", at: "3–0", by: 3 });
  });

  test("a win that finished behind stays in the final-score stats and scored first, out of the swings", () => {
    const quit = match({ endKind: "early_end", scoreTeam0: 1, scoreTeam1: 2 });
    const s = clutchStats([quit], goals(quit, [1, 0, 1]))?.stats;
    expect(s).toMatchObject({ oneGoal: { w: 1, l: 0 }, forfeits: { w: 1, l: 0 }, concededFirst: { w: 1, l: 0 }, comebacks: { n: 0, of: 0 }, best: null });
    expect(s?.ladder.down).toEqual([
      { w: 0, l: 0 },
      { w: 0, l: 0 },
      { w: 0, l: 0 },
    ]);
    expect(s?.ladder.up[0]).toEqual({ w: 0, l: 0 });
  });

  test("the biggest swing's tie goes to the newest match", () => {
    const older = match({ startedAt: 1 });
    const newer = match({ startedAt: 2 });
    const s = clutchStats([newer, older], [...goals(older, [1, 1, 0, 0, 0]), ...goals(newer, [1, 1, 0, 0, 0])])?.stats;
    expect(s?.best?.guid).toBe(newer.guid);
    expect(s?.worst).toBeNull();
  });
});

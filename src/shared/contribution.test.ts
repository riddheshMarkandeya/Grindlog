import { describe, expect, test } from "vitest";
import { carryOf, sessionContribution } from "./contribution";
import type { LobbyFriend, LobbyMatch, Thirds } from "./lobby";

const ME = "Epic|me|0";
const SAM = "Epic|sam|0";
const line = (score: number, shots: number, thirds: Thirds | null, playerKey = ME) => ({ playerKey, score, goals: 0, assists: 0, saves: 0, shots, thirds });
const sam = (score: number, shots: number, thirds: Thirds | null, over: Partial<LobbyFriend> = {}): LobbyFriend => ({ ...line(score, shots, thirds, SAM), id: SAM, side: "with", switched: false, ...over });

let clock = 0;
/** An online 2v2 (Ranked Doubles) with nobody listed; your team's touches 10, theirs 12. */
const match = (over: Partial<LobbyMatch> = {}): LobbyMatch => {
  clock += 1000;
  return {
    guid: `G${String(clock)}`,
    startedAt: clock,
    endedAt: clock + 300,
    playlistId: 11,
    overtime: false,
    result: "win",
    goalDiff: 1,
    sizes: { mine: 2, other: 2 },
    me: line(300, 2, [3, 2, 1]),
    myTeamTotals: { score: 500, goals: 0, assists: 0, saves: 0, shots: 5 },
    touches: { team: [4, 4, 2], opponents: [5, 4, 3] },
    mvpKey: null,
    mvpOnMyTeam: null,
    youSwitched: false,
    friends: [],
    ...over,
  };
};

describe("carryOf", () => {
  test("shots and touches split like the scoreboard rows: you, each friend, the rest", () => {
    const m = match({ sizes: { mine: 3, other: 3 }, playlistId: 13, friends: [sam(200, 1, [1, 1, 1])], myTeamTotals: { score: 900, goals: 0, assists: 0, saves: 0, shots: 6 }, touches: { team: [6, 5, 4], opponents: [0, 0, 0] } });
    expect(carryOf([{ m, fs: m.friends }], 1)).toMatchObject({ matches: 1, touchMatches: 1, score: [300, 200, 400], shots: [2, 1, 3], touches: [6, 3, 6] });
  });

  test("touches count only matches with every touch recomputed; the other rows keep them", () => {
    const done = match();
    const pending = match({ me: line(100, 1, null), myTeamTotals: { score: 200, goals: 0, assists: 0, saves: 0, shots: 2 }, touches: null });
    const carry = carryOf([done, pending].map((m) => ({ m, fs: [] })), 0);
    expect(carry).toMatchObject({ matches: 2, touchMatches: 1, score: [400, 300], shots: [3, 4], touches: [6, 4] });
  });
});

describe("sessionContribution", () => {
  test("per mode; the default has the most steady matches, a tie going to the earlier in MODE_ORDER", () => {
    const c = sessionContribution([match(), match({ playlistId: 13, sizes: { mine: 3, other: 3 } }), match({ playlistId: 13, sizes: { mine: 3, other: 3 } })], []);
    expect(c?.modes.map((m) => [m.mode, m.matches])).toEqual([["2", 1], ["3", 2]]);
    expect(c?.defaultMode).toBe("3");
    expect(sessionContribution([match(), match({ playlistId: 13, sizes: { mine: 3, other: 3 } })], [])?.defaultMode).toBe("2");
    const switched = { playlistId: 13, sizes: { mine: 3, other: 3 }, youSwitched: true };
    expect(sessionContribution([match(), match(switched), match(switched)], [])?.defaultMode).toBe("2");
  });

  test("touches by third: you, each friend, the rest of your team, then the opponents; switched matches and unrecomputed ones left out", () => {
    const ms = [
      match({ friends: [sam(200, 3, [1, 2, 1])] }),
      match({ friends: [sam(200, 3, [9, 9, 9])], touches: { team: [20, 20, 20], opponents: [1, 1, 1] }, youSwitched: true }),
      match({ friends: [sam(200, 3, null)], touches: null }),
    ];
    const [mode] = sessionContribution(ms, [SAM])?.modes ?? [];
    expect(mode).toMatchObject({ mode: "2", matches: 3, carry: { matches: 2, touchMatches: 1, touches: [6, 4, 0] } });
    expect(mode?.thirds).toEqual([[3, 2, 1], [1, 2, 1], [0, 0, 0], [5, 4, 3]]);
  });

  test("a listed friend not on your team leaves the match out", () => {
    const ms = [match({ friends: [sam(200, 3, [1, 1, 1])] }), match({ friends: [sam(200, 3, [1, 1, 1], { side: "against" })] })];
    expect(sessionContribution(ms, [SAM])?.modes[0]?.matches).toBe(1);
  });

  test("no match with a mode (1v1, Hoops, an uneven private) gives nothing", () => {
    expect(sessionContribution([match({ playlistId: 10 }), match({ playlistId: 27 }), match({ playlistId: 6, sizes: { mine: 2, other: 1 } })], [])).toBeNull();
    expect(sessionContribution([], [])).toBeNull();
  });
});

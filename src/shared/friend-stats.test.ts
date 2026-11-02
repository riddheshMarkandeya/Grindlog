import { describe, expect, test } from "vitest";
import { friendCard, friendView, modeOf, playlistLabel, type LobbyFriend, type LobbyMatch } from "./friend-stats";

const SAM = "Epic|sam|0";
const line = (score: number, goals = 0, playerKey = "Epic|me|0") => ({ playerKey, score, goals, assists: 0, saves: 0, shots: goals });
const sam = (side: LobbyFriend["side"], score = 200, goals = 0, over: Partial<LobbyFriend> = {}): LobbyFriend => ({ ...line(score, goals, SAM), id: SAM, side, switched: false, ...over });

let clock = 1_000_000;
/** A match you played; by default an online 2v2 (Ranked Doubles) you won 3–1 with Sam on your team. */
const match = (over: Partial<LobbyMatch> = {}): LobbyMatch => {
  clock += 600_000;
  return {
    guid: `G${String(clock)}`,
    startedAt: clock,
    endedAt: clock + 300_000,
    playlistId: 11,
    overtime: false,
    result: "win",
    goalDiff: 2,
    sizes: { mine: 2, other: 2 },
    me: line(300, 1),
    myTeamTotals: { score: 500, goals: 1 },
    mvpKey: null,
    mvpOnMyTeam: null,
    youSwitched: false,
    friends: [sam("with")],
    ...over,
  };
};
const won = (over: Partial<LobbyMatch> = {}) => match({ result: "win", goalDiff: 1, ...over });
const lost = (over: Partial<LobbyMatch> = {}) => match({ result: "loss", goalDiff: -1, ...over });

describe("which matches count", () => {
  test("offline play is left out of the records; extras, LTMs and unknown playlists stay in", () => {
    const ms = [won({ playlistId: 8 }), won({ playlistId: 27 }), won({ playlistId: 38 }), won({ playlistId: null }), won()];
    expect(friendView(ms, SAM, () => null).with.record).toEqual({ w: 4, l: 0, n: 4 });
  });

  test("only standard soccar with a teammate and even private 2v2/3v3 have a mode", () => {
    expect(modeOf(match({ playlistId: 11 }))).toBe("2");
    expect(modeOf(match({ playlistId: 2 }))).toBe("2");
    expect(modeOf(match({ playlistId: 13, sizes: { mine: 3, other: 3 } }))).toBe("3");
    expect(modeOf(match({ playlistId: 12 }))).toBe("3");
    expect(modeOf(match({ playlistId: 4 }))).toBe("4");
    expect(modeOf(match({ playlistId: 10 }))).toBeNull();
    expect(modeOf(match({ playlistId: 27 }))).toBeNull(); // Ranked Hoops
    expect(modeOf(match({ playlistId: 63 }))).toBeNull(); // Ranked Heatseeker
    expect(modeOf(match({ playlistId: 38 }))).toBeNull(); // an LTM
    expect(modeOf(match({ playlistId: null }))).toBeNull();
    expect(modeOf(match({ playlistId: 6, sizes: { mine: 2, other: 2 } }))).toBe("p2");
    expect(modeOf(match({ playlistId: 26, sizes: { mine: 3, other: 3 } }))).toBe("p3");
    expect(modeOf(match({ playlistId: 6, sizes: { mine: 2, other: 1 } }))).toBeNull();
    expect(modeOf(match({ playlistId: 6, sizes: { mine: 4, other: 4 } }))).toBeNull();
  });
});

describe("sides", () => {
  test("with, against, and neither (no friend row) are counted apart", () => {
    const ms = [won(), lost({ friends: [sam("against")] }), won({ friends: [sam("against")] }), won({ friends: [] })];
    const v = friendView(ms, SAM, () => null);
    expect(v.with.record).toEqual({ w: 1, l: 0, n: 1 });
    expect(v.against.record).toEqual({ w: 1, l: 1, n: 2 });
    expect(friendCard(ms, SAM)).toEqual({ with: { w: 1, l: 0, n: 1 }, against: { w: 1, l: 1, n: 2 }, lastPlayed: ms[2]?.startedAt });
  });

  test("a match with no result counts in n but not in w or l", () => {
    expect(friendView([won(), match({ result: null, goalDiff: null })], SAM, () => null).with.record).toEqual({ w: 1, l: 0, n: 2 });
  });

  test("a friend with no matches has empty records and no last played", () => {
    expect(friendCard([won({ friends: [] })], SAM)).toEqual({ with: { w: 0, l: 0, n: 0 }, against: { w: 0, l: 0, n: 0 }, lastPlayed: null });
  });
});

describe("playlist rows", () => {
  test("private splits by team size, uneven last; online rows by playlist id first", () => {
    expect(playlistLabel(match({ playlistId: 6, sizes: { mine: 1, other: 1 } }))).toBe("Private 1v1");
    expect(playlistLabel(match({ playlistId: 26, sizes: { mine: 4, other: 4 } }))).toBe("Private 4v4");
    expect(playlistLabel(match({ playlistId: 6, sizes: { mine: 3, other: 2 } }))).toBe("Private · uneven");
    expect(playlistLabel(match({ playlistId: 6, sizes: { mine: 5, other: 5 } }))).toBe("Private · uneven");
    const ms = [won({ playlistId: 6, sizes: { mine: 3, other: 2 } }), won({ playlistId: 6 }), won({ playlistId: 13 }), lost({ playlistId: 11 }), won({ playlistId: 2 })];
    expect(friendView(ms, SAM, () => null).with.playlists.map((r) => [r.label, r.w, r.l])).toEqual([
      ["Doubles", 1, 0],
      ["Ranked Doubles", 0, 1],
      ["Ranked Standard", 1, 0],
      ["Private 2v2", 1, 0],
      ["Private · uneven", 1, 0],
    ]);
  });
});

describe("with: tiles", () => {
  test("streaks skip no-result matches; time together sums durations; overtime is its own record", () => {
    const ms = [won(), won(), won(), lost(), match({ result: null, goalDiff: null }), won({ overtime: true }), lost({ overtime: true })];
    const w = friendView(ms, SAM, () => null).with;
    expect(w.streak).toEqual({ result: "loss", length: 1 });
    expect(w.bestWinStreak).toBe(3);
    expect(w.timeMs).toBe(7 * 300_000);
    expect(w.overtime).toEqual({ w: 1, l: 1, n: 2 });
  });

  test("best and worst count online playlists with 5+ decided matches, and need two of them", () => {
    const five = (playlistId: number, wins: number) => Array.from({ length: 5 }, (_, i) => (i < wins ? won({ playlistId }) : lost({ playlistId })));
    const one = friendView([...five(11, 4), ...five(6, 5)], SAM, () => null).with;
    expect(one.best).toBeNull();
    const two = friendView([...five(11, 4), ...five(13, 1), ...five(6, 5), won({ playlistId: 2 })], SAM, () => null).with;
    expect(two.best?.label).toBe("Ranked Doubles");
    expect(two.worst?.label).toBe("Ranked Standard");
  });
});

describe("with: modes", () => {
  test("lists the modes played, the most-played online one as the default", () => {
    const ms = [won({ playlistId: 6 }), won({ playlistId: 6 }), won({ playlistId: 6 }), won({ playlistId: 13, sizes: { mine: 3, other: 3 } }), won(), won()];
    const w = friendView(ms, SAM, () => null).with;
    expect(w.modes.map((m) => [m.mode, m.matches])).toEqual([["2", 2], ["3", 1], ["p2", 3]]);
    expect(w.defaultMode).toBe("2");
    expect(friendView([won({ playlistId: 6 })], SAM, () => null).with.defaultMode).toBe("p2");
    expect(friendView([won({ playlistId: 27 })], SAM, () => null).with.defaultMode).toBeNull();
  });

  test("carry: you, them and the rest of the team; switched matches are left out", () => {
    const ms = [
      won({ playlistId: 13, sizes: { mine: 3, other: 3 }, me: line(300, 2), myTeamTotals: { score: 900, goals: 3 }, friends: [sam("with", 400, 1)], mvpKey: SAM, mvpOnMyTeam: true }),
      won({ playlistId: 13, sizes: { mine: 3, other: 3 }, me: line(500, 1), myTeamTotals: { score: 1000, goals: 2 }, friends: [sam("with", 100, 0)], mvpKey: "Epic|me|0", mvpOnMyTeam: true }),
      won({ playlistId: 13, sizes: { mine: 3, other: 3 }, myTeamTotals: { score: 900, goals: 3 }, mvpKey: "Epic|x|0", mvpOnMyTeam: true }),
      won({ playlistId: 13, sizes: { mine: 3, other: 3 }, myTeamTotals: { score: 100, goals: 0 }, friends: [sam("with", 999, 9, { switched: true })] }),
      won({ playlistId: 13, sizes: { mine: 3, other: 3 }, myTeamTotals: { score: 100, goals: 0 }, youSwitched: true }),
    ];
    const carry = friendView(ms, SAM, () => null).with.modes[0]?.carry;
    expect(carry).toEqual({ matches: 3, score: [1100, 700, 1000], goals: [4, 1, 3], mvps: [1, 1, 1] });
  });

  test("compare: per match with them, without them at the same mode (as an opponent too), and theirs", () => {
    const ms = [
      won({ me: line(400, 2), friends: [sam("with", 300, 1)] }),
      lost({ me: line(200, 0), friends: [sam("with", 100, 1)] }),
      won({ me: line(100, 0), friends: [] }),
      lost({ me: line(300, 1), friends: [sam("against")] }),
      lost({ me: line(999, 9), playlistId: 13, sizes: { mine: 3, other: 3 }, friends: [] }),
      lost({ me: line(999, 9), playlistId: 27, friends: [] }),
    ];
    const c = friendView(ms, SAM, () => null).with.modes.find((m) => m.mode === "2")?.compare;
    expect(c?.with).toEqual({ matches: 2, winPct: 0.5, score: 300, goals: 1, assists: 0, saves: 0, shots: 1 });
    expect(c?.without).toEqual({ matches: 2, winPct: 0.5, score: 200, goals: 0.5, assists: 0, saves: 0, shots: 0.5 });
    expect(c?.them).toEqual({ matches: 2, winPct: null, score: 200, goals: 1, assists: 0, saves: 0, shots: 1 });
  });

  test("compare without any other match at the mode is null", () => {
    expect(friendView([won()], SAM, () => null).with.modes[0]?.compare.without).toBeNull();
  });
});

describe("against", () => {
  test("MVPs and goals you against them, biggest win, overtime, matches newest first with session keys", () => {
    const vs = (over: Partial<LobbyMatch>, theirs = sam("against", 200, 1)) => match({ playlistId: 6, sizes: { mine: 1, other: 1 }, friends: [theirs], ...over });
    const a = vs({ result: "win", goalDiff: 1, me: line(400, 2), mvpKey: "Epic|me|0", mvpOnMyTeam: true });
    const b = vs({ result: "win", goalDiff: 4, me: line(500, 4), overtime: true });
    const c = vs({ result: "loss", goalDiff: -2, me: line(100, 0), mvpKey: SAM, mvpOnMyTeam: false }, sam("against", 600, 3));
    const v = friendView([a, b, c, won()], SAM, (g) => (g === b.guid ? "s-b" : null)).against;
    expect(v.record).toEqual({ w: 2, l: 1, n: 3 });
    expect(v.streak).toEqual({ result: "loss", length: 1 });
    expect(v.mvps).toEqual([1, 1]);
    expect(v.goals).toEqual([6, 5]);
    expect(v.biggestWin).toEqual({ guid: b.guid, startedAt: b.startedAt, label: "Private 1v1", goalDiff: 4 });
    expect(v.overtime).toEqual({ w: 1, l: 0, n: 1 });
    expect(v.matches.map((m) => [m.guid, m.mvp, m.sessionKey])).toEqual([[c.guid, "them", null], [b.guid, null, "s-b"], [a.guid, "me", null]]);
    expect(v.matches[0]).toMatchObject({ label: "Private 1v1", playlistId: 6, result: "loss", me: { score: 100, goals: 0 }, them: { score: 600, goals: 3 } });
  });

  test("no win means no biggest win", () => {
    expect(friendView([lost({ friends: [sam("against")] })], SAM, () => null).against.biggestWin).toBeNull();
  });
});

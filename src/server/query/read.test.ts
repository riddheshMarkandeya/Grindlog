import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openStorage, type Storage } from "../storage";
import { ALT, goal, ME, memoryLogger, player, record, THEM } from "../testing";
import { createIds } from "../ids";
import { createRecordWriter } from "../records/save";
import { createQueryReader } from "./read";

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-read-"));
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup(account?: () => string | null) {
  const logger = memoryLogger();
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  const reader = createQueryReader({ tracker: storage.tracker, logger, ...(account && { account }) });
  const addId = (id: string, status: "confirmed" | "pending" | "rejected") =>
    storage.tracker.run("INSERT OR REPLACE INTO my_ids (primary_id, name, status, added_at) VALUES (?, ?, ?, 1)", id, id, status);
  const lines = (event: string) => logger.lines.filter((l) => l.cat === "query" && l.event === event);
  return { writer, reader, addId, lines };
}

describe("readMyMatches", () => {
  test("a pending id is you: your row, result, goals and statfeed", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "pending");
    writer.save(record("G", 1000));
    const [m] = reader.readMyMatches();
    expect(m).toMatchObject({
      guid: "G",
      startedAt: 1000,
      endedAt: 1300,
      playlistId: 13,
      endKind: "completed",
      overtime: false,
      winnerTeamNum: 0,
      mvpKey: ME,
      result: "win",
      goals: [{ speedKmh: 120, ownGoal: false }],
      statfeed: { Goal: 1 },
    });
    expect(m?.me).toEqual({
      playerKey: ME,
      teamNum: 0,
      score: 100,
      goals: 1,
      shots: 2,
      assists: 0,
      saves: 0,
      demos: 0,
      touches: 5,
      hardestShotKmh: 101.5,
      woodworkHits: 1,
      aerialTouches: 2,
      carMs: 1000,
      boostAvg: 33,
      supersonicMs: 100,
      emptyBoostMs: 50,
    });
  });

  test("a rejected id isn't you: the match reads as spectated", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "rejected");
    writer.save(record("G", 1000));
    expect(reader.readMyMatches()).toMatchObject([{ guid: "G", me: null, result: null, goals: [], statfeed: {} }]);
  });

  test("no id of yours in the match: spectated", () => {
    const { writer, reader, addId } = setup();
    addId(ALT, "confirmed");
    writer.save(record("G", 1000));
    expect(reader.readMyMatches()[0]?.me).toBeNull();
  });

  test("a loss on the other team", () => {
    const { writer, reader, addId } = setup();
    addId(THEM, "confirmed");
    writer.save(record("G", 1000));
    const [m] = reader.readMyMatches();
    expect(m?.result).toBe("loss");
    expect(m?.goals).toEqual([{ speedKmh: 88, ownGoal: false }]);
  });

  test("two of your ids in one match: the camera's is you, logged once per match", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    const players = [player(ME, 0), player(ALT, 1), player(THEM, 1)];
    writer.save(record("G", 1000, { players }, { cameraPrimaryId: ALT }));
    writer.save(record("H", 2000, { players }, { cameraPrimaryId: null }));
    expect(reader.readMyMatches().map((m) => [m.guid, m.me?.playerKey, m.result])).toEqual([
      ["G", ALT, "loss"],
      ["H", ME, "win"], // no camera: the lowest key
    ]);
    reader.readMyMatches();
    expect(lines("two_yous").map((l) => [l.level, l.fields])).toEqual([
      ["warn", { guid: "G", keys: [ME, ALT], chosen: ALT }],
      ["warn", { guid: "H", keys: [ME, ALT], chosen: ME }],
    ]);
  });

  test("goals and statfeed go to the right match", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, { goals: [goal(0, ME, { speedKmh: 70 }), goal(0, ME, { speedKmh: 140, ownGoal: true })] }));
    writer.save(record("H", 2000, { goals: [], statfeed: [{ playerKey: ME, eventName: "Save", count: 3 }] }));
    const [g, h] = reader.readMyMatches();
    expect(g?.goals).toEqual([
      { speedKmh: 70, ownGoal: false },
      { speedKmh: 140, ownGoal: true },
    ]);
    expect(g?.statfeed).toEqual({ Goal: 1 });
    expect(h?.goals).toEqual([]);
    expect(h?.statfeed).toEqual({ Save: 3 });
  });

  test("a range is half-open on the start time, and guids pick matches", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    for (const [guid, at] of [["A", 1000], ["B", 2000], ["C", 3000]] as const) writer.save(record(guid, at));
    expect(reader.readMyMatches({ from: 2000, to: 3000 }).map((m) => m.guid)).toEqual(["B"]);
    expect(reader.readMyMatches({ from: 1500 }).map((m) => m.guid)).toEqual(["B", "C"]);
    expect(reader.readMyMatches({ to: 2000 }).map((m) => m.guid)).toEqual(["A"]);
    expect(reader.readMyMatches({ guids: ["C", "A"] }).map((m) => m.guid)).toEqual(["A", "C"]);
    expect(reader.readMyMatches({ guids: [] })).toEqual([]);
    // The goals follow the same predicate.
    expect(reader.readMyMatches({ from: 2000, to: 3000 })[0]?.goals).toHaveLength(1);
  });

  test("logs each read with its row count", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000));
    reader.readMyMatches();
    expect(lines("read").map((l) => [l.fields.fn, l.fields.rows, typeof l.fields.ms])).toEqual([["readMyMatches", 1, "number"]]);
  });
});

describe("breaks and seasons", () => {
  test("from their tables", () => {
    const { reader } = setup();
    storage.tracker.run("INSERT INTO session_breaks (at) VALUES (1500)");
    expect(reader.readBreaks()).toEqual([1500]);
    expect(reader.readSeasons()).toEqual([
      { id: 1, name: "S22", startDate: "2026-03-11" },
      { id: 2, name: "S23", startDate: "2026-06-09" },
      { id: 3, name: "S24", startDate: "2026-09-23" },
    ]);
  });
});

describe("match fields for cards", () => {
  test("the score and why the match is flagged", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, {}, { scoreTeam0: 3, scoreTeam1: 2 }));
    writer.save(record("H", 2000, {}, { checkFlags: ["goals_match_score"], scoreTeam0: null, scoreTeam1: null }));
    writer.save(record("I", 3000, {}, { endKind: "left", winnerTeamNum: 0, winnerSource: "decided", mvpSource: "inferred" }));
    writer.save(record("J", 4000, {}, { endKind: "early_end", joinedInProgress: true }));
    expect(reader.readMyMatches().map((m) => [m.guid, m.scoreTeam0, m.scoreTeam1, m.flags])).toEqual([
      ["G", 3, 2, []],
      ["H", null, null, ["check_failed"]],
      ["I", 1, 1, ["left", "winner_decided", "mvp_inferred"]],
      ["J", 1, 1, ["joined"]],
    ]);
  });
});

describe("readResults", () => {
  test("one row per match: played or not, and your result", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    writer.save(record("A", 1000));
    writer.save(record("B", 2000, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }, { playlistId: 6 }));
    // Two of your ids: the camera's is you, as readMyMatches picks.
    writer.save(record("C", 3000, { players: [player(ME, 0), player(ALT, 1)] }, { cameraPrimaryId: ALT, playlistId: null }));
    expect(reader.readResults()).toEqual([
      { guid: "A", startedAt: 1000, endedAt: 1300, playlistId: 13, played: true, result: "win", friends: [] },
      { guid: "B", startedAt: 2000, endedAt: 2300, playlistId: 6, played: false, result: null, friends: [] },
      { guid: "C", startedAt: 3000, endedAt: 3300, playlistId: null, played: true, result: "loss", friends: [] },
    ]);
    expect(lines("read").at(-1)?.fields).toMatchObject({ fn: "readResults", rows: 3 });
  });
});

describe("readGoals", () => {
  test("every goal of the matches asked for, in order, with its position", () => {
    const { writer, reader } = setup();
    writer.save(
      record("G", 1000, {
        players: [player(ME, 0, { name: "Me" }), player(THEM, 1, { name: "Them" })],
        goals: [goal(0, ME, { assisterKey: THEM, deflected: true }), goal(1, THEM, { ownGoal: true, toucherKey: null, pos: null, distance: null, aerial: true, clock: null })],
      }),
    );
    writer.save(record("H", 2000));
    writer.save(record("I", 3000));
    const goals = reader.readGoals(["G", "I"]);
    expect(goals.map((g) => [g.matchGuid, g.idx])).toEqual([
      ["G", 0],
      ["G", 1],
      ["I", 0],
      ["I", 1],
    ]);
    expect(goals[0]).toEqual({
      matchGuid: "G",
      idx: 0,
      teamNum: 0,
      scorerKey: ME,
      scorerName: "Me",
      assisterKey: THEM,
      assisterName: "Them",
      toucherKey: ME,
      pos: { x: 10, y: -20, z: 93 },
      distance: 5000,
      speedKmh: 88,
      deflected: true,
      aerial: false,
      ownGoal: false,
      clock: { seconds: 120, overtime: false },
    });
    // Null clock columns, as on a row from before the recompute.
    expect(goals[1]).toMatchObject({ scorerName: "Them", assisterName: null, toucherKey: null, pos: null, distance: null, aerial: true, ownGoal: true, clock: null });
    expect(reader.readGoals([])).toEqual([]);
  });
});

describe("readMatch", () => {
  test("the match and every player, you marked", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G", 1000, { players: [player(ME, 0), player(THEM, 1, { isBot: true, presentAtEnd: false, extras: {} })] }, { checkFlags: ["x"], joinedInProgress: true }));
    const m = reader.readMatch("G");
    expect(m?.match).toEqual({
      guid: "G",
      startedAt: 1000,
      endedAt: 1300,
      playlistId: 13,
      arena: "cs_p",
      endKind: "completed",
      closedVia: "destroyed",
      joinedInProgress: true,
      overtime: false,
      scoreTeam0: 1,
      scoreTeam1: 1,
      winnerTeamNum: 0,
      mvpKey: ME,
      checkFlags: ["x"],
      regulationSeconds: 300,
      endClock: { seconds: 0, overtime: false },
    });
    expect(m?.players.map((p) => [p.playerKey, p.isMe, p.isBot, p.presentAtEnd, p.hardestShotKmh, p.thirds])).toEqual([
      [ME, true, false, true, 101.5, [2, 2, 1]],
      // Extras not computed: no thirds, rather than zeros.
      [THEM, false, true, false, null, null],
    ]);
    expect(m?.result).toBe("win");
    expect(reader.readMatch("nope")).toBeNull();
  });

  test("an overtime goal's clock reads back, and a match without a regulation length gives null", () => {
    const { writer, reader } = setup();
    writer.save(record("G", 1000, { goals: [goal(0, ME, { clock: { seconds: 14, overtime: true } })] }, { regulationSeconds: null }));
    expect(reader.readGoals(["G"])[0]?.clock).toEqual({ seconds: 14, overtime: true });
    expect(reader.readMatch("G")?.match.regulationSeconds).toBeNull();
  });

  test("moments read back in order once timeline_moments has run; before that they're null, not empty", () => {
    const { writer, reader } = setup();
    const moments = [
      { kind: "shot" as const, key: ME, clock: { seconds: 121, overtime: false }, goalIdx: 0 },
      { kind: "epic_save" as const, key: THEM, clock: { seconds: 15, overtime: true }, goalIdx: null },
      { kind: "assist" as const, key: THEM, clock: null, goalIdx: null },
    ];
    writer.save(record("G", 1000, { moments }, { ruleVersions: { timeline_moments: 1 }, endClock: { seconds: 44, overtime: false } }));
    expect(reader.readMoments("G")).toEqual([
      { idx: 0, kind: "shot", playerKey: ME, clock: { seconds: 121, overtime: false }, goalIdx: 0 },
      { idx: 1, kind: "epic_save", playerKey: THEM, clock: { seconds: 15, overtime: true }, goalIdx: null },
      { idx: 2, kind: "assist", playerKey: THEM, clock: null, goalIdx: null },
    ]);
    expect(reader.readMatch("G")?.match.endClock).toEqual({ seconds: 44, overtime: false });
    writer.save(record("Empty", 2000, {}, { ruleVersions: { timeline_moments: 1 } }));
    expect(reader.readMoments("Empty")).toEqual([]);
    // The extras threw: the rule version is stamped, but nothing was computed.
    writer.save(record("Threw", 2500, {}, { ruleVersions: { timeline_moments: 1 }, checkFlags: ["extras_computed"] }));
    expect(reader.readMoments("Threw")).toBeNull();
    // Stored before the recompute: no rule version, no moments, no end clock.
    writer.save(record("Old", 3000, {}, { ruleVersions: { winner: 1 }, endClock: null }));
    expect(reader.readMoments("Old")).toBeNull();
    expect(reader.readMatch("Old")?.match.endClock).toBeNull();
    storage.tracker.run("UPDATE matches SET rule_versions = NULL WHERE guid = 'Old'");
    expect(reader.readMoments("Old")).toBeNull();
    expect(reader.readMoments("nope")).toBeNull();
  });

  test("two of your ids: only the picked one is you; spectated: nobody is", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    addId(ALT, "confirmed");
    writer.save(record("G", 1000, { players: [player(ME, 0), player(ALT, 1)] }, { cameraPrimaryId: ALT }));
    writer.save(record("H", 2000, { players: [player(THEM, 0), player("Epic|x|0", 1)] }));
    expect(reader.readMatch("G")?.players.map((p) => [p.playerKey, p.isMe])).toEqual([
      [ME, false],
      [ALT, true],
    ]);
    expect(reader.readMatch("G")?.result).toBe("loss");
    expect(reader.readMatch("H")?.players.some((p) => p.isMe)).toBe(false);
    expect(reader.readMatch("H")?.result).toBeNull();
  });
});

describe("friends on your team", () => {
  const SAM = "Epic|sam|0";
  let added = 0;
  const BOT = "Bot|bot|0";
  const addFriend = (id: string, nickname: string | null = null) =>
    storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, ?, ?)", id, nickname, (added += 1));
  const duo = (guid: string, at: number, samTeam: 0 | 1, over: Partial<ReturnType<typeof player>> = {}, meOver: Partial<ReturnType<typeof player>> = {}) =>
    record(guid, at, { players: [player(ME, 0, meOver), player(SAM, samTeam, over), player(THEM, 1)] });

  test("a friend on your team at any point is with you; on the other team they aren't", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    addFriend(SAM);
    writer.save(duo("G1", 1000, 0));
    writer.save(duo("G2", 2000, 1));
    writer.save(record("G3", 3000));
    expect(reader.readMyMatches().map((m) => [m.guid, m.friends])).toEqual([["G1", [SAM]], ["G2", []], ["G3", []]]);
    expect(reader.readResults().map((m) => [m.guid, m.friends])).toEqual([["G1", [SAM]], ["G2", []], ["G3", []]]);
  });

  test("a teammate who isn't a friend, a bot friend and your own id are never friends in a match", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    addFriend(BOT);
    addFriend(ME);
    writer.save(record("G", 1000, { players: [player(ME, 0), player(SAM, 0), player(BOT, 0, { isBot: true }), player(THEM, 1)] }));
    expect(reader.readMyMatches()[0]?.friends).toEqual([]);
  });

  test("with no team of yours, you have no friends in the match; spectated neither", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    addFriend(SAM);
    writer.save(record("G1", 1000, { players: [player(ME, 0, { teamNum: null, teamsSeen: 0 }), player(SAM, 0)] }));
    writer.save(record("G2", 2000, { players: [player(SAM, 0), player(THEM, 1)] }));
    expect(reader.readMyMatches().map((m) => m.friends)).toEqual([[], []]);
    expect(reader.readResults().map((m) => m.friends)).toEqual([[], []]);
  });

  test("a friend who switched teams still counts, and is logged once per match", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addFriend(SAM);
    writer.save(duo("G", 1000, 1, { teamsSeen: 3 }));
    expect(reader.readMyMatches()[0]?.friends).toEqual([SAM]);
    reader.readResults();
    expect(lines("friend_switched_team").map((l) => l.fields)).toEqual([{ guid: "G", ids: [SAM], you: false }]);
  });

  test("when you switched, your final team decides, and the line says so", () => {
    const { writer, reader, addId, lines } = setup();
    addId(ME, "confirmed");
    addFriend(SAM);
    writer.save(duo("G", 1000, 1, {}, { teamsSeen: 3 }));
    expect(reader.readMyMatches()[0]?.friends).toEqual([]);
    expect(lines("friend_switched_team").map((l) => l.fields)).toEqual([{ guid: "G", ids: [], you: true }]);
  });

  test("adding a friend later re-labels the matches already stored", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(duo("G", 1000, 0));
    expect(reader.readResults()[0]?.friends).toEqual([]);
    addFriend(SAM);
    expect(reader.readResults()[0]?.friends).toEqual([SAM]);
  });

  test("readTeammates: every human on your team who isn't you, friend or not", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    writer.save(record("G1", 1000, { players: [player(ME, 0), player(SAM, 0, { name: "Sam" }), player(BOT, 0, { isBot: true }), player(THEM, 1)] }));
    writer.save(record("G2", 2000, { players: [player(SAM, 0)] }));
    expect(reader.readTeammates()).toEqual([{ guid: "G1", primaryId: SAM, name: "Sam" }]);
  });

  test("readLobbies: every match you played, team sizes and totals, and the listed friends by side", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    const ALEX = "Epic|alex|0";
    writer.save(
      record(
        "G1",
        1000,
        { players: [player(ME, 0, { score: 300, goals: 2, assists: 1, saves: 2 }), player(SAM, 0, { score: 200, goals: 1, assists: 2, saves: 3, name: "Sam" }), player(BOT, 0, { isBot: true, score: 50, goals: 0, assists: 4, saves: 1 }), player(ALEX, 1), player(THEM, 1, { assists: 7, saves: 7 })] },
        { scoreTeam0: 3, scoreTeam1: 1, mvpKey: SAM, overtime: true },
      ),
    );
    writer.save(record("G2", 2000, { players: [player(ME, 1, { teamsSeen: 3 }), player(SAM, 0, { teamsSeen: 3 }), player(ALEX, 0)] }, { scoreTeam0: 0, scoreTeam1: 2, winnerTeamNum: 1, mvpKey: ALEX }));
    writer.save(record("G3", 3000, { players: [player(SAM, 0), player(THEM, 1)] }));
    writer.save(record("G4", 4000, { players: [player(ME, 0), player(THEM, 1)] }, { scoreTeam0: null, scoreTeam1: null, mvpKey: null }));
    const [g1, g2, g4, ...rest] = reader.readLobbies([SAM, ALEX]);
    expect(rest).toEqual([]);
    expect(g1).toMatchObject({
      guid: "G1",
      startedAt: 1000,
      endedAt: 1300,
      playlistId: 13,
      overtime: true,
      result: "win",
      goalDiff: 2,
      sizes: { mine: 3, other: 2 },
      me: { playerKey: ME, score: 300, goals: 2, assists: 1, saves: 2, shots: 2, thirds: [2, 2, 1] },
      myTeamTotals: { score: 550, goals: 3, assists: 7, saves: 6, shots: 6 },
      touches: { team: [6, 6, 3], opponents: [4, 4, 2] },
      mvpKey: SAM,
      mvpOnMyTeam: true,
      youSwitched: false,
    });
    expect(g1?.friends).toEqual([
      { id: ALEX, playerKey: ALEX, side: "against", switched: false, score: 100, goals: 1, assists: 0, saves: 0, shots: 2, thirds: [2, 2, 1] },
      { id: SAM, playerKey: SAM, side: "with", switched: false, score: 200, goals: 1, assists: 2, saves: 3, shots: 2, thirds: [2, 2, 1] },
    ]);
    // You switched and ended on team 1: Sam, seen on both, is with you; Alex, only on team 0, is against.
    expect(g2).toMatchObject({ result: "win", goalDiff: 2, youSwitched: true, mvpOnMyTeam: false, sizes: { mine: 1, other: 2 } });
    expect(g2?.friends.map((f) => [f.id, f.side, f.switched])).toEqual([[ALEX, "against", false], [SAM, "with", true]]);
    expect(g4).toMatchObject({ goalDiff: null, mvpKey: null, mvpOnMyTeam: null, friends: [] });
  });

  test("readLobbies: a guid range reads only those matches; a match with any player's thirds missing has no touch totals", () => {
    const { writer, reader, addId } = setup();
    addId(ME, "confirmed");
    const uncomputed = { ...player(THEM, 1).extras, touches_defence: null, touches_midfield: null, touches_attack: null };
    writer.save(record("G1", 1000, { players: [player(ME, 0), player(THEM, 1)] }));
    writer.save(record("G2", 2000, { players: [player(ME, 0), player(THEM, 1, { extras: uncomputed })] }));
    writer.save(record("G3", 3000, { players: [player(ME, 0), player(THEM, 1)] }));
    const lobbies = reader.readLobbies([], { guids: ["G2", "G3"] });
    expect(lobbies.map((m) => m.guid)).toEqual(["G2", "G3"]);
    expect(lobbies[0]?.touches).toBeNull();
    expect(lobbies[1]?.touches).toEqual({ team: [2, 2, 1], opponents: [2, 2, 1] });
  });

  test("readFriends: named by the nickname, else the name from their latest match, else the id; listed by name", () => {
    const { writer, reader } = setup();
    addFriend(SAM, "Sammy");
    addFriend(THEM);
    addFriend("Epic|never|0");
    writer.save(record("G1", 1000, { players: [player(ME, 0), player(SAM, 0, { name: "old" }), player(THEM, 1, { name: "Them" })] }));
    writer.save(record("G2", 2000, { players: [player(ME, 0), player(SAM, 0, { name: "new" })] }));
    expect(reader.readFriends()).toEqual([
      { id: "Epic|never|0", nickname: null, name: "Epic|never|0" },
      { id: SAM, nickname: "Sammy", name: "Sammy" },
      { id: THEM, nickname: null, name: "Them" },
    ]);
  });
});

describe("a picked account", () => {
  const SAM = "Epic|sam|0";
  const BOB = "Epic|bob|0";
  /** G1 is ME's (SAM with you), G2 ALT's (SAM and BOB with you), G3 spectated, G4 both ids (camera ME). */
  function seed(account?: () => string | null) {
    const s = setup(account);
    s.addId(ME, "confirmed");
    s.addId(ALT, "confirmed");
    storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, NULL, 1)", SAM);
    s.writer.save(record("G1", 1000, { players: [player(ME, 0), player(SAM, 0), player(THEM, 1)] }));
    s.writer.save(record("G2", 2000, { players: [player(ALT, 0), player(SAM, 0), player(BOB, 0), player(THEM, 1)] }, { mvpKey: ALT }));
    s.writer.save(record("G3", 3000, { players: [player(SAM, 0), player(THEM, 1)] }));
    s.writer.save(record("G4", 4000, { players: [player(ME, 0), player(ALT, 1), player(THEM, 1)] }, { cameraPrimaryId: ME }));
    return s;
  }

  test("all accounts: every match, the spectated one too, and the query lines say no account", () => {
    const { reader, lines } = seed();
    expect(reader.readResults().map((m) => [m.guid, m.played, m.friends])).toEqual([
      ["G1", true, [SAM]],
      ["G2", true, [SAM]],
      ["G3", false, []],
      ["G4", true, []],
    ]);
    expect(reader.account()).toBeNull();
    expect(lines("read").find((l) => l.fields.fn === "readResults")?.fields.account).toBe(false);
  });

  test("ALT picked: only ALT's matches, with friends and teammates from those alone, and ALT is you beside ME", () => {
    const { reader, lines } = seed(() => ALT);
    expect(reader.readResults().map((m) => [m.guid, m.result, m.friends])).toEqual([
      ["G2", "win", [SAM]],
      ["G4", "loss", []], // ALT on team 1, though the camera was ME's
    ]);
    expect(reader.readMyMatches().map((m) => [m.guid, m.me?.playerKey])).toEqual([
      ["G2", ALT],
      ["G4", ALT],
    ]);
    expect(reader.readMyMatches({ from: 3000 }).map((m) => m.guid)).toEqual(["G4"]);
    expect(reader.readTeammates().map((t) => [t.guid, t.primaryId])).toEqual([
      ["G2", BOB],
      ["G2", SAM],
      ["G4", THEM],
    ]);
    expect(reader.readLobbies([SAM]).map((m) => [m.guid, m.result, m.friends.length])).toEqual([
      ["G2", "win", 1],
      ["G4", "loss", 0],
    ]);
    expect(reader.account()).toBe(ALT);
    expect(lines("read").find((l) => l.fields.fn === "readResults")?.fields.account).toBe(true);
  });

  test("ALT picked: a match ALT didn't play still opens by guid; in a both-ids match ALT is you there too", () => {
    const { reader } = seed(() => ALT);
    expect(reader.readMatch("G1")?.match.guid).toBe("G1");
    expect(reader.readMatch("G4")?.players.find((p) => p.isMe)?.playerKey).toBe(ALT);
  });

  test("a picked id that's since rejected falls back to all accounts", () => {
    const { reader, addId } = seed(() => createIds({ tracker: storage.tracker, logger: memoryLogger() }).effectiveAccount(ALT));
    expect(reader.readResults()).toHaveLength(2);
    addId(ALT, "rejected");
    expect(reader.readResults().map((m) => m.guid)).toEqual(["G1", "G2", "G3", "G4"]);
  });
});

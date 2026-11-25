import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "vitest";
import { trackerMigrations } from "../src/server/db/migrations";
import { buildPseudonyms, fakeId, findLeaks, gamertags, parseArgs, pseudonymise, rewriteFilter, scanLeaks, trim } from "./screens-data";

describe("parseArgs", () => {
  test("defaults to no window and no source override", () => {
    expect(parseArgs([])).toEqual({ from: undefined, since: undefined, maxMatches: undefined });
  });

  test("reads --from, --since as local midnight, and --max-matches", () => {
    expect(parseArgs(["--from", "D:\\x", "--since", "2026-11-01", "--max-matches", "40"])).toEqual({
      from: "D:\\x",
      since: new Date(2026, 10, 1).getTime(),
      maxMatches: 40,
    });
  });

  test.each([
    [["--since", "yesterday"]],
    [["--since", "2026-13-01"]],
    [["--max-matches", "0"]],
    [["--max-matches", "1.5"]],
    [["--max-matches"]],
    [["--bogus"]],
    [["stray"]],
  ])("rejects %j", (argv) => {
    expect(parseArgs(argv)).toBeNull();
  });
});

describe("fakeId", () => {
  test("keeps the platform prefix so the dashboard still shows the platform", () => {
    expect(fakeId("XboxOne|2535434623156065|0", 7)).toBe("XboxOne|fake-7|0");
    expect(fakeId("Epic|abc|0", 1)).toBe("Epic|fake-1|0");
  });
});

function take(n: number, avoid: ReadonlySet<string>): string[] {
  const tags = gamertags(avoid);
  return Array.from({ length: n }, () => tags.next().value);
}

describe("gamertags", () => {
  test("is deterministic, unique, and as long as asked", () => {
    const a = take(900, new Set());
    expect(a).toHaveLength(900);
    expect(new Set(a).size).toBe(900);
    expect(take(900, new Set())).toEqual(a);
  });

  test("never hands out a name to avoid, compared case-insensitively", () => {
    const first = take(1, new Set())[0] ?? "";
    expect(first).not.toBe("");
    const out = take(3, new Set([first.toLowerCase()]));
    expect(out.map((n) => n.toLowerCase())).not.toContain(first.toLowerCase());
  });

  test("keeps going past the word list with a numeric suffix", () => {
    const many = take(5000, new Set());
    expect(new Set(many).size).toBe(5000);
  });
});

describe("buildPseudonyms", () => {
  const p = buildPseudonyms({
    ids: ["Epic|me|0", "PS4|friend|0", "Steam|opp|0"],
    realNames: ["RealMe", "RealFriend", "Opp"],
    nicknames: ["Bestie"],
  });

  test("maps every id to a distinct fake with its platform", () => {
    expect([...p.player.values()].map((v) => v.id)).toEqual(["Epic|fake-1|0", "PS4|fake-2|0", "Steam|fake-3|0"]);
  });

  test("gives each id one fake name, never a real one", () => {
    const names = [...p.player.values()].map((v) => v.name);
    expect(new Set(names).size).toBe(3);
    for (const real of ["realme", "realfriend", "opp", "bestie"]) expect(names.map((n) => n.toLowerCase())).not.toContain(real);
  });

  test("maps nicknames to fakes that aren't any player's fake name", () => {
    const nick = p.nickname.get("Bestie") ?? "";
    expect(nick).toBeTruthy();
    expect([...p.player.values()].map((v) => v.name)).not.toContain(nick);
  });
});

describe("rewriteFilter", () => {
  const ids = new Map([
    ["Epic|a|0", "Epic|fake-1|0"],
    ["XboxOne|b|0", "XboxOne|fake-2|0"],
  ]);

  test("maps each teammate id in a with: filter, keeping the playlist part", () => {
    expect(rewriteFilter("everything|with:Epic|a|0,XboxOne|b|0", ids)).toBe("everything|with:Epic|fake-1|0,XboxOne|fake-2|0");
    expect(rewriteFilter("11|with:XboxOne|b|0", ids)).toBe("11|with:XboxOne|fake-2|0");
  });

  test("re-sorts a pair's fake ids, since the dashboard keys a pair by its sorted ids", () => {
    const swap = new Map([
      ["Epic|a|0", "Steam|fake-9|0"],
      ["XboxOne|b|0", "Epic|fake-2|0"],
    ]);
    expect(rewriteFilter("ranked|with:Epic|a|0,XboxOne|b|0", swap)).toBe("ranked|with:Epic|fake-2|0,Steam|fake-9|0");
  });

  test("leaves filters without teammates alone", () => {
    for (const f of ["everything", "ranked|solo", "casual"]) expect(rewriteFilter(f, ids)).toBe(f);
  });
});

describe("findLeaks", () => {
  const forbidden = { ids: ["Epic|7d18aa|0"], idParts: ["7d18aa"], names: ["Rocinante_.", "Max"] };

  test("flags an id or its account part anywhere in a cell", () => {
    expect(findLeaks([{ where: "t.c", value: '["Epic|7d18aa|0"]' }], forbidden)).toHaveLength(1);
    expect(findLeaks([{ where: "t.c", value: "x 7D18AA y" }], forbidden)).toHaveLength(1);
  });

  test("flags a name as a whole cell, case-insensitively", () => {
    expect(findLeaks([{ where: "t.c", value: "rocinante_." }], forbidden)).toHaveLength(1);
  });

  test("flags a name inside JSON text only as a whole quoted string", () => {
    expect(findLeaks([{ where: "t.c", value: '{"n":"Max"}' }], forbidden)).toHaveLength(1);
    expect(findLeaks([{ where: "t.c", value: "maxSpeed" }], forbidden)).toHaveLength(0);
  });

  test("flags a Windows user path", () => {
    expect(findLeaks([{ where: "t.c", value: "C:\\Users\\someone\\AppData" }], forbidden)).toHaveLength(1);
  });

  test("passes clean cells", () => {
    expect(findLeaks([{ where: "t.c", value: "Epic|fake-1|0" }, { where: "t.d", value: "ZoomyGoose" }], forbidden)).toEqual([]);
  });
});

// The real schema, built from the shipped migrations.
function trackerDb(): Database {
  const db = new Database(":memory:");
  for (const sql of trackerMigrations) db.run(sql);
  return db;
}

const ME = "Epic|7d18aa|0";
const FRIEND = "XboxOne|2535|0";
const OPP = "PS4|opp1|0";

type Player = [key: string, name: string];

function addMatch(db: Database, guid: string, startedAt: number, players: readonly [Player, ...Player[]]) {
  db.run(
    `INSERT INTO matches (guid, started_at, ended_at, end_kind, closed_via, joined_in_progress, overtime, mvp_key, camera_primary_id, check_flags)
     VALUES (?, ?, ?, 'completed', 'destroyed', 0, 0, ?, ?, '[]')`,
    [guid, startedAt, startedAt + 300_000, players[0][0], ME],
  );
  for (const [key, name] of players) {
    const bot = key.startsWith("bot:");
    db.run(
      `INSERT INTO match_players (match_guid, player_key, primary_id, name, is_bot, teams_seen, present_at_end, score, goals, shots, assists, saves, touches, demos)
       VALUES (?, ?, ?, ?, ?, 1, 1, 0, 0, 0, 0, 0, 0, 0)`,
      [guid, key, bot ? "Unknown|0|0" : key, name, bot ? 1 : 0],
    );
    db.run("INSERT INTO match_player_statfeed (match_guid, player_key, event_name, count) VALUES (?, ?, 'Shot', 1)", [guid, key]);
  }
  db.run(
    "INSERT INTO match_goals (match_guid, idx, team_num, scorer_key, assister_key, toucher_key, deflected, aerial, own_goal) VALUES (?, 0, 0, ?, ?, ?, 0, 0, 0)",
    [guid, players[0][0], players[1]?.[0] ?? null, players[0][0]],
  );
  db.run("INSERT INTO match_moments (match_guid, idx, kind, player_key) VALUES (?, 0, 'save', ?)", [guid, players[1]?.[0] ?? players[0][0]]);
  db.run("INSERT INTO remark_picks (session_key, filter, mood_band, mood_line, picked_at) VALUES (?, 'everything', 'usual', 'usual-1', 0)", [guid]);
  db.run("INSERT INTO remark_shown (line_id, session_key, shown_at) VALUES ('usual-1', ?, 0)", [guid]);
}

const count = (db: Database, table: string) => (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("trim", () => {
  let db: Database;
  beforeEach(() => {
    db = trackerDb();
    for (let i = 1; i <= 5; i++) addMatch(db, `g${String(i)}`, i * 1_000_000, [[ME, "Me"], [OPP, "Opp"]]);
  });

  test("keeps the newest N matches and drops their child and remark rows", () => {
    expect(trim(db, { maxMatches: 2 })).toEqual({ dropped: 3 });
    expect(db.query("SELECT guid FROM matches ORDER BY guid").all()).toEqual([{ guid: "g4" }, { guid: "g5" }]);
    expect(count(db, "match_players")).toBe(4);
    expect(count(db, "match_player_statfeed")).toBe(4);
    expect(count(db, "match_goals")).toBe(2);
    expect(count(db, "match_moments")).toBe(2);
    expect(count(db, "remark_picks")).toBe(2);
    expect(count(db, "remark_shown")).toBe(2);
  });

  test("drops matches started before --since", () => {
    expect(trim(db, { since: 3_000_000 })).toEqual({ dropped: 2 });
    expect(count(db, "matches")).toBe(3);
  });

  test("applies both limits together", () => {
    expect(trim(db, { since: 2_000_000, maxMatches: 3 })).toEqual({ dropped: 2 });
  });

  test("changes nothing without a window", () => {
    expect(trim(db, {})).toEqual({ dropped: 0 });
    expect(count(db, "matches")).toBe(5);
  });
});

test("a dev DB from before the newest migrations trims and pseudonymises the tables it has", () => {
  const db = new Database(":memory:");
  // Version 10: no match_moments yet.
  for (const sql of trackerMigrations.slice(0, 10)) db.run(sql);
  db.run(
    `INSERT INTO matches (guid, started_at, ended_at, end_kind, closed_via, joined_in_progress, overtime, mvp_key, camera_primary_id, check_flags)
     VALUES ('g1', 1, 2, 'completed', 'destroyed', 0, 0, ?, ?, '[]')`,
    [ME, ME],
  );
  expect(trim(db, { maxMatches: 1 })).toEqual({ dropped: 0 });
  expect(pseudonymise(db).ids).toEqual([ME]);
  expect(db.query("SELECT mvp_key FROM matches").get()).not.toEqual({ mvp_key: ME });
});

describe("pseudonymise + scanLeaks", () => {
  let db: Database;
  beforeEach(() => {
    db = trackerDb();
    addMatch(db, "g1", 1, [[ME, "Rocinante_."], [FRIEND, "DemoGodReal"], [OPP, "OppName"], ["bot:Viper", "Viper"]]);
    // A rename: the same id under an older name.
    addMatch(db, "g2", 2, [[FRIEND, "OldFriendName"], [ME, "Rocinante_."]]);
    db.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'Rocinante_.', 'confirmed', 0)", [ME]);
    db.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, 'Demogod', 0)", [FRIEND]);
    db.run("INSERT INTO never_suggest (primary_id, added_at) VALUES ('Steam|ghost|0', 0)");
    db.run("INSERT INTO remark_picks (session_key, filter, mood_band, mood_line, picked_at) VALUES ('g1', ?, 'usual', 'usual-1', 0)", [`everything|with:${FRIEND}`]);
  });

  test("leaves no original id or name in any text column", () => {
    const forbidden = pseudonymise(db);
    expect(scanLeaks(db, forbidden)).toEqual([]);
    const dump = JSON.stringify(
      ["matches", "match_players", "match_player_statfeed", "match_goals", "match_moments", "my_ids", "friends", "never_suggest", "remark_picks"].map((t) => db.query(`SELECT * FROM ${t}`).all()),
    );
    for (const real of [ME, FRIEND, OPP, "Steam|ghost|0", "Rocinante_.", "DemoGodReal", "OldFriendName", "OppName", "Demogod"]) {
      expect(dump).not.toContain(real);
    }
  });

  test("is consistent: one fake per id everywhere it appears, one name per id across renames", () => {
    pseudonymise(db);
    const me = (db.query("SELECT primary_id FROM my_ids").get() as { primary_id: string }).primary_id;
    const friend = (db.query("SELECT primary_id FROM friends").get() as { primary_id: string }).primary_id;
    expect(me).toMatch(/^Epic\|fake-\d+\|0$/);
    expect(friend).toMatch(/^XboxOne\|fake-\d+\|0$/);
    expect(db.query("SELECT DISTINCT camera_primary_id AS c FROM matches").all()).toEqual([{ c: me }]);
    const friendNames = db.query("SELECT DISTINCT name FROM match_players WHERE primary_id = ?").all(friend);
    expect(friendNames).toHaveLength(1);
    const keys = db.query("SELECT DISTINCT player_key AS k FROM match_players WHERE is_bot = 0 AND player_key <> primary_id").all();
    expect(keys).toEqual([]);
    expect(db.query("SELECT scorer_key AS s, assister_key AS a FROM match_goals WHERE match_guid = 'g1'").get()).toEqual({ s: me, a: friend });
    expect(db.query("SELECT player_key AS k FROM match_moments WHERE match_guid = 'g1'").get()).toEqual({ k: friend });
  });

  test("keeps bots as they are", () => {
    pseudonymise(db);
    expect(db.query("SELECT player_key AS k, primary_id AS p, name AS n FROM match_players WHERE is_bot = 1").all()).toEqual([
      { k: "bot:Viper", p: "Unknown|0|0", n: "Viper" },
    ]);
  });

  test("scanLeaks reports a leftover original", () => {
    const forbidden = pseudonymise(db);
    db.run("INSERT INTO settings (key, value) VALUES ('x', ?)", [JSON.stringify(FRIEND)]);
    expect(scanLeaks(db, forbidden)).toHaveLength(1);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { memoryLogger } from "../testing";
import { PLAYER_EXTRAS } from "../recorder/extras";
import { migrate } from "./migrate";
import { trackerMigrations } from "./migrations";
import { openDb, type Db } from "./sqlite";

let dir: string;
const open: Db[] = [];
const db = (name = "t.db", busyTimeoutMs?: number) => {
  const d = openDb(join(dir, name), { busyTimeoutMs });
  open.push(d);
  return d;
};
const tables = (d: Db) => d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-migrate-"));
});
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  rmSync(dir, { recursive: true, force: true });
});

const v1 = "CREATE TABLE a(x); INSERT INTO a VALUES (1);";
const v2 = "CREATE TABLE b(y);";

describe("migrate", () => {
  test("a fresh DB runs every migration and logs from/to", () => {
    const logger = memoryLogger();
    const d = db();
    expect(migrate(d, "t", [v1, v2], { logger })).toEqual({ from: 0, to: 2 });
    expect(d.pragma("user_version")).toBe(2);
    expect(tables(d)).toEqual(["a", "b"]);
    expect(logger.lines).toMatchObject([{ level: "info", cat: "db", event: "migrated", fields: { db: "t", from: 0, to: 2 } }]);
    expect(logger.lines[0]?.fields.ms).toBeTypeOf("number");
  });

  test("an existing v1 DB upgrades to v2 and keeps its rows", () => {
    const logger = memoryLogger();
    const first = db();
    migrate(first, "t", [v1], { logger });
    first.run("INSERT INTO a VALUES (2)");
    first.close();
    open.length = 0;
    const d = db();
    const seen: number[] = [];
    expect(migrate(d, "t", [v1, v2], { logger, beforeMigrate: (from) => seen.push(from) })).toEqual({ from: 1, to: 2 });
    expect(seen).toEqual([1]);
    expect(d.all("SELECT x FROM a ORDER BY x")).toEqual([{ x: 1 }, { x: 2 }]);
    expect(tables(d)).toEqual(["a", "b"]);
  });

  test("an up-to-date DB does nothing and logs nothing", () => {
    const d = db();
    migrate(d, "t", [v1], { logger: memoryLogger() });
    const logger = memoryLogger();
    let called = false;
    expect(migrate(d, "t", [v1], { logger, beforeMigrate: () => (called = true) })).toEqual({ from: 1, to: 1 });
    expect(called).toBe(false);
    expect(logger.lines).toEqual([]);
  });

  test("a throwing migration rolls back its own changes and version, and is logged", () => {
    const logger = memoryLogger();
    const d = db();
    const bad = "CREATE TABLE c(z); INSERT INTO missing VALUES (1);";
    expect(() => migrate(d, "t", [v1, bad], { logger })).toThrow(/missing/);
    expect(d.pragma("user_version")).toBe(1);
    expect(tables(d)).toEqual(["a"]);
    expect(logger.events()).toEqual(["db/migration_failed"]);
    expect(logger.lines[0]?.fields).toMatchObject({ db: "t", version: 2 });
  });

  test("a DB newer than the code throws and is logged", () => {
    const logger = memoryLogger();
    const d = db();
    d.run("PRAGMA user_version = 3");
    expect(() => migrate(d, "t", [v1], { logger })).toThrow(/newer/);
    expect(logger.lines[0]).toMatchObject({ level: "error", event: "newer_than_code", fields: { db: "t", version: 3, known: 1 } });
    expect(tables(d)).toEqual([]);
  });

  test("a second instance that migrated first is seen inside the lock, so the SQL runs once", () => {
    const logger = memoryLogger();
    const a = db();
    const b = db();
    let bResult: unknown;
    const aResult = migrate(a, "t", [v1, v2], {
      logger,
      // A has already seen pending work; B now does all of it before A takes the lock.
      beforeMigrate: () => (bResult = migrate(b, "t", [v1, v2], { logger })),
    });
    expect(bResult).toEqual({ from: 0, to: 2 });
    expect(aResult).toEqual({ from: 2, to: 2 });
    expect(a.all("SELECT x FROM a")).toEqual([{ x: 1 }]);
    expect(logger.events()).toEqual(["db/migrated"]);
  });

  test("a lock held by another connection fails with SQLITE_BUSY, logged", () => {
    const logger = memoryLogger();
    const holder = db();
    const d = db("t.db", 50);
    holder.run("BEGIN EXCLUSIVE");
    try {
      expect(() => migrate(d, "t", [v1], { logger })).toThrow();
    } finally {
      holder.run("ROLLBACK");
    }
    expect(logger.events()).toEqual(["db/migration_failed"]);
    expect(logger.lines[0]?.fields.err).toMatchObject({ code: "SQLITE_BUSY" });
  });
});

describe("tracker schema", () => {
  test("every registry stat has its match_players column, and match_goals exists", () => {
    const d = db();
    migrate(d, "tracker", trackerMigrations, { logger: memoryLogger() });
    const cols = d.all<{ name: string }>("PRAGMA table_info(match_players)").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(PLAYER_EXTRAS.map((e) => e.column)));
    expect(tables(d)).toContain("match_goals");
  });

  test("a match recorded before the extras keeps its row, with the extras null until recompute", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 2), { logger });
    d.run(
      `INSERT INTO match_players (match_guid, player_key, primary_id, name, is_bot, team_num, teams_seen, present_at_end,
        score, goals, shots, assists, saves, touches, demos) VALUES ('G', 'k', 'k', 'n', 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0)`,
    );
    migrate(d, "tracker", trackerMigrations, { logger });
    expect(d.all("SELECT woodwork_hits, car_ms FROM match_players")).toEqual([{ woodwork_hits: null, car_ms: null }]);
  });

  test("a match recorded before rule versions keeps its row, with no versions", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 3), { logger });
    d.run(
      `INSERT INTO matches (guid, started_at, ended_at, end_kind, closed_via, joined_in_progress, overtime, check_flags)
        VALUES ('G', 1, 2, 'completed', 'destroyed', 0, 0, '[]')`,
    );
    migrate(d, "tracker", trackerMigrations, { logger });
    expect(d.all("SELECT guid, rule_versions FROM matches")).toEqual([{ guid: "G", rule_versions: null }]);
  });

  test("a DB at version 5 gains friends and never-suggest, and keeps its remark picks", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 5), { logger });
    d.run("INSERT INTO remark_shown (line_id, session_key, shown_at) VALUES ('l', 's', 1)");
    migrate(d, "tracker", trackerMigrations.slice(0, 6), { logger });
    expect(d.pragma("user_version")).toBe(6);
    expect(tables(d)).toEqual(expect.arrayContaining(["friends", "never_suggest"]));
    d.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES ('Epic|sam|0', NULL, 1)");
    expect(d.all("SELECT primary_id, nickname FROM friends")).toEqual([{ primary_id: "Epic|sam|0", nickname: null }]);
    expect(d.all("SELECT line_id FROM remark_shown")).toEqual([{ line_id: "l" }]);
  });

  test("a DB at version 6 gains the meta table for app state", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 6), { logger });
    migrate(d, "tracker", trackerMigrations.slice(0, 7), { logger });
    expect(d.pragma("user_version")).toBe(7);
    d.run("INSERT INTO meta (key, value) VALUES ('recomputed_version', '0.1.0')");
    expect(d.all("SELECT key, value FROM meta")).toEqual([{ key: "recomputed_version", value: "0.1.0" }]);
  });

  test("a DB at version 7 gains the touch thirds, null on the rows it had until recompute", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 7), { logger });
    d.run(
      `INSERT INTO match_players (match_guid, player_key, primary_id, name, is_bot, team_num, teams_seen, present_at_end,
        score, goals, shots, assists, saves, touches, demos) VALUES ('G', 'k', 'k', 'n', 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0)`,
    );
    migrate(d, "tracker", trackerMigrations.slice(0, 8), { logger });
    expect(d.pragma("user_version")).toBe(8);
    expect(d.get("SELECT touches_defence, touches_midfield, touches_attack FROM match_players")).toEqual({ touches_defence: null, touches_midfield: null, touches_attack: null });
  });

  test("a DB at version 8 adopts the unchanged seed seasons as season-file rows; an edited or added one stays the user's", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 8), { logger });
    d.run("UPDATE seasons SET start_date = '2026-09-24' WHERE name = 'S24'");
    d.run("INSERT INTO seasons (name, start_date) VALUES ('S25', '2026-12-09')");
    migrate(d, "tracker", trackerMigrations.slice(0, 9), { logger });
    expect(d.pragma("user_version")).toBe(9);
    expect(d.all("SELECT name, file_name AS fileName, file_start AS fileStart FROM seasons ORDER BY start_date")).toEqual([
      { name: "S22", fileName: "S22", fileStart: "2026-03-11" },
      { name: "S23", fileName: "S23", fileStart: "2026-06-09" },
      { name: "S24", fileName: null, fileStart: null },
      { name: "S25", fileName: null, fileStart: null },
    ]);
    expect(tables(d)).toContain("seasons_dismissed");
    expect(() => d.run("UPDATE seasons SET file_name = 's22' WHERE name = 'S25'")).toThrow(/UNIQUE/);
  });

  test("a DB at version 9 gains the goal clock and regulation length, null on the rows it had until recompute", () => {
    const logger = memoryLogger();
    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 9), { logger });
    d.run(
      `INSERT INTO matches (guid, started_at, ended_at, end_kind, closed_via, joined_in_progress, overtime, check_flags)
        VALUES ('G', 1, 2, 'completed', 'destroyed', 0, 0, '[]')`,
    );
    d.run("INSERT INTO match_goals (match_guid, idx, team_num, scorer_key, deflected, aerial, own_goal) VALUES ('G', 0, 0, 'k', 0, 0, 0)");
    migrate(d, "tracker", trackerMigrations.slice(0, 10), { logger });
    expect(d.pragma("user_version")).toBe(10);
    expect(d.get("SELECT clock_seconds, clock_overtime FROM match_goals")).toEqual({ clock_seconds: null, clock_overtime: null });
    expect(d.get("SELECT regulation_seconds FROM matches")).toEqual({ regulation_seconds: null });
  });

  test("a seed season deleted before version 9 is recorded as dismissed, so the season file never brings it back", () => {
    const logger = memoryLogger();
    const fresh = db("fresh.db");
    migrate(fresh, "tracker", trackerMigrations.slice(0, 9), { logger });
    expect(fresh.all("SELECT file_name AS name FROM seasons_dismissed")).toEqual([]);

    const d = db();
    migrate(d, "tracker", trackerMigrations.slice(0, 8), { logger });
    d.run("DELETE FROM seasons WHERE name = 'S22'");
    d.run("UPDATE seasons SET start_date = '2026-09-24' WHERE name = 'S24'");
    migrate(d, "tracker", trackerMigrations.slice(0, 9), { logger });
    expect(d.all("SELECT file_name AS name FROM seasons_dismissed")).toEqual([{ name: "S22" }]);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createQueryReader } from "../query/read";
import { createRecordWriter } from "../records/save";
import { openStorage, type Storage } from "../storage";
import { goal, ME, memoryLogger, player, record, THEM } from "../testing";
import { ROLLING_WINDOW } from "../../shared/trends";
import { createPages } from "./pages";

// Local days follow the process's zone; UTC keeps the expected instants readable.
const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = zone;
});

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-pages-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
/** A UTC instant on 2026-mm-dd. */
const t = (mo: number, d: number, h: number, mi = 0) => Date.UTC(2026, mo - 1, d, h, mi);
const CASUAL = 2; // Doubles
const RANKED = 13; // Ranked Standard

function seed() {
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  /** A match of yours, 5 minutes long. */
  const play = (guid: string, at: number, { playlistId = RANKED, won = true } = {}) => {
    writer.save(record(guid, at, {}, { endedAt: at + 5 * MIN, playlistId, winnerTeamNum: won ? 0 : 1 }));
  };
  const watch = (guid: string, at: number) => {
    writer.save(record(guid, at, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }, { endedAt: at + 5 * MIN }));
  };
  const pages = (now = t(12, 31, 12)) => createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger: memoryLogger(), now: () => now });
  return { play, watch, pages };
}

describe("session list", () => {
  test("spectating still cuts sessions but isn't listed; newest first, numbered within the day", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10, 0));
    watch("W", t(10, 10, 10, 25)); // bridges A and E: 50 min apart, each gap under 30
    play("E", t(10, 10, 10, 50), { won: false });
    watch("S", t(10, 10, 14)); // a session with nothing of yours
    play("D", t(10, 10, 18));
    const { sessions } = pages().sessionList("everything", "2026-10-10", "2026-10-10");
    expect(sessions.map((s) => [s.key, s.ordinal, s.ofDay, s.matches, s.wins, s.losses, s.results])).toEqual([
      ["D", 2, 2, 1, 1, 0, ["win"]],
      ["A", 1, 2, 2, 1, 1, ["win", "loss"]],
    ]);
    expect(sessions[1]).toMatchObject({ day: "2026-10-10", startedAt: t(10, 10, 10, 0), endedAt: t(10, 10, 10, 55) });
  });

  test("the numbering counts only the sessions under the filter", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10), { playlistId: CASUAL });
    play("B", t(10, 10, 14));
    play("C", t(10, 10, 18));
    const ranked = pages().sessionList("ranked", "2026-10-01", "2026-10-31").sessions;
    expect(ranked.map((s) => [s.key, s.ordinal, s.ofDay])).toEqual([
      ["C", 2, 2],
      ["B", 1, 2],
    ]);
  });

  test("the current session comes from the whole cut, even when its latest match was spectated", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 18));
    watch("W", t(10, 10, 18, 20));
    const p = pages(t(10, 10, 18, 40));
    expect(p.sessionList("everything", "2026-10-10", "2026-10-10").currentKey).toBe("A");
    expect(p.currentSummary("everything")?.key).toBe("A");
    expect(p.currentSummary("casual")).toBeNull();
    // Only a key the filtered list can hold.
    expect(p.sessionList("casual", "2026-10-10", "2026-10-10").currentKey).toBeNull();
    // Over the gap after the spectated match's end: no current session.
    expect(pages(t(10, 10, 19, 0)).currentSummary("everything")).toBeNull();
  });

  test("the current chip is null when the current session has only spectating", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    watch("W", t(10, 10, 18));
    expect(pages(t(10, 10, 18, 10)).currentSummary("everything")).toBeNull();
  });
});

describe("a session starting before the 4am cutoff", () => {
  // Starts 03:40 on Nov 1, so its day is Oct 31; its second match starts after 04:00.
  function across() {
    const s = seed();
    s.play("A", t(11, 1, 3, 40));
    s.play("B", t(11, 1, 4, 10), { won: false });
    return s.pages();
  }

  test("is listed whole on the earlier day and folded whole into the earlier month", () => {
    const p = across();
    expect(p.sessionList("everything", "2026-10-31", "2026-10-31").sessions.map((s) => [s.key, s.day, s.matches])).toEqual([["A", "2026-10-31", 2]]);
    expect(p.sessionList("everything", "2026-11-01", "2026-11-01").sessions).toEqual([]);
    expect(p.monthFolds("everything", "2026-12-01").months).toEqual([{ month: "2026-10", sessions: 1, wins: 1, losses: 1 }]);
    expect(p.monthFolds("everything", "2026-10-31").months).toEqual([]);
  });

  test("counts in both periods it touches, each match in its own", () => {
    const p = across();
    for (const [spec, matches] of [
      [{ kind: "day", day: "2026-10-31" }, 1],
      [{ kind: "day", day: "2026-11-01" }, 1],
      [{ kind: "month", day: "2026-10-15" }, 1],
      [{ kind: "month", day: "2026-11-15" }, 1],
      [{ kind: "year", day: "2026-11-15" }, 2],
    ] as const) {
      const period = p.period(spec, "everything", ROLLING_WINDOW);
      expect([period?.aggregate.matches, period?.sessions], JSON.stringify(spec)).toEqual([matches, 1]);
    }
  });
});

describe("session detail", () => {
  test("your matches under the filter, every playlist played, goals, and the current flag", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { playlistId: CASUAL, won: false });
    watch("W", t(10, 10, 10, 20));
    const d = pages(t(10, 10, 10, 30)).sessionDetail("A", "ranked");
    expect(d?.current).toBe(true);
    expect(d?.matches.map((m) => m.guid)).toEqual(["A"]);
    expect(d?.aggregate).toMatchObject({ matches: 1, wins: 1 });
    expect(d?.byPlaylist.map((b) => b.playlistId)).toEqual([RANKED]);
    expect(d?.playlistsPresent).toEqual([CASUAL, RANKED]);
    expect(d?.goals.map((g) => g.matchGuid)).toEqual(["A", "A"]);
    expect(d?.summary).toMatchObject({ key: "A", matches: 1 });
    expect([d?.key, d?.startedAt, d?.endedAt]).toEqual(["A", t(10, 10, 10), t(10, 10, 10, 25)]);
  });

  test("an unknown or stale key is null", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10));
    expect(pages().sessionDetail("B", "everything")).toBeNull();
    expect(pages().sessionDetail("nope", "everything")).toBeNull();
  });

  test("prev and next skip sessions with nothing under the filter", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 14), { playlistId: CASUAL });
    watch("W", t(10, 10, 16));
    play("C", t(10, 11, 18));
    play("D", t(10, 12, 18), { playlistId: CASUAL });
    const p = pages();
    expect([p.sessionDetail("C", "ranked")?.prev, p.sessionDetail("C", "ranked")?.next]).toEqual(["A", null]);
    expect([p.sessionDetail("C", "everything")?.prev, p.sessionDetail("C", "everything")?.next]).toEqual(["B", "D"]);
    // A session with nothing under the filter still finds its neighbours by time.
    expect(p.sessionDetail("B", "ranked")).toMatchObject({ summary: null, matches: [], prev: "A", next: "C" });
  });

  test("month steps land on the nearest session in the month before or after, skipping empty months", () => {
    const { play, pages } = seed();
    play("JUL", t(7, 20, 18));
    play("SEP1", t(9, 3, 18));
    play("SEP2", t(9, 20, 18), { playlistId: CASUAL });
    play("SEP3", t(9, 28, 18));
    play("OCT1", t(10, 2, 18));
    play("OCT2", t(10, 9, 18));
    const p = pages();
    const months = (key: string, f: "everything" | "ranked" = "everything") => {
      const d = p.sessionDetail(key, f);
      return [d?.prevMonth, d?.nextMonth];
    };
    // Back to the previous month's newest, on to the next month's first; August is empty.
    expect(months("OCT2")).toEqual(["SEP3", null]);
    expect(months("SEP2")).toEqual(["JUL", "OCT1"]);
    expect(months("JUL")).toEqual([null, "SEP1"]);
    // Under a filter, only its sessions count.
    expect(months("OCT1", "ranked")).toEqual(["SEP3", null]);
  });

  test("the baseline is the 30 days before the start, under the same filter", () => {
    const { play, pages } = seed();
    play("OLD", t(9, 1, 10)); // over 30 days before
    play("R", t(10, 1, 10));
    play("C", t(10, 2, 10), { playlistId: CASUAL, won: false });
    play("S", t(10, 20, 10));
    const p = pages();
    expect(p.sessionDetail("S", "ranked")?.baseline).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    expect(p.sessionDetail("S", "everything")?.baseline).toMatchObject({ matches: 2, wins: 1, losses: 1 });
  });
});

describe("match detail, periods and seasons", () => {
  test("a match with its players, goals, result and session", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { won: false });
    const m = pages().matchDetail("B");
    expect(m?.match.guid).toBe("B");
    expect(m?.players.map((x) => [x.playerKey, x.isMe])).toEqual([
      [ME, true],
      [THEM, false],
    ]);
    expect(m?.goals).toHaveLength(2);
    expect([m?.result, m?.sessionKey]).toEqual(["loss", "A"]);
    expect(pages().matchDetail("nope")).toBeNull();
    expect(pages().sessionKeyOf("B")).toBe("A");
  });

  test("a period: its range, your aggregate under the filter, playlists played", () => {
    const { play, watch, pages } = seed();
    play("A", t(10, 10, 10));
    play("B", t(10, 10, 10, 10), { playlistId: CASUAL });
    watch("W", t(10, 10, 12));
    const period = pages().period({ kind: "day", day: "2026-10-10" }, "casual", ROLLING_WINDOW);
    expect(period).toMatchObject({
      range: { from: t(10, 10, 4), to: t(10, 11, 4), running: false },
      aggregate: { matches: 1 },
      playlistsPresent: [CASUAL, RANKED],
      sessions: 1,
    });
    expect(pages().period({ kind: "day", day: "2026-10-10" }, "private", ROLLING_WINDOW)?.sessions).toBe(0);
  });

  test("a period's buckets: a 03:30 match counts toward the day before", () => {
    const { play, pages } = seed();
    play("A", t(10, 10, 3, 30));
    play("B", t(10, 10, 12), { won: false });
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "everything", ROLLING_WINDOW);
    expect(period?.bucket).toBe("day");
    expect(period?.buckets).toHaveLength(31);
    const on = (day: string) => period?.buckets.find((b) => b.day === day)?.stats;
    expect(on("2026-10-09")).toMatchObject({ matches: 1, wins: 1, losses: 0, winPct: 1 });
    expect(on("2026-10-10")).toMatchObject({ matches: 1, wins: 0, losses: 1, winPct: 0 });
    expect(on("2026-10-11")).toMatchObject({ matches: 0, winPct: null, perGame: { goals: null } });
  });

  test("a month is compared with the month before, under the same filter", () => {
    const { play, pages } = seed();
    play("S", t(9, 5, 12));
    play("C", t(9, 6, 12), { playlistId: CASUAL });
    play("O", t(10, 5, 12));
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW);
    expect(period?.previous?.range).toEqual({ from: t(9, 1, 4), to: t(10, 1, 4), running: false });
    expect(period?.previous?.aggregate.matches).toBe(1);
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.previous).toBeNull();
  });

  test("all time under a filter starts at the filter's first month", () => {
    const { play, pages } = seed();
    play("C", t(8, 20, 12), { playlistId: CASUAL });
    play("R", t(10, 5, 12));
    const days = (filter: "ranked" | "everything") => pages().period({ kind: "all" }, filter, ROLLING_WINDOW)?.buckets.map((b) => b.day);
    expect(days("ranked")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(days("everything")?.[0]).toBe("2026-08-01");
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.firstDay).toBe("2026-10-05");
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.buckets.map((b) => b.stats.matches)).toEqual([1, 0, 0]);
    expect(pages().period({ kind: "all" }, "ranked", ROLLING_WINDOW)?.bucket).toBe("month");
  });

  test("rolling points: the first window reaches back before the period, played and under the filter", () => {
    const { play, watch, pages } = seed();
    for (let d = 1; d <= 19; d++) play(`S${String(d)}`, t(9, d, 12));
    play("C", t(9, 25, 12), { playlistId: CASUAL, won: false }); // outside the filter: not counted
    watch("W", t(9, 26, 12)); // spectated: not counted
    play("O1", t(10, 5, 12), { won: false });
    play("O2", t(10, 6, 12), { won: false });
    const { rolling } = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW) ?? { rolling: [] };
    expect(rolling.map((p) => [p.n, p.startedAt, p.stats.matches, p.stats.wins])).toEqual([
      [1, t(10, 5, 12), 20, 19],
      [2, t(10, 6, 12), 20, 18],
    ]);
    expect(pages().period({ kind: "month", day: "2026-10-01" }, "casual", ROLLING_WINDOW)?.rolling).toEqual([]);
  });

  test("the rolling window size comes from the caller: with 5 and nothing before, the first point is match 5", () => {
    const { play, pages } = seed();
    for (let d = 1; d <= 6; d++) play(`M${String(d)}`, t(10, d, 12), { won: d % 2 === 0 });
    const { rolling } = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", 5) ?? { rolling: [] };
    expect(rolling.map((p) => [p.n, p.stats.matches, p.stats.wins])).toEqual([
      [5, 5, 2],
      [6, 5, 3],
    ]);
  });

  test("a day bucket opens the day's first listed session under the filter, else the session holding its first match", () => {
    const { play, pages } = seed();
    play("X1", t(10, 10, 3, 30)); // starts on the 9th by the cutoff, runs past it
    play("X2", t(10, 10, 3, 55));
    play("X3", t(10, 10, 4, 20));
    play("K", t(10, 10, 8), { playlistId: CASUAL }); // filtered out
    play("Y", t(10, 10, 12));
    play("Z1", t(10, 20, 3, 40)); // only its tail falls on the 20th
    play("Z2", t(10, 20, 4, 5));
    const period = pages().period({ kind: "month", day: "2026-10-01" }, "ranked", ROLLING_WINDOW);
    const session = (day: string) => period?.buckets.find((b) => b.day === day)?.session;
    expect([session("2026-10-09"), session("2026-10-10"), session("2026-10-19"), session("2026-10-20")]).toEqual(["X1", "Y", "Z1", "Z1"]);
    expect(session("2026-10-11")).toBeNull();
    expect(pages().period({ kind: "month", day: "2026-10-01" }, "casual", ROLLING_WINDOW)?.buckets.find((b) => b.day === "2026-10-10")?.session).toBe("K");
    expect(pages().period({ kind: "this_year" }, "ranked", ROLLING_WINDOW)?.buckets.every((b) => b.session === null)).toBe(true);
  });

  test("played days: per local day under the filter; the first day and total ignore it", () => {
    const { play, watch, pages } = seed();
    play("C", t(3, 2, 12), { playlistId: CASUAL });
    play("A", t(10, 10, 3, 30));
    play("B", t(10, 10, 12));
    play("D", t(10, 9, 20));
    watch("W", t(10, 12, 12));
    play("Y", t(1, 1, 3)); // 2025-12-31 by the cutoff
    expect(pages().playedDays(2026, "ranked")).toEqual({
      days: [
        { day: "2026-10-09", matches: 2 },
        { day: "2026-10-10", matches: 1 },
      ],
      firstDay: "2025-12-31",
      totalMatches: 5,
    });
    expect(pages().playedDays(2025, "everything").days).toEqual([{ day: "2025-12-31", matches: 1 }]);
  });

  test("an unknown season is null; seasons are listed", () => {
    const { pages } = seed();
    expect(pages().period({ kind: "season", id: 99 }, "everything", ROLLING_WINDOW)).toBeNull();
    expect(pages().seasons().map((s) => s.name)).toEqual(["S22", "S23", "S24"]);
  });

  test("the goal list follows the filter", () => {
    const { pages } = seed();
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    writer.save(record("A", t(10, 10, 10), { goals: [goal(0, ME)] }, { endedAt: t(10, 10, 10, 5) }));
    writer.save(record("B", t(10, 10, 10, 10), { goals: [goal(1, THEM)] }, { endedAt: t(10, 10, 10, 15), playlistId: CASUAL }));
    expect(pages().sessionDetail("A", "casual")?.goals.map((g) => g.matchGuid)).toEqual(["B"]);
  });
});

describe("Clutch on the period", () => {
  const MONTH = { kind: "month", day: "2026-10-01" } as const;
  /** A ranked 3–2 win from 0–2 down. */
  const comeback = (guid: string, at: number, playlistId = RANKED) =>
    record(guid, at, { goals: [goal(1, THEM), goal(1, THEM), goal(0, ME), goal(0, ME), goal(0, ME)] }, { endedAt: at + 5 * MIN, playlistId, scoreTeam0: 3, scoreTeam1: 2 });

  test("over the filtered matches, with the best comeback's session key and the skipped matches logged", () => {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    const logger = memoryLogger();
    const pages = createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger, now: () => t(12, 31, 12) });
    writer.save(record("A", t(10, 10, 10), {}, { endedAt: t(10, 10, 10, 5) })); // 1–1, scored first
    writer.save(comeback("B", t(10, 10, 10, 10)));
    writer.save(record("J", t(10, 10, 10, 20), {}, { endedAt: t(10, 10, 10, 25), scoreTeam0: 2 })); // joined: goals ≠ score
    writer.save(record("C", t(10, 12, 10), {}, { endedAt: t(10, 12, 10, 5), playlistId: CASUAL }));
    const clutch = pages.period(MONTH, "everything", ROLLING_WINDOW)?.clutch;
    expect(clutch).toMatchObject({ matches: 4, skippedOrder: 1, scoredFirst: { w: 2, l: 0 }, concededFirst: { w: 1, l: 0 }, comebacks: { n: 1, of: 1 } });
    expect(clutch?.best).toEqual({ guid: "B", startedAt: t(10, 10, 10, 10), score: "3–2", at: "0–2", by: 2, sessionKey: "A" });
    expect(clutch?.worst).toBeNull();
    expect(logger.lines.find((l) => l.event === "clutch")?.fields).toEqual({
      matches: 4,
      skippedOrder: 1,
      skipped: ["J"],
      clockMatches: 3,
      skippedClock: 0,
      skippedClockGuids: [],
      lateScored: 0,
      lateConceded: 0,
    });
    expect(pages.period(MONTH, "casual", ROLLING_WINDOW)?.clutch?.matches).toBe(1);
  });

  test("the goal-clock stats come with the period, and a match with an unclocked goal is logged as skipped", () => {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    const logger = memoryLogger();
    const pages = createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger, now: () => t(12, 31, 12) });
    const at = (seconds: number) => ({ clock: { seconds, overtime: false } });
    // 2–1: they score at 3:20, you answer 10 s later, then win it with 0:12 left.
    const goals = [goal(1, THEM, at(200)), goal(0, ME, at(190)), goal(0, ME, at(12))];
    writer.save(record("L", t(10, 10, 10), { goals }, { endedAt: t(10, 10, 10, 5), scoreTeam0: 2, scoreTeam1: 1 }));
    writer.save(record("U", t(10, 10, 10, 10), { goals: [goal(0, ME, { clock: null })] }, { endedAt: t(10, 10, 10, 15), scoreTeam0: 1, scoreTeam1: 0 }));
    const clutch = pages.period(MONTH, "everything", ROLLING_WINDOW)?.clutch;
    expect(clutch?.skippedClock).toBe(1);
    expect(clutch?.clock).toEqual({ matches: 1, lateScored: 1, lateConceded: 0, yourGoals: 2, theirGoals: 1, answeredByThem: 0, answeredByYou: 1, lateWinners: { w: 1, l: 0 } });
    expect(logger.lines.find((l) => l.event === "clutch")?.fields).toMatchObject({ clockMatches: 1, skippedClock: 1, skippedClockGuids: ["U"], lateScored: 1, lateConceded: 0 });
  });

  test("a period of only private matches has none", () => {
    const { pages } = seed();
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    writer.save(comeback("P", t(10, 10, 10), 6));
    const v = pages().period(MONTH, "private", ROLLING_WINDOW);
    expect(v?.aggregate.matches).toBe(1);
    expect(v?.clutch).toBeNull();
  });
});

describe("Tilt on the period", () => {
  const PRIVATE = 6;
  const OFFLINE = 8;
  const wl = (w: number, l: number) => ({ w, l });
  const ZERO = wl(0, 0);
  function setup(now = t(12, 31, 12)) {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    const logger = memoryLogger();
    const pages = createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger, now: () => now });
    /** A 5-minute match of yours: won, lost, or no result (null). */
    const play = (guid: string, at: number, won: boolean | null, playlistId = RANKED) => {
      writer.save(record(guid, at, {}, { endedAt: at + 5 * MIN, playlistId, winnerTeamNum: won === null ? null : won ? 0 : 1 }));
    };
    const watch = (guid: string, at: number) => {
      writer.save(record(guid, at, { players: [player(THEM, 0), player("Epic|x|0", 1)], goals: [], statfeed: [] }, { endedAt: at + 5 * MIN }));
    };
    return { play, watch, pages, logger };
  }
  const DAY9 = { kind: "day", day: "2026-10-09" } as const;
  const DAY10 = { kind: "day", day: "2026-10-10" } as const;
  const MONTH = { kind: "month", day: "2026-10-01" } as const;

  test("a session across the period edge keeps its game numbers and is judged by its last match past the edge", () => {
    const { play, pages } = setup();
    // Day 9 ends at 04:00 on the 10th.
    play("A", t(10, 10, 3, 40), true);
    play("B", t(10, 10, 3, 50), true);
    play("C", t(10, 10, 4, 0), false);
    const day9 = pages.period(DAY9, "everything", ROLLING_WINDOW)?.tilt;
    expect(day9).toEqual({ games: [wl(2, 0), ZERO, ZERO, ZERO], streaks: [wl(1, 0), ZERO, ZERO, ZERO], sessions: 1, endedOnLoss: 1 });
    // C is game 3 and comes after a win, though A and B are outside the day.
    const day10 = pages.period(DAY10, "everything", ROLLING_WINDOW)?.tilt;
    expect(day10).toEqual({ games: [wl(0, 1), ZERO, ZERO, ZERO], streaks: [wl(0, 1), ZERO, ZERO, ZERO], sessions: 1, endedOnLoss: 1 });
  });

  test("a ranked view still numbers and streaks the casual match before it", () => {
    const { play, pages } = setup();
    play("A", t(10, 10, 10, 0), false, CASUAL);
    play("B", t(10, 10, 10, 10), false);
    play("C", t(10, 10, 10, 20), true);
    const tilt = pages.period(MONTH, "ranked", ROLLING_WINDOW)?.tilt;
    expect(tilt?.games).toEqual([wl(1, 1), ZERO, ZERO, ZERO]);
    expect(tilt?.streaks).toEqual([ZERO, wl(0, 1), wl(1, 0), ZERO]);
  });

  test("private, offline and spectated matches don't number or streak", () => {
    const { play, watch, pages } = setup();
    play("P", t(10, 10, 10, 0), false, PRIVATE);
    play("O", t(10, 10, 10, 10), false, OFFLINE);
    watch("W", t(10, 10, 10, 20));
    play("A", t(10, 10, 10, 30), false);
    play("B", t(10, 10, 10, 40), true);
    const tilt = pages.period(MONTH, "everything", ROLLING_WINDOW)?.tilt;
    expect(tilt?.games).toEqual([wl(1, 1), ZERO, ZERO, ZERO]);
    expect(tilt?.streaks).toEqual([ZERO, wl(1, 0), ZERO, ZERO]);
    expect(pages.period(MONTH, "private", ROLLING_WINDOW)?.tilt).toBeNull();
  });

  test("the current session's matches land in buckets but it isn't counted as ended; the log line", () => {
    const { play, pages, logger } = setup(t(10, 12, 10, 30));
    play("A", t(10, 10, 10, 0), false);
    play("N", t(10, 12, 10, 0), null);
    play("B", t(10, 12, 10, 10), false);
    const tilt = pages.period(MONTH, "everything", ROLLING_WINDOW)?.tilt;
    expect(tilt?.games).toEqual([wl(0, 2), ZERO, ZERO, ZERO]);
    expect([tilt?.sessions, tilt?.endedOnLoss]).toEqual([1, 1]);
    expect(logger.lines.find((l) => l.event === "tilt")?.fields).toEqual({ matches: 2, sessions: 1, endedOnLoss: 1, noResult: 1 });
  });
});

describe("the teammate filter", () => {
  const SAM = "Epic|sam|0";
  const ALEX = "Epic|alex|0";
  let added = 0;
  const addFriend = (id: string, nickname: string | null = null) =>
    storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, ?, ?)", id, nickname, (added += 1));
  /** A match of yours with these players beside you and THEM: [id, team, name]. */
  function seedWith() {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    const play = (guid: string, at: number, others: [string, 0 | 1, string?][] = [], { playlistId = RANKED, won = true } = {}) => {
      const players = [player(ME, 0), player(THEM, 1), ...others.map(([id, team, name]) => player(id, team, { name: name ?? id }))];
      writer.save(record(guid, at, { players }, { endedAt: at + 5 * MIN, playlistId, winnerTeamNum: won ? 0 : 1 }));
    };
    const pages = (now = t(12, 31, 12)) => createPages({ reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger: memoryLogger(), now: () => now });
    return { play, pages };
  }
  const sam = { friends: [SAM] } as const;

  test("list, months, current and latest count only the matches with the friend", () => {
    const { play, pages } = seedWith();
    addFriend(SAM);
    play("A", t(10, 10, 10), [[SAM, 0]]);
    play("B", t(10, 10, 10, 10));
    play("C", t(10, 12, 10));
    const p = pages(t(10, 12, 10, 10));
    expect(p.sessionList("everything", "2026-10-01", "2026-10-31", sam).sessions.map((s) => [s.key, s.matches])).toEqual([["A", 1]]);
    expect(p.sessionList("everything", "2026-10-01", "2026-10-31", "solo").sessions.map((s) => [s.key, s.matches])).toEqual([["C", 1], ["A", 1]]);
    expect(p.monthFolds("everything", "2026-11-01", sam).months).toEqual([{ month: "2026-10", sessions: 1, wins: 1, losses: 0 }]);
    expect(p.currentSummary("everything", sam)).toBeNull();
    expect(p.latest("everything", sam).session?.key).toBe("A");
  });

  test("soloqueue: a friend on the other team doesn't count against it", () => {
    const { play, pages } = seedWith();
    addFriend(SAM);
    play("A", t(10, 10, 10), [[SAM, 1]]);
    play("B", t(10, 10, 10, 10), [[SAM, 0]]);
    const d = pages().sessionDetail("A", "everything", "solo");
    expect(d?.matches.map((m) => m.guid)).toEqual(["A"]);
  });

  test("detail: matches, baseline and steps follow it; friendsPresent follows only the playlist filter", () => {
    const { play, pages } = seedWith();
    addFriend(SAM, "Sammy");
    addFriend(ALEX);
    play("P", t(10, 1, 10), [[SAM, 0]], { won: false }); // the baseline with Sam
    play("Q", t(10, 1, 10, 10), [], { won: true });
    play("A", t(10, 10, 10), [[SAM, 0]]);
    play("B", t(10, 10, 10, 10), [[ALEX, 0, "Alex"]], { playlistId: CASUAL });
    play("C", t(10, 10, 10, 20));
    play("N", t(10, 12, 10));
    const d = pages().sessionDetail("A", "everything", sam);
    expect(d?.matches.map((m) => m.guid)).toEqual(["A"]);
    expect(d?.baseline).toMatchObject({ matches: 1, wins: 0 });
    expect([d?.prev, d?.next]).toEqual(["P", null]);
    expect(d?.friendsPresent).toEqual([{ id: ALEX, name: "Alex" }, { id: SAM, name: "Sammy" }]);
    expect(pages().sessionDetail("A", "casual", sam)?.friendsPresent).toEqual([{ id: ALEX, name: "Alex" }]);
    expect(pages().sessionDetail("A", "ranked")?.friendsPresent).toEqual([{ id: SAM, name: "Sammy" }]);
    expect(pages().sessionDetail("N", "everything")?.friendsPresent).toEqual([]);
  });

  test("detail: contribution covers the session's filtered matches, breaking out the filter's friends", () => {
    const { play, pages } = seedWith();
    addFriend(SAM);
    play("P", t(10, 1, 10), [[SAM, 0]]); // another session
    play("A", t(10, 10, 10), [[SAM, 0]]);
    play("B", t(10, 10, 10, 10), [], { playlistId: CASUAL });
    const anyone = pages().sessionDetail("A", "everything")?.contribution;
    expect(anyone?.modes.map((m) => [m.mode, m.matches])).toEqual([["2", 1], ["3", 1]]);
    // Sam is in the rest when nobody is filtered for.
    expect(anyone?.modes[1]?.carry.score).toEqual([100, 100]);
    const withSam = pages().sessionDetail("A", "everything", sam)?.contribution;
    expect(withSam?.modes).toMatchObject([{ mode: "3", matches: 1, carry: { touchMatches: 1, score: [100, 100, 0], touches: [5, 5, 0] }, thirds: [[2, 2, 1], [2, 2, 1], [0, 0, 0], [2, 2, 1]] }]);
    expect(withSam?.defaultMode).toBe("3");
    expect(pages().sessionDetail("A", "private")?.contribution).toBeNull();
  });

  test("period and rolling follow it; played days' first day and total don't", () => {
    const { play, pages } = seedWith();
    addFriend(SAM);
    play("A", t(10, 10, 10), [[SAM, 0]]);
    play("B", t(10, 10, 12));
    play("C", t(10, 11, 12), [[SAM, 0]], { won: false });
    const v = pages().period({ kind: "month", day: "2026-10-01" }, "everything", 2, sam);
    expect(v?.aggregate).toMatchObject({ matches: 2, wins: 1, losses: 1 });
    expect(v?.clutch?.matches).toBe(2);
    expect(v?.sessions).toBe(2);
    expect(v?.rolling.map((r) => r.n)).toEqual([2]);
    expect(pages().playedDays(2026, "everything", sam)).toEqual({
      days: [
        { day: "2026-10-10", matches: 1 },
        { day: "2026-10-11", matches: 1 },
      ],
      firstDay: "2026-10-10",
      totalMatches: 3,
    });
  });

  test("suggestions: teammates in 3+ matches over 2+ sessions, not friends, not never-suggest, not bots", () => {
    const { play, pages } = seedWith();
    const KIM = "Epic|kim|0";
    const LEE = "Epic|lee|0";
    const BOT = "Bot|b|0";
    // Kim: 3 over two sessions. Lee: 3 in one session. Alex: 2. Sam: a friend. The opponent THEM is never a teammate.
    play("A1", t(10, 10, 10), [[KIM, 0, "kim1"], [LEE, 0], [ALEX, 0], [SAM, 0]]);
    play("A2", t(10, 10, 10, 10), [[KIM, 0], [LEE, 0], [ALEX, 0], [SAM, 0]]);
    play("A3", t(10, 10, 10, 20), [[LEE, 0], [SAM, 0]]);
    play("B1", t(10, 12, 10), [[KIM, 0, "kim2"], [SAM, 0]]);
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    for (const [g, at] of [["X1", t(10, 13, 10)], ["X2", t(10, 13, 10, 10)], ["X3", t(10, 14, 10)]] as const)
      writer.save(record(g, at, { players: [player(ME, 0), player(BOT, 0, { isBot: true })] }, { endedAt: at + 5 * MIN }));
    addFriend(SAM);
    expect(pages().friendSuggestions().suggestions).toEqual([{ id: KIM, name: "kim2", matches: 3, sessions: 2 }]);
    storage.tracker.run("INSERT INTO never_suggest (primary_id, added_at) VALUES (?, 1)", KIM);
    expect(pages().friendSuggestions().suggestions).toEqual([]);
  });

  test("friends: each with both records and when you last played them; named by nickname, seen as the last name", () => {
    const { play, pages } = seedWith();
    addFriend(SAM, "Sammy");
    addFriend(ALEX);
    play("A", t(10, 10, 10), [[SAM, 0, "sam1"]]);
    play("B", t(10, 10, 10, 10), [[SAM, 1, "sam2"]], { won: false });
    play("C", t(10, 10, 10, 20), [[SAM, 1]], { playlistId: 8 }); // offline play doesn't count
    expect(pages().friends().friends).toEqual([
      { id: ALEX, nickname: null, name: ALEX, lastSeenName: null, with: { w: 0, l: 0, n: 0 }, against: { w: 0, l: 0, n: 0 }, lastPlayed: null },
      { id: SAM, nickname: "Sammy", name: "Sammy", lastSeenName: SAM, with: { w: 1, l: 0, n: 1 }, against: { w: 0, l: 1, n: 1 }, lastPlayed: t(10, 10, 10, 10) },
    ]);
  });

  test("friend detail: null for someone not a friend; both sides, with the session of each match against them", () => {
    const { play, pages } = seedWith();
    play("A", t(10, 10, 10), [[SAM, 0]]);
    expect(pages().friendDetail(SAM)).toBeNull();
    addFriend(SAM, "Sammy");
    play("B", t(10, 12, 10), [[SAM, 1, "Sam"]], { won: false });
    const d = pages().friendDetail(SAM);
    expect(d?.friend).toEqual({ id: SAM, nickname: "Sammy", name: "Sammy", lastSeenName: "Sam" });
    expect(d?.view.with.record).toEqual({ w: 1, l: 0, n: 1 });
    expect(d?.view.against.matches.map((m) => [m.guid, m.sessionKey])).toEqual([["B", "B"]]);
  });

  test("pairs: both on one side in 3+ matches over 2+ sessions; a split lobby and offline play don't count", () => {
    const { play, pages } = seedWith();
    addFriend(SAM);
    addFriend(ALEX);
    play("A", t(10, 10, 10), [[SAM, 0], [ALEX, 0]]);
    play("B", t(10, 12, 10), [[SAM, 1], [ALEX, 1]], { won: false });
    play("C", t(10, 14, 10), [[SAM, 0], [ALEX, 1]]);
    play("D", t(10, 16, 10), [[SAM, 0], [ALEX, 0]], { playlistId: 8 });
    expect(pages().friends().pairs).toEqual([]);
    play("E", t(10, 18, 10), [[SAM, 0], [ALEX, 0]]);
    expect(pages().friends().pairs).toEqual([{ ids: [ALEX, SAM], with: { w: 2, l: 0, n: 2 }, against: { w: 0, l: 1, n: 1 }, lastPlayed: t(10, 18, 10) }]);
  });

  test("pairs: not from one session; newest last played first", () => {
    const { play, pages } = seedWith();
    const KIM = "Epic|kim|0";
    for (const id of [SAM, ALEX, KIM]) addFriend(id);
    play("A1", t(10, 10, 10), [[SAM, 0], [ALEX, 0]]);
    play("A2", t(10, 10, 10, 10), [[SAM, 0], [ALEX, 0]]);
    play("A3", t(10, 10, 10, 20), [[SAM, 0], [ALEX, 0]]);
    expect(pages().friends().pairs).toEqual([]);
    play("B", t(10, 11, 10), [[SAM, 0], [KIM, 0]]);
    play("C1", t(10, 12, 10), [[SAM, 0], [KIM, 0]]);
    play("C2", t(10, 12, 10, 10), [[SAM, 0], [KIM, 0]]);
    play("D", t(10, 13, 10), [[SAM, 0], [ALEX, 0]]);
    expect(pages().friends().pairs.map((p) => p.ids)).toEqual([[ALEX, SAM], [KIM, SAM]]);
  });

  test("pair detail: null unless two different friends; the friends and view in key order", () => {
    const { play, pages } = seedWith();
    addFriend(SAM, "Sammy");
    play("A", t(10, 10, 10), [[SAM, 0], [ALEX, 0, "Alex"]]);
    expect(pages().pairDetail(SAM, ALEX)).toBeNull();
    addFriend(ALEX);
    expect(pages().pairDetail(SAM, SAM)).toBeNull();
    const d = pages().pairDetail(SAM, ALEX);
    expect(d?.friends.map((f) => [f.id, f.name, f.lastSeenName])).toEqual([[ALEX, "Alex", "Alex"], [SAM, "Sammy", SAM]]);
    expect(d?.view.with.record).toEqual({ w: 1, l: 0, n: 1 });
  });

  test("never suggested: by last name seen, then id", () => {
    const { play, pages } = seedWith();
    play("A", t(10, 10, 10), [[ALEX, 0, "zed"], [SAM, 0, "amy"]]);
    for (const id of [ALEX, SAM, "Epic|gone|0"]) storage.tracker.run("INSERT INTO never_suggest (primary_id, added_at) VALUES (?, 1)", id);
    expect(pages().neverSuggested().players).toEqual([
      { id: SAM, name: "amy" },
      { id: "Epic|gone|0", name: "Epic|gone|0" },
      { id: ALEX, name: "zed" },
    ]);
  });
});

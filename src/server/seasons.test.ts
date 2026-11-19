import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createQueryReader } from "./query/read";
import { createSeasons } from "./seasons";
import { openStorage, type Storage } from "./storage";
import { memoryLogger } from "./testing";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-seasons-"));
  logger = memoryLogger();
  storage = openStorage({ dir, logger: memoryLogger() });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const seasons = () => createSeasons({ tracker: storage.tracker, reader: createQueryReader({ tracker: storage.tracker, logger: memoryLogger() }), logger });
const SEED = [
  { id: 1, name: "S22", startDate: "2026-03-11" },
  { id: 2, name: "S23", startDate: "2026-06-09" },
  { id: 3, name: "S24", startDate: "2026-09-23" },
];
const events = () => logger.lines.map((l) => [l.level, `${l.cat}/${l.event}`, l.fields]);

describe("seasons store", () => {
  test("an add comes back in start order, with the seed kept", () => {
    expect(seasons().add({ name: "S21", start: "2025-12-10" })).toEqual({
      ok: true,
      seasons: [{ id: 4, name: "S21", startDate: "2025-12-10" }, ...SEED],
    });
    expect(events()).toEqual([["info", "seasons/added", { id: 4, name: "S21", start: "2025-12-10" }]]);
  });

  test("an edit changes the name and the start; a row may keep its own name and start", () => {
    expect(seasons().edit(2, { name: "s23", start: "2026-06-10" })).toEqual({ ok: true, seasons: [SEED[0], { id: 2, name: "s23", startDate: "2026-06-10" }, SEED[2]] });
    expect(seasons().edit(3, { name: "S24", start: "2026-09-23" })).toMatchObject({ ok: true });
    expect(events()).toEqual([
      ["info", "seasons/edited", { id: 2, name: "s23", start: "2026-06-10" }],
      ["info", "seasons/edited", { id: 3, name: "S24", start: "2026-09-23" }],
    ]);
  });

  test("a delete removes the row", () => {
    expect(seasons().remove(2)).toEqual({ ok: true, seasons: [SEED[0], SEED[2]] });
    expect(events()).toEqual([["info", "seasons/deleted", { id: 2, name: "S23", start: "2026-06-09" }]]);
  });

  test("a name another season has, in any case, or its start day is a clash, and nothing is written", () => {
    expect(seasons().add({ name: "s22", start: "2026-12-09" })).toEqual({ ok: false, error: "duplicate_name" });
    expect(seasons().add({ name: "S25", start: "2026-09-23" })).toEqual({ ok: false, error: "duplicate_start" });
    expect(seasons().edit(1, { name: "S23", start: "2026-03-11" })).toEqual({ ok: false, error: "duplicate_name" });
    expect(seasons().edit(1, { name: "S22", start: "2026-06-09" })).toEqual({ ok: false, error: "duplicate_start" });
    expect(storage.tracker.all("SELECT id, name, start_date AS startDate FROM seasons ORDER BY id")).toEqual(SEED);
    expect(events()).toEqual([
      ["warn", "seasons/conflict", { field: "name" }],
      ["warn", "seasons/conflict", { field: "start" }],
      ["warn", "seasons/conflict", { field: "name" }],
      ["warn", "seasons/conflict", { field: "start" }],
    ]);
  });

  test("an unknown id is not found, for edit and delete", () => {
    expect(seasons().edit(99, { name: "S25", start: "2026-12-09" })).toEqual({ ok: false, error: "not_found" });
    expect(seasons().remove(99)).toEqual({ ok: false, error: "not_found" });
    expect(storage.tracker.all("SELECT id FROM seasons")).toHaveLength(3);
  });
});

const rows = () => storage.tracker.all("SELECT name, start_date AS start, file_name AS fileName, file_start AS fileStart FROM seasons ORDER BY start_date");
const FILE = [
  { name: "S22", start: "2026-03-11" },
  { name: "S23", start: "2026-06-10" },
  { name: "S24", start: "2026-09-23" },
  { name: "S25", start: "2026-12-09" },
];
const NONE = { added: 0, moved: 0, edited: 0, dismissed: 0, nameTaken: 0, startTaken: 0 };

describe("season file sync", () => {
  test("adds a new season and moves an unedited seed row to the file's corrected start", () => {
    expect(seasons().sync(FILE)).toEqual({ ...NONE, added: 1, moved: 1, changed: true });
    expect(rows()).toEqual([
      { name: "S22", start: "2026-03-11", fileName: "S22", fileStart: "2026-03-11" },
      { name: "S23", start: "2026-06-10", fileName: "S23", fileStart: "2026-06-10" },
      { name: "S24", start: "2026-09-23", fileName: "S24", fileStart: "2026-09-23" },
      { name: "S25", start: "2026-12-09", fileName: "S25", fileStart: "2026-12-09" },
    ]);
    expect(events()).toEqual([
      ["info", "seasons/moved", { id: 2, name: "S23", from: "2026-06-09", to: "2026-06-10" }],
      ["info", "seasons/added", { id: 4, name: "S25", start: "2026-12-09", source: "file" }],
    ]);
  });

  test("a second identical run changes nothing", () => {
    seasons().sync(FILE);
    const before = rows();
    expect(seasons().sync(FILE)).toEqual({ ...NONE, changed: false });
    expect(rows()).toEqual(before);
  });

  test("a row the user edited is never moved, and its file name stops a re-add", () => {
    seasons().sync(FILE);
    seasons().edit(4, { name: "S25", start: "2026-12-10" });
    expect(seasons().sync([{ name: "S25", start: "2026-12-11" }])).toEqual({ ...NONE, edited: 1, changed: false });
    expect(rows().at(-1)).toEqual({ name: "S25", start: "2026-12-10", fileName: "S25", fileStart: null });
  });

  test("a Save with nothing changed keeps the row following the file", () => {
    seasons().sync(FILE);
    seasons().edit(4, { name: "S25", start: "2026-12-09" });
    expect(seasons().sync([{ name: "S25", start: "2026-12-16" }])).toEqual({ ...NONE, moved: 1, changed: true });
    expect(rows().at(-1)).toEqual({ name: "S25", start: "2026-12-16", fileName: "S25", fileStart: "2026-12-16" });
  });

  test("a deleted file season is remembered and never comes back, in any case", () => {
    seasons().sync(FILE);
    seasons().remove(4);
    expect(storage.tracker.all("SELECT file_name AS fileName FROM seasons_dismissed")).toEqual([{ fileName: "S25" }]);
    expect(seasons().sync([{ name: "s25", start: "2026-12-09" }])).toEqual({ ...NONE, dismissed: 1, changed: false });
    expect(rows()).toHaveLength(3);
  });

  test("deleting a hand-added season dismisses nothing", () => {
    seasons().add({ name: "S21", start: "2025-12-10" });
    seasons().remove(4);
    expect(storage.tracker.all("SELECT * FROM seasons_dismissed")).toEqual([]);
  });

  test("a name a hand-added row has is left to that row", () => {
    seasons().add({ name: "s25", start: "2026-12-08" });
    expect(seasons().sync([{ name: "S25", start: "2026-12-09" }])).toEqual({ ...NONE, nameTaken: 1, changed: false });
    expect(rows().at(-1)).toEqual({ name: "s25", start: "2026-12-08", fileName: null, fileStart: null });
  });

  test("a name a renamed file row now has is left to that row, without breaking the run", () => {
    seasons().sync(FILE);
    seasons().edit(4, { name: "S26", start: "2026-12-09" });
    expect(seasons().sync([{ name: "S26", start: "2027-03-10" }, { name: "S27", start: "2027-06-09" }])).toEqual({ ...NONE, nameTaken: 1, added: 1, changed: true });
    expect(rows().slice(-2)).toEqual([
      { name: "S26", start: "2026-12-09", fileName: "S25", fileStart: null },
      { name: "S27", start: "2027-06-09", fileName: "S27", fileStart: "2027-06-09" },
    ]);
  });

  test("a start another row has is left to that row, for an add and for a move", () => {
    seasons().add({ name: "Winter", start: "2026-12-09" });
    expect(seasons().sync([{ name: "S25", start: "2026-12-09" }, { name: "S24", start: "2026-03-11" }])).toEqual({ ...NONE, startTaken: 2, changed: false });
    expect(rows().map((r) => r.name)).toEqual(["S22", "S23", "S24", "Winter"]);
  });

  test("a season dropped from the file is left alone", () => {
    expect(seasons().sync([{ name: "S25", start: "2026-12-09" }])).toEqual({ ...NONE, added: 1, changed: true });
    expect(rows().map((r) => r.name)).toEqual(["S22", "S23", "S24", "S25"]);
  });
});

describe("edits and file rows", () => {
  test("a real edit detaches the row from the file; a no-change Save doesn't", () => {
    seasons().edit(1, { name: "S22", start: "2026-03-11" });
    seasons().edit(2, { name: "Season 23", start: "2026-06-09" });
    expect(rows().slice(0, 2)).toEqual([
      { name: "S22", start: "2026-03-11", fileName: "S22", fileStart: "2026-03-11" },
      { name: "Season 23", start: "2026-06-09", fileName: "S23", fileStart: null },
    ]);
  });
});


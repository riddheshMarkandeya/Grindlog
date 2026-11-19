// The seasons table's writes. The Stats API carries no season, so new ones come from the repo's
// season file or are added by hand on the Settings page. Clashes are checked before
// writing (names case-insensitively, so `s25` clashes with `S25`); the UNIQUE constraints stay as the
// backstop. The user always wins over the file: an edited row stops following it, a deleted one is
// never brought back, and a name or start a row already has is left to that row.
import type { Season } from "../shared/periods";
import type { SeasonInput } from "../shared/schemas/tables";
import type { Db } from "./db/sqlite";
import type { Logger } from "./log";
import type { QueryReader } from "./query/read";

const C = "seasons";

export interface SyncResult {
  added: number;
  moved: number;
  /** File rows the user edited, which the file no longer moves. */
  edited: number;
  /** File seasons the user deleted. */
  dismissed: number;
  nameTaken: number;
  startTaken: number;
  changed: boolean;
}

interface FileRow {
  id: number;
  start: string;
  fileStart: string | null;
}

export type SeasonWrite = { ok: true; seasons: Season[] } | { ok: false; error: "not_found" | "duplicate_name" | "duplicate_start" };

export function createSeasons({ tracker, reader, logger }: { tracker: Db; reader: QueryReader; logger: Logger }) {
  /** Whether a row other than `id` (null: any row) has this name (case-insensitively) or start. */
  const nameTaken = (name: string, id: number | null) => tracker.get("SELECT 1 FROM seasons WHERE name = ? COLLATE NOCASE AND id IS NOT ?", name, id) !== undefined;
  const startTaken = (start: string, id: number | null) => tracker.get("SELECT 1 FROM seasons WHERE start_date = ? AND id IS NOT ?", start, id) !== undefined;

  /** The clash with another season (not `id`), if any. */
  function clash({ name, start }: SeasonInput, id: number | null): SeasonWrite | null {
    const field = nameTaken(name, id) ? "name" : startTaken(start, id) ? "start" : null;
    if (field === null) return null;
    logger.warn(C, "conflict", { field });
    return { ok: false, error: field === "name" ? "duplicate_name" : "duplicate_start" };
  }

  const exists = (id: number) => tracker.get<Season>("SELECT id, name, start_date AS startDate FROM seasons WHERE id = ?", id);

  function notFound(id: number): SeasonWrite {
    logger.warn(C, "not_found", { id });
    return { ok: false, error: "not_found" };
  }

  function add(input: SeasonInput): SeasonWrite {
    return tracker.transaction(() => {
      const refused = clash(input, null);
      if (refused) return refused;
      const id = tracker.get<{ id: number }>("INSERT INTO seasons (name, start_date) VALUES (?, ?) RETURNING id", input.name, input.start)?.id;
      logger.info(C, "added", { id, name: input.name, start: input.start });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  function edit(id: number, input: SeasonInput): SeasonWrite {
    return tracker.transaction(() => {
      const before = exists(id);
      if (!before) return notFound(id);
      const refused = clash(input, id);
      if (refused) return refused;
      // The editor posts the whole draft, so only a real change detaches the row from the file.
      const changed = before.name !== input.name || before.startDate !== input.start;
      tracker.run("UPDATE seasons SET name = ?, start_date = ?, file_start = CASE WHEN ? THEN NULL ELSE file_start END WHERE id = ?", input.name, input.start, changed, id);
      logger.info(C, "edited", { id, name: input.name, start: input.start });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  function remove(id: number): SeasonWrite {
    return tracker.transaction(() => {
      const season = exists(id);
      if (!season) return notFound(id);
      // A file season deleted stays deleted: the sync checks this list before adding.
      tracker.run("INSERT OR IGNORE INTO seasons_dismissed (file_name) SELECT file_name FROM seasons WHERE id = ? AND file_name IS NOT NULL", id);
      tracker.run("DELETE FROM seasons WHERE id = ?", id);
      logger.info(C, "deleted", { id, name: season.name, start: season.startDate });
      return { ok: true, seasons: reader.readSeasons() };
    });
  }

  /** Applies the season file's entries in one transaction. Never deletes: a season dropped from the file stays. */
  function sync(entries: readonly SeasonInput[]): SyncResult {
    return tracker.transaction(() => {
      const r: SyncResult = { added: 0, moved: 0, edited: 0, dismissed: 0, nameTaken: 0, startTaken: 0, changed: false };
      const skip = (name: string, reason: "name_taken" | "start_taken") => {
        if (reason === "name_taken") r.nameTaken++;
        else r.startTaken++;
        logger.info(C, "file_skipped", { name, reason });
      };
      for (const { name, start } of entries) {
        const row = tracker.get<FileRow>("SELECT id, start_date AS start, file_start AS fileStart FROM seasons WHERE file_name = ? COLLATE NOCASE", name);
        if (row) {
          if (row.fileStart !== row.start) r.edited++; // null once edited
          else if (row.start === start) continue;
          else if (startTaken(start, row.id)) skip(name, "start_taken");
          else {
            tracker.run("UPDATE seasons SET start_date = ?, file_start = ? WHERE id = ?", start, start, row.id);
            logger.info(C, "moved", { id: row.id, name, from: row.start, to: start });
            r.moved++;
          }
          continue;
        }
        if (tracker.get("SELECT 1 FROM seasons_dismissed WHERE file_name = ?", name)) r.dismissed++;
        // Covers a hand-added row and a file row the user renamed to this name.
        else if (nameTaken(name, null)) skip(name, "name_taken");
        else if (startTaken(start, null)) skip(name, "start_taken");
        else {
          const id = tracker.get<{ id: number }>("INSERT INTO seasons (name, start_date, file_name, file_start) VALUES (?, ?, ?, ?) RETURNING id", name, start, name, start)?.id;
          logger.info(C, "added", { id, name, start, source: "file" });
          r.added++;
        }
      }
      r.changed = r.added + r.moved > 0;
      return r;
    });
  }

  return { add, edit, remove, sync };
}

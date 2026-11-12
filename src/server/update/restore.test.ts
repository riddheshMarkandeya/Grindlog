import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { backupName, readUserVersion } from "../db/backup";
import { openDb } from "../db/sqlite";
import { memoryLogger } from "../testing";
import { restoreDbs } from "./restore";

const STARTED = "2026-11-12T10:00:00.000Z";
const at = (iso: string) => new Date(iso);
let dir: string;
let backups: string;
let failed: string;

function makeDb(path: string, version: number, marker = "x", journal = "wal"): void {
  const db = openDb(path);
  db.run("CREATE TABLE t(v TEXT)");
  db.run("INSERT INTO t VALUES (?)", marker);
  db.run(`PRAGMA user_version = ${String(version)}`);
  // A real backup is a VACUUM INTO copy, which is in rollback-journal mode.
  if (journal === "delete") db.get("PRAGMA journal_mode = DELETE");
  db.close();
}
const marker = (path: string) => {
  const db = openDb(path, { readonly: true });
  try {
    return db.get<{ v: string }>("SELECT v FROM t")?.v;
  } finally {
    db.close();
  }
};
function makeBackup(db: "tracker" | "raw", when: string, version: number, mark = "backup"): string {
  const path = join(backups, backupName(at(when), "premigration", db));
  makeDb(path, version, mark, "delete");
  return path;
}
const restore = (logger = memoryLogger()) => restoreDbs({ dataDir: dir, to: "0.1.2", startedAt: STARTED, oldVersions: { tracker: 5, raw: 3 }, logger });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-restore-"));
  backups = join(dir, "backups");
  failed = join(dir, "failed-update", "0.1.2");
  mkdirSync(backups);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("restoreDbs", () => {
  test("a DB the new version migrated moves, with its -wal and -shm, into failed-update, and its backup is renamed into place", () => {
    makeDb(join(dir, "tracker.db"), 6, "new");
    writeFileSync(join(dir, "tracker.db-wal"), "");
    writeFileSync(join(dir, "tracker.db-shm"), "");
    const backup = makeBackup("tracker", "2026-11-12T10:01:00.000Z", 5);
    const logger = memoryLogger();

    expect(restore(logger).tracker).toBe("restored");

    expect(existsSync(join(dir, "tracker.db-wal"))).toBe(false);
    expect(readdirSync(backups)).toEqual([]);
    expect(readUserVersion(join(dir, "tracker.db"))).toBe(5);
    expect(marker(join(dir, "tracker.db"))).toBe("backup");
    expect(readdirSync(failed).sort()).toEqual(["tracker.db", "tracker.db-shm", "tracker.db-wal"]);
    expect(marker(join(failed, "tracker.db"))).toBe("new");
    expect(existsSync(backup)).toBe(false);
    expect(logger.lines.find((l) => l.event === "restored")).toMatchObject({ level: "info", cat: "update", fields: { db: "tracker", backup, keptAt: join(failed, "tracker.db") } });
  });

  test("a DB still at the old version, or not there, is left alone", () => {
    makeDb(join(dir, "tracker.db"), 5, "old");
    const backup = makeBackup("tracker", "2026-11-12T10:01:00.000Z", 5);
    expect(restore()).toEqual({ tracker: "old", raw: "absent" });
    expect(marker(join(dir, "tracker.db"))).toBe("old");
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(failed)).toBe(false);
  });

  test("with no backup at the old version the newer DB stays where it is, so the old version refuses it rather than starting empty", () => {
    makeDb(join(dir, "raw.db"), 4, "new");
    makeBackup("raw", "2026-11-12T10:01:00.000Z", 2);
    const logger = memoryLogger();

    expect(restore(logger).raw).toBe("no_backup");

    expect(readUserVersion(join(dir, "raw.db"))).toBe(4);
    expect(existsSync(failed)).toBe(false);
    expect(logger.lines.find((l) => l.event === "restore_no_backup")).toMatchObject({ level: "error", fields: { db: "raw", wanted: 3, have: 4 } });
  });

  test("the newest backup at the old version wins, back to 24 h before the apply started (the window a kept backup can be from)", () => {
    makeDb(join(dir, "raw.db"), 4, "new");
    makeBackup("raw", "2026-11-11T09:59:00.000Z", 3, "too old");
    makeBackup("raw", "2026-11-11T12:00:00.000Z", 3, "kept");
    makeBackup("raw", "2026-11-12T10:02:00.000Z", 2, "other version");

    expect(restore().raw).toBe("restored");
    expect(marker(join(dir, "raw.db"))).toBe("kept");
  });

  test("a backup older than that window isn't used", () => {
    makeDb(join(dir, "raw.db"), 4, "new");
    makeBackup("raw", "2026-11-11T09:59:00.000Z", 3, "too old");
    expect(restore().raw).toBe("no_backup");
  });

  test("a restore cut short after the DB moved finishes on the next run: the -wal goes too and the backup is renamed into place", () => {
    makeDb(join(dir, "tracker.db"), 6, "new");
    writeFileSync(join(dir, "tracker.db-wal"), "");
    makeBackup("tracker", "2026-11-12T10:01:00.000Z", 5);
    mkdirSync(failed, { recursive: true });
    renameSync(join(dir, "tracker.db"), join(failed, "tracker.db"));

    expect(restore().tracker).toBe("restored");

    expect(marker(join(dir, "tracker.db"))).toBe("backup");
    expect(readdirSync(failed).sort()).toEqual(["tracker.db", "tracker.db-wal"]);
  });

  test("restoring twice is the same as once", () => {
    makeDb(join(dir, "tracker.db"), 6, "new");
    makeBackup("tracker", "2026-11-12T10:01:00.000Z", 5);
    expect(restore().tracker).toBe("restored");
    expect(restore().tracker).toBe("old");
    expect(marker(join(dir, "tracker.db"))).toBe("backup");
    expect(marker(join(failed, "tracker.db"))).toBe("new");
  });
});

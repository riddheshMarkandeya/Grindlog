import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { backupBeforeMigrate, backupsDir, dropSupersededPremigration, runDailyBackup, type Statfs } from "./db/backup";
import { migrate } from "./db/migrate";
import { rawMigrations, trackerMigrations } from "./db/migrations";
import { openDb, type Db, type OpenDbOptions } from "./db/sqlite";
import { log, type Logger } from "./log";
import { dataDir } from "./paths";

export interface Storage {
  /** Settings, seasons, IDs and match records; backed up. */
  tracker: Db;
  /** Raw Stats API events, trimmed by retention; backed up only before a migration. */
  raw: Db;
  dir: string;
  close(): void;
}

export interface StorageOptions {
  dir?: string;
  logger?: Logger;
  now?: () => Date;
  busyTimeoutMs?: number;
  /** Overrides the shipped migrations (tests use a fake next version). */
  migrations?: { tracker: readonly string[]; raw: readonly string[] };
  /** Overrides the free-space reading (tests fake a full disk). */
  statfs?: Statfs;
}

interface OpenOne {
  name: string;
  migrations: readonly string[];
  openOpts: OpenDbOptions;
  beforeMigrate?: (db: Db, from: number) => void;
  /** Called once the DB is open at `to`, with whether a migration ran. */
  afterOpen?: (to: number, migrated: boolean) => void;
}

function openOne(dir: string, logger: Logger, { name, migrations, openOpts, beforeMigrate, afterOpen }: OpenOne): Db {
  const path = join(dir, `${name}.db`);
  const started = performance.now();
  let db: Db;
  try {
    db = openDb(path, openOpts);
  } catch (err) {
    logger.error("db", "open_failed", { db: name, path, err });
    throw err;
  }
  try {
    const hook = beforeMigrate && ((from: number) => {
      beforeMigrate(db, from);
    });
    // migrate logs its own failures.
    const { from, to } = migrate(db, name, migrations, { logger, beforeMigrate: hook });
    logger.info("db", "opened", { db: name, path, version: to, ms: Math.round(performance.now() - started) });
    afterOpen?.(to, from !== to);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Opens and migrates tracker.db and raw.db in the data dir, creating it if needed. */
export function openStorage(opts: StorageOptions = {}): Storage {
  const { dir = dataDir(), logger = log, now = () => new Date(), busyTimeoutMs } = opts;
  const migrations = opts.migrations ?? { tracker: trackerMigrations, raw: rawMigrations };
  const backups = backupsDir(dir);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.error("db", "open_failed", { path: dir, err });
    throw err;
  }
  // A fresh DB (version 0) has nothing to protect. A failure (low disk included) throws: migrating
  // without the backup is what it exists to prevent, and an update's rollback restores from it.
  const premigration = (name: "tracker" | "raw") => (db: Db, from: number) => {
    if (from > 0) backupBeforeMigrate(db, from, { name, dir: backups, now, logger, statfs: opts.statfs });
  };
  const superseded = (name: "tracker" | "raw") => (to: number, migrated: boolean) => {
    if (!migrated && to > 0) dropSupersededPremigration(backups, name, to, { now, logger });
  };
  const tracker = openOne(dir, logger, { name: "tracker", migrations: migrations.tracker, openOpts: { busyTimeoutMs }, beforeMigrate: premigration("tracker"), afterOpen: superseded("tracker") });
  let raw: Db;
  try {
    raw = openOne(dir, logger, {
      name: "raw",
      migrations: migrations.raw,
      openOpts: { busyTimeoutMs, autoVacuum: "incremental", synchronous: "normal" },
      beforeMigrate: premigration("raw"),
      afterOpen: superseded("raw"),
    });
  } catch (err) {
    tracker.close();
    throw err;
  }
  runDailyBackup(tracker, { dir: backups, now, logger });
  return {
    tracker,
    raw,
    dir,
    close: () => {
      try {
        tracker.close();
      } finally {
        raw.close();
      }
    },
  };
}

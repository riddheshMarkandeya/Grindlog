import { mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DAY_MS } from "../../shared/constants";
import { renameRetry } from "../fs-retry";
import type { Logger } from "../log";
import { openDb, type Db } from "./sqlite";

export type BackupReason = "premigration" | "daily";
/** Which database a backup copies. Only tracker.db gets daily backups and keep-7 pruning. */
export type BackupDbName = "tracker" | "raw";

const KEEP_BACKUPS = 7;
/** A check firing slightly early (timer jitter, clock step) must not push the backup back an hour. */
const DUE_SLACK_MS = 5 * 60 * 1000;
/** Free space a pre-migration backup must leave on top of the copy itself, so the migration and the app still have room. */
const SPACE_MARGIN_BYTES = 256 * 1024 * 1024;
const STAMP = String.raw`(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})`;
/** tracker-<UTC yyyyMMdd-HHmmss-SSS>-<reason>.db; the fixed-width stamp makes names sort by time. */
const BACKUP_FILE = new RegExp(String.raw`^tracker-${STAMP}-[a-z]+\.db$`);
/** Any DB's backup, <db>-<stamp>-<reason>.db; group 8 is the reason. */
const ANY_BACKUP_FILE = new RegExp(String.raw`^(?:tracker|raw)-${STAMP}-([a-z]+)\.db$`);
const RAW_BACKUP_FILE = new RegExp(String.raw`^raw-${STAMP}-[a-z]+\.db$`);

/** Where the DBs' backups live, inside the data dir. */
export const backupsDir = (dataDir: string) => join(dataDir, "backups");

export function backupName(at: Date, reason: BackupReason, db: BackupDbName = "tracker"): string {
  const [date = "", time = ""] = at.toISOString().split("T"); // 2026-10-16, 09:05:03.007Z
  return `${db}-${date.replaceAll("-", "")}-${time.slice(0, 8).replaceAll(":", "")}-${time.slice(9, 12)}-${reason}.db`;
}

/** File names in `dir`; [] if the dir doesn't exist yet. */
function readNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** tracker.db's backup file names, oldest first. */
const backupsIn = (names: string[]) => names.filter((f) => BACKUP_FILE.test(f)).sort();

function stampOf(name: string): number {
  const m = ANY_BACKUP_FILE.exec(name);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, ms] = m.slice(0, 8).map(Number) as [number, number, number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

export interface BackupOptions {
  name: BackupDbName;
  dir: string;
  reason: BackupReason;
  now: () => Date;
  logger: Logger;
}

/** Copies a DB into `dir` with VACUUM INTO, then prunes that DB's backups. Logs and rethrows a failure. */
export function backupDb(db: Db, { name, dir, reason, now, logger }: BackupOptions): string {
  const at = now();
  const path = join(dir, backupName(at, reason, name));
  // Written under a name the daily check and the keep-7 count don't see, then renamed: a copy cut
  // short (full disk, killed process) must never pass for the newest good backup.
  const partial = `${path}.partial`;
  const started = performance.now();
  try {
    mkdirSync(dir, { recursive: true });
    db.run("VACUUM INTO ?", partial);
    const { size } = statSync(partial);
    renameRetry(partial, path, { logger });
    logger.info("backup", "created", { db: name, reason, path, bytes: size, ms: Math.round(performance.now() - started) });
  } catch (err) {
    logger.error("backup", "failed", { db: name, reason, path, err });
    try {
      rmSync(partial, { force: true });
    } catch {
      // Best effort: the next prune removes a leftover, and the copy's own error matters more.
    }
    throw err;
  }
  if (name === "tracker") pruneBackups(dir, { logger });
  // A raw copy is about as big as raw.db (hundreds of MB) and only matters while an update could still roll
  // back, so a day's worth is enough.
  else removeMatching(dir, logger, (f) => RAW_BACKUP_FILE.test(f) && at.getTime() - stampOf(f) > DAY_MS);
  return path;
}

/**
 * Deletes all but the newest tracker.db backups, and any `.partial` left by a copy that was killed.
 * Never throws: a failed delete only leaves an extra file.
 */
export function pruneBackups(dir: string, { logger, keep = KEEP_BACKUPS }: { logger: Logger; keep?: number }): void {
  removeMatching(dir, logger, (f, all) => {
    if (f.endsWith(".partial")) return ANY_BACKUP_FILE.test(f.slice(0, -".partial".length));
    const names = backupsIn(all);
    return names.slice(0, Math.max(0, names.length - keep)).includes(f);
  });
}

/** Deletes every raw.db backup; a healthy update no longer needs them. Never throws. */
export function removeRawBackups(dir: string, { logger }: { logger: Logger }): void {
  removeMatching(dir, logger, (f) => RAW_BACKUP_FILE.test(f));
}

/** Deletes the files in `dir` that `match` picks, logging what went. Never throws. */
function removeMatching(dir: string, logger: Logger, match: (name: string, all: string[]) => boolean): void {
  let all: string[];
  try {
    all = readNames(dir);
  } catch (err) {
    logger.warn("backup", "prune_failed", { path: dir, err });
    return;
  }
  const removed: string[] = [];
  for (const name of all.filter((f) => match(f, all))) {
    const path = join(dir, name);
    try {
      rmSync(path);
      removed.push(name);
    } catch (err) {
      logger.warn("backup", "prune_failed", { path, err });
    }
  }
  if (removed.length > 0) logger.info("backup", "pruned", { removed });
}

export interface PremigrationBackup {
  name: string;
  path: string;
  /** The backup's time from its name, in ms since the epoch. */
  at: number;
}

/** One DB's pre-migration backups in `dir`, oldest first; [] if the dir doesn't exist. */
export function premigrationBackups(dir: string, db: BackupDbName): PremigrationBackup[] {
  return readNames(dir)
    .filter((f) => f.startsWith(`${db}-`) && ANY_BACKUP_FILE.exec(f)?.[8] === "premigration")
    .sort()
    .map((name) => ({ name, path: join(dir, name), at: stampOf(name) }));
}

/** A database file's schema version, read through a read-only handle that's closed before returning. */
export function readUserVersion(path: string): number {
  const db = openDb(path, { readonly: true });
  try {
    return Number(db.pragma("user_version"));
  } finally {
    db.close();
  }
}

/** A DB's pre-migration backups under 24 h old (at `at`) taken at schema `version`. */
function youngAtVersion(dir: string, name: BackupDbName, at: number, version: number): PremigrationBackup[] {
  return premigrationBackups(dir, name).filter((b) => at - b.at >= 0 && at - b.at < DAY_MS && readUserVersion(b.path) === version);
}

/** Free space was short for a pre-migration backup; nothing was copied or migrated. */
export class LowDiskError extends Error {
  constructor(
    readonly freeBytes: number,
    readonly needBytes: number,
  ) {
    super(`not enough free disk space: ${String(freeBytes)} bytes free, ${String(needBytes)} needed`);
    this.name = "LowDiskError";
  }
}

export type Statfs = (path: string) => { bavail: number; bsize: number };

function sizeOr0(path: string): number {
  try {
    return statSync(path).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
}

/** Throws LowDiskError unless `dir`'s volume has room for a copy of the DB (with its -wal) plus a margin. */
export function ensureSpace(dir: string, dbPath: string, statfs: Statfs = statfsSync): void {
  mkdirSync(dir, { recursive: true });
  const needBytes = sizeOr0(dbPath) + sizeOr0(`${dbPath}-wal`) + SPACE_MARGIN_BYTES;
  const { bavail, bsize } = statfs(dir);
  const freeBytes = bavail * bsize;
  if (freeBytes < needBytes) throw new LowDiskError(freeBytes, needBytes);
}

export interface PremigrationOptions extends Omit<BackupOptions, "reason"> {
  statfs?: Statfs;
}

/**
 * Backs a DB up before migrating it from schema version `from`, unless a pre-migration backup at that version
 * under 24 h old already exists: a migration that fails part-way restarts every few minutes, and each try would
 * otherwise add another full copy. Throws LowDiskError (logged) when space is short, and rethrows a failed copy.
 */
export function backupBeforeMigrate(db: Db, from: number, { name, dir, now, logger, statfs }: PremigrationOptions): void {
  const at = now().getTime();
  try {
    const kept = youngAtVersion(dir, name, at, from)[0];
    if (kept) {
      logger.info("backup", "premigration_kept", { db: name, from, path: kept.path });
      return;
    }
    ensureSpace(dir, db.path, statfs);
  } catch (err) {
    if (err instanceof LowDiskError) logger.error("db", "low_disk", { db: name, freeBytes: err.freeBytes, needBytes: err.needBytes });
    else logger.error("backup", "failed", { db: name, reason: "premigration", path: dir, err });
    throw err;
  }
  backupDb(db, { name, dir, reason: "premigration", now, logger });
}

/**
 * Deletes a DB's pre-migration backups under 24 h old at schema `version`, once it has opened at that version with
 * no migration due: it has moved on from them (an old version running after a rollback records matches), so
 * reusing one for the next migration would let a later restore drop what was recorded since. Never throws.
 */
export function dropSupersededPremigration(dir: string, name: BackupDbName, version: number, { now, logger }: { now: () => Date; logger: Logger }): void {
  const at = now().getTime();
  let stale: PremigrationBackup[];
  try {
    stale = youngAtVersion(dir, name, at, version);
  } catch (err) {
    logger.warn("backup", "prune_failed", { path: dir, err });
    return;
  }
  for (const b of stale) {
    try {
      rmSync(b.path);
      logger.info("backup", "premigration_superseded", { db: name, version, path: b.path });
    } catch (err) {
      logger.warn("backup", "prune_failed", { path: b.path, err });
    }
  }
}

/**
 * Due when there is no backup, the newest is 24 h old or more, or the newest is dated in the
 * future (the clock moved back; waiting for it would skip backups for that long).
 */
export function dailyBackupDue(dir: string, now: Date): boolean {
  const newest = backupsIn(readNames(dir)).at(-1);
  if (newest === undefined) return true;
  const age = now.getTime() - stampOf(newest);
  return age >= DAY_MS - DUE_SLACK_MS || age < 0;
}

export interface DailyBackupOptions extends Omit<BackupOptions, "reason" | "name"> {
  /** While true, a due backup waits: VACUUM INTO blocks the event loop for the copy. */
  isRecording?: () => boolean;
}

/** Makes a daily backup of tracker.db if one is due. Never throws: a missed backup mustn't stop the app. */
export function runDailyBackup(db: Db, { dir, now, logger, isRecording = () => false }: DailyBackupOptions): void {
  // One instant for the check and the file's stamp: a later stamp could make tomorrow's hourly
  // check find it just under 24 h old and push the backup back an hour.
  const at = now();
  let due: boolean;
  let recording: boolean;
  try {
    due = dailyBackupDue(dir, at);
    recording = due && isRecording();
  } catch (err) {
    logger.error("backup", "failed", { reason: "daily", path: dir, err });
    return;
  }
  if (!due) return;
  if (recording) {
    logger.info("backup", "skipped_recording");
    return;
  }
  try {
    backupDb(db, { name: "tracker", dir, reason: "daily", now: () => at, logger });
  } catch {
    // already logged by backupDb
  }
}

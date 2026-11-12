// Puts back the databases a failed update migrated, from their pre-migration backups, so the version rolled
// back to can open them. Run with the app stopped, before the old version is reinstalled: an interruption
// then still leaves a database either version can open.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DAY_MS } from "../../shared/constants";
import { renameRetry } from "../fs-retry";
import { backupsDir, premigrationBackups, readUserVersion, removeRawBackups, type BackupDbName } from "../db/backup";
import type { Logger } from "../log";

const SIDE_FILES = ["", "-wal", "-shm"] as const;

export interface RestoreOptions {
  dataDir: string;
  /** The version that failed; its databases are kept in `<data>\failed-update\<to>\`. */
  to: string;
  /** When the apply started (ISO). */
  startedAt: string;
  /** The schema version each DB must be at for the old code, which is its migration count. */
  oldVersions: Record<BackupDbName, number>;
  logger: Logger;
}

/** old: nothing to do; absent: no such DB; restored: put back from a backup; no_backup: left as the new version made it. */
export type RestoreResult = "old" | "absent" | "restored" | "no_backup";

export const failedUpdateDir = (dataDir: string) => join(dataDir, "failed-update");

/** Restores each DB whose schema is newer than the old code's. Idempotent: a DB already restored reads as old. */
export function restoreDbs(o: RestoreOptions): Record<BackupDbName, RestoreResult> {
  return { tracker: restoreOne(o, "tracker"), raw: restoreOne(o, "raw") };
}

function restoreOne({ dataDir, to, startedAt, oldVersions, logger }: RestoreOptions, db: BackupDbName): RestoreResult {
  const path = join(dataDir, `${db}.db`);
  const keepDir = join(failedUpdateDir(dataDir), to);
  const kept = join(keepDir, `${db}.db`);
  const wanted = oldVersions[db];
  // Null with the DB already moved away and no backup put back yet: a restore cut short, finished below.
  const have = existsSync(path) ? readUserVersion(path) : null;
  if (have === null && !existsSync(kept)) return "absent";
  if (have !== null && have <= wanted) return "old";

  // Found before anything moves: with no backup, the newer DB must stay, or the old exe would create an empty
  // one and pass its health check with the history hidden. Back to 24 h before the apply, since the tracker
  // reuses a pre-migration backup at the same schema version that young instead of making another. Every
  // handle readUserVersion opens is closed again, which Windows needs before it moves the file.
  const notBefore = Date.parse(startedAt) - DAY_MS;
  const backup = premigrationBackups(backupsDir(dataDir), db)
    .filter((b) => b.at >= notBefore)
    .reverse()
    .find((b) => readUserVersion(b.path) === wanted);
  if (!backup) {
    logger.error("update", "restore_no_backup", { db, wanted, have });
    return "no_backup";
  }
  mkdirSync(keepDir, { recursive: true });
  // The -wal goes too: left beside the backup, SQLite would replay the newer DB's pages into it.
  for (const suffix of SIDE_FILES) {
    if (existsSync(path + suffix)) renameRetry(path + suffix, kept + suffix, { logger });
  }
  // A rename on one volume is atomic and needs no space, unlike copying hundreds of MB.
  renameRetry(backup.path, path, { logger });
  logger.info("update", "restored", { db, backup: backup.path, keptAt: kept, from: have, to: wanted });
  return "restored";
}

/** After a healthy update: the rollback copies and a failed update's DBs are no longer needed. Best effort. */
export function cleanUpAfterUpdate(dataDir: string, updateDir: string, logger: Logger): void {
  removeRawBackups(backupsDir(dataDir), { logger });
  for (const path of [failedUpdateDir(dataDir), join(updateDir, "rollback-setup.exe")]) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (err) {
      logger.warn("update", "cleanup_failed", { path, err });
    }
  }
}

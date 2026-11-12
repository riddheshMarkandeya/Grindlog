// The updater: a copy of the old exe, run from the data dir with --update so the installer can replace the
// app's files. It stops the app, runs the verified installer, starts the new version and waits to see it
// stay up; if it doesn't, it puts the databases back and reinstalls the version that was running.
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_LATEST_PAGE } from "../../shared/release";
import type { BackupDbName } from "../db/backup";
import type { Logger } from "../log";
import type { PowerShellToast } from "../notifier";
import { endApply, type EndApplyOptions } from "./apply-end";
import { checkInstaller, installerFiles } from "./files";
import { healthFields, waitHealthy, type HealthReading } from "./health";
import { cleanUpAfterUpdate, restoreDbs } from "./restore";
import { readStartFailure, readState, writeState, type ApplyOutcome, type ApplyPhase, type ApplyRecord } from "./state";

/** Inno's own install takes well under a minute; this long means it hung (a dialog nobody can see). */
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface InstallerRun {
  code: number | null;
  timedOut: boolean;
}

export interface UpdaterDeps {
  /** The install dir, holding the exe the updater stops, replaces and starts. */
  appDir: string;
  exeName: string;
  dataDir: string;
  updateDir: string;
  logsDir: string;
  /** This updater's version, which is the version being updated from. */
  running: string;
  publicKey: string;
  port: number;
  /** The schema version each DB is at for this (old) code, which is its migration count. */
  oldVersions: Record<BackupDbName, number>;
  logger: Logger;
  /** Ends every process of the install at `exe`; 0 once none is left. */
  quit: (exe: string) => Promise<number>;
  runInstaller: (argv: string[], timeoutMs: number) => Promise<InstallerRun>;
  /** Starts `<app>\<exe> --supervisor` detached. Throws if it can't. */
  startSupervisor: (exe: string) => void;
  probe: (port: number) => Promise<HealthReading>;
  toast: (toast: PowerShellToast) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type UpdateRunResult = ApplyOutcome | "no_apply";

const REINSTALL_TOAST: PowerShellToast = { title: "Grindlog couldn't restart", body: `Reinstall it from ${RELEASES_LATEST_PAGE}`, url: RELEASES_LATEST_PAGE };

/** The installer's command line: silent, no message boxes, and the app left alone (the updater stopped it). */
export function installerArgs(installer: string, logPath: string): string[] {
  return [installer, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NOCLOSEAPPLICATIONS", `/LOG=${logPath}`];
}

/** One update, from the apply the supervisor recorded. Never throws: every way it ends is an outcome. */
export async function runUpdate(d: UpdaterDeps): Promise<UpdateRunResult> {
  const { logger } = d;
  const now = d.now ?? Date.now;
  const started = performance.now();
  const state = readState(d.updateDir, logger);
  const { apply } = state;
  // The supervisor records the apply before it spawns this; anything else is a stray run, or a state.json
  // changed since, and stopping the app on its say-so could install something nobody chose.
  if (apply?.from !== d.running || apply.to !== state.available?.version) {
    logger.warn("update", "no_apply", { running: d.running, apply: apply ?? null, available: state.available?.version ?? null });
    return "no_apply";
  }
  const { from, to } = apply;
  const exe = join(d.appDir, d.exeName);
  const rollbackSetup = join(d.updateDir, "rollback-setup.exe");
  let phase: ApplyPhase = "starting";
  let phaseStarted = performance.now();

  const setPhase = (next: ApplyPhase) => {
    logger.info("update", "phase", { phase: next, prev: phase, from, to, ms: Math.round(performance.now() - phaseStarted) });
    phase = next;
    phaseStarted = performance.now();
    writeState(d.updateDir, logger, { apply: { ...apply, phase: next } satisfies ApplyRecord });
  };
  const finish = (outcome: ApplyOutcome, reason?: string, opts: EndApplyOptions = {}): ApplyOutcome => {
    endApply(d.updateDir, logger, apply, { outcome, ...(reason === undefined ? {} : { reason }), nowMs: now(), ...opts });
    logger.info("update", "done", { outcome, reason, ms: Math.round(performance.now() - started) });
    return outcome;
  };
  const install = async (installer: string, logName: string): Promise<boolean> => {
    const log = join(d.logsDir, logName);
    const t = performance.now();
    const { code, timedOut } = await d.runInstaller(installerArgs(installer, log), INSTALL_TIMEOUT_MS);
    const fields = { path: installer, code, ms: Math.round(performance.now() - t), log };
    if (timedOut) logger.error("update", "installer_timeout", fields);
    else if (code === 0) logger.info("update", "installer_exited", fields);
    else logger.error("update", "installer_exited", fields);
    return !timedOut && code === 0;
  };
  const health = async (version: string) => {
    const t = performance.now();
    const result = await waitHealthy({ port: d.port, version, probe: d.probe, now, ...(d.sleep ? { sleep: d.sleep } : {}) });
    logger.info("update", "health", { ...healthFields(version, result), ms: Math.round(performance.now() - t) });
    return result.ok;
  };

  // Whether a supervisor of this install is (or may be) running, so a crash never starts a second one.
  let up = true;
  const stop = (): Promise<number> => {
    up = false;
    return d.quit(exe);
  };
  const start = () => {
    // Set after the spawn, so one that throws leaves the crash path's retry to run.
    d.startSupervisor(exe);
    up = true;
  };
  // The signature check on the installer, from the path built from the validated version. Null when it passes.
  const files = installerFiles(d.updateDir, to);
  const verify = (): string | null => {
    try {
      const checked = checkInstaller({ publicKey: d.publicKey, version: to, signature: readFileSync(files.signature, "utf8"), installer: readFileSync(files.installer) });
      return checked.ok ? null : checked.reason;
    } catch (err) {
      logger.warn("update", "reverify_unreadable", { path: files.installer, err });
      return "download_unreadable";
    }
  };
  const refuse = (reason: string): ApplyOutcome => {
    logger.warn("update", "reverify_failed", { version: to, reason });
    // An unreadable file is fetched again by the next check; a bad signature is skipped for good.
    return finish("not_started", reason, reason === "download_unreadable" ? { drop: true } : { skip: reason });
  };

  const rollback = async (reason: string): Promise<ApplyOutcome> => {
    setPhase("rolling_back");
    const stopped = await stop();
    // Carried on regardless: a file still locked fails the restore's rename, which ends up as a crash.
    if (stopped !== 0) logger.error("update", "stop_failed", { code: stopped, during: "rollback" });
    restoreDbs({ dataDir: d.dataDir, to, startedAt: apply.startedAt, oldVersions: d.oldVersions, logger });
    // A failed reinstall isn't an outcome of its own: whatever's on disk is started and checked below.
    await install(rollbackSetup, `rollback-${from}.log`);
    setPhase("checking_previous");
    start();
    const back = await health(from);
    const outcome = finish(back ? "rolled_back" : "rollback_failed", reason, { skip: reason });
    await d.toast(back ? { title: "Grindlog's update didn't work", body: `Went back to ${from}.` } : REINSTALL_TOAST);
    return outcome;
  };

  try {
    // Checked before stopping anything (the download sat in a user-writable dir since the check verified it),
    // and again once the app is stopped, so the gap before the run is milliseconds, not the quit's 30 s.
    const before = verify();
    if (before !== null) return refuse(before);
    const previousSetup = join(d.updateDir, "previous", "Grindlog-Setup.exe");
    try {
      copyFileSync(previousSetup, rollbackSetup);
    } catch (err) {
      logger.error("update", "no_rollback_installer", { path: previousSetup, err });
      return finish("not_started", "no_rollback_installer");
    }

    setPhase("stopping");
    const stopped = await stop();
    if (stopped !== 0) {
      logger.error("update", "stop_failed", { code: stopped });
      start();
      return finish("not_started", "stop_failed");
    }
    const after = verify();
    if (after !== null) {
      start();
      return refuse(after);
    }

    setPhase("installing");
    if (!(await install(files.installer, `install-${to}.log`))) return await rollback("installer_failed");

    setPhase("checking");
    start();
    if (!(await health(to))) return await rollback(readStartFailure(d.updateDir, apply, logger) ? "low_disk" : "health_check_failed");
    cleanUpAfterUpdate(d.dataDir, d.updateDir, logger);
    return finish("updated", undefined, { drop: true });
  } catch (err) {
    // Deliberately broad: whatever broke, the app must not be left stopped.
    logger.error("update", "crashed", { phase, err });
    const ensureUp = () => {
      if (!up) start();
    };
    return recover(phase, { rollback, finish, ensureUp, logger, toast: d.toast });
  }
}

interface RecoverDeps {
  rollback: (reason: string) => Promise<ApplyOutcome>;
  finish: (outcome: ApplyOutcome, reason?: string, opts?: EndApplyOptions) => ApplyOutcome;
  /** Starts the install's supervisor unless one was started since the last stop. Throws if it can't. */
  ensureUp: () => void;
  logger: Logger;
  toast: (toast: PowerShellToast) => Promise<void>;
}

/** After a crash: past the point the app's files changed, roll back; before it, start the old version again. */
async function recover(phase: ApplyPhase, { rollback, finish, ensureUp, logger, toast }: RecoverDeps): Promise<ApplyOutcome> {
  try {
    if (phase === "installing" || phase === "checking") return await rollback("crashed");
    ensureUp();
    if (phase === "starting" || phase === "stopping") return finish("not_started", "crashed");
  } catch (err) {
    // Deliberately broad, as above: the last try at leaving the app running and the state readable.
    logger.error("update", "crashed", { phase: "recover", err });
    try {
      ensureUp();
    } catch (startErr) {
      logger.error("update", "start_failed", { err: startErr });
    }
  }
  // A rollback cut short: whether the old version came back is unknown, so the user is told how to fix it, and
  // the version is skipped as after any failed rollback, so the gate doesn't try it again.
  const outcome = finish("rollback_failed", "crashed", { skip: "crashed" });
  await toast(REINSTALL_TOAST);
  return outcome;
}

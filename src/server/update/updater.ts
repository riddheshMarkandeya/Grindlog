// The --update process's entry: `grindlog-updater.exe --update --app-dir <dir>`, a copy of the old exe the
// supervisor put in the data dir and started detached. Wires runUpdate to the real processes; the wiring
// itself is exercised by the release rehearsal, not by unit tests.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UPDATE_KEY } from "../../shared/update-key";
import { VERSION } from "../../shared/version";
import { spawnDetached, statusInfo } from "../control";
import { rawMigrations, trackerMigrations } from "../db/migrations";
import { createLogger } from "../log";
import { quitInstall } from "../launcher";
import { showToast } from "../notifier";
import { dashboardPort, dataDir, identity, logsDir, updateDir } from "../paths";
import { runtimeInfo } from "../runtime-info";
import { runUpdate, type InstallerRun } from "./apply";

const EXIT_FAILED = 1;
type Env = Record<string, string | undefined>;

/** Runs the installer and waits for it; past `timeoutMs` it's ended with its whole tree (Inno's Setup.tmp too). */
async function runInstaller(argv: string[], timeoutMs: number): Promise<InstallerRun> {
  const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", windowsHide: true });
  // Cast: set in the timer callback, which TS doesn't see, so it would read as always false.
  let timedOut = false as boolean;
  const timer = setTimeout(() => {
    timedOut = true;
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore", windowsHide: true });
  }, timeoutMs);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code: timedOut ? null : code, timedOut };
}

export async function runUpdater(argv: readonly string[] = process.argv, env: Env = process.env): Promise<number> {
  const logger = createLogger({ dir: logsDir(env), fileName: "updater.log" });
  const at = argv.indexOf("--app-dir");
  const appDir = at === -1 ? undefined : argv[at + 1];
  logger.info("update", "started", { pid: process.pid, appDir, running: VERSION, ...runtimeInfo() });
  const exeName = identity().exe;
  if (appDir === undefined || !existsSync(join(appDir, exeName))) {
    logger.error("update", "bad_app_dir", { appDir, exe: exeName });
    return EXIT_FAILED;
  }
  if (VERSION === null || UPDATE_KEY === null) {
    logger.error("update", "not_a_release", { version: VERSION, key: UPDATE_KEY !== null });
    return EXIT_FAILED;
  }
  let port: number;
  try {
    port = dashboardPort(env);
  } catch (err) {
    logger.error("update", "config_invalid", { err });
    return EXIT_FAILED;
  }
  try {
    await runUpdate({
      appDir,
      exeName,
      dataDir: dataDir(env),
      updateDir: updateDir(env),
      logsDir: logsDir(env),
      running: VERSION,
      publicKey: UPDATE_KEY,
      port,
      oldVersions: { tracker: trackerMigrations.length, raw: rawMigrations.length },
      logger,
      quit: (exe) => quitInstall(exe, port, logger),
      runInstaller,
      // The updater's env goes on, so a rehearsal's GRINDLOG_* settings reach the new supervisor.
      startSupervisor: (exe) => {
        const pid = spawnDetached([exe, "--supervisor"], appDir, env);
        logger.info("update", "supervisor_started", { exe, pid });
      },
      probe: statusInfo,
      toast: (toast) => showToast(logger, toast),
    });
    return 0;
  } catch (err) {
    // Deliberately broad: runUpdate handles its own failures, so this is a bug; the line is all a report has.
    logger.error("update", "crashed", { phase: "entry", err });
    return EXIT_FAILED;
  }
}

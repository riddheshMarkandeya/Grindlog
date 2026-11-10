// The exe's short-lived modes. --open (the Start menu shortcut) starts the app if it isn't running
// and opens the dashboard; --quit (the installer and updater) ends every process of this install.
// Both exit when done and never open the databases.
import { dirname, join } from "node:path";
import { DASHBOARD_HOST } from "../shared/constants";
import {
  exeProcesses as listExeProcesses,
  openInBrowser,
  pidAlive as pidAliveReal,
  QUIT_TIMEOUT_MS,
  requestStop as requestStopReal,
  SPAWN_METHOD,
  spawnDetached as spawnDetachedReal,
  statusProbe,
  stopAccepted,
  type ExeProcess,
  type Probe,
  type StopOutcome,
} from "./control";
import { EXIT_CONFIG_INVALID, EXIT_OK } from "./exit-codes";
import { createLogger, type Logger } from "./log";
import { dashboardPort, identity, logsDir } from "./paths";
import { runtimeInfo } from "./runtime-info";

const POLL_MS = 250;
/** A pre-migration backup of a large raw.db takes seconds; a minute covers it with room to spare. */
const READY_TIMEOUT_MS = 60_000;
const EXIT_FAILED = 1;

type Env = Record<string, string | undefined>;

interface LauncherDeps {
  port: number;
  execPath: string;
  probe: (port: number) => Promise<Probe>;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  logger: Logger;
}

export interface OpenDeps extends LauncherDeps {
  env: Env;
  spawnDetached: (cmd: string[], cwd: string, env: Env) => number;
  pidAlive: (pid: number) => boolean;
  openBrowser: (url: string) => Promise<void>;
}

/** Starts the app if it isn't running, opens the dashboard, and returns the exit code. */
export async function openDashboard(deps: OpenDeps): Promise<number> {
  const { port, execPath, probe, logger } = deps;
  const url = `http://${DASHBOARD_HOST}:${String(port)}/`;
  const first = await probe(port);
  if (typeof first === "object") {
    logger.info("launcher", "already_running", { pid: first.pid });
    await deps.openBrowser(url);
    return EXIT_OK;
  }

  // A supervisor sleeping between crash restarts leaves the port closed, so this can start a second
  // one. The tracker that loses gets port-taken and its supervisor stops; a process lookup on every
  // click to prevent that would cost about a second.
  let supervisorPid: number | undefined;
  const startSupervisor = (): boolean => {
    try {
      // Detached: the launcher exits right after, and an ordinary child would die with it.
      supervisorPid = deps.spawnDetached([execPath, "--supervisor"], dirname(execPath), deps.env);
    } catch (err) {
      logger.error("launcher", "spawn_failed", { execPath, err });
      return false;
    }
    logger.info("launcher", "starting_supervisor", { method: SPAWN_METHOD, pid: supervisorPid });
    return true;
  };
  if (first === "starting") logger.info("launcher", "waiting_for_startup", { port });
  else if (!startSupervisor()) return EXIT_FAILED;

  const started = deps.now();
  for (;;) {
    await deps.sleep(POLL_MS);
    const answer = await probe(port);
    const waitedMs = deps.now() - started;
    if (typeof answer === "object") {
      logger.info("launcher", "ready", { pid: answer.pid, waitedMs });
      await deps.openBrowser(url);
      return EXIT_OK;
    }
    // "Starting" at first can be a tracker on its way out (503 once its API stops); once the port
    // frees, start one after all.
    if (answer === "refused" && supervisorPid === undefined && !startSupervisor()) return EXIT_FAILED;
    // Gone early: port taken by another app, or a config problem; its own log says which.
    if (supervisorPid !== undefined && !deps.pidAlive(supervisorPid)) {
      logger.warn("launcher", "supervisor_exited", { pid: supervisorPid, waitedMs, last: answer });
      break;
    }
    if (waitedMs >= READY_TIMEOUT_MS) {
      logger.warn("launcher", "ready_timeout", { waitedMs, last: answer });
      break;
    }
  }
  // The browser's own error page beats nothing happening after a click.
  await deps.openBrowser(url);
  return EXIT_FAILED;
}

export interface QuitDeps extends LauncherDeps {
  /** The tray exe beside execPath, waited for too so the installer can replace it. */
  trayExe: string;
  selfPid: number;
  exeProcesses: (exes: string[]) => ExeProcess[];
  requestStop: (port: number) => Promise<StopOutcome>;
  /** Force-ends one process; throws if it can't. */
  killPid: (pid: number) => void;
}

/**
 * After an accepted stop, how long a supervisor gets once the port is free: the tracker still has
 * to exit, then the supervisor gives its tray up to 5 s and its output 1 s more before exiting.
 */
const SUPERVISOR_GRACE_MS = 8_000;

/**
 * Ends every process running this install's exe or its tray and returns the exit code: 0 once
 * none is left (including none running), 1 if some are still there after 30 s. Nothing that
 * records is ever force-killed: a tracker is asked to stop through its endpoint and given the time
 * it needs. A tray is left to its supervisor, unless it has none.
 */
export async function quitApp(deps: QuitDeps): Promise<number> {
  const { port, execPath, logger } = deps;
  const started = deps.now();
  const asked = new Set<number>();
  let startingAsked = false;
  // Whether any stop was accepted, and when the port was first refused after that.
  let accepted = false;
  let refusedSince: number | null = null;
  const counts = { stopRequests: 0, launcherKills: 0, supervisorKills: 0, trayKills: 0, lookupFailures: 0 };
  const counter = { "--open": "launcherKills", "--supervisor": "supervisorKills", tray: "trayKills" } as const;
  const sameExe = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const killFailed = new Set<number>();

  /** Asks the tracker to stop; true once it accepted, so a failed request is sent again next tick. */
  const ask = async (pid: number | null): Promise<boolean> => {
    const outcome = await deps.requestStop(port);
    counts.stopRequests++;
    logger.info("launcher", "stop_requested", { pid, outcome: outcome.kind === "status" ? outcome.status : outcome.kind });
    return stopAccepted(outcome);
  };
  /** Ends every listed tray for "tray", else the main-exe processes whose command line has `target`; a failure is logged and the next tick retries. */
  const kill = (list: ExeProcess[] | null, target: keyof typeof counter, waitedMs: number) => {
    for (const p of list ?? []) {
      const isTray = sameExe(p.path, deps.trayExe);
      if (target === "tray" ? !isTray : isTray || !p.commandLine.includes(target)) continue;
      try {
        deps.killPid(p.pid);
        counts[counter[target]]++;
        logger.info("launcher", "killed", { pid: p.pid, arg: target, waitedMs });
      } catch (err) {
        // ESRCH: it exited since the lookup. Any other failure is retried each tick but logged once.
        if ((err as NodeJS.ErrnoException).code === "ESRCH" || killFailed.has(p.pid)) continue;
        killFailed.add(p.pid);
        logger.error("launcher", "kill_failed", { pid: p.pid, arg: target, err });
      }
    }
  };

  for (;;) {
    let waitFor: ExeProcess[] | null;
    try {
      // A second --quit isn't waited for: it does the same job and finishes on its own.
      waitFor = deps.exeProcesses([execPath, deps.trayExe]).filter((p) => p.pid !== deps.selfPid && !(sameExe(p.path, execPath) && p.commandLine.includes("--quit")));
    } catch (err) {
      waitFor = null;
      // Once per run: a broken lookup would otherwise log on every tick; the count goes in the last line.
      if (counts.lookupFailures++ === 0) logger.error("launcher", "lookup_failed", { err });
    }
    const waitedMs = deps.now() - started;
    if (waitFor?.length === 0) {
      logger.info("launcher", "done", { waitedMs, ...counts });
      return EXIT_OK;
    }
    if (waitedMs >= QUIT_TIMEOUT_MS) {
      logger.warn("launcher", "timeout", { waitedMs, left: waitFor?.map((p) => p.pid) ?? null, ...counts });
      return EXIT_FAILED;
    }

    // A concurrent --open records nothing, but it holds the exe the installer replaces and could
    // start a supervisor after this quit has finished.
    kill(waitFor, "--open", waitedMs);
    // A tray with no supervisor (one killed, or ended in Task Manager) has nobody to close it.
    if (waitFor !== null && !waitFor.some((p) => sameExe(p.path, execPath) && p.commandLine.includes("--supervisor"))) kill(waitFor, "tray", waitedMs);

    const answer = await deps.probe(port);
    if (answer !== "refused") refusedSince = null;
    if (typeof answer === "object") {
      startingAsked = false;
      if (!asked.has(answer.pid) && (await ask(answer.pid))) {
        asked.add(answer.pid);
        accepted = true;
      }
    } else if (answer === "starting") {
      // No pid yet, so once per stretch of starting; the endpoint works before the API mounts.
      if (!startingAsked) {
        startingAsked = await ask(null);
        accepted ||= startingAsked;
      }
    } else {
      startingAsked = false;
      refusedSince ??= waitedMs;
      // Only a supervisor can be waiting to restart a tracker. A tracker its job takes down with it
      // has at most bound the port: the tracker binds before it opens storage. After an accepted
      // stop the supervisor is on its way out, closing its tray first; killing it then would leave a
      // ghost icon. A supervisor sleeping between restarts (nothing accepted) goes at once.
      if (!accepted || waitedMs - refusedSince >= SUPERVISOR_GRACE_MS) kill(waitFor, "--supervisor", waitedMs);
    }
    await deps.sleep(POLL_MS);
  }
}

/** The --open or --quit process: logs to its own file, reads the port, runs the mode, returns the exit code. */
export async function runLauncher(role: "open" | "quit", env: Env = process.env): Promise<number> {
  // Its own file, apart from the long-lived roles' logs. Short launchers sharing it now and then is
  // fine: the logger tolerates losing a rotation race.
  const logger = createLogger({ dir: logsDir(env), fileName: "launcher.log" });
  logger.info("launcher", "started", { pid: process.pid, mode: role, ...runtimeInfo() });
  let port: number;
  try {
    port = dashboardPort(env);
  } catch (err) {
    logger.error("launcher", "config_invalid", { err });
    return EXIT_CONFIG_INVALID;
  }
  const clock = { sleep: Bun.sleep, now: Date.now };
  const execPath = process.execPath;
  try {
    if (role === "open") {
      return await openDashboard({
        port,
        execPath,
        env,
        probe: statusProbe,
        spawnDetached: spawnDetachedReal,
        pidAlive: pidAliveReal,
        openBrowser: (url) => openInBrowser(url, logger),
        ...clock,
        logger,
      });
    }
    return await quitApp({
      port,
      execPath,
      trayExe: join(dirname(execPath), identity().trayExe),
      selfPid: process.pid,
      exeProcesses: listExeProcesses,
      probe: statusProbe,
      requestStop: requestStopReal,
      killPid: (pid) => process.kill(pid),
      ...clock,
      logger,
    });
  } catch (err) {
    // Broad on purpose: whatever escaped (PowerShell that won't start), the installer only sees the
    // exit code, and a friend's report needs this line.
    logger.error("launcher", "crashed", { mode: role, err });
    return EXIT_FAILED;
  }
}

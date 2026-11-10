// The process Task Scheduler starts: it runs the tracker hidden and restarts it after a crash,
// which Task Scheduler itself doesn't do once a task has launched. Beside it, it runs the tray
// icon, whose "Quit" stops the app, and restarts that too. It stays idle otherwise.
import { dirname, join } from "node:path";
import { APP_NAME, CHANNEL, type Channel } from "../shared/channel";
import { VERSION } from "../shared/version";
import { QUIT_TIMEOUT_MS, requestStop as requestStopReal, statusProbe, stopAccepted, type Probe, type StopOutcome } from "./control";
import { EXIT_CONFIG_INVALID, EXIT_OK, EXIT_PORT_TAKEN, EXIT_START_FAILED, TRAY_EXIT_BAD_ARGS, TRAY_EXIT_CRASHED, TRAY_EXIT_QUIT, TRAY_EXIT_STDIN_CLOSED } from "./exit-codes";
import { createLogger, type Logger } from "./log";
import { dashboardPort, identity, logsDir } from "./paths";
import { runtimeInfo } from "./runtime-info";

const RESTART_MIN_MS = 5_000;
const RESTART_MAX_MS = 5 * 60_000;
/** A child that ran this long was healthy, so its crash starts the backoff over. */
const STABLE_UPTIME_MS = 10 * 60_000;

/** A tray that ran this long was healthy, so its failure doesn't count toward giving up. */
const TRAY_STABLE_UPTIME_MS = 60_000;
/** Short tray failures in a row before this supervisor stops restarting it. */
const TRAY_MAX_SHORT_FAILURES = 3;
/** How long the tray gets to go after its stdin closes, before it is killed. */
const TRAY_STOP_WAIT_MS = 5_000;
/** How long the tray's output may keep flowing after it exited (a grandchild holding the pipe). */
const TRAY_DRAIN_MS = 1_000;
/** How often a quit re-asks a tracker that isn't ready to stop yet. */
const QUIT_RETRY_MS = 250;
/**
 * A tracker binds its port before anything else, and one that loses it exits at once, so a child
 * alive this long almost surely holds the port itself: only then is a port that gave no pid taken
 * to be its own.
 */
const OWNS_PORT_AFTER_MS = 5_000;

export type Decision = { kind: "stop" } | { kind: "restart"; delayMs: number; cause: "crash" | "start_failed" };

/** What to do after the tracker exited with `code` after `uptimeMs`; `prevDelayMs` is the last restart's delay (null if none). */
export function decide(code: number, uptimeMs: number, prevDelayMs: number | null): Decision {
  if (code === EXIT_OK || code === EXIT_PORT_TAKEN || code === EXIT_CONFIG_INVALID) return { kind: "stop" };
  const delayMs = prevDelayMs === null || uptimeMs >= STABLE_UPTIME_MS ? RESTART_MIN_MS : Math.min(prevDelayMs * 2, RESTART_MAX_MS);
  return { kind: "restart", delayMs, cause: code === EXIT_START_FAILED ? "start_failed" : "crash" };
}

export type TrayDecision = { kind: "quit" } | { kind: "done" } | { kind: "restart"; delayMs: number; shortFailures: number } | { kind: "give_up"; shortFailures: number };

/** What to do after the tray exited with `code` after `uptimeMs`; `shortFailures` counts the short failures in a row before it. */
export function decideTray(code: number, uptimeMs: number, shortFailures: number): TrayDecision {
  if (code === TRAY_EXIT_QUIT) return { kind: "quit" };
  if (code === TRAY_EXIT_STDIN_CLOSED) return { kind: "done" };
  // No retry fixes a command line the tray rejects (a tray from another version, say).
  if (code === TRAY_EXIT_BAD_ARGS) return { kind: "give_up", shortFailures };
  if (uptimeMs >= TRAY_STABLE_UPTIME_MS) return { kind: "restart", delayMs: RESTART_MIN_MS, shortFailures: 0 };
  const failures = shortFailures + 1;
  if (failures >= TRAY_MAX_SHORT_FAILURES) return { kind: "give_up", shortFailures: failures };
  return { kind: "restart", delayMs: RESTART_MIN_MS * 2 ** (failures - 1), shortFailures: failures };
}

/** The tray's command line: everything it needs, so it reads no config. A dev build has no version. */
export function trayCmd({ trayExe, name, channel, logs, port, version }: { trayExe: string; name: string; channel: Channel; logs: string; port: number; version: string | null }): string[] {
  const cmd = [trayExe, "--port", String(port), "--name", name, "--logs", logs, "--channel", channel];
  return version === null ? cmd : [...cmd, "--version", version];
}

interface Child {
  pid: number;
  exited: Promise<number>;
}
type SpawnFn = (cmd: string[], opts: { cwd: string; windowsHide: boolean; stdio: ["ignore", "ignore", "ignore"] }) => Child;

export interface TrayChild extends Child {
  stdin: { end: () => unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: () => void;
}
type SpawnTrayFn = (cmd: string[], opts: { cwd: string }) => TrayChild;

// Piped both ways: its stdout and stderr become supervisor.log lines, and closing its stdin tells it to go.
const spawnTrayReal: SpawnTrayFn = (cmd, { cwd }) => Bun.spawn(cmd, { cwd, windowsHide: true, stdin: "pipe", stdout: "pipe", stderr: "pipe" });

export interface SupervisorOptions {
  cmd: string[];
  cwd: string;
  logger: Logger;
  /** The tray to run beside the tracker; `port` is the dashboard's, which its Quit stops. */
  tray?: { cmd: string[]; cwd: string; port: number };
  spawn?: SpawnFn;
  spawnTray?: SpawnTrayFn;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  requestStop?: (port: number) => Promise<StopOutcome>;
  probe?: (port: number) => Promise<Probe>;
}

const EXITED = Symbol("exited");
/** What the tray's Quit resolves with: the dashboard port whose tracker to stop. */
interface QuitSignal {
  quitPort: number;
}

/** Calls `onLine` for each line of `stream`, including lines split across chunks and a last unterminated one. */
async function pumpLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (final: boolean) => {
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line !== "") onLine(line);
    }
    if (final && buf.trim() !== "") onLine(buf.trimEnd());
  };
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    flush(false);
  }
  buf += decoder.decode();
  flush(true);
}

/** Writes one line of the tray's stdout: its JSON events under their own name, anything else as output. */
function logTrayLine(logger: Logger, line: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = null;
  }
  if (typeof parsed === "object" && parsed !== null && typeof (parsed as { event?: unknown }).event === "string") {
    const { event, ...fields } = parsed as { event: string } & Record<string, unknown>;
    const level = event === "crashed" ? "error" : event === "open_failed" || event === "bad_args" ? "warn" : "info";
    logger[level]("tray", event, fields);
  } else {
    logger.info("tray", "output", { line });
  }
}

/** Resolves after `ms` of real time, clearing its timer once `p` wins, so nothing lingers. */
async function withinMs<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

interface Deps {
  logger: Logger;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
}

interface QuitDeps extends Deps {
  probe: (port: number) => Promise<Probe>;
  requestStop: (port: number) => Promise<StopOutcome>;
}

interface TrayRun {
  /** Settles once the tray loop has ended and written its last line. */
  done: Promise<void>;
  /** Stops restarting it, closes its stdin so it removes its icon and exits, and kills it if it hasn't after 5 s. */
  stop: () => Promise<void>;
}

/** Runs the tray, restarting it per `decideTray`, until it quits (`onQuit`), closes, gives up or is stopped. */
function superviseTray(t: NonNullable<SupervisorOptions["tray"]>, spawnTray: SpawnTrayFn, d: Deps, onQuit: () => void): TrayRun {
  const { logger, now, sleep } = d;
  let stopping = false;
  // Read through a call: the loop checks it after awaits, and the compiler would narrow a bare read.
  const isStopping = () => stopping;
  let current: TrayChild | null = null;

  async function loop(): Promise<void> {
    let shortFailures = 0;
    while (!isStopping()) {
      const started = now();
      let code: number;
      try {
        const child = spawnTray(t.cmd, { cwd: t.cwd });
        current = child;
        const pumps = Promise.all([
          pumpLines(child.stdout, (line) => { logTrayLine(logger, line); }),
          pumpLines(child.stderr, (line) => { logger.warn("tray", "stderr", { line }); }),
        ]).catch((err: unknown) => { logger.warn("tray", "read_failed", { err }); });
        code = await child.exited;
        // Its last lines (quit_clicked) belong before the exit line. Real time, not the injected
        // sleep: this only bounds a pipe a grandchild might hold open.
        await withinMs(pumps, TRAY_DRAIN_MS);
        current = null;
        logger.info("tray", "exited", { pid: child.pid, code, uptimeMs: now() - started });
      } catch (err) {
        // Bun throws synchronously when the exe is missing (ENOENT, or no csc at install): a failure like any other.
        current = null;
        logger.error("tray", "spawn_failed", { cmd: t.cmd, err });
        code = TRAY_EXIT_CRASHED;
      }
      if (isStopping()) return;
      const dec = decideTray(code, now() - started, shortFailures);
      if (dec.kind === "quit") {
        onQuit();
        return;
      }
      if (dec.kind === "done") return;
      if (dec.kind === "give_up") {
        logger.error("tray", "gave_up", { code, shortFailures: dec.shortFailures });
        return;
      }
      shortFailures = dec.shortFailures;
      logger.warn("tray", "restarting", { delayMs: dec.delayMs, shortFailures });
      await sleep(dec.delayMs);
    }
  }

  // Nothing in the loop is meant to throw; if something does, the tracker carries on without the tray.
  const done = loop().catch((err: unknown) => { logger.error("tray", "loop_failed", { err }); });

  async function stop(): Promise<void> {
    stopping = true;
    const child = current;
    if (child === null) return;
    try {
      child.stdin.end();
    } catch (err) {
      // The pipe is already broken, so the tray is on its way out; the wait below still applies.
      logger.warn("tray", "stdin_close_failed", { err });
    }
    // Its exit, not the loop's end, so the loop's 1 s output drain can't make a clean exit look hung.
    const r = await Promise.race([child.exited.then(() => EXITED), sleep(TRAY_STOP_WAIT_MS)]);
    if (r === EXITED) {
      // The loop's end, so its exited line is written before the supervisor's stopped; it bounds its own drain.
      await done;
      return;
    }
    child.kill();
    logger.warn("tray", "killed", { pid: child.pid });
    await withinMs(done, 2 * TRAY_DRAIN_MS);
  }

  return { done, stop };
}

/**
 * The tray's Quit, with the tracker `child` running: asks it to stop through the shutdown endpoint
 * and waits for it to exit. A port answering with another pid is a duplicate supervisor's tracker,
 * which this quit must not stop. Asking is retried for 30 s, and once accepted the exit gets its
 * own 30 s; past either, this process exits and its job kills the tracker, which startup recovery
 * covers. Every wait ends early when the child exits.
 */
async function quitTracker(child: Child, childStarted: number, port: number, d: QuitDeps): Promise<void> {
  const { logger, now, sleep } = d;
  const t0 = now();
  logger.info("supervisor", "quit_requested", { pid: child.pid });
  const exited = child.exited.then((code) => ({ [EXITED]: code }));
  /** `p`'s value, or EXITED (logged) if the child exits first. */
  const unlessExited = async <T>(p: Promise<T>): Promise<T | typeof EXITED> => {
    const r = await Promise.race([exited, p.then((value) => ({ value }))]);
    if (!(EXITED in r)) return r.value;
    logger.info("supervisor", "child_exited", { pid: child.pid, code: r[EXITED], waitedMs: now() - t0 });
    return EXITED;
  };

  let lastOutcome: Record<string, string> = {};
  let lastKey = "";
  // Checked per round: a round in flight at the deadline (2 s probe, 10 s request at most) finishes.
  while (now() - t0 < QUIT_TIMEOUT_MS) {
    const p = await unlessExited(d.probe(port));
    if (p === EXITED) return;
    if (typeof p === "object" && p.pid !== child.pid) {
      logger.warn("supervisor", "quit_foreign_tracker", { pid: child.pid, portPid: p.pid });
      return;
    }
    const probeKind = typeof p === "object" ? "own" : p;
    let outcome: Record<string, string> = { probe: probeKind };
    // This child's pid, or no pid once the child must hold the port. A tracker busy with its
    // synchronous startup (migrations, a backup) answers nothing, so its probe times out; the stop
    // request then waits and is handled once startup ends.
    if (probeKind === "own" || (probeKind === "starting" && now() - childStarted >= OWNS_PORT_AFTER_MS)) {
      const o = await unlessExited(d.requestStop(port));
      if (o === EXITED) return;
      if (stopAccepted(o)) {
        const acceptedAt = now();
        logger.info("supervisor", "stop_accepted", { probe: probeKind, waitedMs: acceptedAt - t0 });
        if ((await unlessExited(sleep(QUIT_TIMEOUT_MS))) === EXITED) return;
        logger.warn("supervisor", "quit_timeout", { pid: child.pid, accepted: true, waitedMs: now() - acceptedAt });
        return;
      }
      outcome = { probe: probeKind, stop: o.kind === "status" ? `status ${String(o.status)}` : o.kind };
    }
    // Once per change, not every 250 ms.
    const key = JSON.stringify(outcome);
    if (key !== lastKey) logger.info("supervisor", "quit_retrying", outcome);
    lastKey = key;
    lastOutcome = outcome;
    if ((await unlessExited(sleep(QUIT_RETRY_MS))) === EXITED) return;
  }
  logger.warn("supervisor", "quit_timeout", { pid: child.pid, accepted: false, lastOutcome, waitedMs: now() - t0 });
}

/** Runs `cmd` until it exits with a code that `decide` says to stop on, or the tray's Quit; resolves with the code. */
export async function runSupervisor(opts: SupervisorOptions): Promise<number> {
  const { cmd, cwd, logger, tray, spawn = Bun.spawn, spawnTray = spawnTrayReal, sleep = Bun.sleep, now = Date.now, requestStop = requestStopReal, probe = statusProbe } = opts;
  logger.info("supervisor", "started", { pid: process.pid, cmd, ...runtimeInfo() });

  let signalQuit: (q: QuitSignal) => void = () => undefined;
  const quit = new Promise<QuitSignal>((resolve) => {
    signalQuit = resolve;
  });
  const trayRun = tray ? superviseTray(tray, spawnTray, { logger, now, sleep }, () => { signalQuit({ quitPort: tray.port }); }) : null;

  let prevDelayMs: number | null = null;
  for (;;) {
    const started = now();
    let code: number;
    let child: Child | null = null;
    try {
      // stdio ignored: the tracker writes its own log file, and nothing reads a hidden console.
      child = spawn(cmd, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    } catch (err) {
      // Bun throws synchronously when the exe is missing (ENOENT); retrying with backoff covers a
      // reinstall that is mid-rename, and the log says why if it never comes back.
      logger.error("supervisor", "spawn_failed", { cmd, err });
    }
    if (child !== null) {
      // The tray's loop has already ended when its Quit arrives, so there is nothing to stop there.
      const r = await Promise.race([child.exited, quit]);
      if (typeof r === "object") {
        await quitTracker(child, started, r.quitPort, { logger, now, sleep, probe, requestStop });
        logger.info("supervisor", "stopped", { code: EXIT_OK, cause: "quit" });
        return EXIT_OK;
      }
      code = r;
      logger.info("supervisor", "child_exited", { pid: child.pid, code, uptimeMs: now() - started });
    } else {
      code = 1;
    }
    const decision = decide(code, now() - started, prevDelayMs);
    if (decision.kind === "stop") {
      await trayRun?.stop();
      logger.info("supervisor", "stopped", { code });
      return code;
    }
    logger.warn("supervisor", "restarting", { delayMs: decision.delayMs, cause: decision.cause });
    prevDelayMs = decision.delayMs;
    const r = await Promise.race([sleep(decision.delayMs).then(() => null), quit]);
    if (r !== null) {
      logger.info("supervisor", "restart_cancelled", {});
      logger.info("supervisor", "stopped", { code: EXIT_OK, cause: "quit" });
      return EXIT_OK;
    }
  }
}

/** The installed exe's supervisor role: runs this same exe, bare, as the tracker, and the tray beside it. */
export function superviseSelf(): void {
  // Only works compiled: from source, execPath is bare bun.exe, which would start a Bun REPL.
  const exe = process.execPath;
  const bin = dirname(exe);
  // Its own file: two processes rotating one log would race.
  const logger = createLogger({ dir: logsDir(), fileName: "supervisor.log" });
  let tray: SupervisorOptions["tray"];
  try {
    const port = dashboardPort();
    tray = { cmd: trayCmd({ trayExe: join(bin, identity().trayExe), name: APP_NAME, channel: CHANNEL, logs: logsDir(), port, version: VERSION }), cwd: bin, port };
  } catch (err) {
    // A bad GRINDLOG_PORT: the tracker exits EXIT_CONFIG_INVALID and says why; a tray could only point at nothing.
    logger.warn("tray", "skipped", { err });
  }
  void runSupervisor({ cmd: [exe], cwd: bin, logger, tray }).then(() => process.exit(EXIT_OK));
}

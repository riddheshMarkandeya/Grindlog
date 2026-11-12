// Tells "the game is closed" apart from "the game is running with its Stats API off", which the
// WebSocket alone can't: both look like a refused connection.
import { statSync } from "node:fs";
import { APP_NAME } from "../shared/channel";
import type { Logger } from "./log";
import { runCommand } from "./powershell";
import type { ConnectionStatus, StatsClient } from "./recorder/client";
import { describeProblem, isNodeError, userIniPath, type ConfigCheck } from "./stats-config";

const POLL_MS = 20_000;
/** Backstop over the config check's own spawn timeouts, so nothing it does can stall the poll. */
const CHECK_TIMEOUT_MS = 15_000;
/** How long the game may run without the Stats API answering before it counts as off. */
const OFF_AFTER_MS = 60_000;
const GAME_IMAGE = "RocketLeague.exe";

/** True when `tasklist /FO CSV /NH` output has a row for the game. The "no tasks" text is localized, so only the image-name field is read. */
export function parseTasklist(stdout: string): boolean {
  return stdout.split(/\r?\n/).some((line) => line.split(",")[0]?.replace(/"/g, "").toLowerCase() === GAME_IMAGE.toLowerCase());
}

export interface WatchState {
  /** When the game was first seen in the current stretch of waiting; null when it isn't running or we're connected. */
  gameSince: number | null;
  toasted: boolean;
}
export const initialWatchState: WatchState = { gameSince: null, toasted: false };

export interface StepOutput {
  state: WatchState;
  statsApiOff: boolean;
  /** Show the toast now. */
  toast: boolean;
  /**
   * Reconnect now rather than after the client's backoff (up to 30 s), so the 60 s measures the
   * game, not the backoff. Asked on every such poll: the game takes about 26 s to open its port.
   */
  retryNow: boolean;
}

/**
 * One poll. Only a stretch of waiting while the game runs counts; a connection or the game closing
 * ends it, so a game restarted between polls starts a fresh 60 s, and so does its toast.
 */
export function step(state: WatchState, input: { gameRunning: boolean; status: ConnectionStatus; now: number }): StepOutput {
  if (!input.gameRunning || input.status !== "waiting") return { state: initialWatchState, statsApiOff: false, toast: false, retryNow: false };
  const gameSince = state.gameSince ?? input.now;
  const statsApiOff = input.now - gameSince >= OFF_AFTER_MS;
  const toast = statsApiOff && !state.toasted;
  return { state: { gameSince, toasted: state.toasted || toast }, statsApiOff, toast, retryNow: true };
}

const DETECT_TIMEOUT_MS = 10_000;

/** Whether the game is running; throws when tasklist can't be run, fails or times out. */
export async function detectGame(): Promise<boolean> {
  const { code, stdout, stderr, timedOut } = await runCommand(["tasklist", "/FI", `IMAGENAME eq ${GAME_IMAGE}`, "/FO", "CSV", "/NH"], DETECT_TIMEOUT_MS);
  if (timedOut) throw new Error(`tasklist timed out after ${String(DETECT_TIMEOUT_MS)} ms`);
  if (code !== 0) throw new Error(`tasklist exited ${String(code)}: ${stderr.trim()}`);
  return parseTasklist(stdout);
}

export const TOAST_TITLE = `${APP_NAME} isn't getting data`;
const TOAST_BODY = "Rocket League is running but its Stats API is off. Set PacketSendRate above 0 in TAGame\\Config\\TAStatsAPI.ini, then restart the game.";

/** Why a check ran: "setup" is the dashboard's fix reading fresh settings, "file_changed" an edit to the Documents ini. */
export type CheckPhase = "startup" | "game_running" | "setup" | "file_changed";

/** A file's modified time, null when it doesn't exist; throws on any other failure. */
function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch (err) {
    if (isNodeError(err, "ENOENT")) return null;
    throw err;
  }
}

export interface GameWatchOptions {
  client: Pick<StatsClient, "status" | "retryNow">;
  logger: Logger;
  /** The port the client connects to, which the game's WebPort must match. */
  expectedWebPort: number;
  pollMs?: number;
  now?: () => number;
  detect?: () => Promise<boolean>;
  /** Shows a toast with this body, under TOAST_TITLE. */
  toast: (body: string) => Promise<void>;
  checkConfig: (phase: CheckPhase) => Promise<ConfigCheck | null>;
  checkTimeoutMs?: number;
  /** The Documents ini's modified time, null when it's missing; may throw. */
  fileMtime?: (path: string) => number | null;
}

export interface GameWatch {
  /** The game has run a minute or more without the Stats API answering. */
  statsApiOff(): boolean;
  /** The latest Stats API config check; null until one finds the install. */
  statsConfig(): ConfigCheck | null;
  /** Some check has ended, found something or not. */
  statsConfigChecked(): boolean;
  /** Checks now and keeps the result, as the poll's checks do; "timeout" past timeoutMs (default the poll's backstop). */
  recheck(timeoutMs?: number): Promise<ConfigCheck | null | "timeout">;
  stop(): void;
}

/**
 * Polls for the game while the client is waiting, flags "Stats API off" and shows one toast per game
 * run, naming what's wrong in the game's Stats API settings. Checks those at startup too, so the log
 * and status hold them before the game ever runs.
 */
export function startGameWatch(opts: GameWatchOptions): GameWatch {
  const {
    client,
    logger,
    expectedWebPort,
    checkConfig,
    pollMs = POLL_MS,
    now = Date.now,
    detect = detectGame,
    toast,
    checkTimeoutMs = CHECK_TIMEOUT_MS,
    fileMtime = mtimeOf,
  } = opts;
  let state = initialWatchState;
  let off = false;
  let detectFailing = false;
  let busy = false;
  let config: ConfigCheck | null = null;
  let checked = false;
  /** Checks overlap (a poll's and the setup's): only a newer one's result may replace a stored one. */
  let started = 0;
  let stored = 0;
  /** The watched ini's mtime when the stored check ended; "failed" when it couldn't be read. */
  let iniMtime: number | null | "failed" = null;
  let statFailing = false;

  /**
   * The Documents ini, watched while the stored check found a problem: the result is otherwise only
   * refreshed at startup and when the game runs without data, so a fix made by hand would stay
   * flagged while the game is closed.
   */
  const watchedIni = () => (config && config.problems.length > 0 ? userIniPath(config) : null);

  function statIni(path: string): number | null | "failed" {
    try {
      const m = fileMtime(path);
      statFailing = false;
      return m;
    } catch (err) {
      // Logged once per failing stretch: a poll every 20 s would flood the log.
      if (!statFailing) logger.warn("game", "stats_config_stat_failed", { path, err });
      statFailing = true;
      return "failed";
    }
  }

  /** Runs a check and keeps its result unless a later one already ended; "timeout" when it outlasts checkTimeoutMs. */
  async function runCheck(phase: CheckPhase, timeoutMs = checkTimeoutMs): Promise<ConfigCheck | null | "timeout"> {
    const seq = ++started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([checkConfig(phase), timeout]);
      checked = true;
      if (result === "timeout") logger.warn("game", "stats_config_timeout", { phase, timeoutMs });
      else if (seq > stored) {
        config = result;
        stored = seq;
        // Taken right after the check read the file; an edit in the few ms between is missed until the next one.
        const ini = watchedIni();
        if (ini !== null) iniMtime = statIni(ini);
      } else logger.info("game", "stats_config_stale", { phase });
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The toast body: the first problem's fix, or the generic hint when the install wasn't found. */
  async function toastBody(): Promise<string> {
    const check = await runCheck("game_running");
    return check === null || check === "timeout" ? TOAST_BODY : describeProblem(check.problems[0], expectedWebPort, check.file);
  }

  async function poll(): Promise<void> {
    const status = client.status();
    let gameRunning = false;
    // Connected means the game is up; tasklist only runs while waiting.
    if (status === "waiting") {
      try {
        gameRunning = await detect();
        detectFailing = false;
      } catch (err) {
        if (!detectFailing) logger.warn("game", "detect_failed", { err });
        detectFailing = true;
      }
    }
    const out = step(state, { gameRunning, status: client.status(), now: now() });
    state = out.state;
    if (out.retryNow) client.retryNow();
    if (out.statsApiOff !== off) {
      off = out.statsApiOff;
      if (off) logger.warn("game", "stats_api_off", { runningForMs: state.gameSince === null ? null : now() - state.gameSince });
      else logger.info("game", "stats_api_ok");
    }
    // The settings are re-read only here: the game may have been reinstalled or edited since startup.
    if (out.toast) await toast(await toastBody());
    await recheckIfEdited();
  }

  /** A fresh check when the watched ini's mtime moved since the stored check (or the file appeared). */
  async function recheckIfEdited(): Promise<void> {
    const ini = watchedIni();
    if (ini === null) return;
    const m = statIni(ini);
    if (m === "failed" || m === iniMtime) return;
    logger.info("game", "stats_config_file_changed", { path: ini });
    // Moved first, so a check that times out isn't retried every poll for the same edit.
    iniMtime = m;
    await runCheck("file_changed");
  }

  void runCheck("startup");
  const timer = setInterval(() => {
    // A slow tasklist or toast must not stack polls.
    if (busy) return;
    busy = true;
    void poll().finally(() => {
      busy = false;
    });
  }, pollMs);

  return {
    statsApiOff: () => off,
    statsConfig: () => config,
    statsConfigChecked: () => checked,
    recheck: (timeoutMs) => runCheck("setup", timeoutMs),
    stop: () => {
      clearInterval(timer);
    },
  };
}

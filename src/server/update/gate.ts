// The supervisor's side of applying an update: at startup, settle an apply whose updater died; every 30 s,
// decide whether a verified download should be installed now, and if so hand it to the updater.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isNewer } from "../../shared/release";
import { exeProcesses, spawnDetached, statusInfo } from "../control";
import { rawMigrations, trackerMigrations } from "../db/migrations";
import { detectGame } from "../game-watch";
import type { Logger } from "../log";
import { endApply } from "./apply-end";
import { haveInstallerFiles } from "./files";
import { healthFields, waitHealthy, type HealthReading } from "./health";
import { cleanUpAfterUpdate, restoreDbs } from "./restore";
import { readRequest, readState, writeState, type ApplyRecord, type UpdateRequest, type UpdateState } from "./state";

type Env = Record<string, string | undefined>;

const UPDATER_EXE = "grindlog-updater.exe";
export const updaterPath = (dir: string) => join(dir, UPDATER_EXE);

const COOLDOWN_MS = 60 * 60 * 1000;
/** An updater gets this long to move an apply past stopping; quitApp alone gives up after 30 s. */
const STUCK_MS = 2 * 60 * 1000;
/**
 * Longer than a whole apply can take (two 10 min installs, two 10 min health checks): past stopping, the updater
 * is looked up (a second of PowerShell) only after this, not on every tick of a normal apply.
 */
const OVERDUE_MS = 45 * 60 * 1000;

export type WaitReason = "nothing" | "apply_in_progress" | "not_newer" | "files_missing" | "not_chosen" | "cooldown" | "game_running" | "recording";
export type ApplyDecision = { kind: "apply"; to: string } | { kind: "wait"; reason: WaitReason } | { kind: "check_live" };

export interface GateInput {
  state: UpdateState;
  request: UpdateRequest;
  /** This supervisor's version. */
  running: string;
  /** Whether the available version's installer and signature are on disk. */
  filesPresent: boolean;
  now: number;
  /** Only looked up (a tasklist and a status request) once everything else allows an apply. */
  live?: { gameRunning: boolean; recording: boolean };
}

/** Whether to install the available version now. Pure: the caller gathers the facts. */
export function applyDecision({ state, request, running, filesPresent, now, live }: GateInput): ApplyDecision {
  const wait = (reason: WaitReason): ApplyDecision => ({ kind: "wait", reason });
  if (state.apply) return wait("apply_in_progress");
  const { available, lastApply } = state;
  if (!available) return wait("nothing");
  // Until the next check drops it: a version installed by hand since, or one that just ran here unhealthy.
  if (!isNewer(available.version, running)) return wait("not_newer");
  if (!filesPresent) return wait("files_missing");
  if (!request.autoApply && request.install !== available.version) return wait("not_chosen");
  // A start that keeps failing (an app that won't stop, an updater antivirus eats) must not retry every 30 s.
  if ((lastApply?.outcome === "not_started" || lastApply?.outcome === "interrupted") && now - Date.parse(lastApply.at) < COOLDOWN_MS) return wait("cooldown");
  if (!live) return { kind: "check_live" };
  if (live.gameRunning) return wait("game_running");
  if (live.recording) return wait("recording");
  return { kind: "apply", to: available.version };
}

/** An apply still at starting or stopping 2 min on: its updater may have died, or never run at all. */
export function stuckApply(state: UpdateState, now: number): boolean {
  const { apply } = state;
  return apply !== undefined && (apply.phase === "starting" || apply.phase === "stopping") && now - Date.parse(apply.startedAt) > STUCK_MS;
}

/** Whether an updater process runs; a lookup that fails counts as yes, since clearing under a live one could move the DBs twice. */
function updaterRunningSafe(updaterRunning: () => boolean, logger: Logger): boolean {
  try {
    return updaterRunning();
  } catch (err) {
    logger.error("update", "updater_lookup_failed", { err });
    return true;
  }
}

export interface SettleDeps {
  dir: string;
  /** This supervisor's version. */
  running: string;
  logger: Logger;
  /** Puts back DBs a newer version migrated (restoreDbs with this code's schema versions). */
  restore: (apply: ApplyRecord) => void;
  now?: () => number;
}

export interface ResumeDeps extends SettleDeps {
  /** Whether a process runs the updater exe; throws if it can't tell. */
  updaterRunning: () => boolean;
}

export type ResumeResult = { kind: "none" } | { kind: "updater_running" } | { kind: "cleared" } | { kind: "check_health"; apply: ApplyRecord };

/** At supervisor startup, before the tracker starts: settles an apply whose updater is gone. */
export function resumeApply(d: ResumeDeps): ResumeResult {
  const { dir, logger } = d;
  const { apply } = readState(dir, logger);
  const file = updaterPath(dir);
  // The lookup is a second of PowerShell, so it runs only when there's something an updater could own.
  if (!apply && !existsSync(file)) return { kind: "none" };
  if (updaterRunningSafe(d.updaterRunning, logger)) {
    logger.info("update", "updater_running", { apply: apply ?? null });
    return { kind: "updater_running" };
  }
  try {
    rmSync(file, { force: true });
    logger.info("update", "updater_removed", { path: file });
  } catch (err) {
    logger.warn("update", "updater_remove_failed", { path: file, err });
  }
  if (!apply) return { kind: "none" };
  return settleInterrupted(d, apply);
}

/** Ends an apply whose updater is gone, by the version that's running and the phase it was cut short in. */
export function settleInterrupted(d: SettleDeps, apply: ApplyRecord): ResumeResult {
  const { dir, logger } = d;
  const now = (d.now ?? Date.now)();
  logger.warn("update", "apply_interrupted", { phase: apply.phase, from: apply.from, to: apply.to, running: d.running });
  // Cut short during the rollback: the new version already failed once, so it isn't offered again.
  const rolledBack = apply.phase === "rolling_back" || apply.phase === "checking_previous";
  if (d.running === apply.to) {
    if (!rolledBack) return { kind: "check_health", apply };
    // The failed version runs on (the old installer never ran), so it's flagged and its failed DBs are kept.
    endApply(dir, logger, apply, { outcome: "unhealthy", reason: apply.phase, nowMs: now, skip: "interrupted" });
    return { kind: "cleared" };
  }
  if (d.running !== apply.from) {
    endApply(dir, logger, apply, { outcome: "interrupted", reason: apply.phase, nowMs: now });
    return { kind: "cleared" };
  }
  try {
    d.restore(apply);
  } catch (err) {
    // The tracker then refuses a DB still at the newer schema, which the logs and the restart loop show.
    logger.error("update", "restore_failed", { err });
  }
  endApply(dir, logger, apply, { outcome: "interrupted", reason: apply.phase, nowMs: now, ...(rolledBack ? { skip: "interrupted" } : {}) });
  return { kind: "cleared" };
}

export interface FinishDeps {
  dir: string;
  dataDir: string;
  port: number;
  logger: Logger;
  probe: (port: number) => Promise<HealthReading>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The new version runs but its updater died before seeing it healthy: checked here, in the background, with no
 * rollback (that's the updater's job, and this process is the new version).
 */
export async function finishInterrupted(apply: ApplyRecord, d: FinishDeps): Promise<void> {
  const now = d.now ?? Date.now;
  const result = await waitHealthy({ port: d.port, version: apply.to, probe: d.probe, now, ...(d.sleep ? { sleep: d.sleep } : {}) });
  d.logger.info("update", "health", { ...healthFields(apply.to, result), after: "interrupted" });
  // Either way `available` is the running version now, so it goes.
  if (result.ok) cleanUpAfterUpdate(d.dataDir, d.dir, d.logger);
  endApply(d.dir, d.logger, apply, { outcome: result.ok ? "updated" : "unhealthy", ...(result.ok ? {} : { reason: "health_check_failed" }), nowMs: now(), drop: true });
}

export interface GateDeps {
  dir: string;
  /** The running supervisor's exe, copied to be the updater. */
  appExe: string;
  running: string;
  port: number;
  logger: Logger;
  env: Env;
  updaterRunning: () => boolean;
  gameRunning: () => Promise<boolean>;
  status: (port: number) => Promise<HealthReading>;
  copyFile: (from: string, to: string) => void;
  spawn: (cmd: string[], cwd: string, env: Env) => number;
  /** For an apply whose updater died after starting this supervisor (see settleInterrupted). */
  restore: (apply: ApplyRecord) => void;
  /** Starts finishInterrupted in the background. */
  finishInterrupted: (apply: ApplyRecord) => void;
  now?: () => number;
}

/** What the last tick waited on, so a wait is logged once per change rather than every 30 s. */
export interface GateMemo {
  waiting?: WaitReason;
  /** The apply a background health check is finishing, so later ticks leave it alone. */
  finishing?: string;
}

/** One 30 s look. Never throws for an expected failure; each one is logged. */
export async function gateTick(d: GateDeps, memo: GateMemo): Promise<void> {
  const { dir, logger } = d;
  const now = (d.now ?? Date.now)();
  const state = readState(dir, logger);
  const { apply } = state;
  if (apply && memo.finishing === apply.startedAt) return;
  // Past stopping, this supervisor was started by the updater, which then must still be running.
  const pastStop = apply !== undefined && apply.phase !== "starting" && apply.phase !== "stopping" && now - Date.parse(apply.startedAt) > OVERDUE_MS;
  if (apply && (pastStop || stuckApply(state, now)) && !updaterRunningSafe(d.updaterRunning, logger)) {
    if (pastStop) {
      const settled = settleInterrupted({ dir, running: d.running, logger, restore: d.restore, now: () => now }, apply);
      if (settled.kind === "check_health") {
        memo.finishing = apply.startedAt;
        d.finishInterrupted(apply);
      }
      return;
    }
    // Likely antivirus quarantining a fresh exe in AppData; without this, updates would wait for the next logon.
    logger.warn("update", "apply_interrupted", { phase: apply.phase, from: apply.from, to: apply.to, running: d.running, cause: "updater_died" });
    endApply(dir, logger, apply, { outcome: "not_started", reason: "updater_died", nowMs: now });
    return;
  }
  const input: GateInput = { state, request: readRequest(dir, logger), running: d.running, filesPresent: state.available ? haveInstallerFiles(dir, state.available.version) : false, now };
  let decision = applyDecision(input);
  if (decision.kind === "check_live") {
    let gameRunning: boolean;
    try {
      gameRunning = await d.gameRunning();
    } catch (err) {
      // Unknown counts as running: an update stopping the tracker mid-match loses the match.
      logger.warn("update", "game_check_failed", { err });
      gameRunning = true;
    }
    // A tracker that doesn't answer isn't recording, so one stuck in a crash loop still gets the fix.
    const status = gameRunning ? "refused" : await d.status(d.port);
    decision = applyDecision({ ...input, live: { gameRunning, recording: typeof status === "object" && status.connection === "recording" } });
  }
  if (decision.kind !== "apply") {
    const reason = decision.kind === "wait" ? decision.reason : "nothing";
    if (memo.waiting !== reason && reason !== "nothing") logger.info("update", "apply_waiting", { reason, version: state.available?.version ?? null });
    memo.waiting = reason;
    return;
  }
  memo.waiting = undefined;
  startApply(d, decision.to, now);
}

function startApply(d: GateDeps, to: string, now: number): void {
  const { dir, logger } = d;
  const apply: ApplyRecord = { from: d.running, to, startedAt: new Date(now).toISOString(), phase: "starting" };
  if (!writeState(dir, logger, { apply })) return;
  const updater = updaterPath(dir);
  const appDir = dirname(d.appExe);
  try {
    // A copy outside the app dir, so the installer can replace the app's exe while this one runs.
    d.copyFile(d.appExe, updater);
    const pid = d.spawn([updater, "--update", "--app-dir", appDir], dir, d.env);
    logger.info("update", "apply_starting", { from: d.running, to, pid, updater });
  } catch (err) {
    logger.error("update", "apply_spawn_failed", { to, updater, err });
    // As not_started, so the cooldown holds off a copy that keeps failing (antivirus holding the exe).
    endApply(dir, logger, apply, { outcome: "not_started", reason: "spawn_failed", nowMs: now });
  }
}

const GATE_POLL_MS = 30_000;

export interface ApplyGateOptions {
  logger: Logger;
  version: string;
  dir: string;
  dataDir: string;
  appExe: string;
  port: number;
  env: Env;
  /** Runs `fn` after anything queued before it, so a gate tick and an update check never overlap. */
  serial: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** The startup resume and the 30 s poll, on the real processes. Wiring only: the release rehearsal exercises it. */
export function startApplyGate(o: ApplyGateOptions): { stop: () => void } {
  const { logger, dir } = o;
  const updaterRunning = () => exeProcesses([updaterPath(dir)]).length > 0;
  const restore = (apply: ApplyRecord) => {
    restoreDbs({ dataDir: o.dataDir, to: apply.to, startedAt: apply.startedAt, oldVersions: { tracker: trackerMigrations.length, raw: rawMigrations.length }, logger });
  };
  const finish = (apply: ApplyRecord) => {
    finishInterrupted(apply, { dir, dataDir: o.dataDir, port: o.port, logger, probe: statusInfo }).catch((err: unknown) => {
      // Deliberately broad: a background check must not take the supervisor down; the apply stays for the next start.
      logger.error("update", "health_crashed", { err });
    });
  };
  const resume = resumeApply({ dir, running: o.version, logger, updaterRunning, restore });
  const memo: GateMemo = {};
  if (resume.kind === "check_health") {
    memo.finishing = resume.apply.startedAt;
    finish(resume.apply);
  }
  const deps: GateDeps = {
    dir,
    appExe: o.appExe,
    running: o.version,
    port: o.port,
    logger,
    env: o.env,
    updaterRunning,
    gameRunning: detectGame,
    status: statusInfo,
    copyFile: copyFileSync,
    spawn: spawnDetached,
    restore,
    finishInterrupted: finish,
  };
  const timer = setInterval(() => {
    o.serial(() => gateTick(deps, memo)).catch((err: unknown) => {
      // Deliberately broad, as for the checks: the supervisor keeps recording alive, and the next tick runs as usual.
      logger.error("update", "gate_crashed", { err });
    });
  }, GATE_POLL_MS);
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}

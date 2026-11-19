// The supervisor's update check: find the latest release, download it, verify its minisign
// signature and signed version, and record the result in state.json. A separate updater process applies it.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import type { Channel } from "../../shared/channel";
import { installerName, isNewer } from "../../shared/release";
import type { Logger } from "../log";
import { download } from "./download";
import { feedSource, fetchLatest, pickCandidate, type FeedSource, type Pick } from "./feed";
import { startApplyGate, type ApplyGateOptions } from "./gate";
import { checkInstaller, clearDownloads, downloadDir, haveInstallerFiles, installerFiles } from "./files";
import { disabledReason } from "../../shared/update-key";
import { checkPending, readRequest, readState, writeState, type UpdateState } from "./state";

export type CheckOutcome = "up_to_date" | "downloaded" | "skipped" | "skipped_before" | "error" | "apply_in_progress";

export interface CheckDeps {
  /** <data>\update */
  dir: string;
  running: string;
  /** The base64 key line of the release key. */
  publicKey: string;
  source: FeedSource;
  logger: Logger;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
  readFile?: typeof readFileSync;
}

const INSTALLER_MAX_BYTES = 200 * 1024 * 1024;
const SIGNATURE_MAX_BYTES = 4096;

/** One check. Never throws for a feed, network or signature problem: those are outcomes. */
export async function runCheck(d: CheckDeps): Promise<CheckOutcome> {
  const started = performance.now();
  const clock = d.now ?? (() => new Date());
  const now = clock().toISOString();
  const state = readState(d.dir, d.logger);
  // While an apply is set the updater is state.json's only writer, and a check's write could undo its own.
  if (state.apply) {
    d.logger.info("update", "apply_in_progress", { phase: state.apply.phase, to: state.apply.to });
    return "apply_in_progress";
  }
  const newer = (version: string) => isNewer(version, d.running);
  const fetchOpt = d.fetch ? { fetch: d.fetch } : {};
  const skipped = state.skipped.filter((s) => newer(s.version));
  // Checked before the fetch, since a 304 says nothing new: a download the running version has caught
  // up with is stale, and one whose files are gone (antivirus quarantine, a manual delete) must be
  // fetched again, so the ETag that would 304 it away is dropped.
  const availableStale = state.available !== undefined && !newer(state.available.version);
  const availableGone = state.available !== undefined && !availableStale && !haveInstallerFiles(d.dir, state.available.version);
  if (availableStale) clearDownloads(d.dir, d.logger);
  const dropAvailable = availableStale || availableGone;
  const stillAvailable = state.available !== undefined && !dropAvailable;
  const etag = availableGone ? undefined : state.etag;

  const record = (outcome: Exclude<CheckOutcome, "apply_in_progress">, changes: Partial<UpdateState>, fields: Record<string, unknown> = {}): CheckOutcome => {
    const lastOutcome = outcome === "skipped_before" ? "skipped" : outcome;
    const finishedAt = clock().toISOString();
    writeState(d.dir, d.logger, { checkedAt: now, finishedAt, lastOutcome, lastError: undefined, skipped, ...(dropAvailable ? { available: undefined } : {}), ...changes });
    d.logger.info("update", "check_result", { outcome, ms: Math.round(performance.now() - started), ...fields });
    return outcome;
  };

  const res = await fetchLatest(d.source, { ...(etag === undefined ? {} : { etag }), ...fetchOpt });
  if (res.kind === "error") {
    if (res.rateLimitReset !== undefined) d.logger.warn("update", "rate_limited", { reset: new Date(res.rateLimitReset * 1000).toISOString() });
    return record("error", { lastError: res.error }, { status: res.status, error: res.error });
  }
  if (res.kind === "not_modified") {
    return record(stillAvailable ? "downloaded" : "up_to_date", {}, { notModified: true });
  }

  const pick: Pick = pickCandidate(res.release, d.running, skipped.map((s) => s.version));
  const handled = { etag: res.etag };
  switch (pick.kind) {
    case "bad_tag":
      return record("error", { lastError: `bad tag ${pick.tag}`, etag: undefined }, { tag: pick.tag });
    case "up_to_date":
      // The latest release is nothing newer than what runs, so a recorded download is stale too, or
      // was pulled (its release deleted, latest falling back to an older one).
      if (stillAvailable) clearDownloads(d.dir, d.logger);
      return record("up_to_date", { ...handled, available: undefined }, { latest: pick.version });
    case "skipped_before":
      return record("skipped_before", handled, { latest: pick.version });
    case "assets_missing":
      d.logger.info("update", "assets_missing", { version: pick.version, have: pick.have });
      return record("error", { lastError: `assets missing for ${pick.version}`, etag: undefined }, { latest: pick.version });
    case "candidate":
      break;
  }

  const { version } = pick;
  if (stillAvailable && state.available?.version === version) return record("downloaded", handled, { latest: version });

  const files = installerFiles(d.dir, version);
  const discard = () => {
    rmSync(files.installer, { force: true });
    rmSync(files.signature, { force: true });
  };
  const readFile = d.readFile ?? readFileSync;
  let signature: string;
  let installer: Buffer;
  try {
    mkdirSync(downloadDir(d.dir), { recursive: true });
    const t = performance.now();
    await download(pick.signature, files.signature, { maxBytes: SIGNATURE_MAX_BYTES, mustStartWith: "untrusted comment:", logger: d.logger, ...fetchOpt });
    await download(pick.installer, files.installer, { maxBytes: INSTALLER_MAX_BYTES, logger: d.logger, ...fetchOpt });
    d.logger.info("update", "download_done", { file: pick.installer.name, bytes: pick.installer.size, ms: Math.round(performance.now() - t) });
    // Read back here so antivirus taking a file between the rename and the verify is a failed
    // download that retries, like any other.
    signature = readFile(files.signature, "utf8");
    installer = readFile(files.installer);
  } catch (err) {
    d.logger.warn("update", "download_failed", { version, err });
    discard();
    return record("error", { lastError: `download failed for ${version}`, etag: undefined }, { latest: version });
  }

  const skip = (reason: string): CheckOutcome => {
    discard();
    return record("skipped", { ...handled, skipped: [...skipped, { version, reason }] }, { latest: version, reason });
  };
  const checked = checkInstaller({ publicKey: d.publicKey, version, signature, installer });
  if (!checked.ok) {
    if (checked.reason === "comment_mismatch") d.logger.warn("update", "comment_mismatch", { version, comment: checked.comment });
    else d.logger.warn("update", "verify_failed", { version, reason: checked.reason });
    return skip(checked.reason);
  }
  clearDownloads(d.dir, d.logger, version);
  return record("downloaded", { ...handled, available: { version, file: installerName(version), verifiedAt: now } }, { latest: version });
}

export interface ScheduleDeps {
  logger: Logger;
  check: () => Promise<CheckOutcome>;
  /** Polled every `pollMs` between checks: true runs a check now, in place of the scheduled one. */
  due?: () => boolean;
  pollMs?: number;
  firstDelayMs?: number;
  intervalMs?: number;
  jitterMs?: number;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: never) => void;
}

const FIRST_DELAY_MS = 3 * 60_000;
const INTERVAL_MS = 6 * 60 * 60_000;
const JITTER_MS = 30 * 60_000;

const POLL_MS = 5_000;

/**
 * Runs `check` after a short delay, then about every 6 hours, each one after the last finished. With `due`, a
 * check asked for between them runs at the next poll, and the next scheduled one counts from it.
 */
export function startUpdateChecks({ logger, check, due, pollMs = POLL_MS, firstDelayMs = FIRST_DELAY_MS, intervalMs = INTERVAL_MS, jitterMs = JITTER_MS, random = Math.random, setTimeout: set = setTimeout, clearTimeout: clear = clearTimeout }: ScheduleDeps): { stop: () => void } {
  let timer: unknown;
  let pollTimer: unknown;
  let stopped = false;
  // Set before the first await, so a poll and the scheduled timer firing in one tick can't both start a check.
  let running = false;
  const schedule = (ms: number) => {
    timer = set(() => { void run(); }, ms);
  };
  const run = async () => {
    running = true;
    try {
      await check();
    } catch (err) {
      // Deliberately broad: the supervisor running this keeps recording alive, and no updater bug may
      // take it down. The next check runs as usual.
      logger.error("update", "check_crashed", { err });
    } finally {
      running = false;
    }
    if (!stopped) schedule(intervalMs + Math.round(random() * jitterMs));
  };
  const poll = () => {
    if (!running) {
      let now = false;
      try {
        now = due?.() ?? false;
      } catch (err) {
        // Deliberately broad, as for the checks: a throw here must not end the polling.
        logger.error("update", "due_crashed", { err });
      }
      if (now) {
        clear(timer as never);
        void run();
      }
    }
    if (!stopped) pollTimer = set(poll, pollMs);
  };
  schedule(firstDelayMs);
  if (due) pollTimer = set(poll, pollMs);
  return {
    stop: () => {
      stopped = true;
      clear(timer as never);
      clear(pollTimer as never);
    },
  };
}

/**
 * Whether the dashboard has asked for a check that hasn't run. A request it already answered stays answered even
 * when that check wrote nothing (an apply in progress), so it can't fire every poll.
 */
export function checkDue(dir: string, logger: Logger, now: () => number = Date.now): () => boolean {
  let answered: string | undefined;
  return () => {
    const request = readRequest(dir, logger);
    const at = request.checkRequestedAt;
    // The common case, no request or one already answered, skips reading state.json.
    if (at === undefined || at === answered) return false;
    const nowMs = now();
    if (!checkPending(request, readState(dir, logger), nowMs)) return false;
    answered = at;
    logger.info("update", "check_requested", { requestedAt: at, waitedMs: nowMs - Date.parse(at) });
    return true;
  };
}

export interface SupervisorUpdateOptions {
  logger: Logger;
  channel: Channel;
  version: string | null;
  key: string | null;
  dir: string;
  env: Record<string, string | undefined>;
  /** Applying what the checks download: absent in tests of the checks alone, and when the port is misconfigured. */
  apply?: Omit<ApplyGateOptions, "logger" | "version" | "dir" | "env" | "serial">;
}

/**
 * The supervisor's update checks, or none in a dev build or one without a baked key. With the feed
 * overridden for testing, GRINDLOG_UPDATE_FIRST_CHECK_MS can shorten the first wait; it's ignored
 * otherwise, so a stray variable can't make a friend's install check early.
 */
export function startSupervisorUpdates({ logger, channel, version, key, dir, env, apply }: SupervisorUpdateOptions): { stop: () => void } {
  const reason = disabledReason(channel, version, key);
  if (reason !== null || version === null || key === null) {
    logger.info("update", "disabled", { reason });
    return { stop: () => undefined };
  }
  const source = feedSource(env);
  const overridden = env.GRINDLOG_UPDATE_FEED !== undefined && env.GRINDLOG_UPDATE_FEED !== "";
  const firstOverride = Number(env.GRINDLOG_UPDATE_FIRST_CHECK_MS);
  const firstDelayMs = overridden && Number.isInteger(firstOverride) && firstOverride >= 0 ? firstOverride : FIRST_DELAY_MS;
  logger.info("update", "checks_started", { source, firstDelayMs, apply: apply !== undefined });
  // One queue for checks and gate ticks: a check writing state.json from a read taken before the gate set
  // `apply` could otherwise drop the download the updater is about to verify.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const gate = apply ? startApplyGate({ ...apply, logger, version, dir, env, serial }) : null;
  const checks = startUpdateChecks({ logger, firstDelayMs, due: checkDue(dir, logger), check: () => serial(() => runCheck({ dir, running: version, publicKey: key, source, logger })) });
  return {
    stop: () => {
      checks.stop();
      gate?.stop();
    },
  };
}

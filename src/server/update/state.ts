// The small JSON files the supervisor, the tracker and the separate apply-step updater share in <data>\update\.
// Each file has one writer at a time, so no two processes ever race on one: the supervisor and updater write
// state.json (the updater alone while `apply` is set), the tracker writes request.json and start-failure.json.
// Readers take a default for a missing or bad file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UPDATE_CHECK_COOLDOWN_MS, UPDATE_CHECK_PENDING_MS } from "../../shared/constants";
import { isReleaseVersion } from "../../shared/release";
import { renameRetry } from "../fs-retry";
import type { Logger } from "../log";

export const STATE_FILE = "state.json";
export const REQUEST_FILE = "request.json";
export const START_FAILURE_FILE = "start-failure.json";

// Loose objects, nested ones too, keep fields this version doesn't know: a rollback runs older code
// against a file a newer updater wrote, and a write must not drop what that updater needs to read back.
// Versions are checked here so a bad one makes the whole file unreadable (logged, then replaced by the
// next write) rather than throwing later in every check and every tray poll.
const version = z.string().refine(isReleaseVersion, "not a release version");
const stateSchema = z.looseObject({
  v: z.literal(1),
  /** When the last check started; a check asked for before this is answered. */
  checkedAt: z.string().optional(),
  /** When the last check ended, which the manual-check cooldown counts from. */
  finishedAt: z.string().optional(),
  lastOutcome: z.enum(["up_to_date", "downloaded", "skipped", "error"]).optional(),
  lastError: z.string().optional(),
  etag: z.string().optional(),
  available: z.looseObject({ version, file: z.string(), verifiedAt: z.string() }).optional(),
  skipped: z.array(z.looseObject({ version, reason: z.string() })),
  // Present means an apply owns state.json. Phase, outcome and reason are plain strings, not enums: a value from
  // a newer version must not fail the parse, or the next write would rebuild the file from the default.
  apply: z.looseObject({ from: version, to: version, startedAt: z.string(), phase: z.string() }).optional(),
  lastApply: z.looseObject({ from: version, to: version, outcome: z.string(), reason: z.string().optional(), at: z.string() }).optional(),
});
export type UpdateState = z.infer<typeof stateSchema>;
export type ApplyRecord = NonNullable<UpdateState["apply"]>;
export type LastApply = NonNullable<UpdateState["lastApply"]>;

/** Phases this code writes; readers must tolerate others. */
export type ApplyPhase = "starting" | "stopping" | "installing" | "checking" | "rolling_back" | "checking_previous";
/** Outcomes this code writes; readers must tolerate others. */
export type ApplyOutcome = "updated" | "rolled_back" | "rollback_failed" | "not_started" | "interrupted" | "unhealthy";

const startFailureSchema = z.looseObject({
  v: z.literal(1),
  version,
  reason: z.string(),
  freeBytes: z.number(),
  needBytes: z.number(),
  at: z.string(),
});
export interface StartFailure {
  version: string;
  reason: string;
  freeBytes: number;
  needBytes: number;
  at: string;
}

const requestSchema = z.looseObject({
  v: z.literal(1),
  autoApply: z.boolean(),
  install: version.optional(),
  /** When the dashboard asked for a check now. */
  checkRequestedAt: z.string().optional(),
});
export type UpdateRequest = z.infer<typeof requestSchema>;

const DEFAULT_STATE: UpdateState = { v: 1, skipped: [] };
const DEFAULT_REQUEST: UpdateRequest = { v: 1, autoApply: true };

/** Paths already warned about, so a corrupt file polled every 2 s logs once per process. */
const warned = new Set<string>();

function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T, logger: Logger): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return fallback;
    return unreadable(path, fallback, logger, err);
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : unreadable(path, fallback, logger, parsed.error);
  } catch (err) {
    return unreadable(path, fallback, logger, err);
  }
}

function unreadable<T>(path: string, fallback: T, logger: Logger, err: unknown): T {
  if (!warned.has(path)) {
    warned.add(path);
    logger.warn("update", "state_unreadable", { path, err });
  }
  return fallback;
}

/** Merges `changes` into what's on disk (a key set to undefined is removed) and writes it atomically. */
function mergeWrite<T extends object>(dir: string, name: string, current: T, changes: Partial<T>, logger: Logger): boolean {
  const path = join(dir, name);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify({ ...current, ...changes }));
    renameRetry(`${path}.tmp`, path, { logger });
    warned.delete(path);
    return true;
  } catch (err) {
    logger.error("update", "state_write_failed", { path, err });
    return false;
  }
}

export const readState = (dir: string, logger: Logger): UpdateState => readJson(join(dir, STATE_FILE), stateSchema, DEFAULT_STATE, logger);
export const readRequest = (dir: string, logger: Logger): UpdateRequest => readJson(join(dir, REQUEST_FILE), requestSchema, DEFAULT_REQUEST, logger);

/** Supervisor and updater only. Returns false (and logs) when the write failed. */
export const writeState = (dir: string, logger: Logger, changes: Partial<UpdateState>): boolean => mergeWrite(dir, STATE_FILE, readState(dir, logger), changes, logger);
/** Tracker only. Returns false (and logs) when the write failed. */
export const writeRequest = (dir: string, logger: Logger, changes: Partial<UpdateRequest>): boolean => mergeWrite(dir, REQUEST_FILE, readRequest(dir, logger), changes, logger);

/** Tracker only: why the last start failed, for the updater's health check. Never deleted; readers filter by apply. */
export const writeStartFailure = (dir: string, logger: Logger, failure: StartFailure): boolean => mergeWrite(dir, START_FAILURE_FILE, {}, { v: 1, ...failure }, logger);

/** The start failure the apply's new version wrote after the apply began, if any. */
export function readStartFailure(dir: string, apply: Pick<ApplyRecord, "to" | "startedAt">, logger: Logger): StartFailure | undefined {
  const failure = readJson<StartFailure | undefined>(join(dir, START_FAILURE_FILE), startFailureSchema, undefined, logger);
  if (failure?.version !== apply.to || failure.at < apply.startedAt) return undefined;
  return failure;
}

/**
 * Whether an asked-for check hasn't started yet. Both stamps come from toISOString (UTC, fixed width), so string
 * order is time order. A request older than the pending window, from the future (clock moved back) or garbled
 * isn't pending, so nothing can leave it stuck. Nor is one during an apply: no check runs then, and none would
 * record that it was answered.
 */
export function checkPending(request: UpdateRequest, state: UpdateState, nowMs: number): boolean {
  const at = request.checkRequestedAt;
  if (at === undefined || state.apply !== undefined || at <= (state.checkedAt ?? "")) return false;
  const age = nowMs - Date.parse(at);
  return age >= 0 && age < UPDATE_CHECK_PENDING_MS;
}

/** When the dashboard may ask for another check, or null when it may now. A future or garbled finish allows it. */
export function checkAllowedAt(state: UpdateState, nowMs: number): string | null {
  if (state.finishedAt === undefined) return null;
  const finished = Date.parse(state.finishedAt);
  const age = nowMs - finished;
  return age >= 0 && age < UPDATE_CHECK_COOLDOWN_MS ? new Date(finished + UPDATE_CHECK_COOLDOWN_MS).toISOString() : null;
}

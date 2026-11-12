// The two small JSON files the supervisor, the tracker and the separate apply-step updater share in <data>\update\.
// Each file has one writer, so no two processes ever race on one: the supervisor and updater write
// state.json, the tracker writes request.json. Readers take a default for a missing or bad file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isReleaseVersion } from "../../shared/release";
import { renameRetry } from "../fs-retry";
import type { Logger } from "../log";

export const STATE_FILE = "state.json";
export const REQUEST_FILE = "request.json";

// Loose objects, nested ones too, keep fields this version doesn't know: a rollback runs older code
// against a file a newer updater wrote, and a write must not drop what that updater needs to read back.
// Versions are checked here so a bad one makes the whole file unreadable (logged, then replaced by the
// next write) rather than throwing later in every check and every tray poll.
const version = z.string().refine(isReleaseVersion, "not a release version");
const stateSchema = z.looseObject({
  v: z.literal(1),
  checkedAt: z.string().optional(),
  lastOutcome: z.enum(["up_to_date", "downloaded", "skipped", "error"]).optional(),
  lastError: z.string().optional(),
  etag: z.string().optional(),
  available: z.looseObject({ version, file: z.string(), verifiedAt: z.string() }).optional(),
  skipped: z.array(z.looseObject({ version, reason: z.string() })),
});
export type UpdateState = z.infer<typeof stateSchema>;

const requestSchema = z.looseObject({
  v: z.literal(1),
  autoApply: z.boolean(),
  install: version.optional(),
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

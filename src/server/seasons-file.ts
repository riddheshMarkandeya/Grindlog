// The season file: `seasons.json` in Grindlog's GitHub repo, fetched once a day so a new season
// appears without a release (the Stats API carries no season). GRINDLOG_SEASONS_FEED overrides the
// source for testing, or turns the fetch off. Writing the rows, under the rule that a user's edit or
// delete always wins, is the seasons store's job.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SEASONS_FILE_URL } from "../shared/release";
import { seasonInput, type SeasonInput } from "../shared/schemas/tables";
import type { Logger } from "./log";
import type { SyncResult } from "./seasons";
import { FETCH_TIMEOUT_MS, isHttpUrl, USER_AGENT, type FetchFn } from "./update/feed";

export type ParseResult = { ok: true; entries: SeasonInput[] } | { ok: false; error: string };

const seasonFile = z.object({ seasons: z.array(seasonInput).min(1).max(500) });

/** The file's entries. One bad entry rejects the whole file: a half-applied list would be harder to reason about. */
export function parseSeasonFile(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not JSON: ${String(err)}` };
  }
  const parsed = seasonFile.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const entries = parsed.data.seasons;
  const names = new Set<string>();
  const starts = new Set<string>();
  for (const { name, start } of entries) {
    // Case-insensitive, as the seasons table compares names.
    const key = name.toLowerCase();
    if (names.has(key)) return { ok: false, error: `duplicate name: ${name}` };
    if (starts.has(start)) return { ok: false, error: `duplicate start: ${start}` };
    names.add(key);
    starts.add(start);
  }
  return { ok: true, entries };
}

export type SeasonsSource = { kind: "off" } | { kind: "http"; url: string } | { kind: "file"; path: string };

/** GRINDLOG_SEASONS_FEED: unset for the repo's file, `off`, an http(s) URL, or a file path. */
export function seasonsSource(env: Record<string, string | undefined>): SeasonsSource {
  const feed = env.GRINDLOG_SEASONS_FEED;
  if (feed === undefined || feed === "") return { kind: "http", url: SEASONS_FILE_URL };
  if (feed === "off") return { kind: "off" };
  return isHttpUrl(feed) ? { kind: "http", url: feed } : { kind: "file", path: feed };
}

/** When the first run comes: a minute after start, or GRINDLOG_SEASONS_DELAY_MS (whole ms) so e2e needn't wait. */
export function firstRunDelayMs(env: Record<string, string | undefined>): number {
  const raw = env.GRINDLOG_SEASONS_DELAY_MS;
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : FIRST_RUN_DELAY_MS;
}

/** `fetch`: the file couldn't be had; `rejected`: it came, but didn't parse. */
export type SeasonFileResult = { ok: true; entries: SeasonInput[] } | { ok: false; kind: "fetch" | "rejected"; error: string; status?: number };

const FIRST_RUN_DELAY_MS = 60 * 1000;
/** The real file is well under 1 KB; anything this big isn't it. */
const MAX_BODY_BYTES = 64 * 1024;

const tooBig = (status: number): SeasonFileResult => ({ ok: false, kind: "fetch", status, error: `body over ${String(MAX_BODY_BYTES)} bytes` });

function parsed(text: string, status?: number): SeasonFileResult {
  const result = parseSeasonFile(text);
  if (result.ok) return result;
  return status === undefined ? { ok: false, kind: "rejected", error: result.error } : { ok: false, kind: "rejected", error: result.error, status };
}

/** The season file's entries from an http(s) URL or a file path. Never throws: every failure is a result. `signal` aborts the fetch early. */
export async function fetchSeasonFile(
  source: Exclude<SeasonsSource, { kind: "off" }>,
  { fetch = globalThis.fetch, signal }: { fetch?: FetchFn | undefined; signal?: AbortSignal } = {},
): Promise<SeasonFileResult> {
  if (source.kind === "file") {
    let text: string;
    try {
      text = await readFile(source.path, "utf8");
    } catch (err) {
      return { ok: false, kind: "fetch", error: String(err) };
    }
    return parsed(text);
  }
  let res: Response;
  let text: string;
  try {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    res = await fetch(source.url, { headers: { "User-Agent": USER_AGENT }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) return { ok: false, kind: "fetch", status: res.status, error: `HTTP ${String(res.status)}` };
    // A declared size past the cap is refused unread; without one, the length check below still applies.
    if (Number(res.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
      await res.body?.cancel();
      return tooBig(res.status);
    }
    text = await res.text();
  } catch (err) {
    return { ok: false, kind: "fetch", error: String(err) };
  }
  // Characters, not bytes: close enough for a sanity cap, and the file is ASCII.
  if (text.length > MAX_BODY_BYTES) return tooBig(res.status);
  return parsed(text, res.status);
}

const C = "seasons_sync";
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** setTimeout's shape; injected so tests run the schedule by hand. A callback's returned promise is the run. */
export interface Timers {
  setTimeout(fn: () => unknown, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    // A pending fetch day must never keep the process alive on its own.
    t.unref();
    return t;
  },
  clearTimeout: (t) => {
    clearTimeout(t as ReturnType<typeof setTimeout>);
  },
};

export interface SeasonSyncOptions {
  source: SeasonsSource;
  /** The Settings switch, read at each run, so turning it on takes effect at the next one. */
  autoSeasons: () => boolean;
  sync: (entries: SeasonInput[]) => SyncResult;
  /** Called when a run added or moved a season. */
  onChanged: () => void;
  logger: Logger;
  fetch?: FetchFn;
  timers?: Timers;
  firstDelayMs?: number;
}

/** Fetches and applies the season file a minute after start (or `firstDelayMs`), then every 24 h. */
export function startSeasonSync(opts: SeasonSyncOptions): { stop(): Promise<void> } {
  const { source, autoSeasons, sync, onChanged, logger, fetch, timers = realTimers, firstDelayMs = FIRST_RUN_DELAY_MS } = opts;
  if (source.kind === "off") {
    logger.info(C, "skipped", { reason: "feed_off" });
    return { stop: () => Promise.resolve() };
  }
  // Named once narrowed: the closures below don't keep the narrowing of `source`.
  const live = source;
  logger.info(C, "scheduled", { source: live.kind === "http" ? live.url : live.path });
  let timer: unknown;
  // Runs never overlap: the next is scheduled when one ends.
  let running: Promise<void> | undefined;
  // Stop aborts a fetch in flight, so shutdown never waits on the network.
  const abort = new AbortController();

  async function run(): Promise<void> {
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    try {
      if (!autoSeasons()) {
        logger.info(C, "skipped", { reason: "setting_off" });
        return;
      }
      const result = await fetchSeasonFile(live, { fetch, signal: abort.signal });
      if (abort.signal.aborted) {
        logger.info(C, "stopped", {});
        return;
      }
      if (!result.ok) {
        const status = result.status === undefined ? {} : { status: result.status };
        if (result.kind === "fetch") logger.warn(C, "fetch_failed", { ...status, error: result.error, ms: ms() });
        else logger.warn(C, "file_rejected", { ...status, error: result.error });
        return;
      }
      const { changed, ...counts } = sync(result.entries);
      logger.info(C, "synced", { ...counts, ms: ms() });
      if (changed) onChanged();
    } catch (err) {
      // Broad on purpose: a season sync failure must never take down the tracker, and tomorrow's
      // run may well succeed.
      logger.error(C, "sync_crashed", { err });
    } finally {
      if (!abort.signal.aborted) schedule(RUN_INTERVAL_MS);
    }
  }
  const schedule = (delay: number) => {
    timer = timers.setTimeout(() => (running = run()), delay);
  };

  schedule(firstDelayMs);
  return {
    stop: async () => {
      abort.abort();
      timers.clearTimeout(timer);
      await running;
    },
  };
}

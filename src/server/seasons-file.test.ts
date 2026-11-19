import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SEASONS_FILE_URL } from "../shared/release";
import type { SyncResult } from "./seasons";
import { USER_AGENT } from "./update/feed";
import { fetchSeasonFile, firstRunDelayMs, parseSeasonFile, seasonsSource, startSeasonSync } from "./seasons-file";
import { memoryLogger } from "./testing";

const file = (seasons: unknown) => JSON.stringify({ seasons });

describe("parseSeasonFile", () => {
  test("a valid file gives its entries, names trimmed", () => {
    expect(parseSeasonFile(file([{ name: "S24", start: "2026-09-23" }, { name: " S25 ", start: "2026-12-09" }]))).toEqual({
      ok: true,
      entries: [
        { name: "S24", start: "2026-09-23" },
        { name: "S25", start: "2026-12-09" },
      ],
    });
  });

  test("unknown fields are ignored, so the file can grow", () => {
    expect(parseSeasonFile(JSON.stringify({ version: 2, seasons: [{ name: "S25", start: "2026-12-09", end: "2027-03-10" }] }))).toEqual({
      ok: true,
      entries: [{ name: "S25", start: "2026-12-09" }],
    });
  });

  test.each([
    ["a duplicate name, in any case", file([{ name: "S25", start: "2026-12-09" }, { name: "s25", start: "2027-03-10" }]), /duplicate name/],
    ["a duplicate start", file([{ name: "S25", start: "2026-12-09" }, { name: "S26", start: "2026-12-09" }]), /duplicate start/],
    ["a bad date anywhere", file([{ name: "S25", start: "2026-12-09" }, { name: "S26", start: "2027-02-30" }]), /seasons\.1\.start/],
    ["no seasons", file([]), /seasons/],
    ["more than 500 seasons", file(Array.from({ length: 501 }, (_, i) => ({ name: `S${String(i)}`, start: `${String(2000 + i)}-01-01` }))), /seasons/],
    ["no seasons key", JSON.stringify({}), /seasons/],
    ["not JSON", "<html>rate limited</html>", /JSON/],
  ])("%s rejects the whole file", (_, text, error) => {
    const result = parseSeasonFile(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });
});

describe("seasonsSource", () => {
  test("unset or empty is the repo's raw file", () => {
    expect(SEASONS_FILE_URL).toBe("https://raw.githubusercontent.com/riddheshMarkandeya/Grindlog/master/seasons.json");
    expect(seasonsSource({})).toEqual({ kind: "http", url: SEASONS_FILE_URL });
    expect(seasonsSource({ GRINDLOG_SEASONS_FEED: "" })).toEqual({ kind: "http", url: SEASONS_FILE_URL });
  });

  test("off turns it off; an http(s) URL or anything else (a file path) replaces the source", () => {
    expect(seasonsSource({ GRINDLOG_SEASONS_FEED: "off" })).toEqual({ kind: "off" });
    expect(seasonsSource({ GRINDLOG_SEASONS_FEED: "http://127.0.0.1:1/" })).toEqual({ kind: "http", url: "http://127.0.0.1:1/" });
    expect(seasonsSource({ GRINDLOG_SEASONS_FEED: "C:/data/seasons.json" })).toEqual({ kind: "file", path: "C:/data/seasons.json" });
  });
});

describe("firstRunDelayMs", () => {
  test("a minute, unless GRINDLOG_SEASONS_DELAY_MS gives whole milliseconds (for e2e)", () => {
    expect(firstRunDelayMs({})).toBe(60_000);
    expect(firstRunDelayMs({ GRINDLOG_SEASONS_DELAY_MS: "500" })).toBe(500);
    for (const bad of ["", "-1", "1.5", "soon"]) expect(firstRunDelayMs({ GRINDLOG_SEASONS_DELAY_MS: bad }), bad).toBe(60_000);
  });
});

describe("fetchSeasonFile", () => {
  const VALID = file([{ name: "S25", start: "2026-12-09" }]);
  const URL_SOURCE = { kind: "http", url: "https://example.test/seasons.json" } as const;
  const respond = (body: string, status = 200) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init && { init }) });
      return Promise.resolve(new Response(body, { status }));
    };
    return { calls, fetch };
  };

  test("a 200 gives the entries, asked for as Grindlog with a timeout", async () => {
    const { calls, fetch } = respond(VALID);
    expect(await fetchSeasonFile(URL_SOURCE, { fetch })).toEqual({ ok: true, entries: [{ name: "S25", start: "2026-12-09" }] });
    expect(calls[0]?.url).toBe(URL_SOURCE.url);
    expect(calls[0]?.init?.headers).toEqual({ "User-Agent": USER_AGENT });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("a 404 is a fetch failure with its status", async () => {
    expect(await fetchSeasonFile(URL_SOURCE, respond("Not Found", 404))).toEqual({ ok: false, kind: "fetch", status: 404, error: "HTTP 404" });
  });

  test("a network error or timeout is a fetch failure, never a throw", async () => {
    const fetch = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await fetchSeasonFile(URL_SOURCE, { fetch })).toMatchObject({ ok: false, kind: "fetch", error: expect.stringMatching(/timed out/) as unknown });
  });

  test("a body past 64 KB is refused before parsing", async () => {
    expect(await fetchSeasonFile(URL_SOURCE, respond(" ".repeat(64 * 1024 + 1) + VALID))).toEqual({ ok: false, kind: "fetch", status: 200, error: "body over 65536 bytes" });
  });

  test("a declared Content-Length past 64 KB is refused without reading the body", async () => {
    let read = false;
    const body = new ReadableStream({
      pull(c) {
        read = true;
        c.enqueue(new TextEncoder().encode(VALID));
        c.close();
      },
    }, { highWaterMark: 0 }); // pulls only when read
    const fetch = () => Promise.resolve(new Response(body, { headers: { "Content-Length": String(64 * 1024 + 1) } }));
    expect(await fetchSeasonFile(URL_SOURCE, { fetch })).toEqual({ ok: false, kind: "fetch", status: 200, error: "body over 65536 bytes" });
    expect(read).toBe(false);
  });

  test("a bad file is a rejection, apart from a fetch failure", async () => {
    expect(await fetchSeasonFile(URL_SOURCE, respond(file([])))).toMatchObject({ ok: false, kind: "rejected", status: 200 });
  });

  test("a file source is read from disk; a missing one is a fetch failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grindlog-seasons-file-"));
    try {
      const path = join(dir, "seasons.json");
      writeFileSync(path, VALID);
      expect(await fetchSeasonFile({ kind: "file", path }, {})).toEqual({ ok: true, entries: [{ name: "S25", start: "2026-12-09" }] });
      expect(await fetchSeasonFile({ kind: "file", path: join(dir, "missing.json") }, {})).toMatchObject({ ok: false, kind: "fetch", error: expect.stringMatching(/ENOENT/) as unknown });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startSeasonSync", () => {
  const SOURCE = { kind: "http", url: "https://example.test/seasons.json" } as const;
  const NONE: SyncResult = { added: 0, moved: 0, edited: 0, dismissed: 0, nameTaken: 0, startTaken: 0, changed: false };

  /** Timers that fire only when told; a fired callback's promise (the run) is awaited. */
  function fakeTimers() {
    const pending: { fn: () => unknown; ms: number }[] = [];
    return {
      pending,
      setTimeout: (fn: () => unknown, ms: number) => {
        const t = { fn, ms };
        pending.push(t);
        return t;
      },
      clearTimeout: (t: unknown) => {
        const i = pending.indexOf(t as (typeof pending)[number]);
        if (i >= 0) pending.splice(i, 1);
      },
      fire: async () => {
        const t = pending.shift();
        if (!t) throw new Error("no timer pending");
        await t.fn();
      },
    };
  }

  type FetchFn = NonNullable<Parameters<typeof startSeasonSync>[0]["fetch"]>;
  function setup(opts: { source?: Parameters<typeof startSeasonSync>[0]["source"]; on?: boolean; sync?: () => SyncResult; status?: number; firstDelayMs?: number; fetch?: FetchFn } = {}) {
    const timers = fakeTimers();
    const logger = memoryLogger();
    const fetched: string[] = [];
    let changed = 0;
    const body = JSON.stringify({ seasons: [{ name: "S25", start: "2026-12-09" }] });
    const sync = startSeasonSync({
      source: opts.source ?? SOURCE,
      autoSeasons: () => opts.on ?? true,
      sync: opts.sync ?? (() => NONE),
      onChanged: () => changed++,
      logger,
      timers,
      ...(opts.firstDelayMs !== undefined && { firstDelayMs: opts.firstDelayMs }),
      fetch: (url, init) => {
        fetched.push(url);
        return opts.fetch ? opts.fetch(url, init) : Promise.resolve(new Response(body, { status: opts.status ?? 200 }));
      },
    });
    return { timers, logger, fetched, sync, changes: () => changed };
  }
  const events = (logger: ReturnType<typeof memoryLogger>) => logger.lines.map((l) => [l.level, `${l.cat}/${l.event}`]);

  test("first runs a minute after start, then daily", async () => {
    const { timers, fetched, logger } = setup();
    expect(timers.pending.map((t) => t.ms)).toEqual([60_000]);
    expect(setup({ firstDelayMs: 500 }).timers.pending.map((t) => t.ms)).toEqual([500]);
    await timers.fire();
    expect(fetched).toEqual([SOURCE.url]);
    expect(timers.pending.map((t) => t.ms)).toEqual([24 * 60 * 60 * 1000]);
    expect(logger.lines.find((l) => l.event === "synced")?.fields).toEqual({ ...NONE, changed: undefined, ms: expect.any(Number) as unknown });
  });

  test("with the setting off, nothing is fetched, and the next run still comes", async () => {
    const { timers, fetched, logger } = setup({ on: false });
    await timers.fire();
    expect(fetched).toEqual([]);
    expect(logger.lines.at(-1)).toMatchObject({ event: "skipped", fields: { reason: "setting_off" } });
    expect(timers.pending).toHaveLength(1);
  });

  test("with the feed off, nothing is scheduled at all", () => {
    const { timers, logger } = setup({ source: { kind: "off" } });
    expect(timers.pending).toEqual([]);
    expect(logger.lines).toMatchObject([{ cat: "seasons_sync", event: "skipped", fields: { reason: "feed_off" } }]);
  });

  test("a change tells open pages once; no change tells nobody", async () => {
    const changedOnce = setup({ sync: () => ({ ...NONE, added: 1, changed: true }) });
    await changedOnce.timers.fire();
    expect(changedOnce.changes()).toBe(1);
    const unchanged = setup();
    await unchanged.timers.fire();
    expect(unchanged.changes()).toBe(0);
  });

  test("a failed fetch is logged with its status, and nothing is synced", async () => {
    let synced = 0;
    const { timers, logger } = setup({ status: 404, sync: () => (synced++, NONE) });
    await timers.fire();
    expect(synced).toBe(0);
    expect(logger.lines.at(-1)).toMatchObject({ level: "warn", event: "fetch_failed", fields: { status: 404, error: "HTTP 404", ms: expect.any(Number) as unknown } });
  });

  test("a throwing sync is logged as a crash, and the next run is still scheduled", async () => {
    const { timers, logger } = setup({
      sync: () => {
        throw new Error("database is locked");
      },
    });
    await timers.fire();
    expect(events(logger).at(-1)).toEqual(["error", "seasons_sync/sync_crashed"]);
    expect(timers.pending.map((t) => t.ms)).toEqual([24 * 60 * 60 * 1000]);
  });

  test("stop aborts a fetch in flight: shutdown doesn't wait on the network, and nothing is synced", async () => {
    let synced = 0;
    // Settles only when aborted, like a stalled connection.
    const hung: FetchFn = (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason as Error);
        });
      });
    const { timers, sync, logger } = setup({ fetch: hung, sync: () => (synced++, NONE) });
    const run = timers.fire();
    await sync.stop();
    await run;
    expect(synced).toBe(0);
    expect(timers.pending).toEqual([]);
    expect(events(logger).at(-1)).toEqual(["info", "seasons_sync/stopped"]);
  });

  test("stop cancels the next run", async () => {
    const { timers, sync } = setup();
    await sync.stop();
    expect(timers.pending).toEqual([]);
  });
});

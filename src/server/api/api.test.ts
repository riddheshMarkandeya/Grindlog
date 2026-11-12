// Contract tests: the real host on port 0 with the API mounted, over a seeded temp DB. Every
// response is parsed with the schema the web will use.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { z } from "zod";
import { REQUEST_HEADER, TRAY_HEADER } from "../../shared/constants";
import {
  autostartResponse,
  breakResponse,
  currentResponse,
  friendDetailResponse,
  friendsResponse,
  pairDetailResponse,
  neverSuggestResponse,
  idsResponse,
  latestResponse,
  matchDetailResponse,
  monthsResponse,
  periodResponse,
  playedDaysResponse,
  remarksResponse,
  seasonConflict,
  seasonsResponse,
  sessionDetailResponse,
  sessionsResponse,
  statusSchema,
  suggestionsResponse,
  trayResponse,
  type Status,
  type TrayResponse,
} from "../../shared/schemas/responses";
import type { TrayAck } from "../../shared/schemas/params";
import { DEFAULT_SETTINGS, settingsSchema } from "../../shared/schemas/settings";
import { startHost, type Host } from "../host";
import { LogonTaskError, type AutostartState } from "../logon-task";
import { createQueryReader } from "../query/read";
import { createRecordWriter } from "../records/save";
import { openStorage, type Storage } from "../storage";
import { ME, memoryLogger, player, record, THEM } from "../testing";
import { createApi, type Api } from "./index";

let dir: string;
let storage: Storage;
let host: Host;
let api: Api;
let logger: ReturnType<typeof memoryLogger>;
let clock: number;
/** The fake logon task's state; `getFails`/`setFails` make the next calls reject. */
let autostart: AutostartState;
let getFails: Error | null;
let setFails: boolean;
const status: Status = { connection: "connected", statsApiOff: false, configProblems: ["user_missing"], version: null, pid: 1234 };
/** The acks the tray option was called with: it isn't reached unless the header check passed. */
let trayAcks: (TrayAck | null)[];
const trayView: TrayResponse = {
  icon: "attention",
  status: "Stats API needs setting up",
  lines: [{ text: "1 match couldn't be rebuilt after the update" }],
  setupUrl: "/",
  instance: "run1",
  notices: [{ id: 3, title: "Grindlog", body: "hi" }],
};

const T0 = Date.UTC(2026, 9, 10, 18);
const MIN = 60_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-api-"));
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
  const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
  writer.save(record("A", T0, {}, { endedAt: T0 + 5 * MIN }));
  writer.save(record("B", T0 + 10 * MIN, {}, { endedAt: T0 + 15 * MIN, winnerTeamNum: 1 }));
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "index.html"), "<html>app</html>");
  clock = T0 + 20 * MIN;
  logger = memoryLogger();
  autostart = "on";
  trayAcks = [];
  getFails = null;
  setFails = false;
  host = startHost({ port: 0, logger, onShutdown: () => undefined });
  api = createApi({
    tracker: storage.tracker,
    reader: createQueryReader({ tracker: storage.tracker, logger }),
    status: () => status,
    staticDir: dist,
    logger,
    now: () => clock,
    // Out of the way of the idle-timeout test, which needs a quiet stream.
    events: { heartbeatMs: 60_000 },
    logonTask: {
      get: () => (getFails ? Promise.reject(getFails) : Promise.resolve(autostart)),
      set: (on: boolean) => {
        if (setFails) return Promise.reject(new LogonTaskError("refused"));
        autostart = on ? "on" : "off";
        return Promise.resolve(autostart);
      },
    },
    tray: (ack) => {
      trayAcks.push(ack);
      return trayView;
    },
  });
  host.mount(api.handle);
});
afterEach(() => {
  api.stop();
  host.stop();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const url = (path: string) => `http://127.0.0.1:${String(host.port)}${path}`;
async function get<S extends z.ZodType>(schema: S, path: string): Promise<z.infer<S>> {
  const res = await fetch(url(path));
  expect(res.status, path).toBe(200);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  return schema.parse(await res.json());
}
const breakNow = () => fetch(url("/api/sessions/break"), { method: "POST", headers: { [REQUEST_HEADER]: "1" } });

/** Reads SSE frames from a live stream. */
function sse(res: Response) {
  const r = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    /** The next event frame, skipping heartbeats. */
    async next(): Promise<{ event: string; data: unknown }> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (chunk.startsWith(":")) continue;
          const [, event = "", data = ""] = /^event: (.*)\ndata: (.*)$/.exec(chunk) ?? [];
          return { event, data: JSON.parse(data) };
        }
        const { value, done } = await r.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value);
      }
    },
    cancel: () => r.cancel(),
  };
}

describe("endpoints", () => {
  test("every endpoint answers in its schema", async () => {
    expect(await get(statusSchema, "/api/status")).toEqual(status);
    const list = await get(sessionsResponse, "/api/sessions?from=2026-10-01&to=2026-10-31");
    expect(list).toMatchObject({ sessions: [{ key: "A", matches: 2, wins: 1, losses: 1 }], currentKey: "A" });
    expect((await get(monthsResponse, "/api/sessions/months?before=2026-12-01&filter=ranked")).months).toEqual([{ month: "2026-10", sessions: 1, wins: 1, losses: 1 }]);
    expect((await get(currentResponse, "/api/sessions/current")).session?.key).toBe("A");
    const detail = await get(sessionDetailResponse, "/api/sessions/A?filter=13");
    expect(detail.matches.map((m) => m.guid)).toEqual(["A", "B"]);
    expect((await get(matchDetailResponse, "/api/matches/B")).sessionKey).toBe("A");
    expect((await get(periodResponse, "/api/period?kind=month&day=2026-10-01")).aggregate.matches).toBe(2);
    expect((await get(periodResponse, "/api/period?kind=season&season=3")).sessions).toBe(1);
    const month = await get(periodResponse, "/api/period?kind=month&day=2026-10-01");
    expect([month.bucket, month.buckets.length, month.previous?.aggregate.matches]).toEqual(["day", 31, 0]);
    expect(await get(playedDaysResponse, "/api/played-days?year=2026")).toMatchObject({ totalMatches: 2 });
    expect((await get(seasonsResponse, "/api/seasons")).seasons).toHaveLength(3);
  });

  test("bad params are 400 with the issues; unknown keys and routes 404; wrong method 405", async () => {
    const bad = await fetch(url("/api/sessions?from=2026-02-30&to=2026-03-01"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "bad_request", issues: [{ path: ["from"] }] });
    expect(logger.lines.find((l) => l.event === "bad_request")?.fields).toMatchObject({ route: "/api/sessions", issues: ["from"] });
    expect((await fetch(url("/api/period?kind=decade"))).status).toBe(400);
    for (const year of ["0999", "26", "2026.5", ""]) expect((await fetch(url(`/api/played-days?year=${year}`))).status, year).toBe(400);
    for (const path of ["/api/sessions/nope", "/api/matches/nope", "/api/period?kind=season&season=99", "/api/nothing"]) {
      const res = await fetch(url(path));
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await fetch(url("/api/played-days"), { method: "POST", headers: { [REQUEST_HEADER]: "1" } })).status).toBe(405);
  });

  test("a write without the request header is 403 and logged", async () => {
    const res = await fetch(url("/api/sessions/break"), { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(logger.lines.find((l) => l.event === "write_rejected")?.fields).toMatchObject({ method: "POST", path: "/api/sessions/break", origin: "https://evil.example" });
    expect(storage.tracker.all("SELECT * FROM session_breaks")).toEqual([]);
  });

  test("other paths get the app; requests are logged by route", async () => {
    const res = await fetch(url("/sessions/A"));
    expect([res.status, await res.text()]).toEqual([200, "<html>app</html>"]);
    expect(logger.lines.filter((l) => l.event === "request").map((l) => l.fields.route)).toEqual([]);
    await fetch(url("/api/sessions/A"));
    expect(logger.lines.find((l) => l.event === "request")?.fields).toMatchObject({ method: "GET", route: "/api/sessions/:key", status: 200 });
  });

  test("HEAD reads like GET; static files are nosniff too", async () => {
    expect((await fetch(url("/api/status"), { method: "HEAD" })).status).toBe(200);
    // HEAD on the stream answers its headers without opening one.
    const head = await fetch(url("/api/events"), { method: "HEAD" });
    expect([head.status, head.headers.get("content-type")]).toEqual([200, "text/event-stream"]);
    expect(logger.events()).not.toContain("api/sse_open");
    expect((await fetch(url("/"))).headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("once stopped, requests get 503 stopping rather than a closed DB", async () => {
    api.stop();
    const res = await fetch(url("/api/sessions/current"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "stopping" });
  });

  test("a handler that throws is 500 and logged", async () => {
    storage.tracker.exec("DROP TABLE seasons");
    const res = await fetch(url("/api/seasons"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(logger.lines.find((l) => l.event === "failed")).toMatchObject({ level: "error", fields: { route: "/api/seasons" } });
  });
});

describe("latest session", () => {
  test("the newest session under the filter, or null; a private-only one is skipped by everything", async () => {
    const latest = async (filter: string) => (await get(latestResponse, `/api/sessions/latest?filter=${filter}`)).session?.key ?? null;
    expect(await latest("private")).toBeNull();
    createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(record("C", T0 + 60 * MIN, {}, { endedAt: T0 + 65 * MIN, playlistId: 6 }));
    expect(await latest("everything")).toBe("A");
    expect(await latest("private")).toBe("C");
  });

  test("lists the playlists played across all history, whatever the filter", async () => {
    createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(record("C", T0 + 60 * MIN, {}, { endedAt: T0 + 65 * MIN, playlistId: 6 }));
    const body = await get(latestResponse, "/api/sessions/latest?filter=17");
    expect(body).toEqual({ session: null, playlistsPresent: [6, 13] });
  });
});

describe("session break", () => {
  test("cuts the session now, and tells open pages", async () => {
    const events = sse(await fetch(url("/api/events")));
    expect(await events.next()).toEqual({ event: "status", data: status });
    const res = await breakNow();
    expect(breakResponse.parse(await res.json())).toEqual({ at: clock });
    expect(await events.next()).toEqual({ event: "session_break", data: { at: clock } });
    expect((await get(currentResponse, "/api/sessions/current")).session).toBeNull();
    // A second break at the same instant is the same break.
    expect((await breakNow()).status).toBe(200);
    expect(storage.tracker.all("SELECT at FROM session_breaks")).toEqual([{ at: clock }]);
    expect(logger.events()).toContain("api/session_break");
    await events.cancel();
  });
});

describe("remarks", () => {
  const reroll = (key: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(`/api/sessions/${key}/remarks/reroll?filter=ranked`), { method: "POST", headers });

  test("a revisit gets the same lines, a reroll new ones that stick", async () => {
    const first = await get(remarksResponse, "/api/sessions/A/remarks?filter=ranked");
    expect(first.mood.band).toBe("short");
    expect(await get(remarksResponse, "/api/sessions/A/remarks?filter=ranked")).toEqual(first);
    const res = await reroll("A");
    expect(res.status).toBe(200);
    const rolled = remarksResponse.parse(await res.json());
    expect(rolled.mood.text).not.toBe(first.mood.text);
    expect(await get(remarksResponse, "/api/sessions/A/remarks?filter=ranked")).toEqual(rolled);
    expect(logger.events().filter((e) => e === "remarks/remark_picked")).toHaveLength(2);
  });

  test("404 for an unknown session or nothing under the filter; 403 for a reroll without the header; 400 for a bad filter", async () => {
    expect((await fetch(url("/api/sessions/nope/remarks"))).status).toBe(404);
    expect((await fetch(url("/api/sessions/A/remarks?filter=casual"))).status).toBe(404);
    expect((await reroll("nope")).status).toBe(404);
    expect((await reroll("A", {})).status).toBe(403);
    expect((await fetch(url("/api/sessions/A/remarks?filter=bogus"))).status).toBe(400);
  });
});

describe("settings", () => {
  const save = (query: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(`/api/settings?${query}`), { method: "POST", headers });

  test("GET gives the defaults; a POST saves its keys only and answers with all of them", async () => {
    expect(await get(settingsSchema, "/api/settings")).toEqual(DEFAULT_SETTINGS);
    const res = await save("theme=slate&rollingWindow=35&moodLine=false");
    expect(res.status).toBe(200);
    const saved = { ...DEFAULT_SETTINGS, theme: "slate", rollingWindow: 35, moodLine: false };
    expect(settingsSchema.parse(await res.json())).toEqual(saved);
    expect(await get(settingsSchema, "/api/settings")).toEqual(saved);
    expect(logger.events()).toContain("settings/saved");
  });

  test("400 for a bad value, an unknown key or nothing to save; 403 without the header", async () => {
    for (const q of ["rollingWindow=4", "theme=midnight", "colour=red", ""]) expect((await save(q)).status, q).toBe(400);
    expect((await save("theme=slate", {})).status).toBe(403);
    expect(await get(settingsSchema, "/api/settings")).toEqual(DEFAULT_SETTINGS);
  });

  test("a period takes the rolling window", async () => {
    const at = (window: string) => get(periodResponse, `/api/period?kind=all&window=${window}`);
    expect((await at("5")).rolling).toEqual([]);
    expect((await fetch(url("/api/period?kind=all&window=4"))).status).toBe(400);
  });
});

describe("tray", () => {
  const poll = (query: string, headers: Record<string, string> = { [TRAY_HEADER]: "1" }) => fetch(url(`/api/tray${query}`), { headers });

  test("answers the tray's view and passes the ack through with its run, or null without both", async () => {
    const res = await poll("?ack=2&instance=a1b2");
    expect(res.status).toBe(200);
    expect(trayResponse.parse(await res.json())).toEqual(trayView);
    await poll("");
    await poll("?ack=2");
    expect(trayAcks).toEqual([{ id: 2, instance: "a1b2" }, null, null]);
  });

  test("without the tray header it's 403 and logged, and the notices aren't touched", async () => {
    const res = await fetch(url("/api/tray?ack=5"), { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(trayAcks).toEqual([]);
    expect(logger.lines.find((l) => l.event === "tray_rejected")?.fields).toMatchObject({ origin: "https://evil.example" });
  });

  test("a bad ack is 400", async () => {
    for (const q of ["?ack=x", "?ack=-1", "?ack=1.5", "?ack=1&extra=1", "?ack=1&instance=A%20B"]) expect((await poll(q)).status, q).toBe(400);
    expect(trayAcks).toEqual([]);
  });

  test("a 200 writes no request line, since it comes every 2 s; a rejected poll still does", async () => {
    await poll("?ack=0");
    expect(logger.lines.filter((l) => l.event === "request" && l.fields.route === "/api/tray")).toEqual([]);
    await poll("?ack=x");
    expect(logger.lines.filter((l) => l.event === "request" && l.fields.route === "/api/tray")).toHaveLength(1);
  });
});

describe("autostart", () => {
  const change = (query: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(`/api/autostart?${query}`), { method: "POST", headers });

  test("reads the logon task, then switches it off and on", async () => {
    expect(await get(autostartResponse, "/api/autostart")).toEqual({ state: "on" });
    const off = await change("on=false");
    expect(off.status).toBe(200);
    expect(off.headers.get("x-content-type-options")).toBe("nosniff");
    expect(autostartResponse.parse(await off.json())).toEqual({ state: "off" });
    expect(await get(autostartResponse, "/api/autostart")).toEqual({ state: "off" });
    expect(autostartResponse.parse(await (await change("on=true")).json())).toEqual({ state: "on" });
  });

  test("an unavailable task reads as such", async () => {
    autostart = "unavailable";
    expect(await get(autostartResponse, "/api/autostart")).toEqual({ state: "unavailable" });
  });

  test("a bad or missing on is 400; no request header is 403", async () => {
    expect((await change("on=yes")).status).toBe(400);
    expect((await change("")).status).toBe(400);
    expect((await change("on=true&extra=1")).status).toBe(400);
    expect((await change("on=false", {})).status).toBe(403);
    expect(autostart).toBe("on");
  });

  test("a refused switch is 500 autostart_failed, logged by the logon task only", async () => {
    setFails = true;
    const res = await change("on=false");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "autostart_failed" });
    expect(logger.events()).not.toContain("api/failed");
  });

  test("any other rejection in an async handler is a logged 500", async () => {
    getFails = new Error("boom");
    const res = await fetch(url("/api/autostart"));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ error: "internal" });
    expect(logger.lines.find((l) => l.event === "failed")?.fields).toMatchObject({ route: "/api/autostart" });
  });
});

describe("ids", () => {
  const answer = (query: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(`/api/ids?${query}`), { method: "POST", headers });

  test("GET lists them; a POST answers one and comes back with the list", async () => {
    storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES ('Steam|alt|0', 'alt', 'pending', 2)");
    expect(await get(idsResponse, "/api/ids")).toEqual({
      ids: [
        { primaryId: ME, name: "me", platform: "Epic", status: "confirmed" },
        { primaryId: "Steam|alt|0", name: "alt", platform: "Steam", status: "pending" },
      ],
    });
    const res = await answer(`id=${encodeURIComponent("Steam|alt|0")}&status=rejected`);
    expect(res.status).toBe(200);
    expect(idsResponse.parse(await res.json()).ids[1]?.status).toBe("rejected");
    expect((await get(idsResponse, "/api/ids")).ids[1]?.status).toBe("rejected");
  });

  test("400 for a bad status or no id, 404 for an unknown id, 403 without the header", async () => {
    for (const q of [`id=${encodeURIComponent(ME)}&status=pending`, "status=confirmed"]) expect((await answer(q)).status, q).toBe(400);
    expect((await answer("id=Epic%7Cnobody%7C0&status=confirmed")).status).toBe(404);
    expect((await answer(`id=${encodeURIComponent(ME)}&status=rejected`, {})).status).toBe(403);
    expect((await get(idsResponse, "/api/ids")).ids[0]?.status).toBe("confirmed");
  });
});

describe("seasons", () => {
  const post = (path: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(path), { method: "POST", headers });
  const names = async (res: Response) => seasonsResponse.parse(await res.json()).seasons.map((s) => `${s.name} ${s.startDate}`);

  test("add, edit and delete each answer with the whole list", async () => {
    let res = await post("/api/seasons?name=S25&start=2026-12-09");
    expect(res.status).toBe(200);
    expect(await names(res)).toEqual(["S22 2026-03-11", "S23 2026-06-09", "S24 2026-09-23", "S25 2026-12-09"]);
    res = await post("/api/seasons/4?name=S21&start=2025-12-10");
    expect(await names(res)).toEqual(["S21 2025-12-10", "S22 2026-03-11", "S23 2026-06-09", "S24 2026-09-23"]);
    res = await post("/api/seasons/4/delete");
    expect(await names(res)).toEqual(["S22 2026-03-11", "S23 2026-06-09", "S24 2026-09-23"]);
    expect((await get(seasonsResponse, "/api/seasons")).seasons).toHaveLength(3);
  });

  test("409 with the field's code for each clash", async () => {
    for (const [path, error] of [
      ["/api/seasons?name=s22&start=2026-12-09", "duplicate_name"],
      ["/api/seasons?name=S25&start=2026-09-23", "duplicate_start"],
      ["/api/seasons/1?name=S23&start=2026-03-11", "duplicate_name"],
      ["/api/seasons/1?name=S22&start=2026-06-09", "duplicate_start"],
    ] as const) {
      const res = await post(path);
      expect(res.status, path).toBe(409);
      expect(seasonConflict.parse(await res.json())).toEqual({ error });
    }
  });

  test("400 for a bad body or a non-number id, 404 for an unknown id, 403 without the header", async () => {
    for (const path of ["/api/seasons?name=&start=2026-12-09", "/api/seasons?name=S25&start=2026-13-01", "/api/seasons/abc?name=S25&start=2026-12-09", "/api/seasons/abc/delete"]) {
      expect((await post(path)).status, path).toBe(400);
    }
    expect((await post("/api/seasons/99?name=S25&start=2026-12-09")).status).toBe(404);
    expect((await post("/api/seasons/99/delete")).status).toBe(404);
    expect((await post("/api/seasons/1/delete", {})).status).toBe(403);
    expect((await get(seasonsResponse, "/api/seasons")).seasons).toHaveLength(3);
  });
});

describe("match ended", () => {
  test("pushes the match and its session to open pages", async () => {
    const events = sse(await fetch(url("/api/events")));
    await events.next();
    api.matchEnded("B");
    expect(await events.next()).toEqual({ event: "match_ended", data: { guid: "B", sessionKey: "A" } });
    expect(logger.lines.find((l) => l.event === "match_ended")?.fields).toMatchObject({ guid: "B", sessionKey: "A", subscribers: 1 });
    await events.cancel();
  });

  test("a failure is logged and doesn't throw into the recorder", () => {
    storage.tracker.exec("DROP TABLE session_breaks");
    expect(() => {
      api.matchEnded("B");
    }).not.toThrow();
    expect(logger.lines.find((l) => l.event === "match_ended_failed")).toMatchObject({ level: "error", fields: { guid: "B" } });
  });

  // Bun's default idle timeout is 10 s, checked coarsely: a quiet stream was seen closing at about 12 s.
  test("a stream quiet past Bun's idle timeout still gets the next event", { timeout: 25_000 }, async () => {
    const events = sse(await fetch(url("/api/events")));
    await events.next();
    await Bun.sleep(14_000);
    api.matchEnded("A");
    expect(await events.next()).toEqual({ event: "match_ended", data: { guid: "A", sessionKey: "A" } });
    await events.cancel();
  });
});

describe("records recomputed", () => {
  test("tells open pages every record may have changed", async () => {
    const events = sse(await fetch(url("/api/events")));
    await events.next();
    api.recordsRecomputed();
    expect(await events.next()).toEqual({ event: "records_recomputed", data: {} });
    expect(logger.lines.find((l) => l.event === "records_recomputed")?.fields).toEqual({ subscribers: 1 });
    await events.cancel();
  });
});

describe("friends", () => {
  const SAM = "Epic|sam|0";
  const post = (path: string, headers: Record<string, string> = { [REQUEST_HEADER]: "1" }) => fetch(url(path), { method: "POST", headers });
  const q = (id: string) => `id=${encodeURIComponent(id)}`;
  const seedSam = () => {
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    writer.save(record("C", T0 + 30 * MIN, { players: [player(ME, 0), player(SAM, 0, { name: "Sam" }), player(THEM, 1)] }, { endedAt: T0 + 35 * MIN }));
  };

  test("add, rename, remove and never-suggest each answer with the whole list of cards", async () => {
    seedSam();
    const card = { lastSeenName: "Sam", with: { w: 1, l: 0, n: 1 }, against: { w: 0, l: 0, n: 0 }, lastPlayed: T0 + 30 * MIN };
    let res = await post(`/api/friends?${q(SAM)}&nickname=Sammy`);
    expect(res.status).toBe(200);
    expect(friendsResponse.parse(await res.json())).toEqual({ friends: [{ id: SAM, nickname: "Sammy", name: "Sammy", ...card }], pairs: [] });
    res = await post(`/api/friends/nickname?${q(SAM)}`);
    expect(friendsResponse.parse(await res.json()).friends).toEqual([{ id: SAM, nickname: null, name: "Sam", ...card }]);
    expect(await get(friendsResponse, "/api/friends")).toEqual({ friends: [{ id: SAM, nickname: null, name: "Sam", ...card }], pairs: [] });
    res = await post(`/api/friends/remove?${q(SAM)}`);
    expect(friendsResponse.parse(await res.json()).friends).toEqual([]);
    res = await post(`/api/friends/never-suggest?${q(THEM)}`);
    expect(res.status).toBe(200);
    expect((await get(suggestionsResponse, "/api/friends/suggestions")).suggestions).toEqual([]);
  });

  test("with= filters the pages; a bad one is 400", async () => {
    seedSam();
    await post(`/api/friends?${q(SAM)}`);
    const w = `with=${encodeURIComponent(SAM)}`;
    expect((await get(sessionsResponse, `/api/sessions?from=2026-10-01&to=2026-10-31&${w}`)).sessions.map((s) => s.matches)).toEqual([1]);
    expect((await get(sessionsResponse, "/api/sessions?from=2026-10-01&to=2026-10-31&with=solo")).sessions.map((s) => s.matches)).toEqual([2]);
    const detail = await get(sessionDetailResponse, `/api/sessions/A?${w}`);
    expect([detail.matches.map((m) => m.guid), detail.friendsPresent]).toEqual([["C"], [{ id: SAM, name: "Sam" }]]);
    expect((await get(sessionDetailResponse, "/api/sessions/A")).matches[2]?.friends).toEqual([SAM]);
    expect((await get(monthsResponse, `/api/sessions/months?before=2026-12-01&${w}`)).months[0]?.sessions).toBe(1);
    expect((await get(currentResponse, `/api/sessions/current?${w}`)).session?.matches).toBe(1);
    expect((await get(latestResponse, `/api/sessions/latest?${w}`)).session?.key).toBe("A");
    expect((await get(periodResponse, `/api/period?kind=month&day=2026-10-01&${w}`)).aggregate.matches).toBe(1);
    expect((await get(playedDaysResponse, `/api/played-days?year=2026&${w}`)).days).toEqual([{ day: "2026-10-10", matches: 1 }]);
    expect((await get(remarksResponse, `/api/sessions/A/remarks?${w}`)).mood.text).toBeTypeOf("string");
    for (const bad of ["with=", "with=Epic%7Csam", "with=anyone"]) expect((await fetch(url(`/api/sessions/A?${bad}`))).status, bad).toBe(400);
  });

  test("404 for someone not seen or not a friend, 409 for a friend twice, 400 without an id or with a long nickname, 403 without the header", async () => {
    seedSam();
    expect((await post(`/api/friends?${q("Epic|nobody|0")}`)).status).toBe(404);
    expect((await post(`/api/friends?${q(ME)}`)).status).toBe(404);
    expect((await post(`/api/friends/nickname?${q(SAM)}&nickname=x`)).status).toBe(404);
    expect((await post(`/api/friends/remove?${q(SAM)}`)).status).toBe(404);
    expect((await post(`/api/friends?${q(SAM)}`)).status).toBe(200);
    expect((await post(`/api/friends?${q(SAM)}`)).status).toBe(409);
    expect((await post(`/api/friends/never-suggest?${q(SAM)}`)).status).toBe(409);
    expect((await post("/api/friends")).status).toBe(400);
    expect((await post(`/api/friends/nickname?${q(SAM)}&nickname=${"x".repeat(33)}`)).status).toBe(400);
    expect((await post(`/api/friends/remove?${q(SAM)}`, {})).status).toBe(403);
    expect((await get(friendsResponse, "/api/friends")).friends).toHaveLength(1);
  });

  test("detail: a friend's page, 404 for anyone else, 400 without an id", async () => {
    seedSam();
    expect((await fetch(url(`/api/friends/detail?${q(SAM)}`))).status).toBe(404);
    await post(`/api/friends?${q(SAM)}`);
    const d = await get(friendDetailResponse, `/api/friends/detail?${q(SAM)}`);
    expect(d.friend).toEqual({ id: SAM, nickname: null, name: "Sam", lastSeenName: "Sam" });
    expect(d.view.with.record).toEqual({ w: 1, l: 0, n: 1 });
    expect(d.view.with.modes.map((m) => m.mode)).toEqual(["3"]);
    expect((await fetch(url("/api/friends/detail"))).status).toBe(400);
  });

  test("pair: two friends' page, 404 unless both are friends, 400 without both ids", async () => {
    const ALEX = "Epic|alex|0";
    const writer = createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 });
    writer.save(record("C", T0 + 30 * MIN, { players: [player(ME, 0), player(SAM, 0, { name: "Sam" }), player(ALEX, 0, { name: "Alex" }), player(THEM, 1)] }, { endedAt: T0 + 35 * MIN }));
    const pair = `/api/friends/pair?a=${encodeURIComponent(SAM)}&b=${encodeURIComponent(ALEX)}`;
    await post(`/api/friends?${q(SAM)}`);
    expect((await fetch(url(pair))).status).toBe(404);
    await post(`/api/friends?${q(ALEX)}`);
    const d = await get(pairDetailResponse, pair);
    expect(d.friends.map((f) => f.id)).toEqual([ALEX, SAM]);
    expect(d.view.with.record).toEqual({ w: 1, l: 0, n: 1 });
    expect((await fetch(url(`/api/friends/pair?a=${encodeURIComponent(SAM)}`))).status).toBe(400);
  });

  test("never-suggest list and suggest again: 404 when not on it, 403 without the header", async () => {
    seedSam();
    await post(`/api/friends/never-suggest?${q(SAM)}`);
    expect(await get(neverSuggestResponse, "/api/friends/never-suggest")).toEqual({ players: [{ id: SAM, name: "Sam" }] });
    expect((await post(`/api/friends/suggest-again?${q(SAM)}`, {})).status).toBe(403);
    const res = await post(`/api/friends/suggest-again?${q(SAM)}`);
    expect(neverSuggestResponse.parse(await res.json())).toEqual({ players: [] });
    expect((await post(`/api/friends/suggest-again?${q(SAM)}`)).status).toBe(404);
  });
});

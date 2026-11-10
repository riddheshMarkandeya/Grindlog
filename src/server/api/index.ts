// The dashboard's HTTP layer, mounted on the host: the JSON endpoints under /api, server-sent
// events, and the built web app for every other path. No CORS headers: only same-origin pages read it.
import type { Server } from "bun";
import type { z } from "zod";
import { REQUEST_HEADER } from "../../shared/constants";
import { filterOnly, monthsParams, periodParams, playedDaysParams, sessionsParams } from "../../shared/schemas/params";
import {
  breakResponse,
  currentResponse,
  friendDetailResponse,
  pairDetailResponse,
  friendsResponse,
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
  type Status,
} from "../../shared/schemas/responses";
import { settingsPatch, settingsSchema } from "../../shared/schemas/settings";
import { friendIdParams, friendNicknameParams, idStatusParams, pairParams, seasonIdParams, seasonInput } from "../../shared/schemas/tables";
import type { Db } from "../db/sqlite";
import { createFriends, type FriendWrite } from "../friends";
import { createIds } from "../ids";
import type { Logger } from "../log";
import type { QueryReader } from "../query/read";
import { createRemarks } from "../remarks/store";
import { createSeasons, type SeasonWrite } from "../seasons";
import { createSettings } from "../settings";
import { createEventHub, type EventHubOptions } from "./events";
import { createPages } from "./pages";
import { matchRoute, type Route } from "./router";
import { serveStatic } from "./static";

const C = "api";

export interface ApiOptions {
  tracker: Db;
  reader: QueryReader;
  status: () => Status;
  /** The built web app; a folder with no index.html answers "dashboard not built". */
  staticDir: string;
  logger: Logger;
  now?: () => number;
  events?: Partial<Omit<EventHubOptions, "status" | "logger">>;
}

interface Ctx {
  req: Request;
  server: Server<undefined>;
  query: Record<string, string>;
  params: Record<string, string>;
}
type RouteHandler = (ctx: Ctx) => Response;

class BadRequest extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super("bad request");
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new BadRequest(result.error.issues);
  return result.data;
}

/** The schema only types the body: the contract tests parse real responses with it. */
const ok = <S extends z.ZodType>(_schema: S, body: z.infer<S>) => Response.json(body);
const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
const orNotFound = <S extends z.ZodType>(schema: S, body: z.infer<S> | null) => (body === null ? notFound() : ok(schema, body));

function seasonWritten(write: SeasonWrite): Response {
  if (write.ok) return ok(seasonsResponse, { seasons: write.seasons });
  if (write.error === "not_found") return notFound();
  const body: z.infer<typeof seasonConflict> = { error: write.error };
  return Response.json(body, { status: 409 });
}

/** A write answers with what the page shows after it: the friend cards, or the never-suggest list. */
function friendWritten(write: FriendWrite, answer: () => Response): Response {
  if (write.ok) return answer();
  return write.error === "not_found" ? notFound() : Response.json({ error: "conflict" }, { status: 409 });
}

export function createApi({ tracker, reader, status, staticDir, logger, now = Date.now, events: eventOptions }: ApiOptions) {
  const pages = createPages({ reader, logger, now });
  const hub = createEventHub({ status, logger, ...eventOptions });
  const remarks = createRemarks({ tracker, pages, logger, now });
  const settings = createSettings({ tracker, logger });
  const ids = createIds({ tracker, logger });
  const seasons = createSeasons({ tracker, reader, logger });
  const friends = createFriends({ tracker, logger, now });
  const cards = () => ok(friendsResponse, pages.friends());

  const routes: Route<RouteHandler>[] = [
    { method: "GET", path: "/api/status", handler: () => ok(statusSchema, status()) },
    {
      method: "GET",
      path: "/api/events",
      handler: ({ req, server }) => {
        if (req.method === "HEAD") return hub.head();
        // Bun closes a connection idle for 10 s by default; a stream can be quiet for longer.
        server.timeout(req, 0);
        return hub.subscribe(req.signal);
      },
    },
    {
      method: "GET",
      path: "/api/sessions",
      handler: ({ query }) => {
        const p = parse(sessionsParams, query);
        return ok(sessionsResponse, pages.sessionList(p.filter, p.from, p.to, p.with));
      },
    },
    {
      method: "GET",
      path: "/api/sessions/months",
      handler: ({ query }) => {
        const p = parse(monthsParams, query);
        return ok(monthsResponse, pages.monthFolds(p.filter, p.before, p.with));
      },
    },
    {
      method: "GET",
      path: "/api/sessions/current",
      handler: ({ query }) => {
        const p = parse(filterOnly, query);
        return ok(currentResponse, { session: pages.currentSummary(p.filter, p.with) });
      },
    },
    {
      method: "GET",
      path: "/api/sessions/latest",
      handler: ({ query }) => {
        const p = parse(filterOnly, query);
        return ok(latestResponse, pages.latest(p.filter, p.with));
      },
    },
    {
      method: "GET",
      path: "/api/sessions/:key",
      handler: ({ query, params }) => {
        const p = parse(filterOnly, query);
        return orNotFound(sessionDetailResponse, pages.sessionDetail(params.key ?? "", p.filter, p.with));
      },
    },
    {
      method: "GET",
      path: "/api/sessions/:key/remarks",
      // Picks and stores on first view: a revisit shows the same lines.
      handler: ({ query, params }) => {
        const p = parse(filterOnly, query);
        return orNotFound(remarksResponse, remarks.get(params.key ?? "", p.filter, p.with));
      },
    },
    {
      method: "POST",
      path: "/api/sessions/:key/remarks/reroll",
      handler: ({ query, params }) => {
        const p = parse(filterOnly, query);
        return orNotFound(remarksResponse, remarks.reroll(params.key ?? "", p.filter, p.with));
      },
    },
    {
      method: "POST",
      path: "/api/sessions/break",
      handler: () => {
        const at = now();
        // OR IGNORE: a second click in the same ms is the same break.
        tracker.run("INSERT OR IGNORE INTO session_breaks (at) VALUES (?)", at);
        logger.info(C, "session_break", { at });
        hub.publish("session_break", { at });
        return ok(breakResponse, { at });
      },
    },
    { method: "GET", path: "/api/matches/:guid", handler: ({ params }) => orNotFound(matchDetailResponse, pages.matchDetail(params.guid ?? "")) },
    {
      method: "GET",
      path: "/api/period",
      handler: ({ query }) => {
        const p = parse(periodParams, query);
        return orNotFound(periodResponse, pages.period(p.spec, p.filter, p.window, p.with));
      },
    },
    {
      method: "GET",
      path: "/api/played-days",
      handler: ({ query }) => {
        const p = parse(playedDaysParams, query);
        return ok(playedDaysResponse, pages.playedDays(p.year, p.filter, p.with));
      },
    },
    { method: "GET", path: "/api/seasons", handler: () => ok(seasonsResponse, { seasons: pages.seasons() }) },
    { method: "POST", path: "/api/seasons", handler: ({ query }) => seasonWritten(seasons.add(parse(seasonInput, query))) },
    {
      method: "POST",
      path: "/api/seasons/:id",
      handler: ({ query, params }) => seasonWritten(seasons.edit(parse(seasonIdParams, params).id, parse(seasonInput, query))),
    },
    { method: "POST", path: "/api/seasons/:id/delete", handler: ({ params }) => seasonWritten(seasons.remove(parse(seasonIdParams, params).id)) },
    { method: "GET", path: "/api/ids", handler: () => ok(idsResponse, { ids: ids.list() }) },
    {
      method: "POST",
      path: "/api/ids",
      handler: ({ query }) => {
        const p = parse(idStatusParams, query);
        const list = ids.setStatus(p.id, p.status);
        return orNotFound(idsResponse, list && { ids: list });
      },
    },
    { method: "GET", path: "/api/friends", handler: cards },
    { method: "GET", path: "/api/friends/suggestions", handler: () => ok(suggestionsResponse, pages.friendSuggestions()) },
    { method: "GET", path: "/api/friends/detail", handler: ({ query }) => orNotFound(friendDetailResponse, pages.friendDetail(parse(friendIdParams, query).id)) },
    {
      method: "GET",
      path: "/api/friends/pair",
      handler: ({ query }) => {
        const p = parse(pairParams, query);
        return orNotFound(pairDetailResponse, pages.pairDetail(p.a, p.b));
      },
    },
    { method: "GET", path: "/api/friends/never-suggest", handler: () => ok(neverSuggestResponse, pages.neverSuggested()) },
    // The id rides in the query string like the other writes; a PrimaryId's bars are encoded.
    {
      method: "POST",
      path: "/api/friends",
      handler: ({ query }) => {
        const p = parse(friendNicknameParams, query);
        return friendWritten(friends.add(p.id, p.nickname), cards);
      },
    },
    {
      method: "POST",
      path: "/api/friends/nickname",
      handler: ({ query }) => {
        const p = parse(friendNicknameParams, query);
        return friendWritten(friends.setNickname(p.id, p.nickname), cards);
      },
    },
    { method: "POST", path: "/api/friends/remove", handler: ({ query }) => friendWritten(friends.remove(parse(friendIdParams, query).id), cards) },
    { method: "POST", path: "/api/friends/never-suggest", handler: ({ query }) => friendWritten(friends.neverSuggest(parse(friendIdParams, query).id), cards) },
    {
      method: "POST",
      path: "/api/friends/suggest-again",
      handler: ({ query }) => friendWritten(friends.suggestAgain(parse(friendIdParams, query).id), () => ok(neverSuggestResponse, pages.neverSuggested())),
    },
    { method: "GET", path: "/api/settings", handler: () => ok(settingsSchema, settings.get()) },
    // The changes ride in the query string: every setting is one scalar, and handlers are synchronous.
    { method: "POST", path: "/api/settings", handler: ({ query }) => ok(settingsSchema, settings.save(parse(settingsPatch, query))) },
  ];

  function api(req: Request, server: Server<undefined>, url: URL): Response {
    const started = performance.now();
    // HEAD takes the GET route's handler; Bun drops the body itself.
    const match = matchRoute(routes, req.method === "HEAD" ? "GET" : req.method, url.pathname);
    let res: Response;
    let route = url.pathname;
    if (match.kind === "not_found") res = notFound();
    else if (match.kind === "method_not_allowed") res = Response.json({ error: "method_not_allowed" }, { status: 405 });
    else {
      route = match.path;
      try {
        res = match.handler({ req, server, query: Object.fromEntries(url.searchParams), params: match.params });
      } catch (err) {
        if (err instanceof BadRequest) {
          logger.warn(C, "bad_request", { route, issues: err.issues.map((i) => i.path.join(".")) });
          res = Response.json({ error: "bad_request", issues: err.issues }, { status: 400 });
        } else {
          logger.error(C, "failed", { route, err });
          res = Response.json({ error: "internal" }, { status: 500 });
        }
      }
    }
    logger.info(C, "request", { method: req.method, route, status: res.status, ms: Math.round(performance.now() - started) });
    return res;
  }

  let stopped = false;

  function respond(req: Request, server: Server<undefined>): Response {
    // Shutdown closes storage before the host stops listening.
    if (stopped) return Response.json({ error: "stopping" }, { status: 503 });
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get(REQUEST_HEADER) !== "1") {
      logger.warn(C, "write_rejected", { method: req.method, path: url.pathname, origin: req.headers.get("origin") });
      return new Response("Forbidden", { status: 403 });
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return api(req, server, url);
    if (req.method !== "GET" && req.method !== "HEAD") return notFound();
    const res = serveStatic(staticDir, url.pathname);
    if (res.status === 404) logger.info(C, "static_not_found", { path: url.pathname });
    return res;
  }

  function handle(req: Request, server: Server<undefined>): Response {
    const res = respond(req, server);
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  }

  return {
    handle,
    /**
     * Tells open pages a match was saved. Runs inside the recorder's hook, so it never throws: a
     * failure here must not mark the save failed.
     */
    matchEnded(guid: string): void {
      try {
        const sessionKey = pages.sessionKeyOf(guid);
        hub.publish("match_ended", { guid, sessionKey });
        logger.info(C, "match_ended", { guid, sessionKey, subscribers: hub.count() });
      } catch (err) {
        logger.error(C, "match_ended_failed", { guid, err });
      }
    },
    /** Tells open pages a background recompute ended, so any record may have changed. Never throws. */
    recordsRecomputed(): void {
      try {
        hub.publish("records_recomputed", {});
        logger.info(C, "records_recomputed", { subscribers: hub.count() });
      } catch (err) {
        logger.error(C, "records_recomputed_failed", { err });
      }
    },
    stop: () => {
      stopped = true;
      hub.stop();
    },
  };
}

export type Api = ReturnType<typeof createApi>;

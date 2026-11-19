// The dashboard's HTTP layer, mounted on the host: the JSON endpoints under /api, server-sent
// events, and the built web app for every other path. No CORS headers: only same-origin pages read it.
import type { Server } from "bun";
import type { z } from "zod";
import { REQUEST_HEADER, TRAY_HEADER } from "../../shared/constants";
import { autoApplyParams, autostartParams, filterOnly, monthsParams, periodParams, playedDaysParams, sessionsParams, statsSetupParams, trayParams, updateCheckParams, updateInstallParams, type TrayAck } from "../../shared/schemas/params";
import {
  autostartResponse,
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
  statsSetupError,
  statsSetupFixed,
  statusSchema,
  suggestionsResponse,
  trayResponse,
  updateResponse,
  type Status,
  type TrayResponse,
} from "../../shared/schemas/responses";
import { settingsPatch, settingsSchema } from "../../shared/schemas/settings";
import { friendIdParams, friendNicknameParams, idStatusParams, pairParams, seasonIdParams, seasonInput } from "../../shared/schemas/tables";
import type { Db } from "../db/sqlite";
import { createFriends, type FriendWrite } from "../friends";
import { createIds } from "../ids";
import type { Logger } from "../log";
import { LogonTaskError, type LogonTask } from "../logon-task";
import type { QueryReader } from "../query/read";
import { createRemarks } from "../remarks/store";
import { createSeasons, type SeasonWrite } from "../seasons";
import { createSettings } from "../settings";
import type { FixResult } from "../stats-setup";
import type { Updates } from "../update/view";
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
  /** The logon task behind the "Run at Windows startup" setting. */
  logonTask: Pick<LogonTask, "get" | "set">;
  /** The tray's view, acking notices up to `ack`; GET /api/tray answers 404 without it. */
  tray?: (ack: TrayAck | null) => TrayResponse;
  /** The setup card's one-click fix of the game's Stats API settings. */
  statsSetup: { fix: (portConsent: boolean) => Promise<FixResult> };
  /** The update view and the user's update choices, which the supervisor acts on. */
  updates: Pick<Updates, "view" | "install" | "requestCheck" | "setAutoApply">;
}

interface Ctx {
  req: Request;
  server: Server<undefined>;
  query: Record<string, string>;
  params: Record<string, string>;
}
type RouteHandler = (ctx: Ctx) => Response | Promise<Response>;

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

function statsSetupAnswer(result: FixResult): Response {
  if (result.ok) return ok(statsSetupFixed, { changed: result.changed, added: result.added });
  const body: z.infer<typeof statsSetupError> = { error: result.error };
  return Response.json(body, { status: result.error === "no_file" || result.error === "port_needs_consent" ? 409 : 500 });
}

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

export function createApi({ tracker, reader, status, staticDir, logger, now = Date.now, events: eventOptions, logonTask, tray, statsSetup, updates }: ApiOptions) {
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
    // The changes ride in the query string: every setting is one scalar, so a body would add nothing.
    { method: "POST", path: "/api/settings", handler: ({ query }) => ok(settingsSchema, settings.save(parse(settingsPatch, query))) },
    // Not a settings row: the logon task itself is the record, read from schtasks on each request.
    { method: "GET", path: "/api/autostart", handler: async () => ok(autostartResponse, { state: await logonTask.get() }) },
    { method: "POST", path: "/api/autostart", handler: async ({ query }) => ok(autostartResponse, { state: await logonTask.set(parse(autostartParams, query).on) }) },
    { method: "GET", path: "/api/update", handler: () => ok(updateResponse, updates.view()) },
    { method: "POST", path: "/api/update/install", handler: ({ query }) => updateInstalled(updates.install(parse(updateInstallParams, query).version)) },
    {
      method: "POST",
      path: "/api/update/check",
      handler: ({ query }) => {
        parse(updateCheckParams, query);
        return updateChecked(updates.requestCheck());
      },
    },
    {
      method: "POST",
      path: "/api/update/auto-apply",
      handler: ({ query }) => (updates.setAutoApply(parse(autoApplyParams, query).on) ? ok(updateResponse, updates.view()) : Response.json({ error: "write_failed" }, { status: 500 })),
    },
    {
      method: "POST",
      path: "/api/stats-setup/fix",
      handler: async ({ query }) => statsSetupAnswer(await statsSetup.fix(parse(statsSetupParams, query).port === "1")),
    },
    // The tray polls every 2 s: a line per answer would rotate match diagnostics out of the logs in days.
    // Its state changes show as notice/* here and tray/* in the supervisor's log.
    ...(tray ? [{ method: "GET" as const, path: "/api/tray", handler: trayHandler(tray), quiet: true }] : []),
  ];

  /** 409 when the version isn't the one available (it changed, or none is); the request file failing is 500. */
  function updateInstalled(result: ReturnType<Updates["install"]>): Response {
    if (result === "ok") return ok(updateResponse, updates.view());
    return result === "conflict" ? Response.json({ error: "not_available" }, { status: 409 }) : Response.json({ error: "write_failed" }, { status: 500 });
  }

  /** 429 within a minute of the last check ending, 409 for a build that doesn't update, 500 when the request file failed. */
  function updateChecked(result: ReturnType<Updates["requestCheck"]>): Response {
    switch (result) {
      case "ok": return ok(updateResponse, updates.view());
      case "too_soon": return Response.json({ error: "too_soon" }, { status: 429 });
      case "disabled": return Response.json({ error: "disabled" }, { status: 409 });
      case "failed": return Response.json({ error: "write_failed" }, { status: 500 });
    }
  }

  function trayHandler(view: NonNullable<ApiOptions["tray"]>): RouteHandler {
    return ({ req, query }) => {
      // A GET that acks notices: a cross-site page can't add the header without an unanswered preflight.
      if (req.headers.get(TRAY_HEADER) !== "1") {
        logger.warn(C, "tray_rejected", { origin: req.headers.get("origin") });
        return new Response("Forbidden", { status: 403 });
      }
      return ok(trayResponse, view(parse(trayParams, query)));
    };
  }

  async function api(req: Request, server: Server<undefined>, url: URL): Promise<Response> {
    const started = performance.now();
    // HEAD takes the GET route's handler; Bun drops the body itself.
    const match = matchRoute(routes, req.method === "HEAD" ? "GET" : req.method, url.pathname);
    let res: Response;
    let route = url.pathname;
    let quiet = false;
    if (match.kind === "not_found") res = notFound();
    else if (match.kind === "method_not_allowed") res = Response.json({ error: "method_not_allowed" }, { status: 405 });
    else {
      route = match.path;
      quiet = match.quiet;
      try {
        // Awaited inside the try, so an async handler's rejection lands in these branches too.
        res = await match.handler({ req, server, query: Object.fromEntries(url.searchParams), params: match.params });
      } catch (err) {
        if (err instanceof BadRequest) {
          logger.warn(C, "bad_request", { route, issues: err.issues.map((i) => i.path.join(".")) });
          res = Response.json({ error: "bad_request", issues: err.issues }, { status: 400 });
        } else if (err instanceof LogonTaskError) {
          // Logged where it failed, with what schtasks said.
          res = Response.json({ error: "autostart_failed" }, { status: 500 });
        } else {
          logger.error(C, "failed", { route, err });
          res = Response.json({ error: "internal" }, { status: 500 });
        }
      }
    }
    if (!(quiet && res.ok)) {
      logger.info(C, "request", { method: req.method, route, status: res.status, ms: Math.round(performance.now() - started) });
    }
    return res;
  }

  let stopped = false;

  function respond(req: Request, server: Server<undefined>): Response | Promise<Response> {
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

  async function handle(req: Request, server: Server<undefined>): Promise<Response> {
    const res = await respond(req, server);
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
    /** Tells open pages the season file changed the seasons, so any season period may have moved. Never throws. */
    seasonsChanged(): void {
      try {
        hub.publish("seasons_changed", {});
        logger.info(C, "seasons_changed", { subscribers: hub.count() });
      } catch (err) {
        logger.error(C, "seasons_changed_failed", { err });
      }
    },
    stop: () => {
      stopped = true;
      hub.stop();
    },
  };
}

export type Api = ReturnType<typeof createApi>;

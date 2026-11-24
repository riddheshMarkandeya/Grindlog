// What each page shows, composed in one place. Every page starts from the same index: the sessions
// cut over every match, the current one, and per match whether you played and your result. A
// session belongs to the day of its first match, and its rows are always found by its guids: one
// starting at 03:30 counts toward the day before, but its later matches start after that day ends.
import { BASELINE_DAYS } from "../../shared/constants";
import { daysBefore, dayOf, monthOf, periodRange, type PeriodRange, type PeriodSpec, type Season } from "../../shared/periods";
import { inFilter, playlistsPresent, type PlaylistFilter } from "../../shared/playlist-filter";
import { pairKey, withTeammate, type TeammateFilter } from "../../shared/teammate-filter";
import type { FriendCard, FriendDetail, FriendPair, FriendSuggestions, LatestSession, NeverSuggested, MatchDetail, MonthFolds, PairDetail, PeriodView, PlayedDays, SessionDetail, SessionList, SessionSummary } from "../../shared/schemas/responses";
import { aggregate, baseline, byPlaylist, type MyMatch } from "../../shared/aggregate";
import { clutchCounts, clutchStats, type ClutchRef } from "../../shared/clutch";
import { sessionContribution } from "../../shared/contribution";
import { friendCard, friendView, together } from "../../shared/friend-stats";
import type { Logger } from "../log";
import { tiltCounts } from "../../shared/tilt";
import { bucketKind, buckets, previousRange, rollingWindows, trendStats } from "../../shared/trends";
import type { MatchResult, QueryReader } from "../query/read";
import { currentSession, cutSessions, type Session } from "../query/sessions";

const C = "query";

const yours =
  (filter: PlaylistFilter, teammate: TeammateFilter = "anyone") =>
  (m: { playlistId: number | null; friends: readonly string[] }) =>
    inFilter(m.playlistId, filter) && withTeammate(m.friends, teammate);

/** Suggested: a teammate in at least this many matches, across at least this many sessions. */
const SUGGEST_MATCHES = 3;
const SUGGEST_SESSIONS = 2;
const played = (m: MyMatch) => m.me !== null;

export function createPages({ reader, logger, now }: { reader: QueryReader; logger: Logger; now: () => number }) {
  function index() {
    const breaks = reader.readBreaks();
    const results = reader.readResults();
    const all = cutSessions(results, breaks);
    const byGuid = new Map(results.map((r) => [r.guid, r]));
    const rowsOf = (s: Session, filter: PlaylistFilter, teammate: TeammateFilter): MatchResult[] => {
      const wanted = yours(filter, teammate);
      return s.guids.flatMap((g) => {
        const r = byGuid.get(g);
        return r?.played && wanted(r) ? [r] : [];
      });
    };
    return { all, current: currentSession(all, breaks, now()), byGuid, rowsOf, results };
  }
  type Index = ReturnType<typeof index>;

  /** The sessions with a match you played under the filters, oldest first, numbered within their day. */
  function summaries({ all, rowsOf }: Index, filter: PlaylistFilter, teammate: TeammateFilter): SessionSummary[] {
    const listed = all.flatMap((s) => {
      const rows = rowsOf(s, filter, teammate);
      return rows.length ? [{ s, rows, day: dayOf(s.startedAt) }] : [];
    });
    const perDay = Map.groupBy(listed, (l) => l.day);
    return listed.map(({ s, rows, day }) => {
      const sameDay = perDay.get(day) ?? [];
      return {
        key: s.key,
        day,
        ordinal: sameDay.findIndex((l) => l.s === s) + 1,
        ofDay: sameDay.length,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        matches: rows.length,
        wins: rows.filter((r) => r.result === "win").length,
        losses: rows.filter((r) => r.result === "loss").length,
        results: rows.map((r) => r.result),
      };
    });
  }

  function sessionList(filter: PlaylistFilter, fromDay: string, toDay: string, teammate: TeammateFilter = "anyone"): SessionList {
    const idx = index();
    const listed = summaries(idx, filter, teammate);
    const sessions = listed.filter((s) => fromDay <= s.day && s.day <= toDay);
    // Only a session the filter lists, so the key never names one missing from the list.
    const currentKey = listed.find((s) => s.key === idx.current?.key)?.key ?? null;
    return { sessions: sessions.reverse(), currentKey };
  }

  function monthFolds(filter: PlaylistFilter, beforeDay: string, teammate: TeammateFilter = "anyone"): MonthFolds {
    const before = summaries(index(), filter, teammate).filter((s) => s.day < beforeDay);
    const months = [...Map.groupBy(before, (s) => monthOf(s.day)).entries()].map(([month, ss]) => ({
      month,
      sessions: ss.length,
      wins: ss.reduce((n, s) => n + s.wins, 0),
      losses: ss.reduce((n, s) => n + s.losses, 0),
    }));
    return { months: months.reverse() };
  }

  /** Null when there's no current session or nothing in it is under the filters. */
  function currentSummary(filter: PlaylistFilter, teammate: TeammateFilter = "anyone"): SessionSummary | null {
    const idx = index();
    return idx.current === null ? null : (summaries(idx, filter, teammate).find((s) => s.key === idx.current?.key) ?? null);
  }

  /** The newest session with a match you played under the filters, however old (null when there's
   *  none), and the playlists of every match you played. */
  function latest(filter: PlaylistFilter, teammate: TeammateFilter = "anyone"): LatestSession {
    const idx = index();
    return {
      session: summaries(idx, filter, teammate).at(-1) ?? null,
      playlistsPresent: playlistsPresent(idx.results.filter((r) => r.played).map((r) => r.playlistId)),
    };
  }

  /** Null for a key no session has, such as one a break has since re-cut. */
  function sessionDetail(key: string, filter: PlaylistFilter, teammate: TeammateFilter = "anyone"): SessionDetail | null {
    const idx = index();
    const session = idx.all.find((s) => s.key === key);
    if (!session) return null;
    const listed = summaries(idx, filter, teammate);
    const day = dayOf(session.startedAt);
    const month = monthOf(day);
    const rows = reader.readMyMatches({ guids: session.guids }).filter(played);
    const matches = rows.filter(yours(filter, teammate));
    // The baseline reads only the window before this session, not all history.
    const before = reader.readMyMatches({ from: daysBefore(session.startedAt, BASELINE_DAYS), to: session.startedAt }).filter(yours(filter, teammate));
    // Under the playlist filter only, so a friend offered in the dropdown never filters to nothing.
    const present = new Set(rows.filter(yours(filter)).flatMap((m) => m.friends));
    // The teammate filter's friends are broken out in Contribution; anyone and solo break out nobody.
    const ids = typeof teammate === "object" ? teammate.friends : [];
    const friendsPresent = reader
      .readFriends()
      .filter((f) => present.has(f.id))
      .map(({ id, name }) => ({ id, name }));
    return {
      key,
      day,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      current: idx.current?.key === key,
      summary: listed.find((s) => s.key === key) ?? null,
      matches,
      aggregate: aggregate(matches),
      byPlaylist: byPlaylist(matches),
      playlistsPresent: playlistsPresent(rows.map((m) => m.playlistId)),
      friendsPresent,
      baseline: baseline(before, session.startedAt),
      goals: reader.readGoals(matches.map((m) => m.guid)),
      contribution: sessionContribution(reader.readLobbies(ids, { guids: matches.map((m) => m.guid) }), ids),
      // By time, so a session with nothing under the filter still has neighbours.
      prev: listed.findLast((s) => s.startedAt < session.startedAt)?.key ?? null,
      next: listed.find((s) => s.startedAt > session.startedAt)?.key ?? null,
      // The nearest session in the nearest month with one: the previous month's newest, the next
      // month's first. Once set, neither moves as sessions are added; nextMonth starts null.
      prevMonth: listed.findLast((s) => monthOf(s.day) < month)?.key ?? null,
      nextMonth: listed.find((s) => monthOf(s.day) > month)?.key ?? null,
    };
  }

  const keyOf = ({ all }: Index, guid: string) => all.find((s) => s.guids.includes(guid))?.key ?? null;

  function matchDetail(guid: string): MatchDetail | null {
    const m = reader.readMatch(guid);
    if (!m) return null;
    return { ...m, goals: reader.readGoals([guid]), sessionKey: keyOf(index(), guid) };
  }

  /**
   * Each match counts in the period it started in; a session across an edge counts in both. Null
   * for an unknown season. Buckets and the previous period follow the filter like the aggregate.
   */
  function period(spec: PeriodSpec, filter: PlaylistFilter, window: number, teammate: TeammateFilter = "anyone"): PeriodView | null {
    const at = now();
    const seasons = reader.readSeasons();
    const range = periodRange(spec, { now: at, seasons });
    if (!range) return null;
    const mine = (r: PeriodRange) => reader.readMyMatches({ from: r.from ?? undefined, to: r.to }).filter(played);
    const rows = mine(range);
    const wanted = yours(filter, teammate);
    const matches = rows.filter(wanted);
    const idx = index();
    const inRange = (r: MatchResult) => (range.from === null || r.startedAt >= range.from) && r.startedAt < range.to;
    // In start order, as the reader returns them; the buckets ascend without overlap, so they take
    // the matches in one pass.
    const firstDay = matches[0] ? dayOf(matches[0].startedAt) : null;
    const prevRange = previousRange(spec, range, { now: at, seasons });
    const kind = bucketKind(spec);
    const sessionOf = kind === "day" ? daySessions(idx, filter, teammate) : () => null;
    let next = 0;
    return {
      range,
      aggregate: aggregate(matches),
      playlistsPresent: playlistsPresent(rows.map((m) => m.playlistId)),
      sessions: idx.all.filter((s) => idx.rowsOf(s, filter, teammate).some(inRange)).length,
      previous: prevRange && { range: prevRange, aggregate: aggregate(mine(prevRange).filter(wanted)) },
      firstDay,
      bucket: kind,
      buckets: buckets(spec, range, { now: at, firstDay }).map((b) => {
        const startsBefore = (t: number) => (matches[next]?.startedAt ?? Infinity) < t;
        while (startsBefore(b.from)) next++;
        const start = next;
        while (startsBefore(b.to)) next++;
        const first = matches[start];
        return { ...b, stats: trendStats(aggregate(matches.slice(start, next))), session: next > start && first ? sessionOf(b.day, first.guid) : null };
      }),
      rolling: rolling(idx, range, wanted, matches, window),
      clutch: clutch(idx, matches),
      tilt: tilt(idx, inRange, wanted),
    };
  }

  /**
   * Tilt over the sessions with a match in the period. Game number and streak run over every match you
   * played in the session under "everything" (private and offline left out), even outside the period
   * or the filters; only the period's counted matches under the filters land in buckets. The current
   * session isn't counted as ended. Null when no decided match lands.
   */
  function tilt(idx: Index, inRange: (r: MatchResult) => boolean, wanted: ReturnType<typeof yours>): PeriodView["tilt"] {
    const sessions = idx.all.flatMap((s) => {
      const matches = s.guids.flatMap((g) => {
        const r = idx.byGuid.get(g);
        return r?.played && inFilter(r.playlistId, "everything") ? [r] : [];
      });
      return matches.some(inRange) ? [{ matches, ended: s !== idx.current }] : [];
    });
    const { counts, noResult } = tiltCounts(sessions, (r) => inRange(r) && wanted(r) && clutchCounts(r.playlistId));
    const matches = counts.games.reduce((n, r) => n + r.w + r.l, 0);
    logger.info(C, "tilt", { matches, sessions: counts.sessions, endedOnLoss: counts.endedOnLoss, noResult });
    return matches ? counts : null;
  }

  /** Clutch over a period's matches, each biggest swing with the session that opens its match page. */
  function clutch(idx: Index, matches: readonly MyMatch[]): PeriodView["clutch"] {
    const c = clutchStats(matches, reader.readGoals(matches.map((m) => m.guid)));
    logger.info(C, "clutch", { matches: c?.stats.matches ?? 0, skippedOrder: c?.stats.skippedOrder ?? 0, skipped: c?.skipped.slice(0, 5) ?? [] });
    if (!c) return null;
    const keyed = (r: ClutchRef | null) => r && { ...r, sessionKey: keyOf(idx, r.guid) };
    return { ...c.stats, best: keyed(c.stats.best), worst: keyed(c.stats.worst) };
  }

  /**
   * Where a day's recap opens: the day's first listed session, or, for a day holding only the tail
   * of a session that began before the cutoff, the session of the day's first match.
   */
  function daySessions(idx: Index, filter: PlaylistFilter, teammate: TeammateFilter) {
    const firstOfDay = new Map<string, string>();
    for (const s of summaries(idx, filter, teammate)) if (!firstOfDay.has(s.day)) firstOfDay.set(s.day, s.key);
    // The fallback is rare, so its map over every session is built on first use.
    let keyByGuid: Map<string, string> | undefined;
    const byGuid = (g: string) => (keyByGuid ??= new Map(idx.all.flatMap((s) => s.guids.map((guid) => [guid, s.key] as const)))).get(g);
    return (day: string, firstGuid: string) => firstOfDay.get(day) ?? byGuid(firstGuid) ?? null;
  }

  /** Only the last `size` − 1 matches before the period are read, so a window never needs the whole history. */
  function rolling({ results }: Index, range: PeriodRange, wanted: ReturnType<typeof yours>, matches: MyMatch[], size: number) {
    const from = range.from;
    const prior = from === null ? [] : results.filter((r) => r.played && r.startedAt < from && wanted(r));
    const reach = prior.slice(Math.max(0, prior.length - (size - 1)));
    const before = reach.length ? reader.readMyMatches({ guids: reach.map((r) => r.guid) }).filter(played) : [];
    return rollingWindows(before, matches, size).map(({ n, end, window }) => ({ n, startedAt: end.startedAt, stats: trendStats(aggregate(window)) }));
  }

  /** Read from the results alone (in start order): a day's count needs no sessions. */
  function playedDays(year: number, filter: PlaylistFilter, teammate: TeammateFilter = "anyone"): PlayedDays {
    const mine = reader.readResults().filter((r) => r.played);
    const prefix = `${String(year)}-`;
    const days = mine.filter(yours(filter, teammate)).map((r) => dayOf(r.startedAt)).filter((d) => d.startsWith(prefix));
    return {
      days: [...Map.groupBy(days, (d) => d).entries()].map(([day, ds]) => ({ day, matches: ds.length })),
      firstDay: mine[0] ? dayOf(mine[0].startedAt) : null,
      totalMatches: mine.length,
    };
  }

  const sessionsByGuid = ({ all }: Index) => new Map(all.flatMap((s) => s.guids.map((g) => [g, s.key] as const)));
  const sessionLookup = () => {
    const byGuid = sessionsByGuid(index());
    return (guid: string) => byGuid.get(guid) ?? null;
  };

  /**
   * Every friend with both records; a friend's side and records come from friendCard. Pairs of
   * friends appear by the suggestion rule, counting matches with both on one side together.
   */
  function friends(): { friends: FriendCard[]; pairs: FriendPair[] } {
    const list = reader.readFriends();
    if (!list.length) return { friends: [], pairs: [] };
    const ids = list.map((f) => f.id);
    const lobbies = reader.readLobbies(ids);
    const seen = reader.readLastNames(ids);
    // Sessions need the whole index, so it's read only once some pair has enough matches.
    let sessionOf: ((guid: string) => string | null) | undefined;
    const pairs = ids.flatMap((a, i) => ids.slice(i + 1).flatMap((b): FriendPair[] => {
      const pair = pairKey(a, b);
      const ms = together(lobbies, pair);
      if (ms.length < SUGGEST_MATCHES) return [];
      const of = (sessionOf ??= sessionLookup());
      const sessions = new Set(ms.map((m) => of(m.guid))).size;
      return sessions >= SUGGEST_SESSIONS ? [{ ids: pair, ...friendCard(ms, pair) }] : [];
    }));
    pairs.sort((x, y) => (y.lastPlayed ?? 0) - (x.lastPlayed ?? 0));
    logger.info(C, "friend_pairs", { friends: ids.length, pairs: pairs.length });
    return { friends: list.map((f) => ({ ...f, lastSeenName: seen.get(f.id) ?? null, ...friendCard(lobbies, [f.id]) })), pairs };
  }

  /** Null when the id isn't a friend. */
  function friendDetail(id: string): FriendDetail | null {
    const friend = reader.readFriends().find((f) => f.id === id);
    if (!friend) return null;
    const view = friendView(reader.readLobbies([id]), [id], sessionLookup());
    logger.info(C, "friend_detail", { id, with: view.with.record.n, against: view.against.record.n, modes: view.with.modes.map((m) => m.mode) });
    return { friend: { ...friend, lastSeenName: reader.readLastNames([id]).get(id) ?? null }, view };
  }

  /** Null unless both are friends and differ; the friends and the view's arrays are in key order. */
  function pairDetail(a: string, b: string): PairDetail | null {
    if (a === b) return null;
    const ids = pairKey(a, b);
    const all = reader.readFriends();
    const [x, y] = ids.map((id) => all.find((f) => f.id === id));
    if (!x || !y) return null;
    const view = friendView(reader.readLobbies(ids), ids, sessionLookup());
    const seen = reader.readLastNames(ids);
    const row = (f: typeof x) => ({ ...f, lastSeenName: seen.get(f.id) ?? null });
    logger.info(C, "pair_detail", { ids, with: view.with.record.n, against: view.against.record.n, modes: view.with.modes.map((m) => m.mode) });
    return { friends: [row(x), row(y)], view };
  }

  /** By the name they last used, else their id. */
  function neverSuggested(): NeverSuggested {
    const ids = reader.readNeverSuggest();
    const seen = reader.readLastNames(ids);
    return { players: ids.map((id) => ({ id, name: seen.get(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name)) };
  }

  /** Humans often on your team who aren't friends or never-suggest; named by their latest match. */
  function friendSuggestions(): FriendSuggestions {
    const sessionOf = sessionsByGuid(index());
    const skip = new Set([...reader.readFriends().map((f) => f.id), ...reader.readNeverSuggest()]);
    // In start order, so each id's last row has the name they used most recently.
    const byId = Map.groupBy(
      reader.readTeammates().filter((t) => !skip.has(t.primaryId)),
      (t) => t.primaryId,
    );
    const suggestions = [...byId.entries()].flatMap(([id, rows]) => {
      const matches = new Set(rows.map((r) => r.guid)).size;
      const sessions = new Set(rows.map((r) => sessionOf.get(r.guid))).size;
      const name = rows.at(-1)?.name ?? id;
      return matches >= SUGGEST_MATCHES && sessions >= SUGGEST_SESSIONS ? [{ id, name, matches, sessions }] : [];
    });
    return { suggestions: suggestions.sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)) };
  }

  return {
    /** The account the reader is scoped to, or null for every account. */
    account: reader.account,
    sessionList,
    friendSuggestions,
    friends,
    friendDetail,
    pairDetail,
    neverSuggested,
    monthFolds,
    currentSummary,
    latest,
    sessionDetail,
    matchDetail,
    period,
    playedDays,
    seasons: (): Season[] => reader.readSeasons(),
    sessionKeyOf: (guid: string) => keyOf(index(), guid),
  };
}

export type Pages = ReturnType<typeof createPages>;

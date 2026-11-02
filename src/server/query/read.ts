// Reads match records for pages. "You" are found at read time: a player whose PrimaryId is in
// my_ids and not rejected, so confirming or rejecting an id re-labels every match.
import type { Db, Param } from "../db/sqlite";
import type { Logger } from "../log";
import { flagReasons, type FlagInput } from "../../shared/flags";
import type { Season } from "../../shared/periods";
import { resultFor, type Result } from "../../shared/result";
import type { Friend, Goal, MatchDetail } from "../../shared/schemas/responses";
import type { MyMatch, MyRow } from "../../shared/aggregate";
import type { LobbyFriend, LobbyMatch } from "../../shared/friend-stats";

const C = "query";

export interface ReadRange {
  /** Inclusive, on started_at. */
  from?: number;
  /** Exclusive, on started_at. */
  to?: number;
  guids?: readonly string[];
}

export const MINE = "SELECT primary_id FROM my_ids WHERE status != 'rejected'";

interface MatchRow {
  guid: string;
  started_at: number;
  ended_at: number;
  playlist_id: number | null;
  arena: string | null;
  end_kind: MyMatch["endKind"];
  closed_via: MyMatch["closedVia"];
  overtime: number;
  score_team0: number | null;
  score_team1: number | null;
  winner_team_num: number | null;
  mvp_key: string | null;
  camera_primary_id: string | null;
  joined_in_progress: number;
  winner_source: FlagInput["winnerSource"];
  mvp_source: FlagInput["mvpSource"];
  check_failed: number;
  // Your row's columns; null when no player of yours is in the match.
  player_key: string | null;
  primary_id: string | null;
  team_num: number | null;
  teams_seen: number | null;
  score: number;
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  demos: number;
  touches: number;
  hardest_shot_kmh: number | null;
  woodwork_hits: number | null;
  aerial_touches: number | null;
  car_ms: number | null;
  boost_avg: number | null;
  supersonic_ms: number | null;
  empty_boost_ms: number | null;
}

/** A match in the index: when it was, its playlist, and your result in it. */
export interface MatchResult {
  guid: string;
  startedAt: number;
  endedAt: number;
  playlistId: number | null;
  /** A player of yours was in it; false when spectated. */
  played: boolean;
  result: Result | null;
  /** Your friends on your team at any point, as on MyMatch. */
  friends: string[];
}

/** A human on your team in a match, for friend suggestions. */
export interface Teammate {
  guid: string;
  primaryId: string;
  name: string;
}

type ResultRow = Pick<MatchRow, "guid" | "started_at" | "ended_at" | "playlist_id" | "end_kind" | "closed_via" | "winner_team_num" | "camera_primary_id" | "player_key" | "primary_id" | "team_num" | "teams_seen">;

/** Another human in a match: not a bot, not one of your ids. */
interface OtherRow {
  match_guid: string;
  primary_id: string;
  name: string;
  teams_seen: number;
}

/** A match row for readLobbies, with your row's columns (null when spectated). */
type LobbyRow = Pick<MatchRow, "guid" | "started_at" | "ended_at" | "playlist_id" | "overtime" | "score_team0" | "score_team1" | "winner_team_num" | "end_kind" | "closed_via" | "mvp_key" | "camera_primary_id" | "player_key" | "primary_id" | "team_num" | "teams_seen" | "score" | "goals" | "assists" | "saves" | "shots">;

/** Any player in a match, for team sizes, team totals and the listed friends. */
interface LobbyPlayerRow {
  match_guid: string;
  player_key: string;
  primary_id: string;
  team_num: number | null;
  teams_seen: number;
  is_bot: number;
  mine: number;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
}

const lineOf = (r: { player_key: string; score: number; goals: number; assists: number; saves: number; shots: number }) => ({
  playerKey: r.player_key,
  score: r.score,
  goals: r.goals,
  assists: r.assists,
  saves: r.saves,
  shots: r.shots,
});

/** On a team at any point in the match; nobody is on a null team. */
const wasOn = (teamsSeen: number, team: number | null) => team !== null && (teamsSeen & (1 << team)) !== 0;

interface GoalRow {
  match_guid: string;
  idx: number;
  team_num: number;
  scorer_key: string;
  assister_key: string | null;
  toucher_key: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  distance: number | null;
  speed_kmh: number | null;
  deflected: number;
  aerial: number;
  own_goal: number;
}

type FullMatchRow = Omit<MatchRow, "winner_source" | "mvp_source" | "check_failed" | "player_key" | "primary_id" | "team_num" | "teams_seen" | keyof PlayerStats> & {
  check_flags: string;
};

type PlayerStats = Pick<MatchRow, "score" | "goals" | "shots" | "assists" | "saves" | "demos" | "touches" | "hardest_shot_kmh" | "woodwork_hits" | "aerial_touches" | "car_ms" | "boost_avg" | "supersonic_ms" | "empty_boost_ms">;

type PlayerDbRow = PlayerStats & {
  player_key: string;
  primary_id: string;
  name: string;
  is_bot: number;
  team_num: number | null;
  present_at_end: number;
  /** 1 when the id is one of yours. */
  mine: number;
};

function where({ from, to, guids }: ReadRange): { sql: string; params: Param[] } {
  const conds: string[] = [];
  const params: Param[] = [];
  if (from !== undefined) {
    conds.push("m.started_at >= ?");
    params.push(from);
  }
  if (to !== undefined) {
    conds.push("m.started_at < ?");
    params.push(to);
  }
  if (guids) {
    // One JSON parameter rather than a placeholder per guid, so no list hits SQLite's variable limit.
    conds.push("m.guid IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(guids));
  }
  return { sql: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

/** A row with a player of yours. */
type Mine = MatchRow & { player_key: string };
/** The match fields picking you needs: its guid for the log line, its camera to choose by. */
type PickMatch = Pick<MatchRow, "guid" | "camera_primary_id">;
/** A row that may be a player of yours; player_key is null where a join found none. */
interface Candidate {
  primary_id: string | null;
  player_key: string | null;
}
const isNonEmpty = <T>(xs: T[]): xs is [T, ...T[]] => xs.length > 0;

const toMyRow = (r: Mine): MyRow => ({
  playerKey: r.player_key,
  teamNum: r.team_num,
  score: r.score,
  goals: r.goals,
  shots: r.shots,
  assists: r.assists,
  saves: r.saves,
  demos: r.demos,
  touches: r.touches,
  hardestShotKmh: r.hardest_shot_kmh,
  woodworkHits: r.woodwork_hits,
  aerialTouches: r.aerial_touches,
  carMs: r.car_ms,
  boostAvg: r.boost_avg,
  supersonicMs: r.supersonic_ms,
  emptyBoostMs: r.empty_boost_ms,
});

const at = (guid: string, key: string) => `${guid}\n${key}`;

/** Your result from the match row and your team; null for no team (spectated, or no team seen). */
const myResult = (m: Pick<MatchRow, "winner_team_num" | "end_kind" | "closed_via">, teamNum: number | null): Result | null =>
  resultFor({ winnerTeamNum: m.winner_team_num, endKind: m.end_kind, closedVia: m.closed_via }, teamNum);

function toMyMatch(
  m: MatchRow,
  me: MyRow | null,
  goals: readonly { speed_kmh: number | null; own_goal: number }[],
  statfeed: readonly { event_name: string; count: number }[],
  friends: string[],
): MyMatch {
  return {
    guid: m.guid,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    playlistId: m.playlist_id,
    arena: m.arena,
    endKind: m.end_kind,
    closedVia: m.closed_via,
    overtime: m.overtime === 1,
    scoreTeam0: m.score_team0,
    scoreTeam1: m.score_team1,
    winnerTeamNum: m.winner_team_num,
    mvpKey: m.mvp_key,
    flags: flagReasons({
      endKind: m.end_kind,
      joinedInProgress: m.joined_in_progress === 1,
      winnerSource: m.winner_source,
      mvpSource: m.mvp_source,
      checkFailed: m.check_failed === 1,
    }),
    me,
    result: myResult(m, me?.teamNum ?? null),
    goals: goals.map((g) => ({ speedKmh: g.speed_kmh, ownGoal: g.own_goal === 1 })),
    statfeed: Object.fromEntries(statfeed.map((s) => [s.event_name, s.count])),
    friends,
  };
}

export function createQueryReader({ tracker, logger }: { tracker: Db; logger: Logger }) {
  /** Matches already reported with two of your ids, so a page that re-reads doesn't repeat the warning. */
  const twoYousReported = new Set<string>();
  /** Matches already reported with a team switch around a friend, for the same reason. */
  const switchReported = new Set<string>();

  function timed<T>(fn: string, read: () => T[]): T[] {
    const started = performance.now();
    const rows = read();
    logger.info(C, "read", { fn, rows: rows.length, ms: Math.round(performance.now() - started) });
    return rows;
  }

  /**
   * You among a match's rows; null when none is yours (spectated). Two of your ids in one lobby has
   * never been seen: the camera's player is the one you were watching as; without it, the lowest
   * key, so the choice is at least stable.
   */
  function pickMe<R extends Candidate>(match: PickMatch, rows: readonly R[]): (R & { player_key: string }) | null {
    const mine = rows.filter((r): r is R & { player_key: string } => r.player_key !== null);
    if (!isNonEmpty(mine)) return null;
    const [first] = mine;
    if (mine.length === 1) return first;
    const chosen = mine.find((r) => r.primary_id === match.camera_primary_id) ?? first;
    if (!twoYousReported.has(match.guid)) {
      twoYousReported.add(match.guid);
      logger.warn(C, "two_yous", { guid: match.guid, keys: mine.map((r) => r.player_key), chosen: chosen.player_key });
    }
    return chosen;
  }

  /** The other humans in the range's matches, by match; only your friends when `friendsOnly`. */
  function othersIn(w: ReturnType<typeof where>, friendsOnly: boolean): Map<string, OtherRow[]> {
    const rows = tracker.all<OtherRow>(
      `SELECT p.match_guid, p.primary_id, p.name, p.teams_seen
       FROM match_players p ${friendsOnly ? "JOIN friends f ON f.primary_id = p.primary_id" : ""}
       WHERE p.is_bot = 0 AND p.primary_id NOT IN (${MINE})
         AND p.match_guid IN (SELECT m.guid FROM matches m ${w.sql})
       ORDER BY p.match_guid, p.primary_id`,
      ...w.params,
    );
    return Map.groupBy(rows, (r) => r.match_guid);
  }

  /**
   * Your friends on your team at any point, judged by your final team. A switch by a friend, or by
   * you with a friend in the lobby, has never been seen: it's logged once per match.
   */
  function friendsWithYou(guid: string, me: Pick<MatchRow, "team_num" | "teams_seen"> | null, friends: readonly OtherRow[]): string[] {
    if (!me) return [];
    const switched = friends.filter((f) => f.teams_seen === 3).map((f) => f.primary_id);
    const youSwitched = me.teams_seen === 3 && friends.length > 0;
    if ((switched.length > 0 || youSwitched) && !switchReported.has(guid)) {
      switchReported.add(guid);
      logger.warn(C, "friend_switched_team", { guid, ids: switched, you: youSwitched });
    }
    return [...new Set(friends.filter((f) => wasOn(f.teams_seen, me.team_num)).map((f) => f.primary_id))];
  }

  /** Per match, you (null when spectated) picked among the rows of your ids. */
  function resultRows(): { m: ResultRow; me: ResultRow | null }[] {
    const rows = tracker.all<ResultRow>(
      `SELECT m.guid, m.started_at, m.ended_at, m.playlist_id, m.end_kind, m.closed_via, m.winner_team_num, m.camera_primary_id,
         p.player_key, p.primary_id, p.team_num, p.teams_seen
       FROM matches m
       LEFT JOIN match_players p ON p.match_guid = m.guid AND p.primary_id IN (${MINE})
       ORDER BY m.started_at, m.guid, p.player_key`,
    );
    return [...Map.groupBy(rows, (r) => r.guid).values()].map((group) => {
      const [m] = group as [ResultRow, ...ResultRow[]];
      return { m, me: pickMe(m, group) };
    });
  }

  function readMyMatches(range: ReadRange = {}): MyMatch[] {
    return timed("readMyMatches", () => {
      const w = where(range);
      const rows = tracker.all<MatchRow>(
        `SELECT m.guid, m.started_at, m.ended_at, m.playlist_id, m.arena, m.end_kind, m.closed_via, m.overtime, m.score_team0,
           m.score_team1, m.winner_team_num, m.mvp_key, m.camera_primary_id, m.joined_in_progress,
           m.winner_source, m.mvp_source, m.check_flags != '[]' AS check_failed, p.player_key, p.primary_id, p.team_num, p.teams_seen, p.score, p.goals, p.shots, p.assists, p.saves,
           p.demos, p.touches, p.hardest_shot_kmh, p.woodwork_hits, p.aerial_touches, p.car_ms, p.boost_avg, p.supersonic_ms,
           p.empty_boost_ms
         FROM matches m
         LEFT JOIN match_players p ON p.match_guid = m.guid AND p.primary_id IN (${MINE})
         ${w.sql}
         ORDER BY m.started_at, m.guid, p.player_key`,
        ...w.params,
      );
      // Your goals and statfeed for the same matches, by the same predicate rather than a list of every guid.
      const yours = (key: "scorer_key" | "player_key") =>
        `JOIN match_players p ON p.match_guid = x.match_guid AND p.player_key = x.${key} AND p.primary_id IN (${MINE})
         WHERE x.match_guid IN (SELECT m.guid FROM matches m ${w.sql})`;
      const goals = tracker.all<{ match_guid: string; scorer_key: string; speed_kmh: number | null; own_goal: number }>(
        `SELECT x.match_guid, x.scorer_key, x.speed_kmh, x.own_goal FROM match_goals x ${yours("scorer_key")} ORDER BY x.match_guid, x.idx`,
        ...w.params,
      );
      const statfeed = tracker.all<{ match_guid: string; player_key: string; event_name: string; count: number }>(
        `SELECT x.match_guid, x.player_key, x.event_name, x.count FROM match_player_statfeed x ${yours("player_key")}`,
        ...w.params,
      );

      // Keyed by match and player, so a match with two of your ids gets only the chosen one's.
      const goalsOf = Map.groupBy(goals, (g) => at(g.match_guid, g.scorer_key));
      const feedOf = Map.groupBy(statfeed, (s) => at(s.match_guid, s.player_key));
      const friendsOf = othersIn(w, true);
      return [...Map.groupBy(rows, (r) => r.guid).values()].map((group) => {
        const [m] = group as [MatchRow, ...MatchRow[]];
        const picked = pickMe(m, group);
        const me = picked === null ? null : toMyRow(picked);
        const mine = me === null ? "" : at(m.guid, me.playerKey);
        const friends = friendsWithYou(m.guid, picked, friendsOf.get(m.guid) ?? []);
        return toMyMatch(m, me, goalsOf.get(mine) ?? [], feedOf.get(mine) ?? [], friends);
      });
    });
  }

  /** Per match, whether you played and your result: the light index pages cut and count sessions from. */
  function readResults(): MatchResult[] {
    return timed("readResults", () => {
      const friendsOf = othersIn(where({}), true);
      return resultRows().map(({ m, me }) => ({
        guid: m.guid,
        startedAt: m.started_at,
        endedAt: m.ended_at,
        playlistId: m.playlist_id,
        played: me !== null,
        result: myResult(m, me?.team_num ?? null),
        friends: friendsWithYou(m.guid, me, friendsOf.get(m.guid) ?? []),
      }));
    });
  }

  /** Every human on your team at any point who isn't you, per match, for friend suggestions. */
  function readTeammates(): Teammate[] {
    return timed("readTeammates", () => {
      const othersOf = othersIn(where({}), false);
      return resultRows().flatMap(({ m, me }) =>
        (othersOf.get(m.guid) ?? [])
          .filter((o) => wasOn(o.teams_seen, me?.team_num ?? null))
          .map((o) => ({ guid: m.guid, primaryId: o.primary_id, name: o.name })),
      );
    });
  }

  /**
   * Every match you played, with team sizes, your final team's totals and the listed friends (humans,
   * not yours) by side: with you if on your team at any point, against if only ever on the other.
   * With no team of yours, nobody is listed. Every player row is read once: a personal history is
   * small, and `timed` shows the cost if it grows.
   */
  function readLobbies(friendIds: readonly string[]): LobbyMatch[] {
    return timed("readLobbies", () => {
      const rows = tracker.all<LobbyRow>(
        `SELECT m.guid, m.started_at, m.ended_at, m.playlist_id, m.overtime, m.score_team0, m.score_team1, m.winner_team_num, m.end_kind,
           m.closed_via, m.mvp_key, m.camera_primary_id, p.player_key, p.primary_id, p.team_num, p.teams_seen, p.score, p.goals,
           p.assists, p.saves, p.shots
         FROM matches m
         LEFT JOIN match_players p ON p.match_guid = m.guid AND p.primary_id IN (${MINE})
         ORDER BY m.started_at, m.guid, p.player_key`,
      );
      const playersOf = Map.groupBy(
        tracker.all<LobbyPlayerRow>(
          `SELECT match_guid, player_key, primary_id, team_num, teams_seen, is_bot, primary_id IN (${MINE}) AS mine,
             score, goals, assists, saves, shots
           FROM match_players ORDER BY match_guid, primary_id`,
        ),
        (p) => p.match_guid,
      );
      const listed = new Set(friendIds);
      return [...Map.groupBy(rows, (r) => r.guid).values()].flatMap((group) => {
        const [m] = group as [LobbyRow, ...LobbyRow[]];
        const me = pickMe(m, group);
        if (me === null) return [];
        const team = me.team_num;
        const players = playersOf.get(m.guid) ?? [];
        const onMine = players.filter((p) => team !== null && p.team_num === team);
        const scores = team === null || m.score_team0 === null || m.score_team1 === null ? null : [m.score_team0, m.score_team1];
        const mvp = m.mvp_key === null ? undefined : players.find((p) => p.player_key === m.mvp_key);
        const friends = players.flatMap((p): LobbyFriend[] => {
          if (team === null || p.is_bot === 1 || p.mine === 1 || !listed.has(p.primary_id)) return [];
          const side = wasOn(p.teams_seen, team) ? "with" : wasOn(p.teams_seen, 1 - team) ? "against" : null;
          return side === null ? [] : [{ id: p.primary_id, side, switched: p.teams_seen === 3, ...lineOf(p) }];
        });
        return [{
          guid: m.guid,
          startedAt: m.started_at,
          endedAt: m.ended_at,
          playlistId: m.playlist_id,
          overtime: m.overtime === 1,
          result: myResult(m, team),
          goalDiff: scores === null || team === null ? null : (scores[team] ?? 0) - (scores[1 - team] ?? 0),
          sizes: { mine: onMine.length, other: players.filter((p) => team !== null && p.team_num === 1 - team).length },
          me: lineOf(me),
          myTeamTotals: { score: onMine.reduce((n, p) => n + p.score, 0), goals: onMine.reduce((n, p) => n + p.goals, 0) },
          mvpKey: m.mvp_key,
          mvpOnMyTeam: mvp === undefined ? null : mvp.team_num === team,
          youSwitched: me.teams_seen === 3,
          friends,
        }];
      });
    });
  }

  /** Every friend by name: the nickname, else the name in their latest match. */
  function readFriends(): Friend[] {
    return timed("readFriends", () =>
      tracker.all<Friend>(
        `SELECT f.primary_id AS id, f.nickname,
           COALESCE(f.nickname, (SELECT p.name FROM match_players p JOIN matches m ON m.guid = p.match_guid
             WHERE p.primary_id = f.primary_id ORDER BY m.started_at DESC LIMIT 1), f.primary_id) AS name
         FROM friends f`,
      )
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /** The name each id used in its latest match; an id never seen is left out. */
  function readLastNames(ids: readonly string[]): Map<string, string> {
    const rows = timed("readLastNames", () =>
      tracker.all<{ primary_id: string; name: string }>(
        `SELECT p.primary_id, p.name FROM match_players p JOIN matches m ON m.guid = p.match_guid
         WHERE p.primary_id IN (SELECT value FROM json_each(?))
         ORDER BY m.started_at`,
        JSON.stringify(ids),
      ),
    );
    // In start order, so each id's last row wins.
    return new Map(rows.map((r) => [r.primary_id, r.name]));
  }

  /** Every goal of these matches, in match then goal order. */
  function readGoals(guids: readonly string[]): Goal[] {
    return timed("readGoals", () =>
      tracker
        .all<GoalRow>(
          `SELECT match_guid, idx, team_num, scorer_key, assister_key, toucher_key, x, y, z, distance, speed_kmh, deflected, aerial, own_goal
           FROM match_goals WHERE match_guid IN (SELECT value FROM json_each(?))
           ORDER BY match_guid, idx`,
          JSON.stringify(guids),
        )
        .map((g) => ({
          matchGuid: g.match_guid,
          idx: g.idx,
          teamNum: g.team_num,
          scorerKey: g.scorer_key,
          assisterKey: g.assister_key,
          toucherKey: g.toucher_key,
          pos: g.x === null || g.y === null || g.z === null ? null : { x: g.x, y: g.y, z: g.z },
          distance: g.distance,
          speedKmh: g.speed_kmh,
          deflected: g.deflected === 1,
          aerial: g.aerial === 1,
          ownGoal: g.own_goal === 1,
        })),
    );
  }

  /** One match with every player, you marked by the same rule as readMyMatches; null when there's no such match. */
  function readMatch(guid: string): Omit<MatchDetail, "goals" | "sessionKey"> | null {
    const [m] = timed("readMatch", () =>
      tracker.all<FullMatchRow>(
        `SELECT guid, started_at, ended_at, playlist_id, arena, end_kind, closed_via, joined_in_progress, overtime, score_team0,
           score_team1, winner_team_num, mvp_key, camera_primary_id, check_flags
         FROM matches WHERE guid = ?`,
        guid,
      ),
    );
    if (!m) return null;
    const players = timed("readMatchPlayers", () =>
      tracker.all<PlayerDbRow>(
        `SELECT player_key, primary_id, name, is_bot, team_num, present_at_end, score, goals, shots, assists, saves, touches, demos,
           hardest_shot_kmh, woodwork_hits, aerial_touches, car_ms, boost_avg, supersonic_ms, empty_boost_ms,
           primary_id IN (${MINE}) AS mine
         FROM match_players WHERE match_guid = ? ORDER BY player_key`,
        guid,
      ),
    );
    const me = pickMe(m, players.filter((p) => p.mine === 1));
    return {
      match: {
        guid: m.guid,
        startedAt: m.started_at,
        endedAt: m.ended_at,
        playlistId: m.playlist_id,
        arena: m.arena,
        endKind: m.end_kind,
        closedVia: m.closed_via,
        joinedInProgress: m.joined_in_progress === 1,
        overtime: m.overtime === 1,
        scoreTeam0: m.score_team0,
        scoreTeam1: m.score_team1,
        winnerTeamNum: m.winner_team_num,
        mvpKey: m.mvp_key,
        checkFlags: JSON.parse(m.check_flags) as string[],
      },
      players: players.map((p) => ({
        playerKey: p.player_key,
        name: p.name,
        isBot: p.is_bot === 1,
        teamNum: p.team_num,
        presentAtEnd: p.present_at_end === 1,
        score: p.score,
        goals: p.goals,
        shots: p.shots,
        assists: p.assists,
        saves: p.saves,
        touches: p.touches,
        demos: p.demos,
        hardestShotKmh: p.hardest_shot_kmh,
        woodworkHits: p.woodwork_hits,
        aerialTouches: p.aerial_touches,
        carMs: p.car_ms,
        boostAvg: p.boost_avg,
        supersonicMs: p.supersonic_ms,
        emptyBoostMs: p.empty_boost_ms,
        isMe: p.player_key === me?.player_key,
      })),
      result: myResult(m, me?.team_num ?? null),
    };
  }

  return {
    readMyMatches,
    readResults,
    readTeammates,
    readLobbies,
    readFriends,
    readLastNames,
    readNeverSuggest: (): string[] =>
      timed("readNeverSuggest", () => tracker.all<{ primary_id: string }>("SELECT primary_id FROM never_suggest").map((r) => r.primary_id)),
    readGoals,
    readMatch,
    readBreaks: (): number[] => timed("readBreaks", () => tracker.all<{ at: number }>("SELECT at FROM session_breaks ORDER BY at").map((b) => b.at)),
    readSeasons: (): Season[] => timed("readSeasons", () => tracker.all<Season>("SELECT id, name, start_date AS startDate FROM seasons ORDER BY start_date")),
  };
}

export type QueryReader = ReturnType<typeof createQueryReader>;

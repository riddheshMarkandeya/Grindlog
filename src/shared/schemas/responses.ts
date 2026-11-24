// What the API sends. The server's handlers are typed by these schemas' inferred types, and the
// web parses with them, so a shape change is a type error on both sides.
import { z } from "zod";
import { FLAG_REASONS } from "../flags";
import type { ClutchRef, ClutchStats } from "../clutch";
import type { TiltCounts } from "../tilt";
import type { SessionContribution } from "../contribution";
import { MODE_ORDER } from "../lobby";
import type { FriendView } from "../friend-stats";
import type { Season } from "../periods";
import type { TrendStats } from "../trends";

const counted = z.object({ goals: z.number(), assists: z.number(), saves: z.number(), shots: z.number(), demos: z.number(), score: z.number() });
const countedOrNull = z.object({
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  saves: z.number().nullable(),
  shots: z.number().nullable(),
  demos: z.number().nullable(),
  score: z.number().nullable(),
});
const result = z.enum(["win", "loss"]);
const endKind = z.enum(["completed", "early_end", "left", "orphaned"]);
const closedVia = z.enum(["destroyed", "timeout", "restart", "superseded"]);

export const aggregateSchema = z.object({
  matches: z.number(),
  wins: z.number().nullable(),
  losses: z.number().nullable(),
  noResult: z.number().nullable(),
  winPct: z.number().nullable(),
  leftEarly: z.number().nullable(),
  mvps: z.number().nullable(),
  totals: countedOrNull,
  perGame: countedOrNull,
  shootingPct: z.number().nullable(),
  bestWinStreak: z.number().nullable(),
  bestLossStreak: z.number().nullable(),
  endedOn: z.object({ result, length: z.number() }).nullable(),
  extrasMatches: z.number(),
  hardestShotKmh: z.number().nullable(),
  fastestGoalKmh: z.number().nullable(),
  woodworkHits: z.number().nullable(),
  aerialTouches: z.number().nullable(),
  boostAvg: z.number().nullable(),
  supersonicShare: z.number().nullable(),
  emptyBoostShare: z.number().nullable(),
  statfeed: z.record(z.string(), z.number()),
});

/** The extras columns of a player row; null until computed, the car stats also without car state. */
const extras = {
  hardestShotKmh: z.number().nullable(),
  woodworkHits: z.number().nullable(),
  aerialTouches: z.number().nullable(),
  carMs: z.number().nullable(),
  boostAvg: z.number().nullable(),
  supersonicMs: z.number().nullable(),
  emptyBoostMs: z.number().nullable(),
};

export const myRowSchema = counted.extend({ playerKey: z.string(), teamNum: z.number().nullable(), touches: z.number(), ...extras });

export const myMatchSchema = z.object({
  guid: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  playlistId: z.number().nullable(),
  arena: z.string().nullable(),
  endKind,
  closedVia,
  overtime: z.boolean(),
  scoreTeam0: z.number().nullable(),
  scoreTeam1: z.number().nullable(),
  winnerTeamNum: z.number().nullable(),
  mvpKey: z.string().nullable(),
  /** Why the match is flagged; [] when it isn't. */
  flags: z.array(z.enum(FLAG_REASONS)),
  me: myRowSchema.nullable(),
  result: result.nullable(),
  /** Your goals. */
  goals: z.array(z.object({ speedKmh: z.number().nullable(), ownGoal: z.boolean() })),
  statfeed: z.record(z.string(), z.number()),
  /** Your friends who were on your team at any point, by PrimaryId. */
  friends: z.array(z.string()),
});

/** Counted touches by third from the player's own goal: defence, midfield, attack. */
export const thirds = z.tuple([z.number(), z.number(), z.number()]);

/** Per-person arrays: [you, ...friends, the rest of your team]. */
const shares = z.array(z.number());
const carrySchema = z.object({ matches: z.number(), touchMatches: z.number(), score: shares, goals: shares, assists: shares, saves: shares, shots: shares, touches: shares, mvps: shares });

/** A session split by mode (`sessionContribution` in shared/contribution); null with no mode at all. */
const contributionSchema = z.object({
  modes: z.array(
    z.object({
      mode: z.enum(MODE_ORDER),
      matches: z.number(),
      carry: carrySchema,
      /** Over `carry.touchMatches`: [you, ...friends, the rest of your team, the opponents]. */
      thirds: z.array(thirds),
    }),
  ),
  defaultMode: z.enum(MODE_ORDER),
}) satisfies z.ZodType<SessionContribution>;

export const goalSchema = z.object({
  matchGuid: z.string(),
  idx: z.number(),
  teamNum: z.number(),
  scorerKey: z.string(),
  /** The scorer's and assister's names in that match; null when no player row has the key. */
  scorerName: z.string().nullable(),
  assisterKey: z.string().nullable(),
  assisterName: z.string().nullable(),
  toucherKey: z.string().nullable(),
  /** The ball at the touch, raw field coordinates; null for an own goal. */
  pos: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  distance: z.number().nullable(),
  speedKmh: z.number().nullable(),
  deflected: z.boolean(),
  aerial: z.boolean(),
  ownGoal: z.boolean(),
  /** The last game-clock reading before the goal: time left in regulation, time played in overtime. Null until recompute. */
  clock: z.object({ seconds: z.number(), overtime: z.boolean() }).nullable(),
});

/** A session as the picker and the header chip show it, counting only matches you played under the filter. */
export const sessionSummarySchema = z.object({
  key: z.string(),
  /** Local `YYYY-MM-DD` of its first match. */
  day: z.string(),
  /** "2nd of 2 that day", over the sessions listed under the same filter. */
  ordinal: z.number(),
  ofDay: z.number(),
  startedAt: z.number(),
  endedAt: z.number(),
  matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  /** Oldest first. */
  results: z.array(result.nullable()),
});

/** Newest first. */
export const sessionsResponse = z.object({ sessions: z.array(sessionSummarySchema), currentKey: z.string().nullable() });

/** Newest first; `month` is `YYYY-MM`. */
export const monthsResponse = z.object({
  months: z.array(z.object({ month: z.string(), sessions: z.number(), wins: z.number(), losses: z.number() })),
});

export const currentResponse = z.object({ session: sessionSummarySchema.nullable() });

/** The newest session under the filter, and every playlist you've played, so an empty history and a narrow filter can be told apart. */
export const latestResponse = z.object({ session: sessionSummarySchema.nullable(), playlistsPresent: z.array(z.number()) });

export const sessionDetailResponse = z.object({
  key: z.string(),
  day: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  current: z.boolean(),
  /** Null when nothing in the session is under the filter. */
  summary: sessionSummarySchema.nullable(),
  /** Yours under the filter, oldest first. */
  matches: z.array(myMatchSchema),
  aggregate: aggregateSchema,
  byPlaylist: z.array(z.object({ playlistId: z.number().nullable(), aggregate: aggregateSchema })),
  /** Every playlist you played in the session, whatever the filter, for the dropdown. */
  playlistsPresent: z.array(z.number()),
  /** Friends on your team in the session's matches under the playlist filter (not the teammate filter), by name. */
  friendsPresent: z.array(z.object({ id: z.string(), name: z.string() })),
  baseline: aggregateSchema,
  goals: z.array(goalSchema),
  contribution: contributionSchema.nullable(),
  /** The neighbouring sessions listed under both filters. */
  prev: z.string().nullable(),
  next: z.string().nullable(),
  prevMonth: z.string().nullable(),
  nextMonth: z.string().nullable(),
});

export const matchPlayerSchema = counted.extend({
  playerKey: z.string(),
  name: z.string(),
  isBot: z.boolean(),
  teamNum: z.number().nullable(),
  presentAtEnd: z.boolean(),
  touches: z.number(),
  ...extras,
  /** Counted touches by third from their own goal (defence, midfield, attack); null until recomputed. */
  thirds: thirds.nullable(),
  isMe: z.boolean(),
});

export const matchDetailResponse = z.object({
  match: z.object({
    guid: z.string(),
    startedAt: z.number(),
    endedAt: z.number(),
    playlistId: z.number().nullable(),
    arena: z.string().nullable(),
    endKind,
    closedVia,
    joinedInProgress: z.boolean(),
    overtime: z.boolean(),
    scoreTeam0: z.number().nullable(),
    scoreTeam1: z.number().nullable(),
    winnerTeamNum: z.number().nullable(),
    mvpKey: z.string().nullable(),
    checkFlags: z.array(z.string()),
    /** The largest regulation clock reading, up to a whole minute; null until recompute or with no reading. */
    regulationSeconds: z.number().nullable(),
  }),
  players: z.array(matchPlayerSchema),
  goals: z.array(goalSchema),
  /** Yours; null when spectated or undecided. */
  result: result.nullable(),
  sessionKey: z.string().nullable(),
});

const rangeSchema = z.object({ from: z.number().nullable(), to: z.number(), running: z.boolean() });

const orNull = z.number().nullable();
export const trendStatsSchema = z.object({
  matches: z.number(),
  wins: orNull,
  losses: orNull,
  winPct: orNull,
  shootingPct: orNull,
  perGame: z.object({ goals: orNull, assists: orNull, saves: orNull, shots: orNull }),
}) satisfies z.ZodType<TrendStats>;

const record = z.object({ w: z.number(), l: z.number() });
const rungs = z.tuple([record, record, record]);
/** The period's biggest swing; `sessionKey` opens its match page, null when its session wasn't found. */
const clutchRef = z.object({ guid: z.string(), startedAt: z.number(), score: z.string(), at: z.string(), by: z.number(), sessionKey: z.string().nullable() }) satisfies z.ZodType<ClutchRef>;
export const clutchSchema = z.object({
  matches: z.number(),
  skippedOrder: z.number(),
  oneGoal: record,
  oneGoalNoOt: record,
  overtime: record,
  scoredFirst: record,
  concededFirst: record,
  forfeits: record,
  comebacks: z.object({ n: z.number(), of: z.number() }),
  blownLeads: z.object({ n: z.number(), of: z.number() }),
  ladder: z.object({ down: rungs, up: rungs }),
  best: clutchRef.nullable(),
  worst: clutchRef.nullable(),
}) satisfies z.ZodType<ClutchStats>;

const four = z.tuple([record, record, record, record]);
/** Wins and losses by session game number (1–3, 4–6, 7–9, 10+) and after a win / 1, 2, 3+ losses. */
export const tiltSchema = z.object({
  games: four,
  streaks: four,
  /** Ended sessions with a decided match (the current one left out), and those that ended on a loss. */
  sessions: z.number(),
  endedOnLoss: z.number(),
}) satisfies z.ZodType<TiltCounts>;

export const periodResponse = z.object({
  range: rangeSchema,
  aggregate: aggregateSchema,
  playlistsPresent: z.array(z.number()),
  /** Sessions with a match of yours under the filter in the range; one across an edge counts in both periods. */
  sessions: z.number(),
  /** The period compared with, under the same filter; null where there's none (this year, all time, day, year, the first season). */
  previous: z.object({ range: rangeSchema, aggregate: aggregateSchema }).nullable(),
  /** The first day with a match of yours under the filter in the range; all time starts there. */
  firstDay: z.string().nullable(),
  bucket: z.enum(["day", "week", "month"]),
  /** `session`: for a day bucket with matches, the session its recap opens on; null otherwise. */
  buckets: z.array(z.object({ from: z.number(), to: z.number(), day: z.string(), stats: trendStatsSchema, session: z.string().nullable() })),
  /** One point per period match `n` (from 1) that ends a full rolling window (the request's `window`); the window reaches back before the period. */
  rolling: z.array(z.object({ n: z.number(), startedAt: z.number(), stats: trendStatsSchema })),
  /** Clutch over the period's counted matches; null when none counts. */
  clutch: clutchSchema.nullable(),
  /** Tilt over the period's counted matches; null when no decided one counts. */
  tilt: tiltSchema.nullable(),
});

/** Matches you played per local day of a year under the filter; `firstDay` and `totalMatches` cover every match you played, whatever the filter. */
export const playedDaysResponse = z.object({
  days: z.array(z.object({ day: z.string(), matches: z.number() })),
  firstDay: z.string().nullable(),
  totalMatches: z.number(),
});

export const seasonsResponse = z.object({ seasons: z.array(z.object({ id: z.number(), name: z.string(), startDate: z.string() }) satisfies z.ZodType<Season>) });

/** The players the tracker counts as you, or asks about. `pending` counts as you until answered. */
export const idsResponse = z.object({
  ids: z.array(z.object({ primaryId: z.string(), name: z.string().nullable(), platform: z.string(), status: z.enum(["confirmed", "pending", "rejected"]) })),
});
export type IdRow = z.infer<typeof idsResponse>["ids"][number];

/** A friend: one PrimaryId, named by the nickname, else the name in their latest match. */
export const friendSchema = z.object({ id: z.string(), nickname: z.string().nullable(), name: z.string() });
export type Friend = z.infer<typeof friendSchema>;

const wl = z.object({ w: z.number(), l: z.number(), n: z.number() });
const streak = z.object({ result, length: z.number() }).nullable();
const playlistRow = wl.extend({ label: z.string() });
const perMatch = z.object({ matches: z.number(), winPct: z.number().nullable(), score: z.number(), goals: z.number(), assists: z.number(), saves: z.number(), shots: z.number() });
const statLine = z.object({ score: z.number(), goals: z.number(), assists: z.number(), saves: z.number(), shots: z.number() });

/** A friend on the Friends page: both records, when you last played them, and the name they last used (null if never seen). */
export const friendCardSchema = friendSchema.extend({ lastSeenName: z.string().nullable(), with: wl, against: wl, lastPlayed: z.number().nullable() });
export type FriendCard = z.infer<typeof friendCardSchema>;

/** Two friends both on your team, or both on the other, often enough to list; ids in key order. */
const friendPairSchema = friendCardSchema.pick({ with: true, against: true, lastPlayed: true }).extend({ ids: z.tuple([z.string(), z.string()]) });
export type FriendPair = z.infer<typeof friendPairSchema>;

export const friendsResponse = z.object({ friends: z.array(friendCardSchema), pairs: z.array(friendPairSchema) });

const friendRow = friendSchema.extend({ lastSeenName: z.string().nullable() });

/** One friend's page or a pair's, worked out on the server (`friendView` in shared/friend-stats); per-person arrays are [you, ...friends]. */
const friendViewSchema = z.object({
  with: z.object({
    record: wl,
    last: z.number().nullable(),
    playlists: z.array(playlistRow),
    streak,
    bestWinStreak: z.number(),
    best: playlistRow.nullable(),
    worst: playlistRow.nullable(),
    timeMs: z.number(),
    overtime: wl,
    modes: z.array(
      z.object({
        mode: z.enum(MODE_ORDER),
        matches: z.number(),
        carry: carrySchema,
        compare: z.object({ with: perMatch, without: perMatch.nullable(), friends: z.array(perMatch) }),
      }),
    ),
    defaultMode: z.enum(MODE_ORDER).nullable(),
  }),
  against: z.object({
    record: wl,
    last: z.number().nullable(),
    playlists: z.array(playlistRow),
    streak,
    mvps: z.array(z.number()),
    goals: z.array(z.number()),
    biggestWin: z.object({ guid: z.string(), startedAt: z.number(), label: z.string(), goalDiff: z.number() }).nullable(),
    overtime: wl,
    matches: z.array(
      z.object({
        guid: z.string(),
        sessionKey: z.string().nullable(),
        startedAt: z.number(),
        playlistId: z.number().nullable(),
        label: z.string(),
        result: result.nullable(),
        me: statLine,
        friends: z.array(statLine),
        /** 0 = you, i + 1 = friend i. */
        mvp: z.number().nullable(),
      }),
    ),
  }),
}) satisfies z.ZodType<FriendView>;

export const friendDetailResponse = z.object({ friend: friendRow, view: friendViewSchema });
export type FriendDetail = z.infer<typeof friendDetailResponse>;

export const pairDetailResponse = z.object({ friends: z.tuple([friendRow, friendRow]), view: friendViewSchema });
export type PairDetail = z.infer<typeof pairDetailResponse>;

/** Players you said never to suggest, by the name they last used. */
export const neverSuggestResponse = z.object({ players: z.array(z.object({ id: z.string(), name: z.string() })) });
export type NeverSuggested = z.infer<typeof neverSuggestResponse>;

/** Humans often on your team who aren't friends yet, most matches first. */
export const suggestionsResponse = z.object({
  suggestions: z.array(z.object({ id: z.string(), name: z.string(), matches: z.number(), sessions: z.number() })),
});
export type FriendSuggestions = z.infer<typeof suggestionsResponse>;

/** A season write refused because another season has that name or start. */
export const seasonConflict = z.object({ error: z.enum(["duplicate_name", "duplicate_start"]) });

export const statusSchema = z.object({
  connection: z.enum(["waiting", "connected", "recording"]),
  /** The game has run a minute or more without the Stats API answering. */
  statsApiOff: z.boolean(),
  configProblems: z.array(z.enum(["no_ini", "user_missing", "send_rate_off", "web_port_off", "web_port_mismatch"])),
  /** A config check ended without finding the game's settings (or couldn't read them); false while the first runs. */
  configUnknown: z.boolean(),
  /** The Documents ini's full path, when the Documents folder was found, so setup text names the real file. */
  statsIni: z.string().nullable(),
  /** The port the tracker connects to, which the game's WebPort must be. */
  expectedWebPort: z.number().int(),
  /**
   * The release this build is; null for dev and source runs. An open tab reloads when it changes,
   * and an old tab's worker reads it even from a status its own schema rejects, so it must stay a
   * top-level nullable string in every later build.
   */
  version: z.string().nullable(),
  /** The tracker's process ID, so launchers and the updater know which process answered. */
  pid: z.number().int(),
});

/**
 * What the tray shows (GET /api/tray). The tray adds its own "Starting…" and "Not responding". Line and
 * setup urls are dashboard paths starting with "/"; the tray opens nothing else. Notices are toasts for the
 * tray to show, oldest first, until it acks their ids.
 */
export const trayResponse = z.object({
  icon: z.enum(["ready", "active", "attention"]),
  status: z.string(),
  lines: z.array(z.object({ text: z.string(), url: z.string().optional() })),
  setupUrl: z.string().nullable(),
  /** Names this tracker run, so the tray can tell its acks apart from an earlier run's. */
  instance: z.string(),
  notices: z.array(z.object({ id: z.number().int(), title: z.string(), body: z.string() })),
});
export type TrayResponse = z.infer<typeof trayResponse>;
export type TrayNotice = TrayResponse["notices"][number];

/** `GET /api/update` and the update writes: what the Updates section and the tray show. */
export const updateResponse = z.object({
  enabled: z.boolean(),
  version: z.string().nullable(),
  status: z.enum(["disabled", "not_checked", "up_to_date", "ready", "skipped", "error"]),
  available: z.object({ version: z.string(), page: z.string() }).nullable(),
  /** The newest version skipped (failed its signature check) above the running one. */
  skipped: z.string().nullable(),
  autoApply: z.boolean(),
  /** An install was asked for, for the version now available. */
  installRequested: z.boolean(),
  checkedAt: z.string().nullable(),
  /**
   * How the last update ended, while it's worth saying: "updated" for a day on the new version, a rollback
   * for a week on the old one, "unhealthy" for a week on the new one; otherwise null.
   */
  lastApply: z.object({ outcome: z.enum(["updated", "rolled_back", "rollback_failed", "unhealthy"]), from: z.string(), to: z.string(), reason: z.string().nullable(), at: z.string(), page: z.string() }).nullable(),
  /** A check was asked for and hasn't started yet. */
  checking: z.boolean(),
  /** When another check can be asked for (a minute after the last one ended), or null when it can now. */
  checkAllowedAt: z.string().nullable(),
});
export type UpdateResponse = z.infer<typeof updateResponse>;

/** The "Run at Windows startup" switch: the logon task on or off, or unavailable when it's missing or can't be read. */
export const autostartResponse = z.object({ state: z.enum(["on", "off", "unavailable"]) });

const fixKey = z.enum(["packetSendRate", "webPort"]);
/** `POST /api/stats-setup/fix`: the settings it changed and those it inserted (both empty when they were already right). */
export const statsSetupFixed = z.object({ changed: z.array(fixKey), added: z.array(fixKey) });
/**
 * Why the fix wrote nothing: 409 no_file (the game hasn't created its settings yet) or
 * port_needs_consent (a custom WebPort; retry with port=1); 500 write_failed or check_failed.
 */
export const statsSetupError = z.object({ error: z.enum(["no_file", "port_needs_consent", "write_failed", "check_failed"]) });
export type StatsSetupError = z.infer<typeof statsSetupError>["error"];

export const breakResponse = z.object({ at: z.number() });

/** A session's headline remarks. Texts are templates: `{n}`-style placeholders filled from `values` (raw numbers, km/h, epoch ms, a friend's name). */
export const remarksResponse = z.object({
  mood: z.object({ band: z.string(), text: z.string() }),
  quip: z.object({ trigger: z.string(), text: z.string(), values: z.record(z.string(), z.union([z.number(), z.string()])) }).nullable(),
});

/** Server-sent events, by event name. */
export const sseEvents = {
  status: statusSchema,
  match_ended: z.object({ guid: z.string(), sessionKey: z.string().nullable() }),
  session_break: breakResponse,
  /** A background recompute ended: any record may have changed. */
  records_recomputed: z.object({}),
  /** The season file added or moved a season: any season period may have changed. */
  seasons_changed: z.object({}),
};
export type SseEvents = { [K in keyof typeof sseEvents]: z.infer<(typeof sseEvents)[K]> };

export type AggregateWire = z.infer<typeof aggregateSchema>;
export type MyMatchWire = z.infer<typeof myMatchSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionList = z.infer<typeof sessionsResponse>;
export type LatestSession = z.infer<typeof latestResponse>;
export type MonthFolds = z.infer<typeof monthsResponse>;
export type PeriodView = z.infer<typeof periodResponse>;
export type ClutchView = z.infer<typeof clutchSchema>;
export type TiltView = z.infer<typeof tiltSchema>;
export type PlayedDays = z.infer<typeof playedDaysResponse>;
export type SessionDetail = z.infer<typeof sessionDetailResponse>;
export type MatchDetail = z.infer<typeof matchDetailResponse>;
export type Status = z.infer<typeof statusSchema>;
export type Remarks = z.infer<typeof remarksResponse>;

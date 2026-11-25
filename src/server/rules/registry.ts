// The stat rules as data: our own reading of the game's events, one entry per rule, with what it
// rests on. The definitions doc is generated from here, and a test keeps the two in sync. The
// constants are the values the code runs on, not copies.
import {
  BASELINE_DAYS,
  DAY_CUTOFF_HOUR,
  GOAL_LINE_Y,
  RETENTION_DAYS,
  ROLLING_LONG_DAYS,
  ROLLING_SHORT_DAYS,
  SESSION_GAP_MS,
  SIDE_WALL_X,
  WEEK_START_DAY,
} from "../../shared/constants";
import { SWING_MIN_GOALS } from "../../shared/clutch";
import { FIRM_N, MIN_N, TILT_Z } from "../../shared/tilt";
import { CLOSE_UNDER, LONG_FROM } from "../../shared/goal-range";
import { AERIAL_MIN_Z, CORNER_MAX_XY_SUM, HARDEST_SHOT_MAX_KMH, THIRD_Y, WALL_MARGIN } from "../recorder/extras";
import { CAR_SAMPLE_CAP_MS, TOUCH_MERGE_MS, WOODWORK_WINDOW_MS } from "../recorder/play";
import { ORPHAN_TIMEOUT_MS } from "../recorder/lifecycle";
import { UPDATE_STATE_INTERVAL_MS } from "../recorder/sampler";
import { REPLAY_PLAYBACK_SHARE } from "../recorder/checks";
import { CAMERA_SHARE, REPLAY_MIN_STATES } from "../recorder/summary";

/**
 * When a rule takes effect. "stored": while recording, into raw.db, so recompute can't change it.
 * "recorded": when a match's record is computed, live or by recompute; these rules' versions are
 * stored with each match. "read": when a page reads the record, so it always runs at its current version.
 */
export type Applied = "stored" | "recorded" | "read";

/** The order the generated doc lists the areas in. */
export const AREAS = ["recording", "match", "identity", "attribution", "extras", "goals", "queries"] as const;

export type Area = (typeof AREAS)[number];

export interface Rule {
  /** snake_case, stable: the per-match version map is keyed by it. */
  id: string;
  area: Area;
  /** The rule in one line. */
  rule: string;
  constants?: Readonly<Record<string, number>>;
  /** The check ids that flag a match this rule may have got wrong. */
  checks: readonly string[];
  /** What the rule rests on, with figures. */
  evidence: string;
  /** Bumped on any change that can move a stored value. */
  version: number;
  applied: Applied;
  /**
   * The stored columns ("table.column") this rule helps write, best-effort: rules feed each other.
   * rules-diff lists a moved column none of whose rules was bumped as one to review. A recorded rule
   * without them only decides which records or rows exist, or sets a check flag.
   */
  outputs?: readonly string[];
  /** Where it was decided, repo-relative: the dated history behind the current entry. */
  refs: readonly string[];
  /**
   * Reads every UpdateState. A thinned match keeps the outputs snapshotted when it was thinned, and
   * this rule's version with it. Its outputs must be inside the snapshot. A rule that feeds those
   * outputs but also others that recompute is not dense: it is on MIXED_WITH_DENSE, and a thinned
   * match records its current version though the frozen columns came from the snapshot.
   */
  dense?: true;
}

const ADR_RECORDER = "docs/decisions/2026-10-19-recorder-websocket-raw-store.md";
const PLAN_WP3A = "docs/plans/2026-10-19-wp3a-recorder.md";
const CAPTURES = "docs/research/2026-10-19-weekend-captures.md";
const ADR_RECORDS = "docs/decisions/2026-10-20-match-records-per-player.md";
const PLAN_WP4A = "docs/plans/2026-10-20-wp4a-match-records.md";
const ADR_EXTRAS = "docs/decisions/2026-10-20-match-extras-play-view.md";
const PLAN_WP4B = "docs/plans/2026-10-20-wp4b-match-extras.md";
const ADR_THINNING = "docs/decisions/2026-10-20-raw-thinning.md";
const PLAN_WP4CB = "docs/plans/2026-10-20-wp4c-b-retention-split.md";
const MAP = "docs/plans/2026-10-15-rl-tracker-features-map.md";
const PLAN_WP5AA = "docs/plans/2026-10-21-wp5a-a-query-logic.md";
const PLAN_WP6AA = "docs/plans/2026-10-26-wp6a-a-recap-navigation.md";
const PLAN_WP6AC = "docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md";
const PLAN_CONTRIBUTION = "docs/plans/2026-11-16-contribution-stats.md";
const PLAN_ACCOUNTS = "docs/plans/2026-11-22-account-profiles.md";
const ANALYTICS_MAP = "docs/plans/2026-11-23-analytics-map.md";
const PLAN_GOAL_CLOCK = "docs/plans/2026-11-24-goal-clock.md";
const PLAN_GOAL_TIMELINE = "docs/plans/2026-11-24-goal-timeline.md";

const p = (column: string) => `match_players.${column}`;
const m = (column: string) => `matches.${column}`;
const g = (column: string) => `match_goals.${column}`;
const mo = (column: string) => `match_moments.${column}`;

const CAR_STATS = [p("car_ms"), p("boost_avg"), p("supersonic_ms"), p("empty_boost_ms")];
const TOUCH_THIRDS = [p("touches_defence"), p("touches_midfield"), p("touches_attack")];
const HIT_STATS = [p("hardest_shot_kmh"), p("woodwork_hits"), p("aerial_touches"), ...TOUCH_THIRDS];
const GOAL_POINT = [g("toucher_key"), g("x"), g("y"), g("z"), g("distance"), g("deflected"), g("own_goal")];
const SCOREBOARD_STATS = ["score", "goals", "shots", "assists", "saves", "touches", "demos"].map(p);

export const RULES: readonly Rule[] = [
  // recording
  {
    id: "update_state_sampling",
    area: "recording",
    rule: "UpdateState is stored about once per interval; the latest dropped one is held and written just before the next other event (and before any close), so the scoreboard at a goal, MatchEnded or a close is never lost.",
    constants: { UPDATE_STATE_INTERVAL_MS },
    checks: [],
    evidence: "About 2 states a second follows the scoreboard; the car stats weigh each sample by the gap to the next, and car time covers 0.98–0.997 of live play on the 46 captured matches.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "loadout_once",
    area: "recording",
    rule: "Each player's Loadout is stored only the first time they appear in a match's states.",
    checks: [],
    evidence: "Loadout is constant within a match and makes up most of an UpdateState's size.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "menu_states_dropped",
    area: "recording",
    rule: "UpdateStates still showing the menu's PlaylistId 0, before the match's first non-zero one, are not stored.",
    checks: [],
    evidence: "They carry the menu, not the match.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "update_state_thinning",
    area: "recording",
    rule: "Once a match's last event is older than this many days, its UpdateStates are thinned to the first, the last, and each that changes a player's Name, PrimaryId, Shortcut, TeamNum or scoreboard stats, the teams' scores (or whether there is a scoreboard), PlaylistId, Arena or bOvertime, or reads a clock other than the running one; every other event is kept. The dense rules' outputs are snapshotted first.",
    constants: { RETENTION_DAYS },
    checks: ["thinned_snapshot_covers_dense"],
    evidence: "UpdateState is 94% of raw.db. On the 46 captured matches it kept 6,572 of 42,974 states in the 45 it thinned, raw.db went from 98.1 MB to 27.3 MB, and rules-diff showed no change: the car stats and camera came from the snapshot.",
    version: 1,
    applied: "stored",
    refs: [ADR_THINNING, PLAN_WP4CB],
  },
  {
    id: "retention_flag_exempt",
    area: "recording",
    rule: "A match past retention that any check flags under the current rules is kept whole, as the corpus for fixing a rule; the decision is re-checked when the recorded rule versions change, and a match no longer flagged is thinned.",
    checks: [],
    evidence: "Flagged matches are the ones a rule fix needs whole: the unseen-shape rule fits a rule to the real match when one first appears.",
    version: 1,
    applied: "stored",
    refs: [ADR_THINNING, PLAN_WP4CB],
  },
  {
    id: "open_match_owns_events",
    area: "recording",
    rule: "One match is open at a time, and it owns every event, whatever guid the event carries, until a MatchDestroyed (any guid) closes it.",
    checks: [],
    evidence: "After a private game the old match's teardown arrives under the next match's guid: 5 retagged teardowns on the 4 weekend captures, each kept with its match.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A, CAPTURES],
  },
  {
    id: "match_superseded",
    area: "recording",
    rule: "A MatchCreated with another guid closes the open match, whatever its phase, with cause superseded.",
    checks: [],
    evidence: "Never seen on the captures; a safety net against a lost MatchDestroyed.",
    version: 1,
    applied: "stored",
    refs: [PLAN_WP3A],
  },
  {
    id: "orphan_timeout",
    area: "recording",
    rule: "The recorder closes the open match itself with cause timeout after this long with no events, and with cause restart when it starts with a match left open.",
    constants: { ORPHAN_TIMEOUT_MS },
    checks: [],
    evidence: "Matches are serial, so only the last match can be left open; a restart on a real data dir closed its open match as restart.",
    version: 1,
    applied: "stored",
    refs: [PLAN_WP3A],
  },
  {
    id: "close_cause",
    area: "recording",
    rule: "closed_via is destroyed when the game's MatchDestroyed closed the match, else the recorder's cause (timeout, restart, superseded), stored with its RecorderClosed marker.",
    checks: [],
    evidence: "The cause tells a leave from a lost ending: it feeds the end kind (left vs orphaned) and your result.",
    version: 1,
    applied: "stored",
    refs: [ADR_RECORDER, PLAN_WP3A, ADR_RECORDS],
  },
  {
    id: "finished_match_stays_closed",
    area: "recording",
    rule: "A guid whose stored match reached MatchEnded never reopens: its events are dropped until another guid opens. A match closed before MatchEnded still reopens (Reconnect). The check flags a stretch between close markers of at least REPLAY_MIN_STATES states with at least REPLAY_PLAYBACK_SHARE of them bReplay.",
    constants: { REPLAY_MIN_STATES, REPLAY_PLAYBACK_SHARE },
    checks: ["replay_playback"],
    evidence: "Watching a saved replay re-sends its match's guid: on 24 Oct two finished matches reopened 56 times, every UpdateState bReplay (1046/1046, 1777/1777, against about a fifth in live play), with no MatchEnded and a MatchCreated/MatchDestroyed per scrub. No reopen came from a real Reconnect.",
    version: 1,
    applied: "stored",
    refs: [CAPTURES],
  },
  {
    id: "lobby_no_record",
    area: "recording",
    rule: "A match that closes before any live trigger (MatchInitialized, CountdownBegin, RoundStarted, GoalScored) is a lobby and gets no record; recompute keeps a lobby's existing record and warns.",
    checks: [],
    evidence: "A lobby opened and closed with no game on the captures.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP3A, ADR_RECORDS],
  },
  {
    id: "only_latest_match_open",
    area: "recording",
    rule: "Recompute skips a match with no close marker as still open; only the match with the latest event can be live, so another unclosed one is warned about.",
    checks: [],
    evidence: "Matches are serial: an unclosed match that isn't the latest lost its close marker in a failed write.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP3A, PLAN_WP4A],
  },
  {
    id: "dedup_replay_goal",
    area: "recording",
    rule: "A GoalScored with an empty scorer name, GoalSpeed 0 and GoalTime 0 is the replay's copy, dropped on read.",
    checks: ["goal_events_equal_score"],
    evidence: "Every goal is sent twice, the copy when the replay ends or is skipped; the three markers always come together on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_RECORDER, PLAN_WP3A, CAPTURES],
  },
  {
    id: "dedup_repeat_crossbar",
    area: "recording",
    rule: "A CrossbarHit whose data equals the previous CrossbarHit's is dropped on read.",
    checks: [],
    evidence: "The game repeats CrossbarHit with identical data.",
    version: 1,
    applied: "recorded",
    outputs: [p("woodwork_hits")],
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  {
    id: "dedup_repeat_ballhit",
    area: "recording",
    rule: "A BallHit whose data equals the previous BallHit's is dropped on read.",
    checks: [],
    evidence: "The game repeats BallHit with identical data.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...GOAL_POINT],
    refs: [ADR_RECORDER, PLAN_WP3A],
  },
  // match
  {
    id: "finished_match_ends_at_first_close",
    area: "match",
    rule: "A match's record reads its events up to its first close marker after MatchEnded; anything stored after it is not the match. ended_at is the last event read, and closed_via is that marker's cause.",
    checks: [],
    evidence: "Replay playback reopened two finished matches before the recorder refused it: their ended_at moved 1.5–2.5 days to the replay's last event and its goals were counted. Cut at the first close they end 22 Oct 03:23:39 and 23 Oct 03:58:52, with score and winner unchanged.",
    version: 1,
    applied: "recorded",
    outputs: [m("ended_at"), m("closed_via")],
    refs: [CAPTURES],
  },
  {
    id: "roster",
    area: "match",
    rule: "The roster is every player in a state before MatchEnded: team_num is their last real team, teams_seen has bit 1 << team for each team they were on, present_at_end says they were in the last state before MatchEnded.",
    checks: [],
    evidence: "Records cover every player, so pages resolve \"you\" and \"with you\" at read time; about 5 rows per match.",
    version: 1,
    applied: "recorded",
    outputs: [p("primary_id"), p("name"), p("team_num"), p("teams_seen"), p("present_at_end")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "real_teams_only",
    area: "match",
    rule: "Only TeamNum 0 and 1 are teams, wherever a team number is read; 255 (not on a team yet), -1 (no contest) and anything else are no team.",
    checks: ["winner_valid"],
    evidence: "A winner no player is on would show every player a loss (user's choice).",
    version: 1,
    applied: "recorded",
    outputs: [p("team_num"), p("teams_seen"), m("winner_team_num"), m("winner_source"), m("mvp_key"), m("mvp_source"), g("team_num"), ...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "score_last_full_scoreboard",
    area: "match",
    rule: "The score is the last scoreboard before MatchEnded with both teams' goals whole and non-negative; a scoreboard without them is rejected and counted.",
    checks: ["scoreboards_complete", "goal_events_equal_score", "player_goals_equal_score", "assists_within_goals"],
    evidence: "A scoreboard missing a team's goals says nothing reliable; none was rejected on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: [m("score_team0"), m("score_team1")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "final_player_stats",
    area: "match",
    rule: "Each scoreboard stat is the last state before MatchEnded raised to its highest value in the states after it, for players still in them.",
    checks: ["statfeed_matches_scoreboard", "player_goals_equal_score", "assists_within_goals", "player_stats_non_negative"],
    evidence: "In two real matches a shot under 0.5 s before MatchEnded reached the scoreboard only afterwards; teardown states can carry reset counters, so the highest value is kept.",
    version: 1,
    applied: "recorded",
    outputs: SCOREBOARD_STATS,
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "statfeed_counts",
    area: "match",
    rule: "Each StatfeedEvent counts once for its resolved target, by event name; one whose target doesn't resolve is counted apart.",
    checks: ["statfeed_resolved", "statfeed_matches_scoreboard"],
    evidence: "The statfeed matched the scoreboard on every captured match recorded from its start.",
    version: 1,
    applied: "recorded",
    outputs: ["match_player_statfeed.count"],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "end_kind",
    area: "match",
    rule: "With MatchEnded, a match ended early when, outside overtime, the last clock reading before it is above 0 or the one before that above 1, else it completed; without MatchEnded it was left (MatchDestroyed) or orphaned (the recorder closed it).",
    checks: ["clock_non_negative"],
    evidence: "Every match resets the clock to 0 just before MatchEnded: a full match counts down through 1, a forfeit jumps from where it stopped; in overtime the clock counts up.",
    version: 1,
    applied: "recorded",
    outputs: [m("end_kind")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "overtime",
    area: "match",
    rule: "A match went to overtime when any clock reading (a state or ClockUpdatedSeconds) has bOvertime.",
    checks: [],
    evidence: "bOvertime is the game's own flag.",
    version: 1,
    applied: "recorded",
    outputs: [m("overtime")],
    refs: [PLAN_WP4A],
  },
  {
    id: "regulation_length",
    area: "match",
    rule: "A match's regulation length is its largest non-overtime ClockUpdatedSeconds reading, rounded up to a whole minute; null with no such reading above 0. A reading whose bOvertime isn't a boolean is taken as regulation and flagged. A match joined in progress can read short.",
    checks: ["clock_overtime_flagged"],
    evidence: "Of 360 stored matches, 341 start the clock at 299 and 11 at 300; 2 joined in progress read at most 245 and 296; all of them give 300. 2 private matches start at 180. 2 matches joined at the very end have only the final reset to 0, and 2 have no reading, so 4 are null. A private match starting at 372 (→ 420) is in raw.db but not stored.",
    version: 1,
    applied: "recorded",
    outputs: [m("regulation_seconds")],
    refs: [ANALYTICS_MAP, PLAN_GOAL_CLOCK],
  },
  {
    id: "timeline_moments",
    area: "match",
    rule: "Every Shot, Save, EpicSave and Assist statfeed from the start of the match until the first Win statfeed or MatchEnded, whose MainTarget resolves to a roster player, is a moment: its kind, player and the last ClockUpdatedSeconds reading before it (as for a goal). The clock starts at the kickoff's first touch, so a moment before the first reading takes the regulation length when that reading is within 2 s of it; joined in progress, with no regulation length, or after a later first reading (early readings missing), it's null and flagged. At each live goal, the scorer's last shot since the kickoff that isn't paired yet becomes that goal's shot. The moments of each kind equal each player's statfeed tally, which is checked.",
    checks: ["moments_clocked", "moments_match_statfeed"],
    evidence: "In the dev data's non-joined matches, Save+EpicSave and Assist statfeeds equal the scoreboard for all 1,601 player rows and Shot statfeeds for all but 5. Shot statfeeds are 4,370 in play and 1 in the countdown; the rest are all in play. 1,878 of 1,987 goals have a Shot by the scorer since the kickoff (the game didn't count the other 109 as shots); the gap is a median 1.0 s, p99 5.4 s and up to 84 s, so the pairing uses no time window. In 9 of 360 stored matches a kickoff Shot comes before the first reading, the 299 tick, while the states still show 300. No Shot, Save or Assist statfeed comes after its GoalScored or after the first Win.",
    version: 1,
    applied: "recorded",
    outputs: [mo("kind"), mo("player_key"), mo("clock_seconds"), mo("clock_overtime"), mo("goal_idx")],
    refs: [ANALYTICS_MAP, PLAN_GOAL_TIMELINE],
  },
  {
    id: "end_clock",
    area: "match",
    rule: "A match's end clock is the last ClockUpdatedSeconds reading before the first Win statfeed (resolved or not) that comes before MatchEnded, or the last reading at all when no Win comes (left, orphaned); null with no reading. It's stored as read, with the reading's bOvertime. A forfeit resets the clock to 0 only after its Win, hence the cut there; a forfeit with no Win statfeed is flagged.",
    checks: ["forfeit_end_clocked"],
    evidence: "In the dev data, all 81 non-joined forfeits have a Win statfeed and a non-zero regulation reading before it. 199 of 207 regulation completions read 0 and 8 read 1; all 53 overtime completions read in overtime. None of the 11 left matches has a Win: 9 have a reading and 2 have none.",
    version: 1,
    applied: "recorded",
    outputs: [m("end_clock_seconds"), m("end_clock_overtime")],
    refs: [ANALYTICS_MAP, PLAN_GOAL_TIMELINE],
  },
  {
    id: "joined_in_progress",
    area: "match",
    rule: "A match whose stored events have no MatchInitialized was joined in progress.",
    checks: [],
    evidence: "MatchInitialized comes once at the start; re-derived from the stored events so recompute needs only raw.db.",
    version: 1,
    applied: "recorded",
    outputs: [m("joined_in_progress")],
    refs: [PLAN_WP3A, PLAN_WP4A],
  },
  {
    id: "playlist_and_arena",
    area: "match",
    rule: "playlist_id is the last non-zero PlaylistId and arena the last Arena in the states before MatchEnded, both stored raw.",
    checks: ["playlist_present"],
    evidence: "The playlist map is applied when a page reads it, so a corrected map reaches old matches.",
    version: 1,
    applied: "recorded",
    outputs: [m("playlist_id"), m("arena")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "winner",
    area: "match",
    rule: "The winner is MatchEnded's WinnerTeamNum when it names a real team (a no contest names none); without MatchEnded, the team ahead when the clock had reached 0 or it was overtime (\"decided\").",
    checks: ["winner_valid"],
    evidence: "Every MatchEnded match on the captures has a winner; a one-goal lead at 0 s could in theory still be equalised, which the feature map accepts.",
    version: 1,
    applied: "recorded",
    outputs: [m("winner_team_num"), m("winner_source"), m("mvp_key"), m("mvp_source")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "mvp",
    area: "match",
    rule: "The MVP is the MVP statfeed's target; with none, the winning team's unique top scorer among players present at the end; a tie or no winner gives none.",
    checks: ["mvp_count", "mvp_on_roster"],
    evidence:
      "Of 65 real matches, 61 had a podium and one award, 3 a podium and none, 1 an award and no podium. 61 of the 62 awards went to the winning team's top scorer (the other was a tie on score), never to a player who had left. In 2 of the 3 without an award that top scorer had left, so the game held it back and the inference names someone it didn't pick: kept by the user's choice.",
    version: 2,
    applied: "recorded",
    outputs: [m("mvp_key"), m("mvp_source")],
    refs: [ADR_RECORDS, PLAN_WP4A, PLAN_WP6AA],
  },
  {
    id: "your_result",
    area: "match",
    rule: "Your result: a winner decides it; without one, a leave, a superseded close or a timeout is a loss, a restart is unknown, and any other end has no result.",
    checks: [],
    evidence: "After a restart the tracker was down and play may have gone on, so a loss would be a guess (user's choice).",
    version: 1,
    applied: "read",
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "match_flags",
    area: "match",
    rule: "A match is flagged when you left, the tracker lost its ending, you joined in progress, the winner was taken from the score, the MVP was inferred, or a check failed; a forfeit counts normally and isn't flagged.",
    checks: [],
    evidence: "The user's choice (2026-10-27): flag what was guessed or cut short. Real data then: 4 of 76 matches (1 left, 3 inferred MVPs); 21 forfeits unflagged.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP6AC],
  },
  {
    id: "playlist_map",
    area: "match",
    rule: "A playlist id maps to a name and group when a page reads it; an unmapped id is logged once per run with the team sizes.",
    checks: [],
    evidence: "From community lists checked against live play; the game reuses ids (4 was Chaos, now Casual Quads).",
    version: 1,
    applied: "read",
    refs: [ADR_RECORDS, "docs/research/2026-10-15-rl-playlist-ids.md"],
  },
  // identity
  {
    id: "player_key",
    area: "identity",
    rule: "A player's key within a match is their PrimaryId; bots, which all share Unknown|0|0, are keyed bot:<Name>.",
    checks: [],
    evidence: "Every bot has the PrimaryId Unknown|0|0.",
    version: 1,
    applied: "recorded",
    outputs: [p("player_key"), p("is_bot")],
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "target_resolution",
    area: "identity",
    rule: "An event's player reference (Name, Shortcut, TeamNum, no id) is the player with that Shortcut in the latest state when name and team agree, else the one roster player with that name and team, else unresolved.",
    checks: ["statfeed_resolved", "mvp_on_roster"],
    evidence: "Statfeed targets, hitters, scorers and assisters carry no PrimaryId, only Name, Shortcut and TeamNum; the roster is keyed by PrimaryId.",
    version: 1,
    applied: "recorded",
    outputs: ["match_player_statfeed.count", m("mvp_key"), m("camera_primary_id"), g("scorer_key"), g("assister_key"), g("aerial"), ...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [PLAN_WP4A, PLAN_WP4B],
  },
  {
    id: "camera_identity",
    area: "identity",
    rule: "The camera's player is the roster player holding at least this share of the resolved camera targets in play (replays and the podium don't count, unresolved targets say nothing); a bot or no such player gives none.",
    constants: { CAMERA_SHARE },
    checks: ["camera_on_roster", "thinned_snapshot_on_roster"],
    evidence: "The user's own matches had 100% of targets on one player and a spectated private 1v1 71%; counting unresolved targets put a real match at 94.6%.",
    version: 1,
    applied: "recorded",
    outputs: [m("camera_primary_id")],
    dense: true,
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "pending_guess",
    area: "identity",
    rule: "The camera's PrimaryId becomes a pending my_ids guess unless it is already in my_ids (any status) or a confirmed id played the match.",
    checks: [],
    evidence: "46 real matches gave exactly one pending guess, the user's.",
    version: 1,
    applied: "recorded",
    refs: [ADR_RECORDS, PLAN_WP4A],
  },
  {
    id: "your_row",
    area: "identity",
    rule: "You, in a match, are the player whose PrimaryId is in my_ids and not rejected (a pending guess counts); none is a spectated match, with no result and not in your stats. Two of your ids in one match: the account picked in the header is you, else the camera's, else the lowest key, logged once per match. With an account picked, only matches that id played count.",
    checks: [],
    evidence: "Found at read time, so confirming or rejecting an id, or picking an account, re-labels every match. Two ids in one lobby has never been seen; it is logged (query/two_yous) to fit the rule when it happens.",
    version: 2,
    applied: "read",
    refs: [PLAN_WP4A, PLAN_WP5AA, PLAN_ACCOUNTS],
  },
  // attribution
  {
    id: "live_play_window",
    area: "attribution",
    rule: "Only live play counts for the extras: from RoundStarted to the live GoalScored or MatchEnded, less pauses; a match joined in progress starts in play.",
    checks: ["extras_computed"],
    evidence: "212 of 212 BallHits in the completed fixture fell in live play; CrossbarHit fires in replays and on the podium too.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...CAR_STATS, ...GOAL_POINT, g("aerial")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "every_entry_a_hitter",
    area: "attribution",
    rule: "Every entry of BallHit.Players is a hitter, so a 50/50 credits both players.",
    checks: [],
    evidence: "100 of 1,164 fixture hits list two players; crediting only the first made a kickoff 50/50 look like an own goal.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh"), p("aerial_touches"), ...TOUCH_THIRDS, ...GOAL_POINT],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "reference_resolution",
    area: "attribution",
    rule: "A hit, shot, woodwork or goal-last-touch reference that isn't an object is missing and not counted; a player object off the roster counts as unresolved under its kind; a hit's non-object Players entry counts as an unidentified hitter.",
    checks: ["touches_resolved"],
    evidence: "A stat credited to a guessed player would be wrong without a trace, so an unknown reference counts toward touches_resolved instead. No unresolved reference on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: [...HIT_STATS, ...GOAL_POINT],
    refs: [PLAN_WP4B],
  },
  {
    id: "last_touch_comparison",
    area: "attribution",
    rule: "A goal's BallLastTouch is compared with the last hit only when both are known (the last touch and every last hitter resolve, or no hit came since a seen kickoff); it disagrees when it isn't among the last hit's hitters.",
    checks: ["goal_last_touch_agrees"],
    evidence: "An unknown side can't show a disagreement, and counting it either way would flag correct matches or hide wrong ones. No missing BallLastTouch in 432 real GoalScoreds.",
    version: 1,
    applied: "recorded",
    refs: [PLAN_WP4B],
  },
  {
    id: "touch_merge",
    area: "attribution",
    rule: "A player's hit counts as a new touch only when someone else hit since their last counted one, or this long has passed.",
    constants: { TOUCH_MERGE_MS },
    checks: ["extras_in_range"],
    evidence: "The game sends a BallHit per contact, 1.2–1.8× its own touch count.",
    version: 1,
    applied: "recorded",
    outputs: [p("aerial_touches"), ...TOUCH_THIRDS],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  // extras
  {
    id: "hardest_shot",
    area: "extras",
    rule: "Hardest shot is the fastest PostHitSpeed (km/h) over each Shot statfeed's last live hit by the shooter since the kickoff and each goal's origin hit; checked against the maximum.",
    constants: { HARDEST_SHOT_MAX_KMH },
    checks: ["shots_have_touch", "extras_in_range"],
    evidence: "The Shot statfeed arrives 0.1–1.7 s after the touch; PostHitSpeed peaked at 177 km/h (p99 131) on the captures. Every hit would count dribbles and clears.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "aerial_touch",
    area: "extras",
    rule: "A counted touch is aerial when the ball is at least AERIAL_MIN_Z high and at least WALL_MARGIN from every wall (|x| ≤ SIDE_WALL_X − WALL_MARGIN, |y| ≤ GOAL_LINE_Y − WALL_MARGIN), including the 45° corners (|x| + |y| ≤ CORNER_MAX_XY_SUM).",
    constants: { AERIAL_MIN_Z, WALL_MARGIN, SIDE_WALL_X, GOAL_LINE_Y, CORNER_MAX_XY_SUM },
    checks: ["extras_in_range"],
    evidence: "Every AerialGoal's scoring touch was at Z 558–1066 and all but 5 other goals at ≤ 430; 334 of 768 touches at Z ≥ 550 were within 300 of a wall. Some real aerials off the backboard are missed.",
    version: 1,
    applied: "recorded",
    outputs: [p("aerial_touches")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "touch_thirds",
    area: "extras",
    rule: "Each counted touch with a ball position falls in a third of the pitch from the toucher's own goal, by the toucher's team at that hit (a hitter resolves only with a matching team; one that doesn't counts under touches_resolved): defence below −THIRD_Y, attack above THIRD_Y, midfield between (the cuts included). The thirds assume the standard pitch; on Hoops and Dropshot they are only approximate.",
    constants: { THIRD_Y, GOAL_LINE_Y },
    checks: ["touches_resolved"],
    evidence: "Over 27 real sessions your touches leaned defensive (36–51% vs teammates' ~35%), and your team vs the opponents moved by a few points, tracking bad sessions. Counted touches are 0.97× the game's (median of 1,294 player-matches). Every one of 57,800 BallHit hitters on 284 matches had a team.",
    version: 1,
    applied: "recorded",
    outputs: TOUCH_THIRDS,
    refs: [ADR_EXTRAS, PLAN_CONTRIBUTION],
  },
  {
    id: "woodwork",
    area: "extras",
    rule: "A CrossbarHit in live play counts one woodwork hit for its BallLastTouch player, at most once per window.",
    constants: { WOODWORK_WINDOW_MS },
    checks: ["touches_resolved"],
    evidence: "CrossbarHit fires for the posts too, and repeatedly while the ball rolls along the bar.",
    version: 1,
    applied: "recorded",
    outputs: [p("woodwork_hits")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "car_sampling",
    area: "extras",
    rule: "Car samples come from the in-play, non-replay UpdateStates of players with bHasCar, each weighted by the gap to the next state, capped; a player with no samples (the other team) has null car stats.",
    constants: { CAR_SAMPLE_CAP_MS },
    checks: ["extras_in_range", "thinned_snapshot_on_roster"],
    evidence: "Car state comes only for your own team; car time covers 0.98–0.997 of live play on the 46 captured matches.",
    version: 1,
    applied: "recorded",
    outputs: CAR_STATS,
    dense: true,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "car_stats",
    area: "extras",
    rule: "car_ms is the samples' total weight, boost_avg the weighted mean Boost (0–100), supersonic_ms and empty_boost_ms the weight with bSupersonic and with Boost 0.",
    checks: ["extras_in_range", "thinned_snapshot_on_roster"],
    evidence: "Stored as ms beside car_ms, so a share across matches is a ratio of sums.",
    version: 1,
    applied: "recorded",
    outputs: CAR_STATS,
    dense: true,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "car_share_aggregate",
    area: "extras",
    rule: "Across matches, average boost is weighted by car_ms, and the supersonic and empty-boost shares are summed ms over summed car_ms, over matches with car_ms; the extras count only matches that have them computed (woodwork_hits not null).",
    checks: [],
    evidence: "A plain mean of per-match boost would weigh a forfeit like a full match.",
    version: 1,
    applied: "read",
    refs: [PLAN_WP4B, PLAN_WP5AA],
  },
  // goals
  {
    id: "goal_origin",
    area: "goals",
    rule: "A goal's point is the scoring team's last hit since the kickoff, preferring the scorer among a 50/50's hitters; the ball's location there is its position.",
    checks: ["goals_per_team_equal_score"],
    evidence: "The game's own last touch disagrees with the hits on 50/50s; the scoring team's last hit placed all 214 goals on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [...GOAL_POINT, p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_distance",
    area: "goals",
    rule: "A goal's distance is from its point to the centre of the goal attacked; team 0 attacks +Y and team 1 −Y, the goal line at ±GOAL_LINE_Y.",
    constants: { GOAL_LINE_Y },
    checks: [],
    evidence: "Field orientation measured on the captures.",
    version: 1,
    applied: "recorded",
    outputs: [g("distance")],
    refs: [PLAN_WP4B],
  },
  {
    id: "deflected",
    area: "goals",
    rule: "A goal is deflected when the other team hit the ball after its origin hit; the other player in a 50/50 origin doesn't count.",
    checks: [],
    evidence: "38 of 214 captured goals.",
    version: 1,
    applied: "recorded",
    outputs: [g("deflected")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "own_goal",
    area: "goals",
    rule: "A goal is an own goal when the scoring team never hit the ball since a seen kickoff; it then has no point. Joined before the first kickoff, it isn't one.",
    checks: [],
    evidence: "0 of 214 captured goals.",
    version: 1,
    applied: "recorded",
    outputs: GOAL_POINT,
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "aerial_goal",
    area: "goals",
    rule: "A goal is aerial when its scorer has a pending AerialGoal statfeed from live play, which the goal consumes; pending ones clear at each kickoff.",
    checks: ["aerial_goals_match_statfeed"],
    evidence: "24 of 24 AerialGoal statfeeds marked on the captures; the statfeed comes just before its GoalScored.",
    version: 1,
    applied: "recorded",
    outputs: [g("aerial")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_speed",
    area: "goals",
    rule: "A goal's speed is the live GoalScored's GoalSpeed, in km/h.",
    checks: [],
    evidence: "The replay's copy has GoalSpeed 0 and is dropped by dedup.",
    version: 1,
    applied: "recorded",
    outputs: [g("speed_kmh")],
    refs: [PLAN_WP4B],
  },
  {
    id: "goal_clock",
    area: "goals",
    rule: "A goal's clock is the last ClockUpdatedSeconds reading with a numeric TimeSeconds before its live GoalScored, stored as read (time left in regulation, time played in overtime) with the reading's bOvertime. A goal with no reading has a null clock and is flagged, as is a reading whose bOvertime isn't a boolean (it's taken as a regulation reading).",
    checks: ["goals_clocked", "clock_overtime_flagged"],
    evidence: "In raw.db, all 2,005 live goals in 356 matches (1,988 of them in stored matches) have a reading before them, a median 0.5 s and p99 1.0 s earlier; the 7 gaps over 1.1 s (up to 8.1 s) are goals at 0:00 with the ball still in play. A state's own TimeSeconds is off by 1 s on 13 goals, so it isn't used. Every reading carried a boolean bOvertime, and all 57 overtime goals had it true.",
    version: 1,
    applied: "recorded",
    outputs: [g("clock_seconds"), g("clock_overtime")],
    refs: [ANALYTICS_MAP, PLAN_GOAL_CLOCK],
  },
  {
    id: "unresolved_scorer_dropped",
    area: "goals",
    rule: "A goal whose scorer isn't a roster player with a team gets no goal row; it is counted and flagged rather than given a team.",
    checks: ["goals_placed", "goals_per_team_equal_score"],
    evidence: "None seen in 214 captured goals; each way of inferring the team from other events broke on some event order, so a guess could credit the wrong team.",
    version: 1,
    applied: "recorded",
    outputs: [p("hardest_shot_kmh")],
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  {
    id: "goal_range",
    area: "goals",
    rule: "A goal is close under CLOSE_UNDER (a quarter of the pitch), long from LONG_FROM (half the pitch), else mid, from its stored distance.",
    constants: { CLOSE_UNDER, LONG_FROM },
    checks: [],
    evidence: "The game's LongGoal follows no simple distance rule, so the classes are ours.",
    version: 1,
    applied: "read",
    refs: [ADR_EXTRAS, PLAN_WP4B],
  },
  // queries
  {
    id: "session_cut",
    area: "queries",
    rule: "A match starts a new session when it begins more than SESSION_GAP_MS after the latest end so far, or after a manual break placed since the previous match began. Sessions are cut over every match, any playlist and spectated too; one with none of your matches under the filter isn't listed.",
    constants: { SESSION_GAP_MS },
    checks: [],
    evidence: "A session is time at the PC; a break during a match cuts before the next one.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "session_key",
    area: "queries",
    rule: "A session's key is its first match's GUID.",
    checks: [],
    evidence: "Stable across recomputes; a re-cut that moves the first match gives a new key and fresh remark picks (user's choice).",
    version: 1,
    applied: "read",
    refs: [PLAN_WP5AA],
  },
  {
    id: "local_day",
    area: "queries",
    rule: "A local day starts at DAY_CUTOFF_HOUR, so late-night play counts toward the day before; days are counted on calendar fields, so edges stay at the cutoff across DST.",
    constants: { DAY_CUTOFF_HOUR },
    checks: [],
    evidence: "The map's display rule: local time with a 4am cutoff, so a session past midnight stays on its evening's day.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "week_start",
    area: "queries",
    rule: "A week starts on WEEK_START_DAY (Date.getDay numbering) at the day cutoff; months and years start on the 1st at the cutoff.",
    constants: { WEEK_START_DAY },
    checks: [],
    evidence: "The map: weeks start Monday, calendar months. With the cutoff, Monday 03:30 is still the week before.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "season_range",
    area: "queries",
    rule: "A season runs from its start date's day start to the next season's, ordered by start date; the last one is open-ended.",
    checks: [],
    evidence: "Season dates come from the editable seasons table, so order is by date, not id.",
    version: 1,
    applied: "read",
    refs: [PLAN_WP5AA],
  },
  {
    id: "rolling_periods",
    area: "queries",
    rule: "The rolling periods are today and the days before it, ROLLING_SHORT_DAYS and ROLLING_LONG_DAYS local days in all, from the first day's start to now.",
    constants: { ROLLING_SHORT_DAYS, ROLLING_LONG_DAYS },
    checks: [],
    evidence: "Counted in local days, not 24 h steps, so a window across DST still starts at the cutoff.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "playlist_filters",
    area: "queries",
    rule: "Everything leaves out private (6, 26) and offline playlists; ranked is the ranked group without Official Tournament; casual is ids 1–4; extra modes include the LTMs; any single playlist can be picked.",
    checks: [],
    evidence: "Friends' lobbies and bot games would skew overall stats and the baseline, and extra modes per-game stats (map; user's choices); Official Tournament has its own rank.",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "baseline_30_day",
    area: "queries",
    rule: "A session's baseline is your matches under the same filters from the same local time BASELINE_DAYS days before the session's start, up to that start.",
    constants: { BASELINE_DAYS },
    checks: [],
    evidence: "The session isn't compared with itself, and an old session is compared with its own era (user's choice).",
    version: 1,
    applied: "read",
    refs: [MAP, PLAN_WP5AA],
  },
  {
    id: "streaks",
    area: "queries",
    rule: "Win and loss streaks run in start order; a match with no result neither extends nor breaks one.",
    checks: [],
    evidence: "A restart leaves the result unknown, which says nothing about the run.",
    version: 1,
    applied: "read",
    refs: [PLAN_WP5AA],
  },
  {
    id: "clutch_playlists",
    area: "queries",
    rule: "Clutch counts casual, ranked (ranked extras included) and tournament playlists, and of those every match with a team of yours and a win or loss, forfeits and matches you left included. Private, casual extras, LTMs, offline and unknown ids aren't counted, nor is a match with no result.",
    checks: [],
    evidence: "The user's choice (2026-11-23): only team modes where the most goals win. In the prototype's data, 59–19 of 340 counted matches were forfeits, shown on their own.",
    version: 1,
    applied: "read",
    refs: [ANALYTICS_MAP],
  },
  {
    id: "clutch_goal_order",
    area: "queries",
    rule: "A match's goal order is its goals by idx, each credited to its team, used only when the goals per team equal the final score (else the match is left out of goal-order stats and kept in the final-score ones). A comeback is a win after being SWING_MIN_GOALS or more goals down at some point; a blown lead is a loss after being that many up. The ladder buckets each match by its biggest deficit and lead (1, 2, 3+). A match whose result contradicts its final score (a win while behind, as when the other side quits while ahead; a loss while ahead) is left out of comebacks, blown leads and the ladder.",
    constants: { SWING_MIN_GOALS },
    checks: ["goals_per_team_equal_score", "player_goals_equal_score"],
    evidence: "The user's choice (2026-11-23): at any deficit about 3 in 4 comebacks were from one goal down, which happens in almost every match. A joined match (no checks, flagged joined) and a mis-credited own goal fail the per-team comparison. In the 2026-11-23 data, 2 forfeit wins finished behind (one at 0–7) and would have read as comebacks (user's choice to leave them out).",
    version: 1,
    applied: "read",
    refs: [ANALYTICS_MAP],
  },
  {
    id: "clutch_one_goal",
    area: "queries",
    rule: "A 1-goal game is one whose final score differs by one, overtime included; the overtime record is the matches that went to overtime.",
    checks: [],
    evidence: "The user's choice (2026-11-24): the tile shows the win %, like the other share tiles, with the total record and the record without overtime in its note (on 2026-11-23 the total record was the value).",
    version: 1,
    applied: "read",
    refs: [ANALYTICS_MAP],
  },
  {
    id: "tilt_session_order",
    area: "queries",
    rule: "A match's session game number and the run before it count every match you played in its session under \"everything\" (private and offline left out), whatever the page's period or filters. Game numbers bucket 1–3, 4–6, 7–9, 10+; the run before a match buckets as after a win, 1 loss, 2 losses or 3+ losses (none for the session's first decided match). A match with no result keeps its game number but neither extends nor breaks the run. Only casual, ranked and tournament matches with a result that started in the period and pass the filters land in buckets. Sessions ended on a loss: by each session's last decided match, over the whole session, the current session left out.",
    checks: [],
    evidence: "The Tilt prototype (2026-11-24, three rounds on real data): a session is time at the PC, so a ranked match after four casual ones is game 5. Private and offline left out as the prototype did (user's choice, 2026-11-24).",
    version: 1,
    applied: "read",
    refs: [ANALYTICS_MAP],
  },
  {
    id: "tilt_verdict",
    area: "queries",
    rule: "Each bucket's win rate is compared with the rest of its chart (game buckets with every counted match, run buckets with those that have a decided match before them), z on the pooled rate. The verdict looks at 7–9, 10+, 2 losses and 3+ losses: too few to tell under FIRM_N counted matches or with any of them under MIN_N; else a drop where the worst is TILT_Z or more standard errors below; else no clear sign once all four have FIRM_N; else no sign so far. Bars are coloured only past TILT_Z and never under MIN_N, and striped under FIRM_N.",
    constants: { TILT_Z, FIRM_N, MIN_N },
    checks: [],
    evidence: "The Tilt prototype (2026-11-24): with four buckets checked per view, 2 standard errors would false-alarm in ~1 view in 11 with no real tilt, 2.5 in ~1 in 40; at 30 matches a bucket could show only a ~24-point drop, at 60 ~18. FIRM_N also gates \"too few\" overall (user's choice, 2026-11-24). Real data: no drop in any view.",
    version: 1,
    applied: "read",
    refs: [ANALYTICS_MAP],
  },
];

/** The dense rules' ids: a thinned match keeps their versions from when it was thinned. */
export const DENSE_RULE_IDS: readonly string[] = RULES.filter((r) => r.dense).map((r) => r.id);

/** The match_players columns a thinned match's snapshot holds: the dense rules' player outputs. */
export const DENSE_PLAYER_COLUMNS: readonly string[] = [
  ...new Set(RULES.filter((r) => r.dense).flatMap((r) => (r.outputs ?? []).filter((o) => o.startsWith(p(""))).map((o) => o.slice(p("").length)))),
];

/**
 * Not dense, but they feed the snapshotted outputs as well as columns that recompute; player_key
 * shapes the snapshot's keys. A thinned match records their current versions.
 */
export const MIXED_WITH_DENSE: readonly string[] = ["live_play_window", "target_resolution", "player_key"];

/** The versions stored with each match's record: the rules recompute can change. */
export const RECORDED_RULE_VERSIONS: Readonly<Record<string, number>> = Object.fromEntries(
  RULES.filter((r) => r.applied === "recorded").map((r) => [r.id, r.version]),
);

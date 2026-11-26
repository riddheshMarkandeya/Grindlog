import { z } from 'zod';

export const RatingFactorCategorySchema = z.enum([
  'attack',
  'defense',
  'goalkeeping',
  'possession',
  'turnover_recovery',
  'discipline',
  'clutch',
]);
export type RatingFactorCategory = z.infer<typeof RatingFactorCategorySchema>;

export const RatingFactorSchema = z.object({
  name: z.string(),
  delta: z.number(),
  category: RatingFactorCategorySchema.optional(),
  clutchMultiplier: z.number().optional(),
});
export type RatingFactor = z.infer<typeof RatingFactorSchema>;

export const PossessionStateSchema = z.enum(['controlled', 'contested', 'loose']);
export type PossessionState = z.infer<typeof PossessionStateSchema>;

export const DebouncedHitSchema = z.object({
  player_name: z.string(),
  team_num: z.number(),
  start_ts: z.number(),
  end_ts: z.number(),
  touch_count: z.number(),
  pre_speed: z.number(),
  post_speed: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type DebouncedHit = z.infer<typeof DebouncedHitSchema>;

export const PlayerRatingResultSchema = z.object({
  score: z.number().min(0.0).max(10.0),
  factors: z.array(RatingFactorSchema),
});
export type PlayerRatingResult = z.infer<typeof PlayerRatingResultSchema>;

export const ShotOutcomeSchema = z.enum(['goal', 'saved', 'woodwork', 'miss']);
export type ShotOutcome = z.infer<typeof ShotOutcomeSchema>;

export const PlayTrailPointSchema = z.object({
  player_name: z.string(),
  team_num: z.number(),
  x: z.number(),
  y: z.number(),
  ts_offset_sec: z.number(),
});
export type PlayTrailPoint = z.infer<typeof PlayTrailPointSchema>;

export const ShotMapItemSchema = z.object({
  id: z.string(),
  shot_ts: z.number(),
  time_seconds: z.number(),
  player_name: z.string(),
  player_key: z.string(),
  team_num: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  distance: z.number(),
  speed_kmh: z.number(),
  xg: z.number(),
  is_big_chance: z.boolean(),
  outcome: ShotOutcomeSchema,
  trail: z.array(PlayTrailPointSchema).optional(),
});
export type ShotMapItem = z.infer<typeof ShotMapItemSchema>;

export const MomentumEventSchema = z.object({
  type: z.enum(['goal', 'demo', 'woodwork', 'save']),
  team: z.number(),
  text: z.string(),
  ts: z.number(),
});
export type MomentumEvent = z.infer<typeof MomentumEventSchema>;

export const MomentumPointSchema = z.object({
  interval_idx: z.number(),
  time_seconds: z.number(),
  momentum: z.number().min(-100).max(100),
  ball_y: z.number(),
  touch_ratio: z.number(),
  events: z.array(MomentumEventSchema),
});
export type MomentumPoint = z.infer<typeof MomentumPointSchema>;

export const TacticalArchetypeSchema = z.enum([
  'The Striker',
  'The Playmaker',
  'The Anchor',
  'The Disruptor',
  'The Speed Demon',
  'The Boost Hawk',
  'The Air Marshal',
  'The All-Rounder',
  'The Passenger',
]);
export type TacticalArchetype = z.infer<typeof TacticalArchetypeSchema>;

export const DoubleCommitEventSchema = z.object({
  time_seconds: z.number(),
  player1_name: z.string(),
  player2_name: z.string(),
  team_num: z.number(),
  is_fatal: z.boolean(),
  instigator_name: z.string().optional(),
  carrier_name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  carrier_x: z.number().optional(),
  carrier_y: z.number().optional(),
  intruder_x: z.number().optional(),
  intruder_y: z.number().optional(),
  net_status: z.enum(['covered', 'open_net', 'rusher_open_net', 'unknown']).optional(),
  third_man_covering: z.string().nullable().optional(),
  rushed_from_net: z.boolean().optional(),
  ball_zone: z.enum(['attack_box', 'midfield', 'defense']).optional(),
  penalty_delta: z.number().optional(),
  context_reason: z.string().optional(),
  trail: z.array(PlayTrailPointSchema).optional(),
});
export type DoubleCommitEvent = z.infer<typeof DoubleCommitEventSchema>;

export const CoachPointSchema = z.object({
  title: z.string(),
  description: z.string(),
  tag: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
});
export type CoachPoint = z.infer<typeof CoachPointSchema>;

export const PlayerCoachReportSchema = z.object({
  player_name: z.string(),
  is_user: z.boolean(),
  rating: z.number(),
  verdict: z.string(),
  verdict_summary: z.string(),
  strengths: z.array(CoachPointSchema),
  improvements: z.array(CoachPointSchema),
});
export type PlayerCoachReport = z.infer<typeof PlayerCoachReportSchema>;

export const TouchDistributionSchema = z.object({
  defence_pct: z.number(),
  midfield_pct: z.number(),
  attack_pct: z.number(),
});
export type TouchDistribution = z.infer<typeof TouchDistributionSchema>;

export const RadarProfileSchema = z.object({
  finishing: z.number().min(0).max(100),
  creation: z.number().min(0).max(100),
  defense: z.number().min(0).max(100),
  motor: z.number().min(0).max(100),
  physicality: z.number().min(0).max(100),
  boost_iq: z.number().min(0).max(100),
  aerial: z.number().min(0).max(100).optional(),
  positioning: z.number().min(0).max(100).optional(),
  archetype: TacticalArchetypeSchema,
});
export type RadarProfile = z.infer<typeof RadarProfileSchema>;

export const MatchPlayerAnalysisSchema = z.object({
  player_key: z.string(),
  primary_id: z.string(),
  name: z.string(),
  team_num: z.number(),
  is_bot: z.boolean(),
  is_user: z.boolean(),
  score: z.number(),
  goals: z.number(),
  shots: z.number(),
  assists: z.number(),
  saves: z.number(),
  touches: z.number(),
  demos: z.number(),
  rating: z.number(),
  rating_factors: z.array(RatingFactorSchema),
  xg: z.number(),
  xg_diff: z.number(),
  big_chances: z.number(),
  big_chances_missed: z.number(),
  big_chances_created: z.number(),
  key_passes: z.number(),
  hardest_shot_kmh: z.number().nullable(),
  boost_avg: z.number().nullable(),
  supersonic_pct: z.number(),
  empty_boost_pct: z.number(),
  empty_boost_seconds: z.number(),
  supersonic_seconds: z.number(),
  touches_defence: z.number(),
  touches_midfield: z.number(),
  touches_attack: z.number(),
  touch_distribution: TouchDistributionSchema,
  aerial_touches: z.number(),
  woodwork_hits: z.number(),
  clearances: z.number(),
  shot_conversion_pct: z.number(),
  double_commits: z.number().default(0),
  fatal_double_commits: z.number().default(0),
  turnover_concessions: z.number().default(0),
  errors_leading_to_goal: z.number().default(0),
  small_pads: z.number().default(0),
  big_orbs: z.number().default(0),
  boost_steals: z.number().default(0),
  pad_ratio_pct: z.number().default(0),
  tactical_metrics: z.object({
    duels_won: z.number().default(0),
    favorable_passes: z.number().default(0),
    infield_crosses: z.number().default(0),
    hockey_assists: z.number().default(0),
    hospital_passes: z.number().default(0),
    corner_roll_giveaways: z.number().default(0),
    screamers: z.number().default(0),
    solo_goals: z.number().default(0),
    counter_goals: z.number().default(0),
    reflex_saves: z.number().default(0),
    rebound_instant_clears: z.number().default(0),
    spilled_rebounds: z.number().default(0),
    shadow_defenses: z.number().default(0),
    back_post_rotations: z.number().default(0),
    backboard_clears: z.number().default(0),
    goal_line_scrambles: z.number().default(0),
    counter_press_recoveries: z.number().default(0),
    tactical_demos: z.number().default(0),
    boost_abandonments: z.number().default(0),
    corner_boost_desertions: z.number().default(0),
    near_post_traps: z.number().default(0),
    reckless_dives: z.number().default(0),
    kickoff_cheat_ups: z.number().default(0),
    double_corner_desertions: z.number().default(0),
    aerial_goals: z.number().default(0),
    flip_resets: z.number().default(0),
    covered_double_commits: z.number().default(0),
    net_rush_double_commits: z.number().default(0),
    third_man_covers: z.number().default(0),
  }).optional(),
  radar: RadarProfileSchema,
});
export type MatchPlayerAnalysis = z.infer<typeof MatchPlayerAnalysisSchema>;

export const MatchAnalysisResultSchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  ended_at: z.number(),
  playlist_id: z.number().nullable(),
  arena: z.string().nullable(),
  overtime: z.boolean(),
  score_team0: z.number(),
  score_team1: z.number(),
  winner_team_num: z.number().nullable(),
  user_team_num: z.number().nullable(),
  mvp_key: z.string().nullable(),
  team0_rating: z.number(),
  team1_rating: z.number(),
  team0_xg: z.number(),
  team1_xg: z.number(),
  players: z.array(MatchPlayerAnalysisSchema),
  shots: z.array(ShotMapItemSchema),
  momentum: z.array(MomentumPointSchema),
  double_commits: z.array(DoubleCommitEventSchema).default([]),
  user_coach_report: PlayerCoachReportSchema.nullable(),
  awards: z.object({
    player_of_the_match: z.string().nullable(),
    the_sniper: z.string().nullable(),
    the_iron_wall: z.string().nullable(),
    crossbar_magnet: z.string().nullable(),
    the_enforcer: z.string().nullable().optional(),
    speed_demon: z.string().nullable().optional(),
    the_playmaker: z.string().nullable().optional(),
    the_boost_goblin: z.string().nullable().optional(),
    air_marshal: z.string().nullable().optional(),
    double_trouble: z.string().nullable().optional(),
  }),
  computed_at: z.number(),
  engine_version: z.number().optional(),
});
export type MatchAnalysisResult = z.infer<typeof MatchAnalysisResultSchema>;

export const SessionMatchSummarySchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  score_team0: z.number(),
  score_team1: z.number(),
  winner_team_num: z.number().nullable(),
  user_team_num: z.number().nullable().optional(),
  is_win: z.boolean(),
  user_rating: z.number(),
  playlist_id: z.number().nullable(),
});
export type SessionMatchSummary = z.infer<typeof SessionMatchSummarySchema>;

export const PodiumPlayerSchema = z.object({
  player_key: z.string(),
  primary_id: z.string().optional(),
  name: z.string(),
  matches_played: z.number(),
  win_rate: z.number(),
  avg_rating: z.number(),
  total_goals: z.number(),
  total_assists: z.number().default(0),
  total_saves: z.number().default(0),
  total_double_commits: z.number().default(0),
  total_xg: z.number(),
  avg_boost: z.number(),
});
export type PodiumPlayer = z.infer<typeof PodiumPlayerSchema>;

export const SessionRecapSchema = z.object({
  session_key: z.string(),
  total_matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  total_goals_for: z.number().default(0),
  total_goals_against: z.number().default(0),
  total_double_commits: z.number().default(0),
  podium: z.array(PodiumPlayerSchema),
  matches: z.array(SessionMatchSummarySchema),
});
export type SessionRecap = z.infer<typeof SessionRecapSchema>;

export const PlayerFormMatchSchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  is_win: z.boolean(),
  rating: z.number(),
  goals: z.number(),
  assists: z.number(),
  saves: z.number(),
  score_team0: z.number(),
  score_team1: z.number(),
  user_team_num: z.number(),
  playlist_id: z.number().nullable(),
  arena: z.string().nullable(),
});
export type PlayerFormMatch = z.infer<typeof PlayerFormMatchSchema>;

export const PlaylistStatsSchema = z.object({
  playlist_id: z.number(),
  playlist_name: z.string(),
  matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  avg_rating: z.number(),
  goals_per_game: z.number(),
});
export type PlaylistStats = z.infer<typeof PlaylistStatsSchema>;

export const PlayerProfileSchema = z.object({
  player_key: z.string(),
  primary_id: z.string(),
  name: z.string(),
  is_user: z.boolean(),
  total_matches: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  total_playtime_minutes: z.number(),
  overtime_matches: z.number(),
  career_rating: z.number(),
  highest_rating: z.number(),
  lowest_rating: z.number(),
  radar: RadarProfileSchema,
  attributes: z.object({
    total_goals: z.number(),
    goals_per_game: z.number(),
    total_shots: z.number(),
    shots_per_game: z.number(),
    shot_conversion_pct: z.number(),
    hardest_shot_kmh: z.number(),
    total_woodwork_hits: z.number(),
    total_assists: z.number(),
    assists_per_game: z.number(),
    total_saves: z.number(),
    saves_per_game: z.number(),
    total_demos: z.number(),
    demos_per_game: z.number(),
    total_aerial_touches: z.number(),
    aerials_per_game: z.number(),
    avg_boost: z.number(),
    supersonic_pct: z.number(),
    empty_boost_pct: z.number(),
    touch_distribution: TouchDistributionSchema,
  }),
  playlists: z.array(PlaylistStatsSchema),
  recent_matches: z.array(PlayerFormMatchSchema),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const SquadFriendStatsSchema = z.object({
  name: z.string(),
  primary_id: z.string(),
  is_pinned_friend: z.boolean(),
  matches_together: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  teammate_goals: z.number(),
  teammate_assists: z.number(),
  user_goals: z.number(),
  user_assists: z.number(),
  double_commits: z.number(),
  double_commits_per_game: z.number(),
  chemistry_score: z.number(),
  chemistry_verdict: z.string(),
  last_played: z.number().nullable(),
});
export type SquadFriendStats = z.infer<typeof SquadFriendStatsSchema>;

export const DuoDossierMatchSchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  arena: z.string().nullable(),
  score_user: z.number(),
  score_opp: z.number(),
  is_win: z.boolean(),
  user_goals: z.number(),
  friend_goals: z.number(),
  user_rating: z.number(),
  friend_rating: z.number(),
  double_commits: z.number(),
  errors_leading_to_goal: z.number().optional().default(0),
  mode: z.string().optional(),
  team_size: z.number().optional(),
  playlist_id: z.number().nullable().optional(),
});
export type DuoDossierMatch = z.infer<typeof DuoDossierMatchSchema>;

export const DuoFriendDossierSchema = z.object({
  name: z.string(),
  primary_id: z.string(),
  is_pinned_friend: z.boolean(),
  matches_together: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  matches_2s: z.number().optional(),
  wins_2s: z.number().optional(),
  matches_3s: z.number().optional(),
  wins_3s: z.number().optional(),
  user_goals: z.number(),
  friend_goals: z.number(),
  user_assists_to_friend: z.number(),
  friend_assists_to_user: z.number(),
  goal_differential: z.number(),
  double_commits: z.number(),
  fatal_double_commits: z.number(),
  double_commits_per_game: z.number(),
  user_encroachments: z.number().optional().default(0),
  friend_encroachments: z.number().optional().default(0),
  passing_connection_rate: z.number().optional().default(0),
  third_man_coverage_pct: z.number().optional().default(0),
  rotational_risk: z.enum(['Low', 'Moderate', 'High', 'Critical']),
  chemistry_score: z.number(),
  chemistry_verdict: z.string(),
  synergy_insights: z.array(z.string()),
  user_radar: RadarProfileSchema,
  friend_radar: RadarProfileSchema,
  matches: z.array(DuoDossierMatchSchema),
});
export type DuoFriendDossier = z.infer<typeof DuoFriendDossierSchema>;

export const TrioPlayerSummarySchema = z.object({
  name: z.string(),
  primary_id: z.string(),
  is_user: z.boolean(),
  avg_rating: z.number(),
  total_goals: z.number(),
  goals_per_game: z.number(),
  total_assists: z.number(),
  assists_per_game: z.number(),
  total_saves: z.number(),
  saves_per_game: z.number(),
  total_shots: z.number(),
  shot_conversion_pct: z.number(),
  total_demos: z.number(),
  demos_per_game: z.number(),
  avg_score: z.number(),
  mvp_count: z.number(),
  radar: RadarProfileSchema,
});
export type TrioPlayerSummary = z.infer<typeof TrioPlayerSummarySchema>;

export const TrioMatchPlayerStatSchema = z.object({
  name: z.string(),
  rating: z.number(),
  goals: z.number(),
  assists: z.number(),
  saves: z.number(),
  shots: z.number(),
  demos: z.number(),
  score: z.number(),
});
export type TrioMatchPlayerStat = z.infer<typeof TrioMatchPlayerStatSchema>;

export const TrioMatchRecordSchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  arena: z.string().nullable(),
  score_team: z.number(),
  score_opp: z.number(),
  is_win: z.boolean(),
  best_player: z.string(),
  players: z.array(TrioMatchPlayerStatSchema),
  double_commits: z.number(),
  errors_leading_to_goal: z.number().optional().default(0),
});
export type TrioMatchRecord = z.infer<typeof TrioMatchRecordSchema>;

export const TrioAssistConnectionSchema = z.object({
  passer: z.string(),
  scorer: z.string(),
  assists: z.number(),
});
export type TrioAssistConnection = z.infer<typeof TrioAssistConnectionSchema>;

export const TrioDoubleCommitPairSchema = z.object({
  pair: z.string(),
  count: z.number(),
  p1_name: z.string().optional(),
  p2_name: z.string().optional(),
  p1_encroached: z.number().optional().default(0),
  p2_encroached: z.number().optional().default(0),
});
export type TrioDoubleCommitPair = z.infer<typeof TrioDoubleCommitPairSchema>;

export const TrioPassingMatrixEntrySchema = z.object({
  passer: z.string(),
  receiver: z.string(),
  passes: z.number(),
  goals: z.number(),
  conversion_pct: z.number(),
});
export type TrioPassingMatrixEntry = z.infer<typeof TrioPassingMatrixEntrySchema>;

export const TrioSquadDossierSchema = z.object({
  squad_name: z.string(),
  matches_together: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate: z.number(),
  goal_differential: z.number(),
  total_goals_scored: z.number(),
  total_goals_conceded: z.number(),
  total_double_commits: z.number(),
  double_commits_per_game: z.number(),
  third_man_coverage_pct: z.number().optional().default(0),
  players: z.array(TrioPlayerSummarySchema),
  passing_network: z.array(TrioAssistConnectionSchema),
  passing_matrix: z.array(TrioPassingMatrixEntrySchema).optional().default([]),
  intra_double_commits: z.array(TrioDoubleCommitPairSchema),
  synergy_verdict: z.string(),
  tactical_insights: z.array(z.string()),
  matches: z.array(TrioMatchRecordSchema),
});
export type TrioSquadDossier = z.infer<typeof TrioSquadDossierSchema>;

export const SquadExplorerMatchSchema = z.object({
  guid: z.string(),
  started_at: z.number(),
  arena: z.string().nullable(),
  score_team: z.number(),
  score_opp: z.number(),
  is_win: z.boolean(),
  friends_on_team: z.array(z.string()),
  all_teammates: z.array(z.string()),
  best_player: z.string(),
  players: z.array(TrioMatchPlayerStatSchema),
  double_commits: z.number(),
  errors_leading_to_goal: z.number().optional().default(0),
  mode: z.enum(['2v2 Doubles', '3v3 Standard', 'Other']),
  team_size: z.number(),
  playlist_id: z.number().nullable().optional(),
});
export type SquadExplorerMatch = z.infer<typeof SquadExplorerMatchSchema>;

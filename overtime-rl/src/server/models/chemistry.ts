import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type {
  CarBodyType,
  MatchAnalysisResult,
  PairChemistryModeSplit,
  PairChemistryOverview,
  PairChemistryPillarScores,
  PairChemistryPlayerRef,
  PairChemistryRecord,
  RadarProfile,
  TacticalArchetype,
} from '../../shared/types.ts';
import type { GrindlogReader, TrackerMatchPlayer } from '../ingestion/grindlog-reader.ts';
import type { OvertimeDBCache } from '../db/cache.ts';
import { MatchAnalyzer } from './analyzer.ts';
import { aggregateRadarFromAnalyses } from './radar-aggregator.ts';
import { calculatePlayerRadar } from './radar.ts';
import { calculateMatchRatingFromPlayerRow } from './profile.ts';
import { buildPlayerFifaCard } from './fifa-card.ts';
import { calculateTacticalOvr } from '../../shared/ovr.ts';

export interface PairModeBucketInput {
  mode: 'all' | '2v2' | '3v3';
  matches: number;
  wins: number;
  goalDiff: number;
  mutualDoubleCommits: number;
  assistsAtoB: number;
  assistsBtoA: number;
}

export interface PairChemistryInput {
  playerA: PairChemistryPlayerRef;
  playerB: PairChemistryPlayerRef;
  radarA: RadarProfile;
  radarB: RadarProfile;
  matchesTogether: number;
  wins: number;
  goalDiff: number;
  assistsAtoB: number;
  assistsBtoA: number;
  mutualDoubleCommits: number;
  thirdManCovers: number;
  soloWinRateA: number;
  soloWinRateB: number;
  avgRatingTogether: number;
  soloRatingBaseline: number;
  avgBoostA: number;
  avgBoostB: number;
  supersonicShareA: number;
  supersonicShareB: number;
  emptyBoostShareA: number;
  emptyBoostShareB: number;
  modeBuckets?: PairModeBucketInput[];
}

interface CandidatePlayerProfile {
  primary_id: string;
  aliases: string[];
  raw_name: string;
  ref: PairChemistryPlayerRef;
  radar: RadarProfile;
  soloWinRate: number;
  soloAvgRating: number;
}

interface MutualMatchJoinedRow {
  guid: string;
  started_at: number;
  team_size: number;
  winner_team_num: number | null;
  score_team0: number;
  score_team1: number;
  a_pid: string;
  a_name: string;
  a_key: string;
  a_team: number;
  a_goals: number;
  a_assists: number;
  a_saves: number;
  a_shots: number;
  a_demos: number;
  a_car_ms: number | null;
  a_super_ms: number | null;
  a_empty_ms: number | null;
  a_boost: number | null;
  b_pid: string;
  b_name: string;
  b_key: string;
  b_team: number;
  b_goals: number;
  b_assists: number;
  b_saves: number;
  b_shots: number;
  b_demos: number;
  b_car_ms: number | null;
  b_super_ms: number | null;
  b_empty_ms: number | null;
  b_boost: number | null;
}

const CORE_SQUAD_DISPLAY: Array<{ pid: string; rawName: string; displayName: string; defaultCar: CarBodyType }> = [
  { pid: 'Epic|f5c0f37f0a5649e4bff607332fcf8ac0|0', rawName: 'Swapo_o', displayName: 'Swap', defaultCar: 'octane_zsr' },
  { pid: 'Epic|6cfc32973fa343fc9f07ec20c3a9e0b1|0', rawName: 'Mechless Madness', displayName: 'Mechless', defaultCar: 'fennec' },
  { pid: 'Epic|7d1894456e94432a929fb2982478eb1d|0', rawName: 'Rocinante_.', displayName: 'Rocinante', defaultCar: 'octane' },
];

const ARCHETYPE_BADGE_MAP: Record<TacticalArchetype, string> = {
  'The Striker': 'ST',
  'The Air Marshal': 'AF',
  'The Dribbler': 'CAM',
  'The Playmaker': 'CM',
  'The Anchor': 'CDM',
  'The Disruptor': 'CDM',
  'The Speed Demon': 'RW',
  'The Boost Hawk': 'LM',
  'The All-Rounder': 'CM',
  'The Passenger': 'SUB',
};

function clampScore(value: number, min = 20, max = 99): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreToDiamondsAndTier(score: number): { diamonds: number; tierLabel: string } {
  if (score >= 76) return { diamonds: 3, tierLabel: 'Telepathic Link' };
  if (score >= 64) return { diamonds: 2, tierLabel: 'Strong Link' };
  if (score >= 52) return { diamonds: 1, tierLabel: 'Functional Link' };
  return { diamonds: 0, tierLabel: 'Tactical Friction' };
}

function computeRoleFit(radarA: RadarProfile, radarB: RadarProfile): { score: number; label: string } {
  const offA = radarA.finishing * 0.45 + (radarA.aerial ?? 65) * 0.3 + radarA.dribbling * 0.25;
  const defA = radarA.goalkeeping * 0.35 + (radarA.positioning ?? 68) * 0.3 + radarA.creation * 0.2 + radarA.tackling * 0.15;
  const offB = radarB.finishing * 0.45 + (radarB.aerial ?? 65) * 0.3 + radarB.dribbling * 0.25;
  const defB = radarB.goalkeeping * 0.35 + (radarB.positioning ?? 68) * 0.3 + radarB.creation * 0.2 + radarB.tackling * 0.15;

  const leanA = offA - defA;
  const leanB = offB - defB;
  const spread = Math.abs(leanA - leanB);

  const dualAggressors =
    offA >= 74 &&
    offB >= 74 &&
    (radarA.positioning ?? 68) < 69 &&
    (radarB.positioning ?? 68) < 69;
  const dualPassiveAnchors =
    defA >= 74 && defB >= 74 && radarA.finishing < 64 && radarB.finishing < 64;

  let score = 62 + Math.min(26, spread * 1.15);
  if (dualAggressors) {
    score -= 14;
  } else if (dualPassiveAnchors) {
    score -= 10;
  } else if (leanA * leanB < 0) {
    score += 8;
  }

  const shortA = radarA.archetype.replace(/^The /, '');
  const shortB = radarB.archetype.replace(/^The /, '');
  let label = `${shortA} × ${shortB}`;
  if (dualAggressors) label = 'Dual Aggressors';
  else if (dualPassiveAnchors) label = 'Dual Anchors';

  return { score: clampScore(score), label };
}

function computePillarsFromMetrics(input: {
  matchesTogether: number;
  wins: number;
  goalDiff: number;
  assistsAtoB: number;
  assistsBtoA: number;
  mutualDoubleCommits: number;
  thirdManCovers: number;
  radarA: RadarProfile;
  radarB: RadarProfile;
  soloWinRateA: number;
  soloWinRateB: number;
  avgRatingTogether: number;
  soloRatingBaseline: number;
  avgBoostA: number;
  avgBoostB: number;
  supersonicShareA: number;
  supersonicShareB: number;
  emptyBoostShareA: number;
  emptyBoostShareB: number;
}): {
  pillars: PairChemistryPillarScores;
  score: number;
  roleLabel: string;
  winRateLift: number;
  confidencePct: number;
} {
  const m = Math.max(1, input.matchesTogether);
  const linksPerGame = (input.assistsAtoB + input.assistsBtoA) / m;
  const maxOneWay = Math.max(1, Math.max(input.assistsAtoB, input.assistsBtoA));
  const minOneWay = Math.min(input.assistsAtoB, input.assistsBtoA);
  const reciprocity = minOneWay > 0 ? (minOneWay / maxOneWay) * 9 : 0;
  const avgCreation = (input.radarA.creation + input.radarB.creation) / 2;
  const passingSynergy = clampScore(26 + linksPerGame * 62 + avgCreation * 0.25 + reciprocity);

  const dcPerGame = input.mutualDoubleCommits / m;
  const coverPerGame = input.thirdManCovers / m;
  const avgDis = ((input.radarA.positioning ?? 68) + (input.radarB.positioning ?? 68)) / 2;
  const spacingDiscipline = clampScore(
    (95 - dcPerGame * 72) * 0.68 + avgDis * 0.24 + Math.min(12, coverPerGame * 24)
  );

  const roleFit = computeRoleFit(input.radarA, input.radarB);

  const supDiff = Math.abs(input.supersonicShareA - input.supersonicShareB);
  const avgBoost = (input.avgBoostA + input.avgBoostB) / 2;
  const emptyPenalty = (input.emptyBoostShareA + input.emptyBoostShareB) * 55;
  const tempoSync = clampScore(
    62 + Math.max(0, 1 - supDiff * 2.8) * 18 + Math.min(16, Math.max(0, (avgBoost - 40) * 0.55)) - emptyPenalty
  );

  const winRateTogether = (input.wins / m) * 100;
  const expectedWinRate = (input.soloWinRateA + input.soloWinRateB) / 2;
  const winRateLift = round1(winRateTogether - expectedWinRate);
  const gdPerGame = input.goalDiff / m;
  const ratingLift = input.avgRatingTogether - input.soloRatingBaseline;
  const rawImpact = 48 + (winRateTogether - 50) * 0.8 + winRateLift * 0.85 + gdPerGame * 8 + ratingLift * 10;
  const impactBayes = m / (m + 12);
  const impactLift = clampScore(impactBayes * rawImpact + (1 - impactBayes) * 58);

  const rawComposite =
    0.25 * passingSynergy +
    0.25 * spacingDiscipline +
    0.2 * roleFit.score +
    0.15 * tempoSync +
    0.15 * impactLift;

  const sampleStab = m >= 12 ? 1 : m / (m + 6);
  const finalScore = clampScore(sampleStab * rawComposite + (1 - sampleStab) * 58);

  return {
    pillars: {
      passing_synergy: passingSynergy,
      spacing_discipline: spacingDiscipline,
      role_complementarity: roleFit.score,
      tempo_sync: tempoSync,
      impact_lift: impactLift,
    },
    score: finalScore,
    roleLabel: roleFit.label,
    winRateLift,
    confidencePct: Math.round((m / (m + 12)) * 100),
  };
}

function buildPairNarrative(
  input: PairChemistryInput,
  pillars: PairChemistryPillarScores,
  roleLabel: string,
  winRateLift: number
): { strengths: string[]; frictions: string[]; coachingTip: string } {
  const m = Math.max(1, input.matchesTogether);
  const dcPerGame = round2(input.mutualDoubleCommits / m);
  const totalLinks = input.assistsAtoB + input.assistsBtoA;
  const nameA = input.playerA.display_name;
  const nameB = input.playerB.display_name;

  const strengths: string[] = [];
  const frictions: string[] = [];

  if (dcPerGame <= 0.22) {
    strengths.push(`Clean pitch spacing (${dcPerGame} double-commits/gm across ${m} games).`);
  } else if (dcPerGame >= 0.34) {
    frictions.push(`Frequent challenge overlaps (${dcPerGame} double-commits/gm, ${input.mutualDoubleCommits} total).`);
  }

  if (totalLinks / m >= 0.35) {
    strengths.push(
      `Direct goal link rate (${totalLinks} assists paired: ${nameA} -> ${nameB} ${input.assistsAtoB}, ${nameB} -> ${nameA} ${input.assistsBtoA}).`
    );
  } else {
    frictions.push(`Low assist conversion (${totalLinks} direct goal links in ${m} matches — look earlier infield).`);
  }

  if (pillars.role_complementarity >= 78) {
    strengths.push(`Complementary profile (${roleLabel}) balances 1st-man pressure with back-post safety.`);
  } else if (roleLabel === 'Dual Aggressors') {
    frictions.push(`Two forward-leaning attackers share overlapping challenge zones without a natural 3rd-man buffer.`);
  } else if (roleLabel === 'Dual Anchors') {
    frictions.push(`Defensive overlap leaves midfield counters short on first-touch finishing pressure.`);
  }

  if (winRateLift >= 4) {
    strengths.push(`Outperforms solo baselines by +${winRateLift.toFixed(1)}% win rate when queuing together.`);
  } else if (winRateLift <= -6 && m >= 5) {
    frictions.push(`Shared win rate trails solo averages (${winRateLift.toFixed(1)}%), indicating adjustment friction.`);
  }

  if (strengths.length === 0) {
    strengths.push(`Stable rotation baseline across ${m} mutual matches (${pillars.tempo_sync} tempo sync).`);
  }
  if (frictions.length === 0) {
    frictions.push(`Keep third-man boost discipline tight on deep clears to elevate passing chains.`);
  }

  let coachingTip = `Maintain structured stagger between ${nameA} and ${nameB} during midfield transitions.`;
  if (pillars.spacing_discipline <= pillars.passing_synergy && dcPerGame >= 0.3) {
    coachingTip = `${nameA} & ${nameB}: designate clear 1st-man challenger on corner challenges; trailer delays to mid-post instead of diving same corner (${dcPerGame} DC/gm).`;
  } else if (pillars.passing_synergy < 65) {
    coachingTip = `Convert more solo air/wall clears into early infield lays between ${nameA} and ${nameB} to unlock 3-diamond link bonus.`;
  } else if (pillars.spacing_discipline >= 80 && pillars.passing_synergy >= 70) {
    coachingTip = `Elite natural pairing — keep ${nameA} pressing high while ${nameB} sweeps second balls and counters cleanly.`;
  }

  return { strengths, frictions, coachingTip };
}

/**
 * Computes full 5-pillar Rocket League pairwise chemistry & EA FC diamond tier for any duo.
 */
export function evaluatePairChemistry(input: PairChemistryInput): PairChemistryRecord {
  const m = Math.max(1, input.matchesTogether);
  const { pillars, score, roleLabel, winRateLift, confidencePct } = computePillarsFromMetrics({
    matchesTogether: m,
    wins: input.wins,
    goalDiff: input.goalDiff,
    assistsAtoB: input.assistsAtoB,
    assistsBtoA: input.assistsBtoA,
    mutualDoubleCommits: input.mutualDoubleCommits,
    thirdManCovers: input.thirdManCovers,
    radarA: input.radarA,
    radarB: input.radarB,
    soloWinRateA: input.soloWinRateA,
    soloWinRateB: input.soloWinRateB,
    avgRatingTogether: input.avgRatingTogether,
    soloRatingBaseline: input.soloRatingBaseline,
    avgBoostA: input.avgBoostA,
    avgBoostB: input.avgBoostB,
    supersonicShareA: input.supersonicShareA,
    supersonicShareB: input.supersonicShareB,
    emptyBoostShareA: input.emptyBoostShareA,
    emptyBoostShareB: input.emptyBoostShareB,
  });

  const { diamonds, tierLabel } = scoreToDiamondsAndTier(score);
  const { strengths, frictions, coachingTip } = buildPairNarrative(input, pillars, roleLabel, winRateLift);

  const modeSplits: PairChemistryModeSplit[] = (input.modeBuckets || [])
    .filter(b => b.matches > 0)
    .map(b => {
      const sub = computePillarsFromMetrics({
        matchesTogether: b.matches,
        wins: b.wins,
        goalDiff: b.goalDiff,
        assistsAtoB: b.assistsAtoB,
        assistsBtoA: b.assistsBtoA,
        mutualDoubleCommits: b.mutualDoubleCommits,
        thirdManCovers: Math.round((input.thirdManCovers * b.matches) / m),
        radarA: input.radarA,
        radarB: input.radarB,
        soloWinRateA: input.soloWinRateA,
        soloWinRateB: input.soloWinRateB,
        avgRatingTogether: input.avgRatingTogether,
        soloRatingBaseline: input.soloRatingBaseline,
        avgBoostA: input.avgBoostA,
        avgBoostB: input.avgBoostB,
        supersonicShareA: input.supersonicShareA,
        supersonicShareB: input.supersonicShareB,
        emptyBoostShareA: input.emptyBoostShareA,
        emptyBoostShareB: input.emptyBoostShareB,
      });
      const subTier = scoreToDiamondsAndTier(sub.score);
      return {
        mode: b.mode,
        matches_together: b.matches,
        wins: b.wins,
        losses: b.matches - b.wins,
        win_rate: round1((b.wins / b.matches) * 100),
        goal_differential: b.goalDiff,
        chemistry_score: sub.score,
        diamonds: subTier.diamonds,
        double_commits_per_game: round2(b.mutualDoubleCommits / b.matches),
        mutual_assists_per_game: round2((b.assistsAtoB + b.assistsBtoA) / b.matches),
      };
    });

  return {
    pair_key: `${input.playerA.primary_id}::${input.playerB.primary_id}`,
    player_a: input.playerA,
    player_b: input.playerB,
    matches_together: m,
    wins: input.wins,
    losses: m - input.wins,
    win_rate: round1((input.wins / m) * 100),
    goal_differential: input.goalDiff,
    chemistry_score: score,
    diamonds,
    tier_label: tierLabel,
    role_pairing_label: roleLabel,
    pillars,
    mutual_double_commits: input.mutualDoubleCommits,
    double_commits_per_game: round2(input.mutualDoubleCommits / m),
    assists_a_to_b: input.assistsAtoB,
    assists_b_to_a: input.assistsBtoA,
    total_goal_links: input.assistsAtoB + input.assistsBtoA,
    win_rate_lift_pct: winRateLift,
    confidence_pct: confidencePct,
    mode_splits: modeSplits,
    strengths,
    frictions,
    coaching_tip: coachingTip,
  };
}

function buildFallbackRadar(rows: Array<TrackerMatchPlayer & { winner_team_num: number | null }>): RadarProfile {
  const n = Math.max(1, rows.length);
  const sum = rows.reduce(
    (acc, r) => ({
      goals: acc.goals + (r.goals || 0),
      shots: acc.shots + (r.shots || 0),
      assists: acc.assists + (r.assists || 0),
      saves: acc.saves + (r.saves || 0),
      demos: acc.demos + (r.demos || 0),
      touches: acc.touches + (r.touches || 0),
      def: acc.def + (r.touches_defence || 0),
      mid: acc.mid + (r.touches_midfield || 0),
      aerials: acc.aerials + (r.aerial_touches || 0),
      carMs: acc.carMs + (r.car_ms || 300000),
      superMs: acc.superMs + (r.supersonic_ms || 0),
      emptyMs: acc.emptyMs + (r.empty_boost_ms || 0),
      boostSum: acc.boostSum + (r.boost_avg || 50) * (r.car_ms || 300000),
    }),
    { goals: 0, shots: 0, assists: 0, saves: 0, demos: 0, touches: 0, def: 0, mid: 0, aerials: 0, carMs: 0, superMs: 0, emptyMs: 0, boostSum: 0 }
  );

  return calculatePlayerRadar({
    goals: sum.goals / n,
    shots: sum.shots / n,
    assists: sum.assists / n,
    saves: sum.saves / n,
    demos: sum.demos / n,
    clearances: Math.round((sum.def * 0.4) / n),
    keyPasses: sum.assists / n,
    duelsWon: Math.round((sum.touches * 0.16) / n),
    touchesMidfield: sum.mid / n,
    touchesTotal: sum.touches / n,
    carMs: sum.carMs / n,
    supersonicMs: sum.superMs / n,
    boostAvg: sum.carMs > 0 ? sum.boostSum / sum.carMs : 50,
    emptyBoostMs: sum.emptyMs / n,
    xg: (sum.shots * 0.18) / n,
    aerialTouches: sum.aerials / n,
  });
}

function collectCandidatePlayers(
  dbTracker: DatabaseSync,
  reader: GrindlogReader,
  cache: OvertimeDBCache | undefined,
  analyzer: MatchAnalyzer,
  primaryUserId: string,
  primaryIdsFilter?: Set<string>
): CandidatePlayerProfile[] {
  const seedIds = new Map<string, { rawName: string; displayName?: string; defaultCar?: CarBodyType }>();

  for (const core of CORE_SQUAD_DISPLAY) {
    seedIds.set(core.pid, { rawName: core.rawName, displayName: core.displayName, defaultCar: core.defaultCar });
  }

  try {
    const friends = dbTracker.prepare('SELECT primary_id, nickname FROM friends').all() as Array<{
      primary_id: string;
      nickname: string | null;
    }>;
    for (const f of friends) {
      if (!seedIds.has(f.primary_id)) {
        seedIds.set(f.primary_id, { rawName: f.nickname || f.primary_id });
      }
    }
  } catch {}

  if (!primaryIdsFilter) {
    try {
      const frequent = dbTracker
        .prepare(
          `SELECT mp.primary_id, MAX(mp.name) as name, COUNT(*) as games
           FROM match_players mp
           JOIN match_players u ON u.match_guid = mp.match_guid AND u.primary_id = ? AND u.team_num = mp.team_num
           WHERE mp.is_bot = 0
           GROUP BY mp.primary_id
           HAVING COUNT(*) >= 3
           ORDER BY games DESC
           LIMIT 8`
        )
        .all(primaryUserId) as Array<{ primary_id: string; name: string; games: number }>;
      for (const row of frequent) {
        if (!seedIds.has(row.primary_id)) {
          seedIds.set(row.primary_id, { rawName: row.name });
        }
      }
    } catch {}
  }

  const profiles: CandidatePlayerProfile[] = [];
  for (const [pid, meta] of seedIds.entries()) {
    if (primaryIdsFilter && !primaryIdsFilter.has(pid)) continue;

    const rows = reader.getPlayerMatches(pid);
    if (rows.length === 0) continue;

    const card = buildPlayerFifaCard({ reader, primaryId: pid, playerName: meta.rawName, cache, analyzer, mode: 'all' });
    const analyzedEntries = rows
      .slice(0, 40)
      .map(r => analyzer.analyzeMatch(r.match_guid, false)?.players.find(p => p.primary_id === pid || p.name === meta.rawName))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    const radar = analyzedEntries.length >= 3 ? aggregateRadarFromAnalyses(analyzedEntries) : buildFallbackRadar(rows);
    const ovr = calculateTacticalOvr(radar);
    const wins = rows.filter(r => r.winner_team_num === r.team_num).length;
    const soloAvgRating =
      analyzedEntries.length > 0
        ? analyzedEntries.reduce((s, p) => s + p.rating, 0) / analyzedEntries.length
        : rows.reduce((s, r) => s + calculateMatchRatingFromPlayerRow(r), 0) / rows.length;

    const resolvedName = rows[0]?.name || meta.rawName;
    const prefs = cache?.getCardPrefs(pid) ?? null;

    profiles.push({
      primary_id: pid,
      aliases: Array.from(new Set([resolvedName, meta.rawName, card?.display_name || resolvedName])),
      raw_name: resolvedName,
      ref: {
        primary_id: pid,
        display_name: card?.display_name || meta.displayName || resolvedName,
        archetype: card?.archetype || radar.archetype,
        role_badge: card?.position || ARCHETYPE_BADGE_MAP[radar.archetype] || 'FLEX',
        ovr: card?.ovr ?? ovr.ovr,
        car_body: (prefs?.car_body || card?.car_body || meta.defaultCar || 'octane') as CarBodyType,
      },
      radar,
      soloWinRate: (wins / rows.length) * 100,
      soloAvgRating,
    });
  }

  return profiles;
}

function classifyModeSize(teamSize: number): '2v2' | '3v3' | null {
  if (teamSize === 2) return '2v2';
  if (teamSize === 3) return '3v3';
  return null;
}

function didPlayerMatchDc(dc: MatchAnalysisResult['double_commits'][number], aAliases: Set<string>, bAliases: Set<string>): boolean {
  const n1 = dc.player1_name.toLowerCase();
  const n2 = dc.player2_name.toLowerCase();
  return (aAliases.has(n1) && bAliases.has(n2)) || (aAliases.has(n2) && bAliases.has(n1));
}

function evaluateSingleCandidatePair(
  dbTracker: DatabaseSync,
  analyzer: MatchAnalyzer,
  candA: CandidatePlayerProfile,
  candB: CandidatePlayerProfile,
  modeFilter: 'all' | '2v2' | '3v3'
): PairChemistryRecord | null {
  const allRows = dbTracker
    .prepare(
      `SELECT m.guid, m.started_at, m.winner_team_num, m.score_team0, m.score_team1,
              (SELECT COUNT(*) FROM match_players mp2 WHERE mp2.match_guid = m.guid AND mp2.team_num = a.team_num AND mp2.is_bot = 0) as team_size,
              a.primary_id as a_pid, a.name as a_name, a.player_key as a_key, a.team_num as a_team,
              a.goals as a_goals, a.assists as a_assists, a.saves as a_saves, a.shots as a_shots, a.demos as a_demos,
              a.car_ms as a_car_ms, a.supersonic_ms as a_super_ms, a.empty_boost_ms as a_empty_ms, a.boost_avg as a_boost,
              b.primary_id as b_pid, b.name as b_name, b.player_key as b_key, b.team_num as b_team,
              b.goals as b_goals, b.assists as b_assists, b.saves as b_saves, b.shots as b_shots, b.demos as b_demos,
              b.car_ms as b_car_ms, b.supersonic_ms as b_super_ms, b.empty_boost_ms as b_empty_ms, b.boost_avg as b_boost
       FROM matches m
       JOIN match_players a ON m.guid = a.match_guid AND a.primary_id = ?
       JOIN match_players b ON m.guid = b.match_guid AND b.primary_id = ?
       WHERE a.team_num = b.team_num AND a.is_bot = 0 AND b.is_bot = 0
       ORDER BY m.started_at DESC`
    )
    .all(candA.primary_id, candB.primary_id) as unknown as MutualMatchJoinedRow[];

  if (allRows.length < 2) return null;

  const aAliases = new Set(candA.aliases.map(n => n.toLowerCase()));
  const bAliases = new Set(candB.aliases.map(n => n.toLowerCase()));

  const goalPairs = dbTracker
    .prepare(
      `SELECT g.match_guid, p_assist.primary_id as assister_pid, p_score.primary_id as scorer_pid
       FROM match_goals g
       JOIN match_players p_assist ON g.match_guid = p_assist.match_guid AND g.assister_key = p_assist.player_key
       JOIN match_players p_score ON g.match_guid = p_score.match_guid AND g.scorer_key = p_score.player_key
       WHERE (p_assist.primary_id = ? AND p_score.primary_id = ?)
          OR (p_assist.primary_id = ? AND p_score.primary_id = ?)`
    )
    .all(candA.primary_id, candB.primary_id, candB.primary_id, candA.primary_id) as Array<{
    match_guid: string;
    assister_pid: string;
    scorer_pid: string;
  }>;

  const goalLinksByMatch = new Map<string, { ab: number; ba: number }>();
  for (const g of goalPairs) {
    const cur = goalLinksByMatch.get(g.match_guid) || { ab: 0, ba: 0 };
    if (g.assister_pid === candA.primary_id) cur.ab++;
    else cur.ba++;
    goalLinksByMatch.set(g.match_guid, cur);
  }

  const perModeStats: Record<'all' | '2v2' | '3v3', PairModeBucketInput> = {
    all: { mode: 'all', matches: 0, wins: 0, goalDiff: 0, mutualDoubleCommits: 0, assistsAtoB: 0, assistsBtoA: 0 },
    '2v2': { mode: '2v2', matches: 0, wins: 0, goalDiff: 0, mutualDoubleCommits: 0, assistsAtoB: 0, assistsBtoA: 0 },
    '3v3': { mode: '3v3', matches: 0, wins: 0, goalDiff: 0, mutualDoubleCommits: 0, assistsAtoB: 0, assistsBtoA: 0 },
  };

  let filteredWins = 0;
  let filteredGoalDiff = 0;
  let filteredAB = 0;
  let filteredBA = 0;
  let filteredDCs = 0;
  let filteredCovers = 0;
  let ratingSum = 0;
  let boostASum = 0;
  let boostBSum = 0;
  let supShareASum = 0;
  let supShareBSum = 0;
  let emptyShareASum = 0;
  let emptyShareBSum = 0;
  let filteredMatches = 0;

  for (const r of allRows) {
    const isTeam0 = r.a_team === 0;
    const scoreTeam = isTeam0 ? r.score_team0 : r.score_team1;
    const scoreOpp = isTeam0 ? r.score_team1 : r.score_team0;
    const gd = scoreTeam - scoreOpp;
    const isWin = scoreTeam > scoreOpp;
    const modeTag = classifyModeSize(r.team_size);

    const analysis = analyzer.analyzeMatch(r.guid, false);
    let matchDc = 0;
    let matchCover = 0;
    if (analysis?.double_commits) {
      for (const dc of analysis.double_commits) {
        if (didPlayerMatchDc(dc, aAliases, bAliases)) {
          matchDc++;
        } else if (dc.team_num === r.a_team && (dc.net_status === 'covered' || Boolean(dc.third_man_covering))) {
          matchCover++;
        }
      }
    }

    const links = goalLinksByMatch.get(r.guid) || { ab: 0, ba: 0 };

    perModeStats.all.matches++;
    if (isWin) perModeStats.all.wins++;
    perModeStats.all.goalDiff += gd;
    perModeStats.all.mutualDoubleCommits += matchDc;
    perModeStats.all.assistsAtoB += links.ab;
    perModeStats.all.assistsBtoA += links.ba;

    if (modeTag) {
      perModeStats[modeTag].matches++;
      if (isWin) perModeStats[modeTag].wins++;
      perModeStats[modeTag].goalDiff += gd;
      perModeStats[modeTag].mutualDoubleCommits += matchDc;
      perModeStats[modeTag].assistsAtoB += links.ab;
      perModeStats[modeTag].assistsBtoA += links.ba;
    }

    if (modeFilter !== 'all' && modeTag !== modeFilter) continue;

    filteredMatches++;
    if (isWin) filteredWins++;
    filteredGoalDiff += gd;
    filteredAB += links.ab;
    filteredBA += links.ba;
    filteredDCs += matchDc;
    filteredCovers += matchCover;

    const aAnalyzed = analysis?.players.find(p => p.primary_id === candA.primary_id || aAliases.has(p.name.toLowerCase()));
    const bAnalyzed = analysis?.players.find(p => p.primary_id === candB.primary_id || bAliases.has(p.name.toLowerCase()));
    const rA =
      aAnalyzed?.rating ??
      calculateMatchRatingFromPlayerRow({
        goals: r.a_goals,
        assists: r.a_assists,
        saves: r.a_saves,
        shots: r.a_shots,
        demos: r.a_demos,
        team_num: r.a_team,
        winner_team_num: r.winner_team_num,
        score_team0: r.score_team0,
        score_team1: r.score_team1,
      });
    const rB =
      bAnalyzed?.rating ??
      calculateMatchRatingFromPlayerRow({
        goals: r.b_goals,
        assists: r.b_assists,
        saves: r.b_saves,
        shots: r.b_shots,
        demos: r.b_demos,
        team_num: r.b_team,
        winner_team_num: r.winner_team_num,
        score_team0: r.score_team0,
        score_team1: r.score_team1,
      });
    ratingSum += (rA + rB) / 2;

    const aCar = Math.max(1000, r.a_car_ms || 300000);
    const bCar = Math.max(1000, r.b_car_ms || 300000);
    boostASum += r.a_boost ?? 50;
    boostBSum += r.b_boost ?? 50;
    supShareASum += (r.a_super_ms || 0) / aCar;
    supShareBSum += (r.b_super_ms || 0) / bCar;
    emptyShareASum += (r.a_empty_ms || 0) / aCar;
    emptyShareBSum += (r.b_empty_ms || 0) / bCar;
  }

  const minMatches = modeFilter === 'all' ? 2 : 1;
  if (filteredMatches < minMatches) return null;

  return evaluatePairChemistry({
    playerA: candA.ref,
    playerB: candB.ref,
    radarA: candA.radar,
    radarB: candB.radar,
    matchesTogether: filteredMatches,
    wins: filteredWins,
    goalDiff: filteredGoalDiff,
    assistsAtoB: filteredAB,
    assistsBtoA: filteredBA,
    mutualDoubleCommits: filteredDCs,
    thirdManCovers: filteredCovers,
    soloWinRateA: candA.soloWinRate,
    soloWinRateB: candB.soloWinRate,
    avgRatingTogether: ratingSum / filteredMatches,
    soloRatingBaseline: (candA.soloAvgRating + candB.soloAvgRating) / 2,
    avgBoostA: boostASum / filteredMatches,
    avgBoostB: boostBSum / filteredMatches,
    supersonicShareA: supShareASum / filteredMatches,
    supersonicShareB: supShareBSum / filteredMatches,
    emptyBoostShareA: emptyShareASum / filteredMatches,
    emptyBoostShareB: emptyShareBSum / filteredMatches,
    modeBuckets: [perModeStats.all, perModeStats['2v2'], perModeStats['3v3']],
  });
}

/**
 * Evaluates all real player pairs across the user's squadmates & recurring teammates,
 * ranking compatible duos vs tactical friction pairs with EA FC diamond link grades.
 */
export function buildAllPairwiseChemistry(params: {
  reader: GrindlogReader;
  cache?: OvertimeDBCache;
  analyzer?: MatchAnalyzer;
  modeFilter?: 'all' | '2v2' | '3v3';
  primaryIdsFilter?: Set<string>;
}): PairChemistryOverview {
  const { reader, cache, analyzer, modeFilter = 'all', primaryIdsFilter } = params;
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const trackerDbPath = path.join(localAppData, 'Grindlog', 'tracker.db');
  const resolvedAnalyzer = analyzer || new MatchAnalyzer(reader, cache);

  const methodologyNotes = [
    'Five-pillar weighted chemistry: Passing & Goal Links (25%), Spacing & Anti-Double-Commit (25%), Role Complementarity (20%), Tempo & Boost Sync (15%), and Sample-Weighted Win/Rating Lift (15%).',
    'EA FC Diamond Links: 3◆ Telepathic Link (>=76), 2◆ Strong Link (64-75), 1◆ Functional Link (52-63), 0◆ Tactical Friction (<52).',
    'Bayesian shrinkage m/(m+12) stabilizes small sample win-rate spikes so 3-game streaks do not outrank proven 30+ match chemistry.',
  ];

  if (!fs.existsSync(trackerDbPath)) {
    return {
      generated_at: new Date().toISOString(),
      mode_filter: modeFilter,
      players: [],
      pairs: [],
      best_pairs: [],
      friction_pairs: [],
      methodology_notes: methodologyNotes,
    };
  }

  const primaryUser = reader.getPrimaryUser();
  const dbTracker = new DatabaseSync(trackerDbPath, { readOnly: true });
  try {
    const primaryUid = primaryUser?.primary_id || CORE_SQUAD_DISPLAY[0].pid;
    const candidates = collectCandidatePlayers(dbTracker, reader, cache, resolvedAnalyzer, primaryUid, primaryIdsFilter);
    const pairs: PairChemistryRecord[] = [];

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const record = evaluateSingleCandidatePair(dbTracker, resolvedAnalyzer, candidates[i], candidates[j], modeFilter);
        if (record) pairs.push(record);
      }
    }

    pairs.sort((a, b) => b.chemistry_score - a.chemistry_score || b.matches_together - a.matches_together);

    const substantial = pairs.filter(p => p.matches_together >= 3);
    const pool = substantial.length >= 2 ? substantial : pairs;
    const bestPairs = [...pool]
      .sort((a, b) => b.chemistry_score - a.chemistry_score || b.matches_together - a.matches_together)
      .slice(0, 3);
    const frictionPairs = [...pool]
      .sort((a, b) => a.chemistry_score - b.chemistry_score || b.double_commits_per_game - a.double_commits_per_game)
      .slice(0, 3);

    return {
      generated_at: new Date().toISOString(),
      mode_filter: modeFilter,
      players: candidates.map(c => c.ref),
      pairs,
      best_pairs: bestPairs,
      friction_pairs: frictionPairs,
      methodology_notes: methodologyNotes,
    };
  } finally {
    dbTracker.close();
  }
}

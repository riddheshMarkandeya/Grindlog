import type {
  CarBodyType,
  CardMode,
  FifaCardData,
  MatchPlayerAnalysis,
  PlayerCardPrefs,
  PlayStyleBadge,
  RadarProfile,
  TacticalArchetype,
} from '../../shared/types.ts';
import { calculateTacticalOvr } from '../../shared/ovr.ts';
import type { GrindlogReader, TrackerMatchPlayer } from '../ingestion/grindlog-reader.ts';
import type { OvertimeDBCache } from '../db/cache.ts';
import { ENGINE_VERSION, type MatchAnalyzer } from './analyzer.ts';
import { calculatePlayerRadar } from './radar.ts';
import { aggregateRadarFromAnalyses } from './radar-aggregator.ts';
import { calculateMatchRatingFromPlayerRow } from './profile.ts';

export const DEFAULT_CARD_CYCLE_SIZE = 15;

export interface PlayerCycleWindow {
  cycleSize: number;
  currentCycle: number;
  windowStartMatch: number;
  windowEndMatch: number;
  totalMatches: number;
  progressInCycle: number;
  matchesUntilRefresh: number;
  isProvisional: boolean;
  activeSlice: Array<
    TrackerMatchPlayer & {
      started_at: number;
      winner_team_num: number | null;
      score_team0: number;
      score_team1: number;
    }
  >;
  prevSlice: Array<
    TrackerMatchPlayer & {
      started_at: number;
      winner_team_num: number | null;
      score_team0: number;
      score_team1: number;
    }
  >;
}

const ARCHETYPE_POSITION_MAP: Record<TacticalArchetype, string> = {
  'The Striker': 'ST',
  'The Playmaker': 'CAM',
  'The Dribbler': 'LW',
  'The Disruptor': 'CDM',
  'The Anchor': 'CB',
  'The Air Marshal': 'RF',
  'The Speed Demon': 'RW',
  'The Boost Hawk': 'LM',
  'The All-Rounder': 'CM',
  'The Passenger': 'SUB',
};

const DEFAULT_SUBTITLE_MAP: Record<TacticalArchetype, string> = {
  'The Striker': 'APEX STRIKER',
  'The Playmaker': 'THE ARCHITECT',
  'The Dribbler': 'DRIBBLE WIZARD',
  'The Disruptor': 'MIDFIELD ENFORCER',
  'The Anchor': 'THE IRON WALL',
  'The Air Marshal': 'SKY MARSHAL',
  'The Speed Demon': 'BLITZ RUNNER',
  'The Boost Hawk': 'BOOST THIEF',
  'The All-Rounder': 'BOX-TO-BOX',
  'The Passenger': 'SQUAD RESERVE',
};

/**
 * Computes discrete N-match evaluation blocks (default 15 games) from chronological match history.
 * Ensures FIFA card attributes stay locked between checkpoints rather than flickering every match.
 */
export function sliceCardCycleMatches<
  T extends TrackerMatchPlayer & {
    started_at: number;
    winner_team_num: number | null;
    score_team0: number;
    score_team1: number;
  },
>(rowsNewestFirst: T[], cycleSize: number = DEFAULT_CARD_CYCLE_SIZE): PlayerCycleWindow {
  const safeSize = Math.max(10, Math.min(20, Math.round(cycleSize)));
  const chronological = [...rowsNewestFirst].sort((a, b) => a.started_at - b.started_at);
  const totalMatches = chronological.length;
  const completedCycles = Math.floor(totalMatches / safeSize);

  if (completedCycles >= 1) {
    const windowEndMatch = completedCycles * safeSize;
    const windowStartMatch = windowEndMatch - safeSize + 1;
    const activeSlice = chronological.slice(windowStartMatch - 1, windowEndMatch);
    const prevSlice =
      completedCycles >= 2
        ? chronological.slice(windowStartMatch - 1 - safeSize, windowStartMatch - 1)
        : [];
    const progressInCycle = totalMatches - windowEndMatch;

    return {
      cycleSize: safeSize,
      currentCycle: completedCycles,
      windowStartMatch,
      windowEndMatch,
      totalMatches,
      progressInCycle,
      matchesUntilRefresh: safeSize - progressInCycle,
      isProvisional: false,
      activeSlice,
      prevSlice,
    };
  }

  return {
    cycleSize: safeSize,
    currentCycle: 0,
    windowStartMatch: totalMatches > 0 ? 1 : 0,
    windowEndMatch: totalMatches,
    totalMatches,
    progressInCycle: totalMatches,
    matchesUntilRefresh: Math.max(1, safeSize - totalMatches),
    isProvisional: true,
    activeSlice: chronological,
    prevSlice: [],
  };
}

/**
 * Resolves FIFA Position code (`ST`, `CAM`, `GK`, etc.) from archetype and GK proficiency.
 */
export function resolveCardPosition(radar: RadarProfile): string {
  if (radar.archetype === 'The Anchor' && radar.goalkeeping >= 56 && radar.goalkeeping >= radar.tackling) {
    return 'GK';
  }
  return ARCHETYPE_POSITION_MAP[radar.archetype] || 'CM';
}

/**
 * Maps Tactical OVR & form rating onto EA FC card promo tier titles.
 */
export function resolvePromoEdition(ovr: number, isProvisional: boolean, avgRating: number): string {
  if (isProvisional) return 'PROVISIONAL';
  if (ovr >= 90) return 'OVERTIME ICON';
  if (ovr >= 84 && avgRating >= 7.9) return 'IN-FORM TOTW';
  if (ovr >= 83) return 'ELITE HERO';
  if (ovr >= 75) return 'GOLD RARE';
  if (ovr >= 62) return 'SILVER STAR';
  return 'BRONZE PROSPECT';
}

/**
 * Awards 1 Gold PlayStyle+ and up to 2 Silver PlayStyles deterministically from unified FIFA+RL metrics.
 */
export function extractCardPlayStyles(radar: RadarProfile, analyses: MatchPlayerAnalysis[]): PlayStyleBadge[] {
  const n = Math.max(1, analyses.length);
  const perMatch = (getter: (a: MatchPlayerAnalysis) => number) =>
    Math.round((analyses.reduce((s, a) => s + getter(a), 0) / n) * 10) / 10;

  const candidates: Array<{ id: string; name: string; icon: string; score: number; metric_label: string }> = [
    {
      id: 'power_shot',
      name: 'Power Shot',
      icon: '🎯',
      score: radar.finishing,
      metric_label: `${perMatch(a => a.goals)} G/gm`,
    },
    {
      id: 'trickster',
      name: 'Trickster',
      icon: '🪄',
      score: radar.dribbling,
      metric_label: `${perMatch(a => a.tactical_metrics?.dribble_chains ?? 0)} Drb/gm`,
    },
    {
      id: 'quick_step',
      name: 'Rapid',
      icon: '⚡',
      score: radar.pace,
      metric_label: `${perMatch(a => a.tactical_metrics?.pace_sprints ?? 0)} Brk/gm`,
    },
    {
      id: 'anticipate',
      name: 'Anticipate',
      icon: '⚔️',
      score: radar.tackling,
      metric_label: `${perMatch(a => a.tactical_metrics?.duels_won ?? 0)} 50s/gm`,
    },
    {
      id: 'far_reach',
      name: 'Far Reach',
      icon: '🧤',
      score: radar.goalkeeping,
      metric_label: `${perMatch(a => a.saves)} Sv/gm`,
    },
    {
      id: 'incisive_pass',
      name: 'Incisive Pass',
      icon: '📐',
      score: radar.creation,
      metric_label: `${perMatch(a => a.key_passes)} KP/gm`,
    },
    {
      id: 'aerial',
      name: 'Aerial',
      icon: '✈️',
      score: radar.aerial ?? 40,
      metric_label: `${perMatch(a => a.aerial_touches)} Air/gm`,
    },
  ];

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const result: PlayStyleBadge[] = [];
  if (sorted.length > 0 && sorted[0].score >= 30) {
    result.push({
      id: sorted[0].id,
      name: sorted[0].name,
      icon: sorted[0].icon,
      tier: 'plus',
      metric_label: sorted[0].metric_label,
    });
  }
  for (let i = 1; i < sorted.length && result.length < 3; i++) {
    if (sorted[i].score >= 48) {
      result.push({
        id: sorted[i].id,
        name: sorted[i].name,
        icon: sorted[i].icon,
        tier: 'silver',
        metric_label: sorted[i].metric_label,
      });
    }
  }
  return result;
}

function evaluateSliceRadar(
  sliceRows: PlayerCycleWindow['activeSlice'],
  cache?: OvertimeDBCache,
  analyzer?: MatchAnalyzer
): { radar: RadarProfile; analyses: MatchPlayerAnalysis[]; winRate: number; avgRating: number } {
  const analyses: MatchPlayerAnalysis[] = [];
  let wins = 0;
  let ratingSum = 0;
  let goals = 0;
  let shots = 0;
  let assists = 0;
  let saves = 0;
  let demos = 0;
  let defTouches = 0;
  let midTouches = 0;
  let attTouches = 0;
  let touches = 0;
  let carMs = 0;
  let superMs = 0;
  let emptyMs = 0;
  let boostWeighted = 0;
  let aerials = 0;

  for (const r of sliceRows) {
    if (r.team_num === r.winner_team_num) wins++;
    goals += r.goals;
    shots += r.shots;
    assists += r.assists;
    saves += r.saves;
    demos += r.demos;
    defTouches += r.touches_defence || 0;
    midTouches += r.touches_midfield || 0;
    attTouches += r.touches_attack || 0;
    touches += r.touches || 0;
    const cMs = r.car_ms || 300_000;
    carMs += cMs;
    superMs += r.supersonic_ms || 0;
    emptyMs += r.empty_boost_ms || 0;
    boostWeighted += (r.boost_avg ?? 50) * cMs;
    aerials += r.aerial_touches || 0;

    let entry: MatchPlayerAnalysis | undefined;
    const cachedMatch = cache?.getMatch(r.match_guid);
    if (cachedMatch && cachedMatch.engine_version === ENGINE_VERSION) {
      entry = cachedMatch.players.find(p => p.primary_id === r.primary_id || p.name === r.name);
    } else if (analyzer) {
      const mAnalysis = analyzer.analyzeMatch(r.match_guid, false);
      entry = mAnalysis?.players.find(p => p.primary_id === r.primary_id || p.name === r.name);
    }
    if (entry) {
      analyses.push(entry);
      ratingSum += entry.rating;
    } else {
      ratingSum += calculateMatchRatingFromPlayerRow(r);
    }
  }

  const count = Math.max(1, sliceRows.length);
  const radar: RadarProfile =
    analyses.length === sliceRows.length && analyses.length > 0
      ? aggregateRadarFromAnalyses(analyses)
      : calculatePlayerRadar({
          goals,
          shots,
          assists,
          saves,
          demos,
          clearances: Math.round(defTouches * 0.4),
          keyPasses: assists,
          duelsWon: Math.round(touches * 0.14),
          touchesDefence: defTouches,
          touchesMidfield: midTouches,
          touchesAttack: attTouches,
          touchesTotal: Math.max(1, touches),
          carMs: Math.max(1, carMs),
          supersonicMs: superMs,
          boostAvg: carMs > 0 ? boostWeighted / carMs : 50,
          emptyBoostMs: emptyMs,
          xg: shots * 0.22,
          aerialTouches: aerials,
        });

  return {
    radar,
    analyses,
    winRate: Math.round((wins / count) * 1000) / 10,
    avgRating: Math.round((ratingSum / count) * 10) / 10,
  };
}

function defaultCarForArchetype(archetype: TacticalArchetype): CarBodyType {
  if (archetype === 'The Striker' || archetype === 'The Dribbler') return 'fennec';
  if (archetype === 'The Playmaker') return 'dominus';
  return 'octane';
}

const DEFAULT_DISPLAY_NAMES: Record<string, string> = {
  'swapo_o': 'Swap',
  'mechless madness': 'Mechless',
  'rocinante_.': 'Rocinante',
};

function resolveDefaultCardName(rawName: string): string {
  return DEFAULT_DISPLAY_NAMES[rawName.trim().toLowerCase()] || rawName;
}

/**
 * Classifies a player match row cleanly into 2s vs 3s using playlist_id and actual non-bot team size.
 */
export function classifyRowGameMode(row: { playlist_id?: number | null; team_size?: number }): '2s' | '3s' | 'other' {
  const pid = row.playlist_id ?? 0;
  const ts = row.team_size ?? 0;
  if (pid === 2 || pid === 11) return '2s';
  if (pid === 1 || pid === 12 || pid === 13) return '3s';
  if (ts === 2) return '2s';
  if (ts === 3) return '3s';
  return 'other';
}

/**
 * Builds the player's shareable FUT-style FIFA+RL Card locked to completed 15-game Rating Cycles.
 */
export function buildPlayerFifaCard(params: {
  reader: GrindlogReader;
  primaryId: string;
  playerName?: string;
  cache?: OvertimeDBCache;
  analyzer?: MatchAnalyzer;
  cycleSize?: number;
  mode?: CardMode;
  prefsOverride?: PlayerCardPrefs | null;
}): FifaCardData | null {
  const {
    reader,
    primaryId,
    playerName,
    cache,
    analyzer,
    cycleSize = DEFAULT_CARD_CYCLE_SIZE,
    mode = 'all',
    prefsOverride,
  } = params;
  const allRows = reader.getPlayerMatches(primaryId);
  if (allRows.length === 0) return null;

  const rows = mode === 'all' ? allRows : allRows.filter(r => classifyRowGameMode(r) === mode);
  if (rows.length === 0) return null;

  const resolvedName = playerName || rows[0].name || allRows[0].name || 'Unknown Pilot';
  const resolvedPid = rows[0].primary_id || primaryId;
  const window = sliceCardCycleMatches(rows, cycleSize);

  const activeEval = evaluateSliceRadar(window.activeSlice, cache, analyzer);
  const activeOvr = calculateTacticalOvr(activeEval.radar);

  let prevOvr = activeOvr;
  let prevRadar = activeEval.radar;
  if (window.prevSlice.length > 0) {
    const prevEval = evaluateSliceRadar(window.prevSlice, cache, analyzer);
    prevRadar = prevEval.radar;
    prevOvr = calculateTacticalOvr(prevRadar);
  }

  const prefs = prefsOverride !== undefined ? prefsOverride : cache?.getCardPrefs(resolvedPid) || cache?.getCardPrefs(primaryId) || null;
  const carBody: CarBodyType = prefs?.car_body || defaultCarForArchetype(activeEval.radar.archetype);
  const displayName = (prefs?.custom_name || '').trim() || resolveDefaultCardName(resolvedName);
  const cardTitle = (prefs?.custom_title || '').trim() || DEFAULT_SUBTITLE_MAP[activeEval.radar.archetype];

  return {
    primary_id: resolvedPid,
    mode,
    player_name: resolvedName,
    display_name: displayName,
    card_title: cardTitle,
    promo_edition: resolvePromoEdition(activeOvr.ovr, window.isProvisional, activeEval.avgRating),
    position: resolveCardPosition(activeEval.radar),
    archetype: activeEval.radar.archetype,
    car_body: carBody,
    ovr: activeOvr.ovr,
    total800: activeOvr.total800,
    tier: activeOvr.tier,
    accent_color: activeOvr.accentColor,
    stats: {
      pac: Math.round(activeEval.radar.pace),
      sho: Math.round(activeEval.radar.finishing),
      pas: Math.round(activeEval.radar.creation),
      dri: Math.round(activeEval.radar.dribbling),
      tac: Math.round(activeEval.radar.tackling),
      gk: Math.round(activeEval.radar.goalkeeping),
      aer: Math.round(activeEval.radar.aerial ?? 40),
      dis: Math.round(activeEval.radar.positioning ?? 50),
    },
    stat_deltas: {
      ovr: window.prevSlice.length > 0 ? activeOvr.ovr - prevOvr.ovr : 0,
      pac: window.prevSlice.length > 0 ? Math.round(activeEval.radar.pace - prevRadar.pace) : 0,
      sho: window.prevSlice.length > 0 ? Math.round(activeEval.radar.finishing - prevRadar.finishing) : 0,
      pas: window.prevSlice.length > 0 ? Math.round(activeEval.radar.creation - prevRadar.creation) : 0,
      dri: window.prevSlice.length > 0 ? Math.round(activeEval.radar.dribbling - prevRadar.dribbling) : 0,
      tac: window.prevSlice.length > 0 ? Math.round(activeEval.radar.tackling - prevRadar.tackling) : 0,
      gk: window.prevSlice.length > 0 ? Math.round(activeEval.radar.goalkeeping - prevRadar.goalkeeping) : 0,
    },
    cycle: {
      cycle_size: window.cycleSize,
      current_cycle: window.currentCycle,
      window_start_match: window.windowStartMatch,
      window_end_match: window.windowEndMatch,
      total_matches: window.totalMatches,
      progress_in_cycle: window.progressInCycle,
      matches_until_refresh: window.matchesUntilRefresh,
      is_provisional: window.isProvisional,
      win_rate: activeEval.winRate,
      avg_rating: activeEval.avgRating,
    },
    playstyles: extractCardPlayStyles(activeEval.radar, activeEval.analyses),
  };
}

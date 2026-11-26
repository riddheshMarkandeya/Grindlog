import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { MatchPlayerAnalysis, PlayerProfile, PlayerFormMatch, PlaylistStats } from '../../shared/types.ts';
import { calculatePlayerRadar } from './radar.ts';
import { aggregateRadarFromAnalyses } from './radar-aggregator.ts';
import type { GrindlogReader } from '../ingestion/grindlog-reader.ts';
import type { OvertimeDBCache } from '../db/cache.ts';
import { ENGINE_VERSION, type MatchAnalyzer } from './analyzer.ts';
import { buildPlayerFifaCard } from './fifa-card.ts';

interface CareerRawTelemetry {
  duelsWon: number;
  doubleCommits: number;
  fatalDoubleCommits: number;
  keyPasses: number;
  favorablePasses: number;
  infieldCrosses: number;
  backboardClears: number;
  counterPressRecoveries: number;
  reflexSaves: number;
  aerialGoals: number;
  flipResets: number;
  screamers: number;
  smallPads: number;
  bigOrbs: number;
  boostSteals: number;
}

const careerTelemetryCache = new Map<string, { matchCount: number; data: CareerRawTelemetry }>();

function extractCareerTacticalTelemetry(
  primaryId: string,
  playerNames: Set<string>,
  matchGuids: Set<string>
): CareerRawTelemetry {
  const matchCount = matchGuids.size;
  const cached = careerTelemetryCache.get(primaryId);
  if (cached && cached.matchCount === matchCount) {
    return cached.data;
  }

  const out: CareerRawTelemetry = {
    duelsWon: 0,
    doubleCommits: 0,
    fatalDoubleCommits: 0,
    keyPasses: 0,
    favorablePasses: 0,
    infieldCrosses: 0,
    backboardClears: 0,
    counterPressRecoveries: 0,
    reflexSaves: 0,
    aerialGoals: 0,
    flipResets: 0,
    screamers: 0,
    smallPads: 0,
    bigOrbs: 0,
    boostSteals: 0,
  };

  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const rawDbPath = path.join(localAppData, 'Grindlog', 'raw.db');
    if (!fs.existsSync(rawDbPath)) return out;

    const rdb = new DatabaseSync(rawDbPath, { readOnly: true });
    try {
      // 1. Scan StatfeedEvent for special tactical medals belonging to playerName
      const sfRows = rdb
        .prepare("SELECT match_guid, ts, data FROM events WHERE name = 'StatfeedEvent'")
        .all() as Array<{ match_guid: string; ts: number; data: string }>;

      const goalTimesByMatch = new Map<string, Array<{ ts: number; scoringTeam: number }>>();
      const shotTimesByMatch = new Map<string, Array<{ ts: number; shooter: string; team: number }>>();

      for (const r of sfRows) {
        if (!matchGuids.has(r.match_guid)) continue;
        try {
          const d = JSON.parse(r.data);
          const evt = d.EventName;
          const target = d.MainTarget?.Name;
          const team = d.MainTarget?.TeamNum;

          if (evt === 'Goal' && team !== undefined) {
            const list = goalTimesByMatch.get(r.match_guid) || [];
            list.push({ ts: r.ts, scoringTeam: team });
            goalTimesByMatch.set(r.match_guid, list);
          } else if (evt === 'Shot' && target && team !== undefined) {
            const list = shotTimesByMatch.get(r.match_guid) || [];
            list.push({ ts: r.ts, shooter: target, team });
            shotTimesByMatch.set(r.match_guid, list);
          }

          if (target && playerNames.has(target)) {
            if (evt === 'EpicSave' || evt === 'Savior') out.reflexSaves++;
            else if (evt === 'AerialGoal') out.aerialGoals++;
            else if (evt === 'FlipReset') out.flipResets++;
            else if (evt === 'LongGoal') out.screamers++;
          }
        } catch {}
      }

      // 2. Scan BoostPickup events if logged
      const boostRows = rdb
        .prepare("SELECT match_guid, data FROM events WHERE name = 'BoostPickup'")
        .all() as Array<{ match_guid: string; data: string }>;

      for (const br of boostRows) {
        if (!matchGuids.has(br.match_guid)) continue;
        try {
          const d = JSON.parse(br.data);
          if (!d.Player?.Name || !playerNames.has(d.Player.Name)) continue;
          const bType = d.BoostType;
          const loc = d.Location || { X: 0, Y: 0, Z: 0 };
          const teamNum = d.Player?.TeamNum ?? 0;
          if (bType === 'BoostType_Pad') {
            out.smallPads++;
          } else if (bType === 'BoostType_Pill') {
            out.bigOrbs++;
            const isOppCorner =
              (teamNum === 0 && loc.Y > 2500 && Math.abs(loc.X) > 2400) ||
              (teamNum === 1 && loc.Y < -2500 && Math.abs(loc.X) > 2400);
            if (isOppCorner) out.boostSteals++;
          }
        } catch {}
      }

      // 3. Scan BallHit physics sequence across matches
      const hitRows = rdb
        .prepare("SELECT match_guid, ts, data FROM events WHERE name = 'BallHit' ORDER BY match_guid, seq ASC")
        .all() as Array<{ match_guid: string; ts: number; data: string }>;

      let prev: { g: string; ts: number; name: string; team: number; x: number; y: number; z: number; sp: number } | null = null;

      for (const hr of hitRows) {
        if (!matchGuids.has(hr.match_guid)) continue;
        try {
          const d = JSON.parse(hr.data);
          const p = d.Players?.[0];
          if (!p?.Name) continue;

          const cur = {
            g: hr.match_guid,
            ts: hr.ts,
            name: p.Name as string,
            team: p.TeamNum as number,
            x: (d.Ball?.Location?.X ?? 0) as number,
            y: (d.Ball?.Location?.Y ?? 0) as number,
            z: (d.Ball?.Location?.Z ?? 0) as number,
            sp: (d.Ball?.PostHitSpeed ?? 0) as number,
          };

          // Backboard wall clear
          if (playerNames.has(cur.name) && cur.z >= 640 && cur.sp >= 45) {
            const ownGoalY = cur.team === 0 ? -5120 : 5120;
            if (Math.abs(cur.y - ownGoalY) <= 750) {
              out.backboardClears++;
            }
          }

          if (prev && prev.g === cur.g) {
            const dt = cur.ts - prev.ts;
            const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);

            // Double commit (encroacher is second player touching within 750ms & 900uu)
            if (prev.team === cur.team && prev.name !== cur.name && dt <= 750 && dist <= 900) {
              if (playerNames.has(cur.name)) {
                out.doubleCommits++;
                const oppTeam = cur.team === 0 ? 1 : 0;
                const goals = goalTimesByMatch.get(cur.g);
                if (goals && goals.some(gl => gl.scoringTeam === oppTeam && gl.ts >= cur.ts && gl.ts <= cur.ts + 6000)) {
                  out.fatalDoubleCommits++;
                }
              }
            }

            // 50/50 Duel won
            if (prev.team !== cur.team && dt <= 400 && dist <= 650) {
              const winnerName =
                cur.team === 0 ? (cur.y > prev.y ? cur.name : prev.name) : cur.y < prev.y ? cur.name : prev.name;
              if (playerNames.has(winnerName)) {
                out.duelsWon++;
              }
            }

            // Counter-press recovery: winning ball back inside attacking half within 4s of dispossession
            if (prev.team !== cur.team && playerNames.has(cur.name) && dt <= 4000 && cur.sp >= 45) {
              const isInOppHalf = cur.team === 0 ? cur.y > 1200 : cur.y < -1200;
              if (isInOppHalf) out.counterPressRecoveries++;
            }

            // Favorable Pass / Infield Cross / Key Pass
            if (prev.team === cur.team && playerNames.has(prev.name) && cur.name !== prev.name && dt > 120 && dt <= 3500) {
              const isAttHalf = prev.team === 0 ? prev.y > 500 : prev.y < -500;
              const isFromWing = Math.abs(prev.x) >= 2200;
              const isIntoCenterSlot = Math.abs(cur.x) <= 950;
              if (isAttHalf && isFromWing && isIntoCenterSlot) {
                out.infieldCrosses++;
              } else if (isAttHalf && prev.sp >= 55) {
                out.favorablePasses++;
              }

              // Check if receiver shot within 3s -> Key Pass
              const shots = shotTimesByMatch.get(cur.g);
              if (shots && shots.some(s => s.shooter === cur.name && s.ts >= cur.ts && s.ts <= cur.ts + 3000)) {
                out.keyPasses++;
              }
            }
          }

          prev = cur;
        } catch {}
      }
    } finally {
      rdb.close();
    }
  } catch {}

  careerTelemetryCache.set(primaryId, { matchCount, data: out });
  return out;
}

const PLAYLIST_NAMES: Record<number, string> = {
  1: 'Casual 3v3 Standard',
  2: 'Casual 2v2 Doubles',
  3: 'Casual 1v1 Duel',
  4: 'Casual 4v4 Chaos',
  10: 'Ranked 1v1 Duel',
  11: 'Ranked 2v2 Doubles',
  12: 'Ranked Solo Standard',
  13: 'Ranked 3v3 Standard',
  27: 'Ranked Hoops',
  28: 'Ranked Rumble',
  29: 'Ranked Dropshot',
  30: 'Ranked Snow Day',
  34: 'Competitive Tournament',
  53: 'Special LTM Mode',
};

export function getPlaylistName(id: number | null): string {
  if (id === null || id === undefined) return 'Unknown Playlist';
  return PLAYLIST_NAMES[id] || `Playlist #${id}`;
}

export function calculateMatchRatingFromPlayerRow(row: {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  woodwork_hits?: number | null;
  aerial_touches?: number | null;
  team_num: number;
  winner_team_num: number | null;
  score_team0: number;
  score_team1: number;
}): number {
  const isWin = row.team_num === row.winner_team_num;
  const oppGoals = row.team_num === 0 ? row.score_team1 : row.score_team0;
  const cleanSheet = oppGoals === 0;

  let score = 6.0;
  score += row.goals * 0.85;
  score += row.assists * 0.50;
  score += row.saves * 0.40;
  score += Math.max(0, row.shots - row.goals) * 0.05;
  score += row.demos * 0.15;
  if (row.woodwork_hits && row.woodwork_hits > 0) score += row.woodwork_hits * 0.10;
  if (row.aerial_touches && row.aerial_touches > 0) score += Math.min(0.4, row.aerial_touches * 0.05);

  if (isWin) score += 0.35;
  else score -= 0.30;

  if (cleanSheet) score += 0.40;
  if (oppGoals >= 4) score -= (oppGoals - 3) * 0.20;

  let compressed = score;
  if (score >= 15.0) {
    compressed = 10.0;
  } else if (score > 7.5) {
    const progress = Math.min(1.0, (score - 7.5) / 7.5);
    compressed = 7.5 + 2.5 * Math.sin((progress * Math.PI) / 2);
  }

  return Math.max(1.0, Math.min(10.0, Math.round(compressed * 10) / 10));
}

export function buildPlayerProfile(
  reader: GrindlogReader,
  targetPrimaryId?: string,
  cache?: OvertimeDBCache,
  analyzer?: MatchAnalyzer
): PlayerProfile | null {
  const primaryUser = reader.getPrimaryUser();
  const primaryId = targetPrimaryId || primaryUser?.primary_id;
  if (!primaryId) return null;

  const rows = reader.getPlayerMatches(primaryId);
  if (rows.length === 0) return null;

  const resolvedPrimaryId = rows[0].primary_id || primaryId;
  const playerName = rows[0].name || primaryUser?.name || 'Unknown Pilot';
  const isUser = primaryUser?.primary_id === resolvedPrimaryId;
  const playerNames = new Set(rows.map(r => r.name));
  const matchGuids = new Set(rows.map(r => r.match_guid));
  const shouldFullAnalyzeAll = rows.length <= 45;

  let totalGoals = 0;
  let totalShots = 0;
  let totalAssists = 0;
  let totalSaves = 0;
  let totalDemos = 0;
  let totalAerials = 0;
  let totalWoodwork = 0;
  let maxShotKmh = 0;
  let totalWins = 0;
  let totalOvertime = 0;

  let totalCarMs = 0;
  let totalSupersonicMs = 0;
  let totalEmptyBoostMs = 0;
  let totalBoostWeighted = 0;

  let totalDefTouches = 0;
  let totalMidTouches = 0;
  let totalAttTouches = 0;

  const matchRatings: number[] = [];
  const recentMatches: PlayerFormMatch[] = [];
  const analyzedEntries: MatchPlayerAnalysis[] = [];

  // Grouping by playlist
  const playlistMap = new Map<
    number,
    { matches: number; wins: number; ratings: number[]; goals: number }
  >();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isWin = r.team_num === r.winner_team_num;
    if (isWin) totalWins++;
    if (r.overtime > 0) totalOvertime++;

    totalGoals += r.goals;
    totalShots += r.shots;
    totalAssists += r.assists;
    totalSaves += r.saves;
    totalDemos += r.demos;
    totalAerials += r.aerial_touches || 0;
    totalWoodwork += r.woodwork_hits || 0;
    if (r.hardest_shot_kmh && r.hardest_shot_kmh > maxShotKmh) {
      maxShotKmh = r.hardest_shot_kmh;
    }

    const carMs = r.car_ms || 300_000;
    totalCarMs += carMs;
    totalSupersonicMs += r.supersonic_ms || 0;
    totalEmptyBoostMs += r.empty_boost_ms || 0;
    totalBoostWeighted += (r.boost_avg || 50) * carMs;

    totalDefTouches += r.touches_defence || 0;
    totalMidTouches += r.touches_midfield || 0;
    totalAttTouches += r.touches_attack || 0;

    // Resolve authoritative MatchAnalyzer rating wherever cached or within friend/recent threshold
    let analyzedPlayer: MatchPlayerAnalysis | undefined;
    if (analyzer && (i < 20 || shouldFullAnalyzeAll)) {
      const mAnalysis = analyzer.analyzeMatch(r.match_guid, false);
      analyzedPlayer = mAnalysis?.players.find(
        p => p.primary_id === r.primary_id || p.name === r.name
      );
    } else if (cache) {
      const cachedMatch = cache.getMatch(r.match_guid);
      if (cachedMatch && cachedMatch.engine_version === ENGINE_VERSION) {
        analyzedPlayer = cachedMatch.players.find(
          p => p.primary_id === r.primary_id || p.name === r.name
        );
      }
    }

    if (analyzedPlayer) {
      analyzedEntries.push(analyzedPlayer);
    }

    const rating = analyzedPlayer ? analyzedPlayer.rating : calculateMatchRatingFromPlayerRow(r);
    matchRatings.push(rating);

    // Track playlist
    const pId = r.playlist_id ?? 0;
    let plData = playlistMap.get(pId);
    if (!plData) {
      plData = { matches: 0, wins: 0, ratings: [], goals: 0 };
      playlistMap.set(pId, plData);
    }
    plData.matches++;
    if (isWin) plData.wins++;
    plData.ratings.push(rating);
    plData.goals += r.goals;

    // Collect first 20 recent matches
    if (i < 20) {
      recentMatches.push({
        guid: r.match_guid,
        started_at: r.started_at,
        is_win: isWin,
        rating,
        goals: r.goals,
        assists: r.assists,
        saves: r.saves,
        score_team0: r.score_team0,
        score_team1: r.score_team1,
        user_team_num: r.team_num,
        playlist_id: r.playlist_id,
        arena: r.arena,
      });
    }
  }

  const n = rows.length;
  const wins = totalWins;
  const losses = n - wins;
  const winRate = Math.round((wins / n) * 1000) / 10;
  const totalPlaytimeMinutes = Math.round(totalCarMs / 60_000);

  const careerRating = Math.round((matchRatings.reduce((a, b) => a + b, 0) / n) * 10) / 10;
  const highestRating = Math.max(...matchRatings);
  const lowestRating = Math.min(...matchRatings);

  // Extract empirical career tactical rules & physics telemetry from raw.db
  const rawTel = extractCareerTacticalTelemetry(resolvedPrimaryId, playerNames, matchGuids);
  const hasPadData = rawTel.smallPads + rawTel.bigOrbs > 0;
  const careerPadRatio = hasPadData ? Math.round((rawTel.smallPads / (rawTel.smallPads + rawTel.bigOrbs)) * 100) : undefined;

  // Use exact aggregated MatchAnalyzer rules when every match has full engine data; otherwise use raw.db rules scan
  const radar =
    analyzedEntries.length === rows.length && analyzedEntries.length > 0
      ? aggregateRadarFromAnalyses(analyzedEntries)
      : calculatePlayerRadar({
          goals: totalGoals,
          shots: totalShots,
          assists: totalAssists,
          saves: totalSaves,
          demos: totalDemos,
          clearances: Math.round(totalDefTouches * 0.4),
          keyPasses: Math.max(totalAssists, totalAssists + rawTel.keyPasses),
          duelsWon: rawTel.duelsWon > 0 ? rawTel.duelsWon : Math.round(totalDemos * 0.8),
          touchesDefence: totalDefTouches,
          touchesMidfield: totalMidTouches,
          touchesAttack: totalAttTouches,
          touchesTotal: totalDefTouches + totalMidTouches + totalAttTouches,
          carMs: totalCarMs,
          supersonicMs: totalSupersonicMs,
          boostAvg: totalCarMs > 0 ? totalBoostWeighted / totalCarMs : 50,
          emptyBoostMs: totalEmptyBoostMs,
          xg: totalGoals * 0.82,
          aerialTouches: totalAerials,
          doubleCommits: rawTel.doubleCommits,
          fatalDoubleCommits: rawTel.fatalDoubleCommits,
          hardestShotKmh: maxShotKmh,
          screamers: rawTel.screamers,
          favorablePasses: rawTel.favorablePasses,
          infieldCrosses: rawTel.infieldCrosses,
          backboardClears: rawTel.backboardClears,
          counterPressRecoveries: rawTel.counterPressRecoveries,
          reflexSaves: rawTel.reflexSaves,
          aerialGoals: rawTel.aerialGoals,
          flipResets: rawTel.flipResets,
          smallPads: rawTel.smallPads,
          bigOrbs: rawTel.bigOrbs,
          padRatioPct: careerPadRatio,
          boostSteals: rawTel.boostSteals,
        });

  const totalAllTouches = Math.max(1, totalDefTouches + totalMidTouches + totalAttTouches);
  const touchDistribution = {
    defence_pct: Math.round((totalDefTouches / totalAllTouches) * 100),
    midfield_pct: Math.round((totalMidTouches / totalAllTouches) * 100),
    attack_pct: Math.round((totalAttTouches / totalAllTouches) * 100),
  };

  const gpg = Math.round((totalGoals / n) * 100) / 100;
  const spg = Math.round((totalShots / n) * 100) / 100;
  const conversionPct = totalShots > 0 ? Math.round((totalGoals / totalShots) * 1000) / 10 : 0;
  const apg = Math.round((totalAssists / n) * 100) / 100;
  const savesPerGame = Math.round((totalSaves / n) * 100) / 100;
  const dpg = Math.round((totalDemos / n) * 100) / 100;
  const aerialsPerGame = Math.round((totalAerials / n) * 100) / 100;
  const avgBoost = totalCarMs > 0 ? Math.round((totalBoostWeighted / totalCarMs) * 10) / 10 : 50;
  const supersonicPct = totalCarMs > 0 ? Math.round((totalSupersonicMs / totalCarMs) * 1000) / 10 : 0;
  const emptyBoostPct = totalCarMs > 0 ? Math.round((totalEmptyBoostMs / totalCarMs) * 1000) / 10 : 0;

  // Playlists stats
  const playlists: PlaylistStats[] = Array.from(playlistMap.entries())
    .map(([pId, pl]) => {
      const pWins = pl.wins;
      const pLosses = pl.matches - pWins;
      const pWinRate = Math.round((pWins / pl.matches) * 1000) / 10;
      const pAvgRating = Math.round((pl.ratings.reduce((a, b) => a + b, 0) / pl.matches) * 10) / 10;
      const pGpg = Math.round((pl.goals / pl.matches) * 100) / 100;
      return {
        playlist_id: pId,
        playlist_name: getPlaylistName(pId),
        matches: pl.matches,
        wins: pWins,
        losses: pLosses,
        win_rate: pWinRate,
        avg_rating: pAvgRating,
        goals_per_game: pGpg,
      };
    })
    .sort((a, b) => b.matches - a.matches);

  // Dynamic Strengths & Improvements
  const strengths: string[] = [];
  if (conversionPct >= 35) {
    strengths.push(
      `Lethal Striking Efficiency: Converting ${conversionPct}% of shots on target with ${gpg} goals per match.`
    );
  } else if (gpg >= 1.2) {
    strengths.push(`Prolific Scoring: Averages ${gpg} goals per match over ${n} games.`);
  }

  if (savesPerGame >= 0.8) {
    strengths.push(
      `Rock-Solid Goal Protection: Averaging ${savesPerGame} saves per game (${totalSaves} career saves) with high goalmouth command.`
    );
  }

  if (maxShotKmh >= 115) {
    strengths.push(
      `Devastating Velocity: All-time hardest strike clocked at ${Math.round(maxShotKmh)} km/h.`
    );
  }

  if (dpg >= 0.6) {
    strengths.push(
      `Physical Disruptor: Averages ${dpg} demos per match, consistently displacing defenders from rotations.`
    );
  }

  if (strengths.length < 3 && avgBoost >= 52) {
    strengths.push(
      `Resource Discipline: Maintains an average boost storage of ${avgBoost}, ensuring constant challenge readiness.`
    );
  }

  const improvements: string[] = [];
  if (emptyBoostPct >= 8.0) {
    improvements.push(
      `Boost Starvation Vulnerability: You spend ${emptyBoostPct}% of match time on 0 boost. Focus on pathing through small boost pad lines on recovery rather than detouring for 100-orbs.`
    );
  }

  if (supersonicPct < 14.0) {
    improvements.push(
      `Momentum & Recovery Speed: Only ${supersonicPct}% of playtime is spent supersonic. Incorporate speed flips and wave dashes off walls to maintain pace without expending boost.`
    );
  }

  if (apg < 0.6 && gpg >= 1.2) {
    improvements.push(
      `Distribution & Playmaking: With ${gpg} goals vs ${apg} assists per match, expanding infield passing options will counter defensive double-teams.`
    );
  }

  if (touchDistribution.defence_pct >= 45) {
    improvements.push(
      `Deep Defensive Pinning: ${touchDistribution.defence_pct}% of your touches happen in the defensive third. Challenge earlier in midfield to maintain offensive pressure.`
    );
  }

  const fifaCard = buildPlayerFifaCard({
    reader,
    primaryId: resolvedPrimaryId,
    playerName,
    cache,
    analyzer,
  });

  return {
    player_key: rows[0].player_key,
    primary_id: resolvedPrimaryId,
    name: playerName,
    is_user: isUser,
    total_matches: n,
    wins,
    losses,
    win_rate: winRate,
    total_playtime_minutes: totalPlaytimeMinutes,
    overtime_matches: totalOvertime,
    career_rating: careerRating,
    highest_rating: highestRating,
    lowest_rating: lowestRating,
    radar,
    fifa_card: fifaCard ?? undefined,
    attributes: {
      total_goals: totalGoals,
      goals_per_game: gpg,
      total_shots: totalShots,
      shots_per_game: spg,
      shot_conversion_pct: conversionPct,
      hardest_shot_kmh: Math.round(maxShotKmh * 10) / 10,
      total_woodwork_hits: totalWoodwork,
      total_assists: totalAssists,
      assists_per_game: apg,
      total_saves: totalSaves,
      saves_per_game: savesPerGame,
      total_demos: totalDemos,
      demos_per_game: dpg,
      total_aerial_touches: totalAerials,
      aerials_per_game: aerialsPerGame,
      avg_boost: avgBoost,
      supersonic_pct: supersonicPct,
      empty_boost_pct: emptyBoostPct,
      touch_distribution: touchDistribution,
    },
    playlists,
    recent_matches: recentMatches,
    strengths,
    improvements,
  };
}

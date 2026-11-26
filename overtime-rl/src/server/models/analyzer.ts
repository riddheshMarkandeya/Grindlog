import type {
  MatchAnalysisResult,
  MatchPlayerAnalysis,
  ShotMapItem,
  MomentumEvent,
  PlayerCoachReport,
  DoubleCommitEvent,
} from '../../shared/types.ts';
import { calculateXG, calculateClinicality } from './xg.ts';
import { calculatePlayerRating } from './rating.ts';
import { calculateMomentumWave } from './momentum.ts';
import type { HitRecord } from './momentum.ts';
import { calculatePlayerRadar } from './radar.ts';
import { generateCoachReport } from './coach.ts';
import { groupMicroTouches, isSimultaneous50 } from './possession.ts';
import type { RawBallHit } from './possession.ts';
import { extractFifaPlayMetrics, evaluateConcededGoalChains } from './fifa-telemetry.ts';
import {
  evaluatePassDelivery,
  evaluate5sWinBack,
  evaluateReboundWaiver,
  evaluateDefensiveRewind,
  evaluateDoubleCommitLiability,
  evaluateBackPostRotation,
  evaluateShadowDefense,
  evaluateRecklessDive,
  evaluateKickoffSupport,
  evaluateBackboardDefense,
  evaluateInfieldCross,
  type PlayerSpatialState,
} from './causal-evaluator.ts';
import { GrindlogReader } from '../ingestion/grindlog-reader.ts';
import type { TrackerMatch, TrackerMatchPlayer, TrackerMatchGoal, RawEventRecord } from '../ingestion/grindlog-reader.ts';
import { OvertimeDBCache } from '../db/cache.ts';

export const ENGINE_VERSION = 7;

export class MatchAnalyzer {
  private reader: GrindlogReader;
  private cache: OvertimeDBCache;

  constructor(reader?: GrindlogReader, cache?: OvertimeDBCache) {
    this.reader = reader || new GrindlogReader();
    this.cache = cache || new OvertimeDBCache();
  }

  public analyzeMatch(guid: string, forceRecompute: boolean = false): MatchAnalysisResult | null {
    if (!forceRecompute) {
      const cached = this.cache.getMatch(guid);
      if (cached && cached.engine_version === ENGINE_VERSION) {
        // Self-heal user_team_num and awards if old cache
        if (cached.user_team_num === undefined || cached.user_team_num === null) {
          const userP = cached.players.find(p => p.is_user || p.name === 'Swapo_o');
          if (userP) {
            cached.user_team_num = userP.team_num;
            userP.is_user = true;
            this.cache.saveMatch(cached);
          }
        }
        return cached;
      }
    }

    const match = this.reader.getMatch(guid);
    if (!match) return null;

    const players = this.reader.getMatchPlayers(guid);
    const goals = this.reader.getMatchGoals(guid);
    const rawEvents = this.reader.getSurgicalRawEvents(guid);
    const primaryUser = this.reader.getPrimaryUser();
    const myPlayerIds = this.reader.getMyPlayerIds();

    // 1. Process Shots, xG, and Double Commits
    const {
      shots,
      playerShotsMap,
      keyPassesMap,
      bigChancesCreatedMap,
      favorablePassesMap,
      hospitalPassesMap,
      hockeyAssistsMap,
      failedSlotRecoveriesMap,
      duelsMap,
      turnoverConcessionMap,
      doubleCommitsList,
      playerDoubleCommitsMap,
      coveredDoubleCommitsMap,
      netRushDoubleCommitsMap,
      thirdManCoversMap,
      playerFatalDoubleCommitsMap,
      tailingOvercommitsMap,
      tacticalDemosMap,
      screamersMap,
      tapInsMap,
      soloGoalsMap,
      counterGoalsMap,
      reflexSavesMap,
      routineSavesMap,
      reboundInstantClearsMap,
      spilledReboundsMap,
      boostAbandonmentsMap,
      spectatorConcessionsMap,
      honestEffortsMap,
      fastBreakImmunitiesMap,
      counterPressRecoveriesMap,
      backPostRotationsMap,
      nearPostTrapsMap,
      shadowDefensesMap,
      recklessDivesMap,
      waivedRecklessDivesMap,
      smallPadDisciplinesMap,
      cornerBoostDesertionsMap,
      kickoffCheatUpsMap,
      doubleCornerDesertionsMap,
      backboardClearsMap,
      backboardHesitationsMap,
      infieldCrossesMap,
      cornerRollGiveawaysMap,
      demoEvasionsMap,
      goalLineScramblesMap,
      aerialGoalsMap,
      flipResetsMap,
      playerSmallPadsMap,
      playerBigOrbsMap,
      playerBoostStealsMap,
      clutchMultiplier,
      garbageTimeMultiplier,
      hits,
      momentumEvents,
      debouncedHits,
      roundStartedTimes,
      resolvedGoalsList,
      fifaMetricsMap,
    } = this.processRawEvents(match, players, goals, rawEvents);

    // 2. Team metrics
    const team0Players = players.filter(p => p.team_num === 0);
    const team1Players = players.filter(p => p.team_num === 1);

    const team0Goals = match.score_team0;
    const team1Goals = match.score_team1;
    const winnerTeamNum = match.winner_team_num;

    // 3. Process Player Ratings & Radars
    const analyzedPlayers: MatchPlayerAnalysis[] = players.map(p => {
      const pShots = playerShotsMap.get(p.name) || [];
      const shotXGs = pShots.map(s => ({ xg: s.xg, isGoal: s.outcome === 'goal' }));
      const totalXG = shotXGs.reduce((acc, s) => acc + s.xg, 0);

      const isWin = winnerTeamNum !== null && p.team_num === winnerTeamNum;
      const goalsConceded = p.team_num === 0 ? team1Goals : team0Goals;
      const cleanSheet = isWin && goalsConceded === 0;

      const pBigChances = pShots.filter(s => s.is_big_chance).length;
      const pBigChancesMissed = pShots.filter(s => s.is_big_chance && s.outcome !== 'goal').length;
      const pKeyPasses = keyPassesMap.get(p.name) || 0;
      const pBCC = bigChancesCreatedMap.get(p.name) || 0;
      const fifa = fifaMetricsMap.get(p.name);
      const pDuelsWon = fifa ? fifa.duelsWon : (duelsMap.get(p.name) || 0);
      const pTurnoverConcessions = turnoverConcessionMap.get(p.name) || 0;

      const ratingResult = calculatePlayerRating({
        goals: p.goals,
        assists: p.assists,
        saves: p.saves,
        shots: p.shots,
        demos: p.demos,
        ownGoals: 0,
        isWin,
        isOvertime: Boolean(match.overtime),
        goalsConceded,
        cleanSheet,
        keyPasses: pKeyPasses,
        bigChancesCreated: pBCC,
        bigChancesMissed: pBigChancesMissed,
        clearances: Math.round((p.touches_defence || 0) * 0.4),
        duelsWon: pDuelsWon,
        hardestShotKmh: p.hardest_shot_kmh,
        carMs: p.car_ms || 300000,
        supersonicMs: p.supersonic_ms || 0,
        emptyBoostMs: p.empty_boost_ms || 0,
        turnoverConcessions: pTurnoverConcessions,
        doubleCommits: playerDoubleCommitsMap.get(p.name) || 0,
        coveredDoubleCommits: coveredDoubleCommitsMap.get(p.name) || 0,
        netRushDoubleCommits: netRushDoubleCommitsMap.get(p.name) || 0,
        thirdManCovers: thirdManCoversMap.get(p.name) || 0,
        fatalDoubleCommits: playerFatalDoubleCommitsMap.get(p.name) || 0,
        tailingOvercommits: tailingOvercommitsMap.get(p.name) || 0,
        favorablePasses: favorablePassesMap.get(p.name) || 0,
        hospitalPasses: hospitalPassesMap.get(p.name) || 0,
        hockeyAssists: hockeyAssistsMap.get(p.name) || 0,
        tacticalDemos: tacticalDemosMap.get(p.name) || 0,
        screamers: screamersMap.get(p.name) || 0,
        tapIns: tapInsMap.get(p.name) || 0,
        soloGoals: soloGoalsMap.get(p.name) || 0,
        counterGoals: counterGoalsMap.get(p.name) || 0,
        reflexSaves: reflexSavesMap.get(p.name) || 0,
        routineSaves: routineSavesMap.get(p.name) || 0,
        reboundInstantClears: reboundInstantClearsMap.get(p.name) || 0,
        spilledRebounds: spilledReboundsMap.get(p.name) || 0,
        boostAbandonments: boostAbandonmentsMap.get(p.name) || 0,
        failedSlotRecoveries: failedSlotRecoveriesMap.get(p.name) || 0,
        spectatorConcessions: spectatorConcessionsMap.get(p.name) || 0,
        honestEfforts: honestEffortsMap.get(p.name) || 0,
        fastBreakImmunities: fastBreakImmunitiesMap.get(p.name) || 0,
        counterPressRecoveries: counterPressRecoveriesMap.get(p.name) || 0,
        backPostRotations: backPostRotationsMap.get(p.name) || 0,
        nearPostTraps: nearPostTrapsMap.get(p.name) || 0,
        shadowDefenses: shadowDefensesMap.get(p.name) || 0,
        recklessDives: recklessDivesMap.get(p.name) || 0,
        waivedRecklessDives: waivedRecklessDivesMap.get(p.name) || 0,
        smallPadDisciplines: smallPadDisciplinesMap.get(p.name) || 0,
        cornerBoostDesertions: cornerBoostDesertionsMap.get(p.name) || 0,
        kickoffCheatUps: kickoffCheatUpsMap.get(p.name) || 0,
        doubleCornerDesertions: doubleCornerDesertionsMap.get(p.name) || 0,
        backboardClears: backboardClearsMap.get(p.name) || 0,
        backboardHesitations: backboardHesitationsMap.get(p.name) || 0,
        infieldCrosses: infieldCrossesMap.get(p.name) || 0,
        cornerRollGiveaways: cornerRollGiveawaysMap.get(p.name) || 0,
        demoEvasions: demoEvasionsMap.get(p.name) || 0,
        goalLineScrambles: goalLineScramblesMap.get(p.name) || 0,
        boostSteals: playerBoostStealsMap.get(p.name) || 0,
        clutchMultiplier,
        garbageTimeMultiplier,
        shotXGs,
      });

      const smallPads = playerSmallPadsMap.get(p.name) || 0;
      const bigOrbs = playerBigOrbsMap.get(p.name) || 0;
      const boostSteals = playerBoostStealsMap.get(p.name) || 0;
      const padRatioPct = Math.round((smallPads / Math.max(1, smallPads + bigOrbs)) * 100);

      const radar = calculatePlayerRadar({
        goals: p.goals,
        shots: p.shots,
        assists: p.assists,
        saves: p.saves,
        demos: p.demos,
        clearances: Math.round((p.touches_defence || 0) * 0.4),
        keyPasses: pKeyPasses,
        duelsWon: pDuelsWon,
        touchesDefence: p.touches_defence || 0,
        touchesMidfield: p.touches_midfield || 0,
        touchesAttack: p.touches_attack || 0,
        touchesTotal: p.touches || 1,
        carMs: p.car_ms || 300000,
        supersonicMs: p.supersonic_ms || 0,
        boostAvg: p.boost_avg,
        emptyBoostMs: p.empty_boost_ms || 0,
        xg: totalXG,
        aerialTouches: p.aerial_touches || 0,
        aerialGoals: aerialGoalsMap.get(p.name) || 0,
        flipResets: flipResetsMap.get(p.name) || 0,
        doubleCommits: playerDoubleCommitsMap.get(p.name) || 0,
        coveredDoubleCommits: coveredDoubleCommitsMap.get(p.name) || 0,
        netRushDoubleCommits: netRushDoubleCommitsMap.get(p.name) || 0,
        thirdManCovers: thirdManCoversMap.get(p.name) || 0,
        dribbleChains: fifa?.dribbleChains ?? 0,
        dribbleTakeOns: fifa?.dribbleTakeOns ?? 0,
        dribbleGoals: fifa?.dribbleGoals ?? 0,
        dribbleTurnovers: fifa?.dribbleTurnovers ?? 0,
        cleanDispossessions: fifa?.cleanDispossessions ?? 0,
        paceSprints: fifa?.paceSprints ?? 0,
        avgTransitionVelocity: fifa?.avgTransitionVelocity ?? 0,
        blitzCounterGoals: fifa?.blitzCounterGoals ?? 0,
        xgPrevented: fifa?.xgPrevented ?? 0,
        // Wire full tactical & causal rules into attributes
        screamers: screamersMap.get(p.name) || 0,
        soloGoals: soloGoalsMap.get(p.name) || 0,
        counterGoals: counterGoalsMap.get(p.name) || 0,
        bigChancesMissed: pBigChancesMissed,
        hardestShotKmh: p.hardest_shot_kmh,
        bigChancesCreated: pBCC,
        favorablePasses: favorablePassesMap.get(p.name) || 0,
        infieldCrosses: infieldCrossesMap.get(p.name) || 0,
        hockeyAssists: hockeyAssistsMap.get(p.name) || 0,
        hospitalPasses: hospitalPassesMap.get(p.name) || 0,
        cornerRollGiveaways: cornerRollGiveawaysMap.get(p.name) || 0,
        reflexSaves: reflexSavesMap.get(p.name) || 0,
        reboundInstantClears: reboundInstantClearsMap.get(p.name) || 0,
        spilledRebounds: spilledReboundsMap.get(p.name) || 0,
        shadowDefenses: shadowDefensesMap.get(p.name) || 0,
        backPostRotations: backPostRotationsMap.get(p.name) || 0,
        backboardClears: backboardClearsMap.get(p.name) || 0,
        goalLineScrambles: goalLineScramblesMap.get(p.name) || 0,
        counterPressRecoveries: counterPressRecoveriesMap.get(p.name) || 0,
        turnoverConcessions: pTurnoverConcessions,
        tacticalDemos: tacticalDemosMap.get(p.name) || 0,
        smallPads,
        bigOrbs,
        padRatioPct,
        boostSteals,
        boostAbandonments: boostAbandonmentsMap.get(p.name) || 0,
        cornerBoostDesertions: cornerBoostDesertionsMap.get(p.name) || 0,
        fatalDoubleCommits: playerFatalDoubleCommitsMap.get(p.name) || 0,
        nearPostTraps: nearPostTrapsMap.get(p.name) || 0,
        recklessDives: recklessDivesMap.get(p.name) || 0,
        kickoffCheatUps: kickoffCheatUpsMap.get(p.name) || 0,
        doubleCornerDesertions: doubleCornerDesertionsMap.get(p.name) || 0,
      });

      const playMs = Math.max(1, p.car_ms || 300000);
      const supersonicPct = Math.round(((p.supersonic_ms || 0) / playMs) * 100);
      const emptyBoostPct = Math.round(((p.empty_boost_ms || 0) / playMs) * 100);
      const supersonicSeconds = Math.round((p.supersonic_ms || 0) / 1000);
      const emptyBoostSeconds = Math.round((p.empty_boost_ms || 0) / 1000);

      const tDef = p.touches_defence || 0;
      const tMid = p.touches_midfield || 0;
      const tAtt = p.touches_attack || 0;
      const tSum = Math.max(1, tDef + tMid + tAtt);
      const touchDist = {
        defence_pct: Math.round((tDef / tSum) * 100),
        midfield_pct: Math.round((tMid / tSum) * 100),
        attack_pct: Math.round((tAtt / tSum) * 100),
      };

      const shotConversionPct = p.shots > 0 ? Math.round((p.goals / p.shots) * 100) : 0;
      const isUser =
        myPlayerIds.has(p.primary_id) ||
        (primaryUser && (p.primary_id === primaryUser.primary_id || p.name === primaryUser.name)) ||
        p.name === 'Swapo_o' ||
        p.primary_id === match.camera_primary_id;

      return {
        player_key: p.player_key,
        primary_id: p.primary_id,
        name: p.name,
        team_num: p.team_num,
        is_bot: Boolean(p.is_bot),
        is_user: isUser,
        score: p.score,
        goals: p.goals,
        shots: p.shots,
        assists: p.assists,
        saves: p.saves,
        touches: p.touches,
        demos: p.demos,
        rating: ratingResult.score,
        rating_factors: ratingResult.factors,
        xg: Math.round(totalXG * 100) / 100,
        xg_diff: calculateClinicality(p.goals, totalXG),
        big_chances: pBigChances,
        big_chances_missed: pBigChancesMissed,
        big_chances_created: pBCC,
        key_passes: pKeyPasses,
        hardest_shot_kmh: p.hardest_shot_kmh,
        boost_avg: p.boost_avg,
        supersonic_pct: supersonicPct,
        empty_boost_pct: emptyBoostPct,
        supersonic_seconds: supersonicSeconds,
        empty_boost_seconds: emptyBoostSeconds,
        touches_defence: tDef,
        touches_midfield: tMid,
        touches_attack: tAtt,
        touch_distribution: touchDist,
        aerial_touches: p.aerial_touches || 0,
        woodwork_hits: p.woodwork_hits || 0,
        clearances: Math.round((p.touches_defence || 0) * 0.4),
        shot_conversion_pct: shotConversionPct,
        double_commits: playerDoubleCommitsMap.get(p.name) || 0,
        fatal_double_commits: playerFatalDoubleCommitsMap.get(p.name) || 0,
        turnover_concessions: pTurnoverConcessions,
        errors_leading_to_goal: pTurnoverConcessions + (tailingOvercommitsMap.get(p.name) || 0),
        small_pads: smallPads,
        big_orbs: bigOrbs,
        boost_steals: boostSteals,
        pad_ratio_pct: padRatioPct,
        tactical_metrics: {
          duels_won: pDuelsWon,
          favorable_passes: favorablePassesMap.get(p.name) || 0,
          infield_crosses: infieldCrossesMap.get(p.name) || 0,
          hockey_assists: hockeyAssistsMap.get(p.name) || 0,
          hospital_passes: hospitalPassesMap.get(p.name) || 0,
          corner_roll_giveaways: cornerRollGiveawaysMap.get(p.name) || 0,
          screamers: screamersMap.get(p.name) || 0,
          solo_goals: soloGoalsMap.get(p.name) || 0,
          counter_goals: counterGoalsMap.get(p.name) || 0,
          reflex_saves: reflexSavesMap.get(p.name) || 0,
          rebound_instant_clears: reboundInstantClearsMap.get(p.name) || 0,
          spilled_rebounds: spilledReboundsMap.get(p.name) || 0,
          shadow_defenses: shadowDefensesMap.get(p.name) || 0,
          back_post_rotations: backPostRotationsMap.get(p.name) || 0,
          backboard_clears: backboardClearsMap.get(p.name) || 0,
          goal_line_scrambles: goalLineScramblesMap.get(p.name) || 0,
          counter_press_recoveries: counterPressRecoveriesMap.get(p.name) || 0,
          tactical_demos: tacticalDemosMap.get(p.name) || 0,
          boost_abandonments: boostAbandonmentsMap.get(p.name) || 0,
          corner_boost_desertions: cornerBoostDesertionsMap.get(p.name) || 0,
          near_post_traps: nearPostTrapsMap.get(p.name) || 0,
          reckless_dives: recklessDivesMap.get(p.name) || 0,
          kickoff_cheat_ups: kickoffCheatUpsMap.get(p.name) || 0,
          double_corner_desertions: doubleCornerDesertionsMap.get(p.name) || 0,
          aerial_goals: aerialGoalsMap.get(p.name) || 0,
          flip_resets: flipResetsMap.get(p.name) || 0,
          covered_double_commits: coveredDoubleCommitsMap.get(p.name) || 0,
          net_rush_double_commits: netRushDoubleCommitsMap.get(p.name) || 0,
          third_man_covers: thirdManCoversMap.get(p.name) || 0,
          dribble_chains: Math.round((fifa?.dribbleChains ?? 0) * 100) / 100,
          dribble_take_ons: fifa?.dribbleTakeOns ?? 0,
          dribble_goals: fifa?.dribbleGoals ?? 0,
          dribble_turnovers: fifa?.dribbleTurnovers ?? 0,
          clean_dispossessions: fifa?.cleanDispossessions ?? 0,
          pace_sprints: fifa?.paceSprints ?? 0,
          avg_transition_velocity: fifa?.avgTransitionVelocity ?? 0,
          blitz_counter_goals: fifa?.blitzCounterGoals ?? 0,
          xg_prevented: Math.round((fifa?.xgPrevented ?? 0) * 100) / 100,
        },
        radar,
      };
    });

    // 4. Calculate Team Aggregates
    const t0Analyzed = analyzedPlayers.filter(p => p.team_num === 0);
    const t1Analyzed = analyzedPlayers.filter(p => p.team_num === 1);

    const team0Rating = t0Analyzed.length > 0
      ? Math.round((t0Analyzed.reduce((acc, p) => acc + p.rating, 0) / t0Analyzed.length) * 10) / 10
      : 6.0;
    const team1Rating = t1Analyzed.length > 0
      ? Math.round((t1Analyzed.reduce((acc, p) => acc + p.rating, 0) / t1Analyzed.length) * 10) / 10
      : 6.0;

    const team0XG = Math.round(t0Analyzed.reduce((acc, p) => acc + p.xg, 0) * 100) / 100;
    const team1XG = Math.round(t1Analyzed.reduce((acc, p) => acc + p.xg, 0) * 100) / 100;

    // 5. Calculate Momentum Wave
    const durationSeconds = Math.max(300, Math.round((match.ended_at - match.started_at) / 1000));
    const momentum = calculateMomentumWave(match.started_at, durationSeconds, hits, momentumEvents);

    // 6. Awards
    let playerOfTheMatch: string | null = null;
    let theSniper: string | null = null;
    let theIronWall: string | null = null;
    let crossbarMagnet: string | null = null;
    let theEnforcer: string | null = null;
    let speedDemon: string | null = null;
    let thePlaymaker: string | null = null;
    let theBoostGoblin: string | null = null;
    let airMarshal: string | null = null;
    let doubleTrouble: string | null = null;

    if (analyzedPlayers.length > 0) {
      const sortedByRating = [...analyzedPlayers].sort((a, b) => b.rating - a.rating);
      playerOfTheMatch = sortedByRating[0]?.name || null;

      const sortedByClinicality = [...analyzedPlayers].filter(p => p.goals > 0).sort((a, b) => b.xg_diff - a.xg_diff);
      theSniper = sortedByClinicality[0]?.name || null;

      const sortedByDefense = [...analyzedPlayers].sort((a, b) => (b.saves * 2 + b.touches) - (a.saves * 2 + a.touches));
      theIronWall = sortedByDefense[0]?.name || null;

      const woodworkList = players.filter(p => (p.woodwork_hits || 0) > 0).sort((a, b) => (b.woodwork_hits || 0) - (a.woodwork_hits || 0));
      crossbarMagnet = woodworkList[0]?.name || null;

      const sortedByDemos = [...analyzedPlayers].filter(p => p.demos >= 2).sort((a, b) => b.demos - a.demos);
      theEnforcer = sortedByDemos[0] ? `${sortedByDemos[0].name} (${sortedByDemos[0].demos} Demos)` : null;

      const sortedByPace = [...analyzedPlayers].filter(p => p.supersonic_pct >= 14).sort((a, b) => b.supersonic_pct - a.supersonic_pct);
      speedDemon = sortedByPace[0] ? `${sortedByPace[0].name} (${sortedByPace[0].supersonic_pct}% Supersonic)` : null;

      const sortedByPlaymaking = [...analyzedPlayers].filter(p => p.assists + p.big_chances_created >= 2).sort((a, b) => (b.assists * 2 + b.big_chances_created) - (a.assists * 2 + a.big_chances_created));
      thePlaymaker = sortedByPlaymaking[0] ? `${sortedByPlaymaking[0].name} (${sortedByPlaymaking[0].assists}A, ${sortedByPlaymaking[0].big_chances_created} BCC)` : null;

      const sortedByBoost = [...analyzedPlayers].filter(p => (p.boost_avg || 0) >= 58).sort((a, b) => (b.boost_avg || 0) - (a.boost_avg || 0));
      theBoostGoblin = sortedByBoost[0] ? `${sortedByBoost[0].name} (${Math.round(sortedByBoost[0].boost_avg || 0)} Boost Avg)` : null;

      const sortedByAerials = [...analyzedPlayers].filter(p => p.aerial_touches >= 3).sort((a, b) => b.aerial_touches - a.aerial_touches);
      airMarshal = sortedByAerials[0] ? `${sortedByAerials[0].name} (${sortedByAerials[0].aerial_touches} Aerials)` : null;

      if (doubleCommitsList.length >= 2) {
        const pairCounts = new Map<string, number>();
        for (const dc of doubleCommitsList) {
          const key = [dc.player1_name, dc.player2_name].sort().join(' & ');
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
        let topPair = '';
        let maxDc = 0;
        for (const [pair, cnt] of pairCounts.entries()) {
          if (cnt > maxDc) {
            maxDc = cnt;
            topPair = pair;
          }
        }
        if (maxDc >= 2) {
          doubleTrouble = `${topPair} (${maxDc} Double Commits)`;
        }
      }
    }

    // 7. Generate User Diagnostic & Coach Report
    const userPlayer = analyzedPlayers.find(p => p.is_user) || null;
    const effectiveRoundStarts =
      roundStartedTimes.length > 0
        ? roundStartedTimes
        : [match.started_at, ...resolvedGoalsList.map(g => g.ts + 4500)];
    const concededGoalChains = evaluateConcededGoalChains({
      goals: resolvedGoalsList,
      shots,
      doubleCommits: doubleCommitsList,
      debouncedHits,
      roundStartedTimes: effectiveRoundStarts,
      matchStartedAt: match.started_at,
      userTeamNum: userPlayer ? userPlayer.team_num : null,
    });

    const result: MatchAnalysisResult = {
      guid: match.guid,
      started_at: match.started_at,
      ended_at: match.ended_at,
      playlist_id: match.playlist_id,
      arena: match.arena,
      overtime: Boolean(match.overtime),
      score_team0: match.score_team0,
      score_team1: match.score_team1,
      winner_team_num: match.winner_team_num,
      user_team_num: userPlayer ? userPlayer.team_num : null,
      mvp_key: match.mvp_key,
      team0_rating: team0Rating,
      team1_rating: team1Rating,
      team0_xg: team0XG,
      team1_xg: team1XG,
      players: analyzedPlayers,
      shots,
      momentum,
      double_commits: doubleCommitsList,
      conceded_goal_chains: concededGoalChains,
      user_coach_report: null,
      awards: {
        player_of_the_match: playerOfTheMatch,
        the_sniper: theSniper,
        the_iron_wall: theIronWall,
        crossbar_magnet: crossbarMagnet,
        the_enforcer: theEnforcer,
        speed_demon: speedDemon,
        the_playmaker: thePlaymaker,
        the_boost_goblin: theBoostGoblin,
        air_marshal: airMarshal,
        double_trouble: doubleTrouble,
      },
      computed_at: Date.now(),
      engine_version: ENGINE_VERSION,
    };

    if (userPlayer) {
      result.user_coach_report = generateCoachReport(userPlayer, result);
    }

    // Cache computed result
    this.cache.saveMatch(result);
    return result;
  }

  private processRawEvents(
    match: TrackerMatch,
    players: TrackerMatchPlayer[],
    goals: TrackerMatchGoal[],
    rawEvents: RawEventRecord[]
  ) {
    const shots: ShotMapItem[] = [];
    const playerShotsMap = new Map<string, ShotMapItem[]>();
    const keyPassesMap = new Map<string, number>();
    const bigChancesCreatedMap = new Map<string, number>();
    const duelsMap = new Map<string, number>();
    const turnoverConcessionMap = new Map<string, number>();
    const hits: HitRecord[] = [];
    const momentumEvents: MomentumEvent[] = [];

    const playerTeamMap = new Map<string, number>();
    const playerKeyMap = new Map<string, string>();
    for (const p of players) {
      playerTeamMap.set(p.name, p.team_num);
      playerKeyMap.set(p.name, p.player_key);
    }

    // 1. Process BallHit, BoostPickup & Spatial Timeline
    const rawHits: RawBallHit[] = [];
    const ballHits: Array<{ seq: number; ts: number; name: string; x: number; y: number; z: number; speed: number; teamNum: number }> = [];
    const playerSmallPadsMap = new Map<string, number>();
    const playerBigOrbsMap = new Map<string, number>();
    const playerBoostStealsMap = new Map<string, number>();
    const boostPickupsList: Array<{ ts: number; playerName: string; teamNum: number; x: number; y: number; z: number; boostType: string }> = [];

    type SpatialSample = { ts: number; x: number; y: number; z: number; speed: number };
    const playerPosTimeline = new Map<string, SpatialSample[]>();
    const pushSpatial = (name: string, sample: SpatialSample) => {
      let arr = playerPosTimeline.get(name);
      if (!arr) {
        arr = [];
        playerPosTimeline.set(name, arr);
      }
      arr.push(sample);
    };

    const roundStartedTimes: number[] = [];
    const rawStatGoalEvents: Array<{ ts: number; teamNum: number; scorerName?: string }> = [];

    for (const ev of rawEvents) {
      if (ev.name === 'BallHit') {
        const playerName = ev.data.Players?.[0]?.Name;
        if (!playerName) continue;
        const teamNum = ev.data.Players?.[0]?.TeamNum ?? playerTeamMap.get(playerName) ?? 0;
        const loc = ev.data.Ball?.Location || { X: 0, Y: 0, Z: 0 };
        const postSpeed = ev.data.Ball?.PostHitSpeed || 0;
        const preSpeed = ev.data.Ball?.PreHitSpeed || 0;

        rawHits.push({
          seq: ev.seq,
          ts: ev.ts,
          player_name: playerName,
          team_num: teamNum,
          pre_speed: preSpeed,
          post_speed: postSpeed,
          x: loc.X,
          y: loc.Y,
          z: loc.Z,
        });

        ballHits.push({
          seq: ev.seq,
          ts: ev.ts,
          name: playerName,
          x: loc.X,
          y: loc.Y,
          z: loc.Z,
          speed: postSpeed,
          teamNum,
        });

        hits.push({
          ts: ev.ts,
          y: loc.Y,
          teamNum,
        });

        const existingSamples = playerPosTimeline.get(playerName);
        const prevSample = existingSamples?.[existingSamples.length - 1];
        let estSpeed = Math.max(450, Math.min(2300, postSpeed * 27.78));
        if (prevSample && ev.ts - prevSample.ts >= 100 && ev.ts - prevSample.ts <= 2500) {
          const dtSec = (ev.ts - prevSample.ts) / 1000;
          const dist = Math.hypot(loc.X - prevSample.x, loc.Y - prevSample.y);
          estSpeed = Math.max(250, Math.min(2300, dist / dtSec));
        }
        pushSpatial(playerName, { ts: ev.ts, x: loc.X, y: loc.Y, z: loc.Z, speed: estSpeed });
      } else if (ev.name === 'RoundStarted') {
        roundStartedTimes.push(ev.ts);
      } else if (ev.name === 'CrossbarHit') {
        momentumEvents.push({
          type: 'woodwork',
          team: 0,
          text: 'Crossbar / Woodwork Hit',
          ts: ev.ts,
        });
      } else if (ev.name === 'GoalScored') {
        const scorer = ev.data.Scorer?.Name || 'Goal';
        const teamNum = ev.data.Scorer?.TeamNum ?? 0;
        momentumEvents.push({
          type: 'goal',
          team: teamNum,
          text: `Goal by ${scorer}`,
          ts: ev.ts,
        });
      } else if (ev.name === 'StatfeedEvent') {
        const evtName = ev.data.EventName;
        const target = ev.data.MainTarget?.Name;
        const teamNum = ev.data.MainTarget?.TeamNum ?? 0;

        if (evtName === 'Goal') {
          rawStatGoalEvents.push({ ts: ev.ts, teamNum, scorerName: target });
        } else if (evtName === 'Demolish' || evtName === 'Demolition') {
          momentumEvents.push({
            type: 'demo',
            team: teamNum,
            text: `${target} Demolition`,
            ts: ev.ts,
          });
        } else if (evtName === 'Save' || evtName === 'EpicSave' || evtName === 'Epic Save') {
          momentumEvents.push({
            type: 'save',
            team: teamNum,
            text: `${evtName === 'EpicSave' ? 'Epic Save' : evtName} by ${target}`,
            ts: ev.ts,
          });
        }
      } else if (ev.name === 'BoostPickup') {
        const pName = ev.data.Player?.Name;
        const teamNum = ev.data.Player?.TeamNum ?? playerTeamMap.get(pName) ?? 0;
        const bType = ev.data.BoostType;
        const loc = ev.data.Location || { X: 0, Y: 0, Z: 0 };
        if (pName) {
          boostPickupsList.push({ ts: ev.ts, playerName: pName, teamNum, x: loc.X, y: loc.Y, z: loc.Z, boostType: bType });
          pushSpatial(pName, { ts: ev.ts, x: loc.X, y: loc.Y, z: loc.Z, speed: 1550 });
          if (bType === 'BoostType_Pad') {
            playerSmallPadsMap.set(pName, (playerSmallPadsMap.get(pName) || 0) + 1);
          } else if (bType === 'BoostType_Pill') {
            playerBigOrbsMap.set(pName, (playerBigOrbsMap.get(pName) || 0) + 1);
            // Check for opponent corner boost steal
            const isOppCorner =
              (teamNum === 0 && loc.Y > 2500 && Math.abs(loc.X) > 2400) ||
              (teamNum === 1 && loc.Y < -2500 && Math.abs(loc.X) > 2400);
            if (isOppCorner) {
              playerBoostStealsMap.set(pName, (playerBoostStealsMap.get(pName) || 0) + 1);
            }
          }
        }
      }
    }

    const debouncedHits = groupMicroTouches(rawHits, 350);

    // Helper resolving a player's real chronological position at targetTs
    const getSpatialAt = (playerName: string, targetTs: number, maxAgeMs = 12000): PlayerSpatialState | null => {
      const samples = playerPosTimeline.get(playerName);
      if (!samples || samples.length === 0) return null;
      let latest: SpatialSample | null = null;
      for (let i = samples.length - 1; i >= 0; i--) {
        const s = samples[i];
        if (s.ts <= targetTs) {
          if (targetTs - s.ts <= maxAgeMs) latest = s;
          break;
        }
      }
      if (!latest) return null;
      return {
        name: playerName,
        team_num: playerTeamMap.get(playerName) ?? 0,
        x: latest.x,
        y: latest.y,
        z: latest.z,
        speed: latest.speed,
      };
    };

    const getSpatialStatesAt = (targetTs: number, maxAgeMs = 12000): PlayerSpatialState[] => {
      const out: PlayerSpatialState[] = [];
      for (const p of players) {
        const s = getSpatialAt(p.name, targetTs, maxAgeMs);
        if (s) out.push(s);
      }
      return out;
    };

    // Resolve real goal timestamps chronologically
    const realGoalEvents = rawStatGoalEvents.length > 0
      ? rawStatGoalEvents.sort((a, b) => a.ts - b.ts)
      : goals.map((g, idx) => ({ ts: match.started_at + idx * 30000, teamNum: g.team_num }));

    const buildTrail = (targetTs: number) =>
      debouncedHits
        .filter(h => h.start_ts <= targetTs && h.start_ts >= targetTs - 3500)
        .slice(-6)
        .map(h => ({
          player_name: h.player_name,
          team_num: h.team_num,
          x: Math.round(h.x),
          y: Math.round(h.y),
          ts_offset_sec: Math.round(((h.start_ts - targetTs) / 1000) * 10) / 10,
        }));

    // 2. Correlate Goals with xG & Nuances (screamers, tap-ins, solo goals, counter goals)
    const screamersMap = new Map<string, number>();
    const tapInsMap = new Map<string, number>();
    const soloGoalsMap = new Map<string, number>();
    const counterGoalsMap = new Map<string, number>();
    const resolvedGoalsList: Array<{ idx: number; ts: number; teamNum: number; scorerName: string; speedKmh: number }> = [];

    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      const scorerPlayer = players.find(p => p.player_key === g.scorer_key);
      const scorerName = scorerPlayer ? scorerPlayer.name : 'Unknown';
      const teamNum = g.team_num;
      const realGoalTs = realGoalEvents[i]?.ts ?? (match.started_at + i * 30000);

      const x = g.x ?? 0;
      const y = g.y ?? (teamNum === 0 ? 3000 : -3000);
      const z = g.z ?? 100;
      const speedKmh = g.speed_kmh ?? 70;
      const distance = g.distance ?? 2000;
      resolvedGoalsList.push({ idx: i, ts: realGoalTs, teamNum, scorerName, speedKmh });

      const xgRes = calculateXG({
        x,
        y,
        z,
        speedKmh,
        attackingTeamNum: teamNum,
      });

      // Goal classification
      if (speedKmh >= 98 && (distance >= 3500 || Math.abs(y) < 1200)) {
        screamersMap.set(scorerName, (screamersMap.get(scorerName) || 0) + 1);
      } else if (distance < 1200 && xgRes.xg >= 0.60) {
        tapInsMap.set(scorerName, (tapInsMap.get(scorerName) || 0) + 1);
      }

      // Solo & Counter Goal classification from preceding hit chain
      const preGoalHits = debouncedHits.filter(h => h.start_ts <= realGoalTs && h.start_ts >= realGoalTs - 6500);
      if (!g.assister_key) {
        const scorerPreHits = preGoalHits.filter(h => h.player_name === scorerName && h.start_ts >= realGoalTs - 5000);
        if (scorerPreHits.length >= 2) {
          soloGoalsMap.set(scorerName, (soloGoalsMap.get(scorerName) || 0) + 1);
        }
      }
      const startedInOwnHalf = preGoalHits.some(
        h => h.team_num === teamNum && (teamNum === 0 ? h.y < -1000 : h.y > 1000)
      );
      if (startedInOwnHalf && preGoalHits.length >= 1) {
        counterGoalsMap.set(scorerName, (counterGoalsMap.get(scorerName) || 0) + 1);
      }

      const shotItem: ShotMapItem = {
        id: `goal-${i}`,
        shot_ts: realGoalTs,
        time_seconds: Math.max(0, Math.round((realGoalTs - match.started_at) / 1000)),
        player_name: scorerName,
        player_key: g.scorer_key || '',
        team_num: teamNum,
        x,
        y,
        z,
        distance: g.distance ?? xgRes.distance,
        speed_kmh: speedKmh,
        xg: xgRes.xg,
        is_big_chance: xgRes.isBigChance,
        outcome: 'goal',
        trail: buildTrail(realGoalTs),
      };

      shots.push(shotItem);
      const pList = playerShotsMap.get(scorerName) || [];
      pList.push(shotItem);
      playerShotsMap.set(scorerName, pList);

      // Check assister for Big Chance Created
      if (g.assister_key) {
        const assisterPlayer = players.find(p => p.player_key === g.assister_key);
        if (assisterPlayer) {
          keyPassesMap.set(assisterPlayer.name, (keyPassesMap.get(assisterPlayer.name) || 0) + 1);
          if (xgRes.isBigChance) {
            bigChancesCreatedMap.set(assisterPlayer.name, (bigChancesCreatedMap.get(assisterPlayer.name) || 0) + 1);
          }
        }
      }
    }

    // 3. Correlate StatfeedEvent Shots with BallHit (deduplicating Shots that immediately precede a recorded Goal)
    const shotEvents = rawEvents.filter(e => e.name === 'StatfeedEvent' && e.data.EventName === 'Shot');
    for (let i = 0; i < shotEvents.length; i++) {
      const sEv = shotEvents[i];
      const targetName = sEv.data.MainTarget?.Name;
      if (!targetName) continue;
      const teamNum = sEv.data.MainTarget?.TeamNum ?? playerTeamMap.get(targetName) ?? 0;

      // Skip Statfeed Shots that belong to a Goal already counted in Section 2 (within 3.5s)
      const isAlreadyGoalShot = realGoalEvents.some(
        ge =>
          ge.teamNum === teamNum &&
          (!('scorerName' in ge) || !ge.scorerName || ge.scorerName === targetName) &&
          ge.ts >= sEv.ts - 500 &&
          ge.ts <= sEv.ts + 3500
      );
      if (isAlreadyGoalShot) continue;

      let matchedHit = null;
      for (let j = ballHits.length - 1; j >= 0; j--) {
        const h = ballHits[j];
        if (h.ts > sEv.ts) continue;
        if (sEv.ts - h.ts > 4000) break;
        if (h.name === targetName) {
          matchedHit = h;
          break;
        }
      }

      if (matchedHit) {
        const xgRes = calculateXG({
          x: matchedHit.x,
          y: matchedHit.y,
          z: matchedHit.z,
          speedKmh: matchedHit.speed,
          attackingTeamNum: teamNum,
        });

        const timeSec = Math.max(0, Math.round((sEv.ts - match.started_at) / 1000));
        const shotItem: ShotMapItem = {
          id: `shot-${i}`,
          shot_ts: sEv.ts,
          time_seconds: timeSec,
          player_name: targetName,
          player_key: playerKeyMap.get(targetName) || '',
          team_num: teamNum,
          x: matchedHit.x,
          y: matchedHit.y,
          z: matchedHit.z,
          distance: xgRes.distance,
          speed_kmh: Math.round(matchedHit.speed),
          xg: xgRes.xg,
          is_big_chance: xgRes.isBigChance,
          outcome: 'saved',
          trail: buildTrail(sEv.ts),
        };

        shots.push(shotItem);
        const pList = playerShotsMap.get(targetName) || [];
        pList.push(shotItem);
        playerShotsMap.set(targetName, pList);

        for (let k = ballHits.length - 1; k >= 0; k--) {
          const prevHit = ballHits[k];
          if (prevHit.ts > matchedHit.ts) continue;
          if (matchedHit.ts - prevHit.ts > 3000) break;
          if (prevHit.teamNum === teamNum && prevHit.name !== targetName) {
            keyPassesMap.set(prevHit.name, (keyPassesMap.get(prevHit.name) || 0) + 1);
            if (xgRes.isBigChance) {
              bigChancesCreatedMap.set(prevHit.name, (bigChancesCreatedMap.get(prevHit.name) || 0) + 1);
            }
            break;
          }
        }
      }
    }

    // 4. Detect 50/50 Duels via debounced touches
    for (let i = 0; i < debouncedHits.length - 1; i++) {
      const h1 = debouncedHits[i];
      const h2 = debouncedHits[i + 1];
      if (isSimultaneous50(h1, h2, 400)) {
        const winner = h2.team_num === 0 ? (h2.y > h1.y ? h2.player_name : h1.player_name) : (h2.y < h1.y ? h2.player_name : h1.player_name);
        duelsMap.set(winner, (duelsMap.get(winner) || 0) + 1);
      }
    }

    // 5. Passing, Favorable Delivery & Pre-Assists (Hockey Assists)
    const favorablePassesMap = new Map<string, number>();
    const hospitalPassesMap = new Map<string, number>();
    const hockeyAssistsMap = new Map<string, number>();
    const failedSlotRecoveriesMap = new Map<string, number>();

    for (let i = 0; i < debouncedHits.length - 1; i++) {
      const h = debouncedHits[i];
      const nextH = debouncedHits[i + 1];
      const dt = nextH.start_ts - h.end_ts;

      const isAttackingThird = h.team_num === 0 ? h.y > 1500 : h.y < -1500;
      const spatialAtPass = getSpatialStatesAt(nextH.start_ts, 8000);

      // Case 1: Pass connected to teammate
      if (dt > 80 && dt <= 3500 && h.team_num === nextH.team_num && h.player_name !== nextH.player_name) {
        if (isAttackingThird) {
          const passEval = evaluatePassDelivery(
            h.player_name,
            h.team_num,
            { x: nextH.x, y: nextH.y, z: nextH.z },
            spatialAtPass
          );
          if (passEval.isFavorable) {
            favorablePassesMap.set(h.player_name, (favorablePassesMap.get(h.player_name) || 0) + 1);
          } else {
            const isDispossessed = debouncedHits.some(
              afterH =>
                afterH.team_num !== h.team_num &&
                afterH.start_ts > nextH.end_ts &&
                afterH.start_ts <= nextH.end_ts + 1500
            );
            if (isDispossessed) {
              hospitalPassesMap.set(h.player_name, (hospitalPassesMap.get(h.player_name) || 0) + 1);
            }
          }

          if (i > 0) {
            const prevH = debouncedHits[i - 1];
            if (
              h.start_ts - prevH.end_ts <= 3500 &&
              prevH.team_num === h.team_num &&
              prevH.player_name !== h.player_name
            ) {
              hockeyAssistsMap.set(prevH.player_name, (hockeyAssistsMap.get(prevH.player_name) || 0) + 1);
            }
          }
        }
      }
      // Case 2: Ball passed across the slot/center and intercepted cleanly by opponent
      else if (
        dt >= 250 &&
        dt <= 3500 &&
        h.team_num !== nextH.team_num &&
        isAttackingThird &&
        (Math.abs(h.x - nextH.x) >= 650 || Math.abs(h.y - nextH.y) >= 650)
      ) {
        const passEval = evaluatePassDelivery(
          h.player_name,
          h.team_num,
          { x: nextH.x, y: nextH.y, z: nextH.z },
          spatialAtPass
        );

        if (passEval.isFavorable) {
          favorablePassesMap.set(h.player_name, (favorablePassesMap.get(h.player_name) || 0) + 1);

          const oppScores = realGoalEvents.some(
            ge => ge.teamNum === nextH.team_num && ge.ts >= nextH.start_ts && ge.ts <= nextH.start_ts + 6000
          );
          if (oppScores && passEval.liabilityPlayer) {
            failedSlotRecoveriesMap.set(
              passEval.liabilityPlayer,
              (failedSlotRecoveriesMap.get(passEval.liabilityPlayer) || 0) + 1
            );
          }
        } else if (Math.abs(nextH.x) <= 1600) {
          // True hospital pass into defended central danger zone
          hospitalPassesMap.set(h.player_name, (hospitalPassesMap.get(h.player_name) || 0) + 1);
        }
      }
    }

    // 6. Tactical Demos, Reflex/Routine Saves, Rebound Waivers, AerialGoals & FlipResets
    const tacticalDemosMap = new Map<string, number>();
    const reflexSavesMap = new Map<string, number>();
    const routineSavesMap = new Map<string, number>();
    const reboundInstantClearsMap = new Map<string, number>();
    const spilledReboundsMap = new Map<string, number>();
    const aerialGoalsMap = new Map<string, number>();
    const flipResetsMap = new Map<string, number>();
    const saveEventsList: Array<{ ts: number; playerName: string; teamNum: number; isEpic: boolean }> = [];

    for (const ev of rawEvents) {
      if (ev.name === 'StatfeedEvent') {
        const evtName = ev.data.EventName;
        const target = ev.data.MainTarget?.Name;
        const teamNum = ev.data.MainTarget?.TeamNum ?? 0;

        if ((evtName === 'Demolish' || evtName === 'Demolition') && target) {
          const isTactical = rawEvents.some(
            other =>
              other.name === 'StatfeedEvent' &&
              (other.data.EventName === 'Goal' || other.data.EventName === 'Shot') &&
              other.data.MainTarget?.TeamNum === teamNum &&
              other.ts >= ev.ts &&
              other.ts <= ev.ts + 3500
          );
          if (isTactical) {
            tacticalDemosMap.set(target, (tacticalDemosMap.get(target) || 0) + 1);
          }
        } else if ((evtName === 'Save' || evtName === 'EpicSave' || evtName === 'Epic Save') && target) {
          const isEpic = evtName === 'EpicSave' || evtName === 'Epic Save';
          saveEventsList.push({ ts: ev.ts, playerName: target, teamNum, isEpic });
          if (isEpic) {
            reflexSavesMap.set(target, (reflexSavesMap.get(target) || 0) + 1);
          } else {
            routineSavesMap.set(target, (routineSavesMap.get(target) || 0) + 1);
          }

          const reboundWaiver = evaluateReboundWaiver(ev.ts, debouncedHits, target);
          if (reboundWaiver.waived) {
            reboundInstantClearsMap.set(target, (reboundInstantClearsMap.get(target) || 0) + 1);
          } else {
            spilledReboundsMap.set(target, (spilledReboundsMap.get(target) || 0) + 1);
          }
        } else if (evtName === 'AerialGoal' && target) {
          aerialGoalsMap.set(target, (aerialGoalsMap.get(target) || 0) + 1);
        } else if (evtName === 'FlipReset' && target) {
          flipResetsMap.set(target, (flipResetsMap.get(target) || 0) + 1);
        }
      }
    }

    // 7. Defensive Accountability & 5s Rewind Causes on Conceded Goals (Real Goal Timestamps)
    const boostAbandonmentsMap = new Map<string, number>();
    const spectatorConcessionsMap = new Map<string, number>();
    const honestEffortsMap = new Map<string, number>();
    const fastBreakImmunitiesMap = new Map<string, number>();

    for (const ge of realGoalEvents) {
      const goalTs = ge.ts;
      const defendingTeam = ge.teamNum === 0 ? 1 : 0;

      const recentHits = debouncedHits.filter(h => h.end_ts <= goalTs && h.start_ts >= goalTs - 5000);
      const isFastBreak = recentHits.some(
        h => h.team_num === defendingTeam && (defendingTeam === 0 ? h.y > 2000 : h.y < -2000)
      );

      const blamings = evaluateDefensiveRewind(
        goalTs,
        getSpatialStatesAt(goalTs, 6000),
        debouncedHits,
        defendingTeam,
        isFastBreak
      );

      for (const blame of blamings) {
        if (blame.cause === 'boost_abandonment') {
          boostAbandonmentsMap.set(blame.playerName, (boostAbandonmentsMap.get(blame.playerName) || 0) + 1);
        } else if (blame.cause === 'spectator') {
          spectatorConcessionsMap.set(blame.playerName, (spectatorConcessionsMap.get(blame.playerName) || 0) + 1);
        } else if (blame.cause === 'honest_effort') {
          honestEffortsMap.set(blame.playerName, (honestEffortsMap.get(blame.playerName) || 0) + 1);
        } else if (blame.cause === 'fast_break_immunity') {
          fastBreakImmunitiesMap.set(blame.playerName, (fastBreakImmunitiesMap.get(blame.playerName) || 0) + 1);
        }
      }
    }

    // 8. Counter-Press 5-Second Win-Back
    const counterPressRecoveriesMap = new Map<string, number>();
    for (let i = 0; i < debouncedHits.length - 1; i++) {
      const h1 = debouncedHits[i];
      const h2 = debouncedHits[i + 1];
      if (h1.team_num !== h2.team_num) {
        const turnoverZone =
          h1.team_num === 0
            ? h1.y > 1500
              ? 'attack'
              : h1.y < -1500
              ? 'defense'
              : 'midfield'
            : h1.y < -1500
            ? 'attack'
            : h1.y > 1500
            ? 'defense'
            : 'midfield';
        const winBack = evaluate5sWinBack(h2.start_ts, debouncedHits, h1.team_num, turnoverZone);
        if (winBack.wonBack && winBack.recoveredBy) {
          counterPressRecoveriesMap.set(
            winBack.recoveredBy,
            (counterPressRecoveriesMap.get(winBack.recoveredBy) || 0) + 1
          );
        }
      }
    }

    // 9. Detect Teammate Double Commits with Scrum Deduplication, Ball-Zone Scaling & 3s Net-Coverage
    const doubleCommitsList: DoubleCommitEvent[] = [];
    const playerDoubleCommitsMap = new Map<string, number>();
    const coveredDoubleCommitsMap = new Map<string, number>();
    const netRushDoubleCommitsMap = new Map<string, number>();
    const thirdManCoversMap = new Map<string, number>();
    const playerFatalDoubleCommitsMap = new Map<string, number>();
    const tailingOvercommitsMap = new Map<string, number>();
    const lastDcByTeam = new Map<number, { ts: number; x: number; y: number; names: Set<string> }>();

    for (let i = 0; i < ballHits.length - 1; i++) {
      const h1 = ballHits[i];
      const h2 = ballHits[i + 1];
      if (h1.teamNum === h2.teamNum && h1.name !== h2.name) {
        const dt = h2.ts - h1.ts;
        const dist = Math.hypot(h2.x - h1.x, h2.y - h1.y);
        const isGroundDC = dt <= 400 && dist <= 650;
        const isAerialDC = dt <= 750 && dist <= 900 && (h1.z > 500 || h2.z > 500);

        if (isGroundDC || isAerialDC) {
          // Coalesce rapid ping-pong bounces in the same scrum within <= 1500ms
          const prevDc = lastDcByTeam.get(h1.teamNum);
          if (
            prevDc &&
            h2.ts - prevDc.ts <= 1500 &&
            (prevDc.names.has(h1.name) || prevDc.names.has(h2.name)) &&
            Math.hypot(h2.x - prevDc.x, h2.y - prevDc.y) <= 1200
          ) {
            prevDc.ts = h2.ts;
            continue;
          }

          const oppTeam = h1.teamNum === 0 ? 1 : 0;
          const ownGoalY = h1.teamNum === 0 ? -5120 : 5120;
          const distFromOwnGoal = Math.abs(h2.y - ownGoalY);
          const ballZone: 'attack_box' | 'midfield' | 'defense' =
            distFromOwnGoal >= 8400 ? 'attack_box' : distFromOwnGoal >= 3600 ? 'midfield' : 'defense';

          const isFatal = realGoalEvents.some(
            ge => ge.teamNum === oppTeam && ge.ts >= h2.ts && ge.ts <= h2.ts + 8000
          );

          const h1PriorTouches = ballHits.filter(
            bh => bh.name === h1.name && bh.ts < h1.ts && bh.ts >= h1.ts - 2500
          ).length;

          const teamPlayers = players.filter(p => p.team_num === h1.teamNum);
          const otherTeammates = teamPlayers.filter(p => p.name !== h1.name && p.name !== h2.name);

          let thirdManInNet: string | null = null;
          if (teamPlayers.length >= 3) {
            for (const tm of otherTeammates) {
              const wasForwardRecently = ballHits.some(
                b =>
                  b.name === tm.name &&
                  b.ts >= h2.ts - 7000 &&
                  b.ts <= h2.ts + 1000 &&
                  Math.abs(b.y - ownGoalY) > 5400
              );
              const spatTm = getSpatialAt(tm.name, h2.ts, 22000);
              const heldDefensiveDepth = Boolean(spatTm && Math.abs(spatTm.y - ownGoalY) <= 4400);
              const postDefTouch = ballHits.some(
                b => b.name === tm.name && b.ts > h2.ts && b.ts <= h2.ts + 4000 && Math.abs(b.y - ownGoalY) <= 4800
              );
              const postDefSave = rawEvents.some(
                ev =>
                  ev.name === 'StatfeedEvent' &&
                  (ev.data.EventName === 'Save' || ev.data.EventName === 'EpicSave' || ev.data.EventName === 'Epic Save') &&
                  ev.data.MainTarget?.Name === tm.name &&
                  ev.ts >= h2.ts &&
                  ev.ts <= h2.ts + 4500
              );
              if (!wasForwardRecently && (heldDefensiveDepth || postDefTouch || postDefSave)) {
                thirdManInNet = tm.name;
                break;
              }
            }
          }

          const isNetExposed = teamPlayers.length < 3 || thirdManInNet === null;
          const prevIntruder = getSpatialAt(h2.name, h2.ts - 400, 9000);
          const intruderRushedFromNet = Boolean(
            prevIntruder &&
              Math.abs(prevIntruder.y - ownGoalY) <= 3400 &&
              (h1.teamNum === 0 ? h2.y - prevIntruder.y >= 1800 : prevIntruder.y - h2.y >= 1800)
          );

          const dcLiability = evaluateDoubleCommitLiability(
            { player_name: h1.name, team_num: h1.teamNum, ts: h1.ts, y: h1.y },
            { player_name: h2.name, team_num: h2.teamNum, ts: h2.ts, y: h2.y },
            isFatal,
            h1PriorTouches,
            {
              teamSize: teamPlayers.length,
              thirdManInNet,
              isNetExposed,
              intruderRushedFromNet,
              ballZone,
            }
          );

          lastDcByTeam.set(h1.teamNum, {
            ts: h2.ts,
            x: h2.x,
            y: h2.y,
            names: new Set([h1.name, h2.name]),
          });

          const timeSec = Math.max(0, Math.round((h2.ts - match.started_at) / 1000));
          const isCarrierH1 = dcLiability.carrier === h1.name;
          doubleCommitsList.push({
            time_seconds: timeSec,
            player1_name: h1.name,
            player2_name: h2.name,
            team_num: h1.teamNum,
            is_fatal: isFatal,
            carrier_name: dcLiability.carrier,
            instigator_name: dcLiability.intruder,
            x: h2.x,
            y: h2.y,
            z: h2.z,
            carrier_x: isCarrierH1 ? h1.x : h2.x,
            carrier_y: isCarrierH1 ? h1.y : h2.y,
            intruder_x: isCarrierH1 ? h2.x : h1.x,
            intruder_y: isCarrierH1 ? h2.y : h1.y,
            net_status: dcLiability.netStatus,
            third_man_covering: dcLiability.thirdManCovering,
            rushed_from_net: dcLiability.rushedFromNet,
            ball_zone: dcLiability.ballZone,
            penalty_delta: dcLiability.intruderDelta,
            context_reason: dcLiability.reason,
            trail: buildTrail(h2.ts),
          });

          playerDoubleCommitsMap.set(dcLiability.intruder, (playerDoubleCommitsMap.get(dcLiability.intruder) || 0) + 1);
          if (dcLiability.netStatus === 'covered') {
            coveredDoubleCommitsMap.set(dcLiability.intruder, (coveredDoubleCommitsMap.get(dcLiability.intruder) || 0) + 1);
            if (dcLiability.thirdManCovering) {
              thirdManCoversMap.set(
                dcLiability.thirdManCovering,
                (thirdManCoversMap.get(dcLiability.thirdManCovering) || 0) + 1
              );
            }
          } else if (dcLiability.netStatus === 'rusher_open_net') {
            netRushDoubleCommitsMap.set(dcLiability.intruder, (netRushDoubleCommitsMap.get(dcLiability.intruder) || 0) + 1);
          }

          if (isFatal) {
            if (dcLiability.netStatus !== 'covered') {
              tailingOvercommitsMap.set(dcLiability.intruder, (tailingOvercommitsMap.get(dcLiability.intruder) || 0) + 1);
            }
            playerFatalDoubleCommitsMap.set(dcLiability.intruder, (playerFatalDoubleCommitsMap.get(dcLiability.intruder) || 0) + 1);
          }
        }
      }
    }

    // 10. Detect Errors Leading to Goal (Turnovers & Failed Clears in Own Defensive Third)
    for (const ge of realGoalEvents) {
      const goalTs = ge.ts;
      const scoringTeam = ge.teamNum;
      const defendingTeam = scoringTeam === 0 ? 1 : 0;

      const defHits = ballHits.filter(h => h.teamNum === defendingTeam && h.ts <= goalTs && h.ts >= goalTs - 4500);
      if (defHits.length > 0) {
        const lastDefHit = defHits[defHits.length - 1];
        const isDefThird = defendingTeam === 0 ? lastDefHit.y < -3200 : lastDefHit.y > 3200;
        const oppHitAfter = ballHits.some(h => h.teamNum === scoringTeam && h.ts >= lastDefHit.ts && h.ts <= goalTs);
        if (isDefThird && oppHitAfter) {
          turnoverConcessionMap.set(lastDefHit.name, (turnoverConcessionMap.get(lastDefHit.name) || 0) + 1);
        }
      }
    }

    // 11. Community Tactical Rules: Back-Post, Shadow Defense, Reckless Dives, Backboard, Infield, Kickoff
    const backPostRotationsMap = new Map<string, number>();
    const nearPostTrapsMap = new Map<string, number>();
    const shadowDefensesMap = new Map<string, number>();
    const recklessDivesMap = new Map<string, number>();
    const waivedRecklessDivesMap = new Map<string, number>();
    const smallPadDisciplinesMap = new Map<string, number>();
    const cornerBoostDesertionsMap = new Map<string, number>();
    const kickoffCheatUpsMap = new Map<string, number>();
    const doubleCornerDesertionsMap = new Map<string, number>();
    const backboardClearsMap = new Map<string, number>();
    const backboardHesitationsMap = new Map<string, number>();
    const infieldCrossesMap = new Map<string, number>();
    const cornerRollGiveawaysMap = new Map<string, number>();
    const demoEvasionsMap = new Map<string, number>();
    const goalLineScramblesMap = new Map<string, number>();

    // A. Backboard Wall Clears
    for (const h of debouncedHits) {
      const bb = evaluateBackboardDefense(h, h.team_num);
      if (bb.isBackboardClear) {
        backboardClearsMap.set(h.player_name, (backboardClearsMap.get(h.player_name) || 0) + 1);
      }
    }

    // B. Infield Crosses & Corner Roll Giveaways
    for (let i = 0; i < debouncedHits.length - 1; i++) {
      const h1 = debouncedHits[i];
      const h2 = debouncedHits[i + 1];
      if (h1.team_num === h2.team_num) {
        const cross = evaluateInfieldCross(h1, h2, h1.team_num, false);
        if (cross.isInfieldCross) {
          infieldCrossesMap.set(h1.player_name, (infieldCrossesMap.get(h1.player_name) || 0) + 1);
        }
      } else {
        const isGoalieClaim = Math.abs(h2.y) > 4500 && Math.abs(h2.x) < 1200;
        const cross = evaluateInfieldCross(h1, h2, h1.team_num, isGoalieClaim);
        if (cross.isCornerRollGiveaway) {
          cornerRollGiveawaysMap.set(h1.player_name, (cornerRollGiveawaysMap.get(h1.player_name) || 0) + 1);
        }
      }
    }

    // C. Back-Post Rotations & Near-Post Traps on Shots (Real Shot Timestamps & Spatial History)
    for (const s of shots) {
      const defTeam = s.team_num === 0 ? 1 : 0;
      const defGoalY = defTeam === 0 ? -5120 : 5120;
      for (const p of players) {
        if (p.team_num === defTeam) {
          const spat = getSpatialAt(p.name, s.shot_ts, 4500);
          if (spat) {
            const bp = evaluateBackPostRotation(spat, { x: s.x, y: s.y, z: s.z }, defGoalY);
            if (bp.isBackPost) {
              backPostRotationsMap.set(p.name, (backPostRotationsMap.get(p.name) || 0) + 1);
            } else if (bp.isNearPostTrap) {
              nearPostTrapsMap.set(p.name, (nearPostTrapsMap.get(p.name) || 0) + 1);
            }
          }
        }
      }
    }

    // D. Kickoff Support: Cheat-Ups vs Double-Corner Desertions (Real RoundStarted Timestamps)
    const kickoffTimes =
      roundStartedTimes.length > 0
        ? roundStartedTimes
        : [match.started_at, ...realGoalEvents.map(ge => ge.ts + 4500)];

    for (const koTs of kickoffTimes) {
      const koHits = debouncedHits.filter(h => h.start_ts >= koTs && h.start_ts <= koTs + 5000);
      if (koHits.length === 0) continue;

      const firstHit = koHits[0];
      const isDeadBall = Math.abs(firstHit.x) <= 600 && Math.abs(firstHit.y) <= 800;

      for (const p of players) {
        if (p.name === firstHit.player_name) continue;
        // Resolve first post-kickoff action from hits or boost pickups relative to firstHit
        const firstTouch = debouncedHits.find(
          h => h.player_name === p.name && h.start_ts > firstHit.end_ts && h.start_ts <= firstHit.start_ts + 4500
        );
        const firstPickup = boostPickupsList.find(
          b => b.playerName === p.name && b.ts >= koTs && b.ts <= firstHit.start_ts + 4500
        );
        const act =
          firstTouch && (!firstPickup || firstTouch.start_ts <= firstPickup.ts)
            ? { x: firstTouch.x, y: firstTouch.y, z: firstTouch.z }
            : firstPickup
            ? { x: firstPickup.x, y: firstPickup.y, z: firstPickup.z }
            : null;

        if (!act) continue;
        const concededQuickly = realGoalEvents.some(
          ge => ge.teamNum !== p.team_num && ge.ts >= koTs && ge.ts <= koTs + 6500
        );
        const koSupp = evaluateKickoffSupport(
          { name: p.name, team_num: p.team_num, x: act.x, y: act.y, z: act.z, speed: 1500 },
          isDeadBall,
          concededQuickly
        );
        if (koSupp.isCheatUp) {
          kickoffCheatUpsMap.set(p.name, (kickoffCheatUpsMap.get(p.name) || 0) + 1);
        } else if (koSupp.isDesertion) {
          doubleCornerDesertionsMap.set(p.name, (doubleCornerDesertionsMap.get(p.name) || 0) + 1);
        }
      }
    }

    // E. Small-Pad Line Discipline
    for (const p of players) {
      const pMs = p.car_ms || 300000;
      const emptyRatio = (p.empty_boost_ms || 0) / pMs;
      if (emptyRatio < 0.06 && p.touches >= 20) {
        smallPadDisciplinesMap.set(p.name, 1);
      }
    }

    // F. Shadow Defense & First-Man Reckless Dives
    for (let i = 0; i < debouncedHits.length - 1; i++) {
      const h1 = debouncedHits[i];
      const h2 = debouncedHits[i + 1];
      const dt = h2.start_ts - h1.end_ts;
      if (h1.team_num === h2.team_num || dt > 3000) continue;

      // Shadow Defense: defender touches next in own half between ball & own net without conceding within 4.5s
      const defGoalY = h2.team_num === 0 ? -5120 : 5120;
      const inDefHalf = h2.team_num === 0 ? h2.y < 0 : h2.y > 0;
      const concededSoon = realGoalEvents.some(
        ge => ge.teamNum === h1.team_num && ge.ts >= h2.start_ts && ge.ts <= h2.start_ts + 4500
      );
      if (inDefHalf && !concededSoon) {
        const attackerPos = getSpatialAt(h1.player_name, h2.start_ts, 4000) || {
          name: h1.player_name,
          team_num: h1.team_num,
          x: h1.x,
          y: h1.y,
          z: h1.z,
          speed: 1200,
        };
        const shadowRes = evaluateShadowDefense(
          { name: h2.player_name, team_num: h2.team_num, x: h2.x, y: h2.y, z: h2.z, speed: 1200 },
          attackerPos,
          { x: h1.x, y: h1.y, z: h1.z },
          defGoalY,
          true
        );
        if (shadowRes.isShadowDefense) {
          shadowDefensesMap.set(h2.player_name, (shadowDefensesMap.get(h2.player_name) || 0) + 1);
        }
      }

      // Reckless Dive: player commits deep in opponent half / transition, loses clean progression >1400 uu leading to shot/goal within 4s
      const h1InAttack = h1.team_num === 0 ? h1.y > 1000 : h1.y < -1000;
      const netAdvanceTowardH1Goal = h1.team_num === 0 ? h1.y - h2.y : h2.y - h1.y;
      if (h1InAttack && dt <= 1600 && (Math.abs(h2.y - h1.y) > 800 || netAdvanceTowardH1Goal > 600)) {
        const oppThreatSoon = shots.some(
          s => s.team_num === h2.team_num && s.shot_ts >= h2.start_ts && s.shot_ts <= h2.start_ts + 4500
        );
        if (oppThreatSoon) {
          const recovered = debouncedHits.some(
            rec => rec.player_name === h1.player_name && rec.start_ts > h2.end_ts && rec.start_ts <= h1.end_ts + 3500
          );
          const diveRes = evaluateRecklessDive(1900, true, recovered);
          if (diveRes.isRecklessDive) {
            if (diveRes.waived50) {
              waivedRecklessDivesMap.set(h1.player_name, (waivedRecklessDivesMap.get(h1.player_name) || 0) + 1);
            } else {
              recklessDivesMap.set(h1.player_name, (recklessDivesMap.get(h1.player_name) || 0) + 1);
            }
          }
        }
      }
    }

    // 12. Game-State Multipliers
    const scoreDiff = Math.abs(match.score_team0 - match.score_team1);
    const matchDurationSec = match.ended_at && match.started_at ? (match.ended_at - match.started_at) / 1000 : 300;
    const isOvertime = Boolean(match.overtime);

    let clutchMultiplier: number | undefined = undefined;
    let garbageTimeMultiplier: number | undefined = undefined;

    if (isOvertime || (matchDurationSec >= 240 && scoreDiff <= 1)) {
      clutchMultiplier = 1.25;
    } else if (matchDurationSec >= 270 && scoreDiff >= 4) {
      garbageTimeMultiplier = 0.50;
    }

    const goalMarkersForFifa = resolvedGoalsList.length > 0 ? resolvedGoalsList : realGoalEvents;
    const fifaMetricsMap = extractFifaPlayMetrics({
      debouncedHits,
      shots,
      realGoalEvents: goalMarkersForFifa,
      saveEvents: saveEventsList,
    });

    return {
      shots,
      playerShotsMap,
      keyPassesMap,
      bigChancesCreatedMap,
      favorablePassesMap,
      hospitalPassesMap,
      hockeyAssistsMap,
      failedSlotRecoveriesMap,
      duelsMap,
      turnoverConcessionMap,
      doubleCommitsList,
      playerDoubleCommitsMap,
      coveredDoubleCommitsMap,
      netRushDoubleCommitsMap,
      thirdManCoversMap,
      playerFatalDoubleCommitsMap,
      tailingOvercommitsMap,
      tacticalDemosMap,
      screamersMap,
      tapInsMap,
      soloGoalsMap,
      counterGoalsMap,
      reflexSavesMap,
      routineSavesMap,
      reboundInstantClearsMap,
      spilledReboundsMap,
      boostAbandonmentsMap,
      spectatorConcessionsMap,
      honestEffortsMap,
      fastBreakImmunitiesMap,
      counterPressRecoveriesMap,
      backPostRotationsMap,
      nearPostTrapsMap,
      shadowDefensesMap,
      recklessDivesMap,
      waivedRecklessDivesMap,
      smallPadDisciplinesMap,
      cornerBoostDesertionsMap,
      kickoffCheatUpsMap,
      doubleCornerDesertionsMap,
      backboardClearsMap,
      backboardHesitationsMap,
      infieldCrossesMap,
      cornerRollGiveawaysMap,
      demoEvasionsMap,
      goalLineScramblesMap,
      aerialGoalsMap,
      flipResetsMap,
      playerSmallPadsMap,
      playerBigOrbsMap,
      playerBoostStealsMap,
      clutchMultiplier,
      garbageTimeMultiplier,
      hits,
      momentumEvents,
      debouncedHits,
      roundStartedTimes,
      resolvedGoalsList,
      fifaMetricsMap,
    };
  }
}

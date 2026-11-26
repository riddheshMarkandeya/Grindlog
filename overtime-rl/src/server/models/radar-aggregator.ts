import type { MatchPlayerAnalysis, RadarProfile } from '../../shared/types.ts';
import { calculatePlayerRadar } from './radar.ts';

/**
 * Aggregates a player's analyzed match records into a single rule-aware 8-axis RadarProfile.
 * Shared across Career Profile, Duo Dossiers, and Trio Roster views so all views use
 * 100% consistent tactical & causal rules.
 */
export function aggregateRadarFromAnalyses(entries: MatchPlayerAnalysis[]): RadarProfile {
  if (entries.length === 0) {
    return calculatePlayerRadar({
      goals: 0,
      shots: 0,
      assists: 0,
      saves: 0,
      demos: 0,
      clearances: 0,
      keyPasses: 0,
      duelsWon: 0,
      touchesMidfield: 0,
      touchesTotal: 0,
      carMs: 300_000,
      supersonicMs: 0,
      boostAvg: 50,
      emptyBoostMs: 0,
      xg: 0,
    });
  }

  let goals = 0;
  let shots = 0;
  let assists = 0;
  let saves = 0;
  let demos = 0;
  let clearances = 0;
  let keyPasses = 0;
  let bigChancesCreated = 0;
  let bigChancesMissed = 0;
  let touchesDefence = 0;
  let touchesMidfield = 0;
  let touchesAttack = 0;
  let touchesTotal = 0;
  let carMs = 0;
  let supersonicMs = 0;
  let emptyBoostMs = 0;
  let boostWeighted = 0;
  let xg = 0;
  let aerialTouches = 0;
  let doubleCommits = 0;
  let fatalDoubleCommits = 0;
  let turnoverConcessions = 0;
  let smallPads = 0;
  let bigOrbs = 0;
  let boostSteals = 0;
  let hardestShotKmh = 0;

  let duelsWon = 0;
  let favorablePasses = 0;
  let infieldCrosses = 0;
  let hockeyAssists = 0;
  let hospitalPasses = 0;
  let cornerRollGiveaways = 0;
  let screamers = 0;
  let soloGoals = 0;
  let counterGoals = 0;
  let reflexSaves = 0;
  let reboundInstantClears = 0;
  let spilledRebounds = 0;
  let shadowDefenses = 0;
  let backPostRotations = 0;
  let backboardClears = 0;
  let goalLineScrambles = 0;
  let counterPressRecoveries = 0;
  let tacticalDemos = 0;
  let boostAbandonments = 0;
  let cornerBoostDesertions = 0;
  let nearPostTraps = 0;
  let recklessDives = 0;
  let kickoffCheatUps = 0;
  let doubleCornerDesertions = 0;
  let aerialGoals = 0;
  let flipResets = 0;
  let coveredDoubleCommits = 0;
  let netRushDoubleCommits = 0;
  let thirdManCovers = 0;

  for (const p of entries) {
    goals += p.goals || 0;
    shots += p.shots || 0;
    assists += p.assists || 0;
    saves += p.saves || 0;
    demos += p.demos || 0;
    clearances += p.clearances || 0;
    keyPasses += p.key_passes || 0;
    bigChancesCreated += p.big_chances_created || 0;
    bigChancesMissed += p.big_chances_missed || 0;
    touchesDefence += p.touches_defence || 0;
    touchesMidfield += p.touches_midfield || 0;
    touchesAttack += p.touches_attack || 0;
    touchesTotal += p.touches || 0;

    // Derive match carMs from supersonic ratio or 300s regulation baseline
    const mCarMs = p.supersonic_pct > 0 && p.supersonic_seconds > 0
      ? Math.round((p.supersonic_seconds * 1000 * 100) / Math.max(1, p.supersonic_pct))
      : 300_000;
    carMs += mCarMs;
    supersonicMs += (p.supersonic_seconds || 0) * 1000;
    emptyBoostMs += (p.empty_boost_seconds || 0) * 1000;
    boostWeighted += (p.boost_avg ?? 50) * mCarMs;

    xg += p.xg || 0;
    aerialTouches += p.aerial_touches || 0;
    doubleCommits += p.double_commits || 0;
    fatalDoubleCommits += p.fatal_double_commits || 0;
    turnoverConcessions += p.turnover_concessions || 0;
    smallPads += p.small_pads || 0;
    bigOrbs += p.big_orbs || 0;
    boostSteals += p.boost_steals || 0;
    if ((p.hardest_shot_kmh || 0) > hardestShotKmh) {
      hardestShotKmh = p.hardest_shot_kmh || 0;
    }

    const tm = p.tactical_metrics;
    if (tm) {
      duelsWon += tm.duels_won || 0;
      favorablePasses += tm.favorable_passes || 0;
      infieldCrosses += tm.infield_crosses || 0;
      hockeyAssists += tm.hockey_assists || 0;
      hospitalPasses += tm.hospital_passes || 0;
      cornerRollGiveaways += tm.corner_roll_giveaways || 0;
      screamers += tm.screamers || 0;
      soloGoals += tm.solo_goals || 0;
      counterGoals += tm.counter_goals || 0;
      reflexSaves += tm.reflex_saves || 0;
      reboundInstantClears += tm.rebound_instant_clears || 0;
      spilledRebounds += tm.spilled_rebounds || 0;
      shadowDefenses += tm.shadow_defenses || 0;
      backPostRotations += tm.back_post_rotations || 0;
      backboardClears += tm.backboard_clears || 0;
      goalLineScrambles += tm.goal_line_scrambles || 0;
      counterPressRecoveries += tm.counter_press_recoveries || 0;
      tacticalDemos += tm.tactical_demos || 0;
      boostAbandonments += tm.boost_abandonments || 0;
      cornerBoostDesertions += tm.corner_boost_desertions || 0;
      nearPostTraps += tm.near_post_traps || 0;
      recklessDives += tm.reckless_dives || 0;
      kickoffCheatUps += tm.kickoff_cheat_ups || 0;
      doubleCornerDesertions += tm.double_corner_desertions || 0;
      aerialGoals += tm.aerial_goals || 0;
      flipResets += tm.flip_resets || 0;
      coveredDoubleCommits += tm.covered_double_commits || 0;
      netRushDoubleCommits += tm.net_rush_double_commits || 0;
      thirdManCovers += tm.third_man_covers || 0;
    }
  }

  const totalPadEvents = smallPads + bigOrbs;
  const padRatioPct = totalPadEvents > 0 ? Math.round((smallPads / totalPadEvents) * 100) : undefined;

  return calculatePlayerRadar({
    goals,
    shots,
    assists,
    saves,
    demos,
    clearances,
    keyPasses,
    duelsWon,
    touchesDefence,
    touchesMidfield,
    touchesAttack,
    touchesTotal: Math.max(1, touchesTotal),
    carMs: Math.max(1, carMs),
    supersonicMs,
    boostAvg: carMs > 0 ? boostWeighted / carMs : 50,
    emptyBoostMs,
    xg,
    aerialTouches,
    aerialGoals,
    flipResets,
    doubleCommits,
    coveredDoubleCommits,
    netRushDoubleCommits,
    thirdManCovers,
    fatalDoubleCommits,
    bigChancesCreated,
    bigChancesMissed,
    hardestShotKmh,
    favorablePasses,
    infieldCrosses,
    hockeyAssists,
    hospitalPasses,
    cornerRollGiveaways,
    screamers,
    soloGoals,
    counterGoals,
    reflexSaves,
    reboundInstantClears,
    spilledRebounds,
    shadowDefenses,
    backPostRotations,
    backboardClears,
    goalLineScrambles,
    counterPressRecoveries,
    turnoverConcessions,
    tacticalDemos,
    smallPads,
    bigOrbs,
    padRatioPct,
    boostSteals,
    boostAbandonments,
    cornerBoostDesertions,
    nearPostTraps,
    recklessDives,
    kickoffCheatUps,
    doubleCornerDesertions,
  });
}

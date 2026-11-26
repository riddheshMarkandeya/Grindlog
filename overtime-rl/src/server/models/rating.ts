import type { PlayerRatingResult, RatingFactor, RatingFactorCategory } from '../../shared/types.ts';

export interface PlayerMatchMetrics {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  ownGoals: number;
  deflectedOwnGoals?: number;
  isWin: boolean;
  isOvertime: boolean;
  goalsConceded: number;
  cleanSheet: boolean;
  keyPasses: number;
  bigChancesCreated: number;
  bigChancesMissed: number;
  toughAngleMisses?: number;
  clearances: number;
  pressureClearances?: number;
  duelsWon: number;
  duelsLost?: number;
  duelStreakBonus?: number;
  aerialDuelsWon?: number;
  aerialWhiffs?: number;
  cleanTackles?: number;
  lastManTackles?: number;
  recklessDives?: number;
  favorablePasses?: number;
  hospitalPasses?: number;
  hockeyAssists?: number;
  progressivePasses?: number;
  pressResistances?: number;
  counterPressRecoveries?: number;
  sloppyTurnovers?: number;
  turnoverConcessions: number;
  spilledRebounds?: number;
  reboundInstantClears?: number;
  reflexSaves?: number;
  routineSaves?: number;
  controlledReboundParries?: number;
  spectatorConcessions?: number;
  boostAbandonments?: number;
  honestEfforts?: number;
  fastBreakImmunities?: number;
  kickoffBreakdowns?: number;
  failedSlotRecoveries?: number;
  tacticalDemos?: number;
  screamers?: number;
  soloGoals?: number;
  counterGoals?: number;
  tapIns?: number;
  softGoals?: number;
  clutchMultiplier?: number;
  garbageTimeMultiplier?: number;
  hardestShotKmh: number | null;
  carMs: number;
  supersonicMs: number;
  emptyBoostMs: number;
  doubleCommits?: number;
  coveredDoubleCommits?: number;
  netRushDoubleCommits?: number;
  thirdManCovers?: number;
  fatalDoubleCommits?: number;
  tailingOvercommits?: number;
  backPostRotations?: number;
  nearPostTraps?: number;
  shadowDefenses?: number;
  waivedRecklessDives?: number;
  smallPadDisciplines?: number;
  cornerBoostDesertions?: number;
  kickoffCheatUps?: number;
  doubleCornerDesertions?: number;
  backboardClears?: number;
  backboardHesitations?: number;
  infieldCrosses?: number;
  cornerRollGiveaways?: number;
  demoEvasions?: number;
  goalLineScrambles?: number;
  boostSteals?: number;
  shotXGs: Array<{
    xg: number;
    isGoal: boolean;
    speedKmh?: number;
    distance?: number;
    isScreamer?: boolean;
    isSolo?: boolean;
    isCounter?: boolean;
    isTapIn?: boolean;
    isSoft?: boolean;
  }>;
}

export function calculatePlayerRating(metrics: PlayerMatchMetrics): PlayerRatingResult {
  const factors: RatingFactor[] = [];
  let score = 6.0; // Baseline FotMob starting rating

  const clutchMult = metrics.clutchMultiplier ?? 1.0;
  const garbageMult = metrics.garbageTimeMultiplier ?? 1.0;

  const addFactor = (
    name: string,
    delta: number,
    category: RatingFactorCategory,
    applyClutch: boolean = false
  ) => {
    let finalDelta = Math.round(delta * 100) / 100;
    if (applyClutch && clutchMult !== 1.0) {
      finalDelta = Math.round(delta * clutchMult * 100) / 100;
    } else if (delta < 0 && garbageMult !== 1.0) {
      finalDelta = Math.round(delta * garbageMult * 100) / 100;
    }

    score += finalDelta;
    factors.push({
      name,
      delta: finalDelta,
      category,
      clutchMultiplier: applyClutch && clutchMult !== 1.0 ? clutchMult : undefined,
    });
  };

  // =========================================================================
  // 1. ATTACKING CONTRIBUTIONS (xG, Goals & Nuance)
  // =========================================================================
  if (metrics.screamers && metrics.screamers > 0) {
    addFactor(`Long-Range Screamer (${metrics.screamers})`, metrics.screamers * 1.40, 'attack', true);
  }
  if (metrics.soloGoals && metrics.soloGoals > 0) {
    addFactor(`Solo Run / Take-On Goal (${metrics.soloGoals})`, metrics.soloGoals * 1.50, 'attack', true);
  }
  if (metrics.counterGoals && metrics.counterGoals > 0) {
    addFactor(`Counter-Attack Goal (${metrics.counterGoals})`, metrics.counterGoals * 1.30, 'attack', true);
  }
  if (metrics.tapIns && metrics.tapIns > 0) {
    addFactor(`Tap-In Finish (${metrics.tapIns})`, metrics.tapIns * 0.40, 'attack', false);
  }
  if (metrics.softGoals && metrics.softGoals > 0) {
    addFactor(`Soft Long Goal (${metrics.softGoals})`, metrics.softGoals * 0.50, 'attack', false);
  }

  // Fallback for goals not specifically categorized
  const categorizedGoals =
    (metrics.screamers || 0) +
    (metrics.soloGoals || 0) +
    (metrics.counterGoals || 0) +
    (metrics.tapIns || 0) +
    (metrics.softGoals || 0);
  const remainingGoals = metrics.goals - categorizedGoals;

  if (remainingGoals > 0) {
    let goalDelta = 0;
    const goalShots = metrics.shotXGs.filter(s => s.isGoal);
    goalShots.slice(0, remainingGoals).forEach(g => {
      goalDelta += 0.60 + 0.40 * (1.0 - g.xg);
    });
    if (goalDelta === 0) goalDelta = remainingGoals * 0.85;
    goalDelta = Math.round(goalDelta * 100) / 100;
    addFactor(`Goals (${remainingGoals})`, goalDelta, 'attack', true);
  }

  // Assists & Pre-Assists
  if (metrics.assists > 0) {
    const assistDelta = Math.round(metrics.assists * 0.50 * 100) / 100;
    addFactor(`Assists (${metrics.assists})`, assistDelta, 'attack', true);
  }

  if (metrics.hockeyAssists && metrics.hockeyAssists > 0) {
    addFactor(`Hockey Assist (${metrics.hockeyAssists})`, metrics.hockeyAssists * 0.35, 'attack', false);
  }

  if (metrics.bigChancesCreated > 0) {
    // High-yield playmaking
    const bccDelta = Math.round(metrics.bigChancesCreated * 0.40 * 100) / 100;
    addFactor(`Big Chances Created (${metrics.bigChancesCreated})`, bccDelta, 'attack', false);
  }

  if (metrics.favorablePasses && metrics.favorablePasses > 0) {
    const favDelta = Math.round(Math.min(1.00, metrics.favorablePasses * 0.50) * 100) / 100;
    addFactor(`Favorable Chance Delivery (${metrics.favorablePasses})`, favDelta, 'attack', false);
  }

  if (metrics.keyPasses > 0) {
    const kpDelta = Math.round(metrics.keyPasses * 0.40 * 100) / 100;
    addFactor(`Key Passes (${metrics.keyPasses})`, kpDelta, 'attack', false);
  }

  if (metrics.progressivePasses && metrics.progressivePasses > 0) {
    addFactor(`Progressive / Backboard Pass (${metrics.progressivePasses})`, metrics.progressivePasses * 0.30, 'possession', false);
  }

  if (metrics.pressResistances && metrics.pressResistances > 0) {
    addFactor(`Press Resistance (${metrics.pressResistances})`, metrics.pressResistances * 0.20, 'possession', false);
  }

  if (metrics.hardestShotKmh && metrics.hardestShotKmh >= 100) {
    addFactor(`100+ km/h Shot (${Math.round(metrics.hardestShotKmh)} km/h)`, 0.15, 'attack', false);
  }

  if (metrics.bigChancesMissed > 0) {
    const bcmPenalty = Math.round(-0.30 * metrics.bigChancesMissed * 100) / 100;
    addFactor(`Big Chance Missed (${metrics.bigChancesMissed})`, bcmPenalty, 'attack', false);
  }

  if (metrics.toughAngleMisses && metrics.toughAngleMisses > 0) {
    addFactor(`Tough Angle Miss (${metrics.toughAngleMisses})`, metrics.toughAngleMisses * -0.05, 'attack', false);
  }

  if (metrics.hospitalPasses && metrics.hospitalPasses > 0) {
    addFactor(`Hospital Pass into Traffic (${metrics.hospitalPasses})`, metrics.hospitalPasses * -0.30, 'possession', false);
  }

  if (metrics.infieldCrosses && metrics.infieldCrosses > 0) {
    addFactor(`Infield Cross (${metrics.infieldCrosses})`, metrics.infieldCrosses * 0.35, 'attack', false);
  }

  if (metrics.cornerRollGiveaways && metrics.cornerRollGiveaways > 0) {
    addFactor(`Corner-Roll Giveaway (${metrics.cornerRollGiveaways})`, metrics.cornerRollGiveaways * -0.25, 'attack', false);
  }

  // =========================================================================
  // 2. DEFENSIVE CONTRIBUTIONS, TACKLES & 50/50s
  // =========================================================================
  if (metrics.cleanSheet && metrics.isWin) {
    addFactor('Clean Sheet', 0.35, 'defense', false);
  }

  if (metrics.backPostRotations && metrics.backPostRotations > 0) {
    addFactor(`Back-Post Rotation (${metrics.backPostRotations})`, metrics.backPostRotations * 0.20, 'defense', false);
  }

  if (metrics.nearPostTraps && metrics.nearPostTraps > 0) {
    addFactor(`Near-Post Flat-Foot Trap (${metrics.nearPostTraps})`, metrics.nearPostTraps * -0.35, 'defense', false);
  }

  if (metrics.shadowDefenses && metrics.shadowDefenses > 0) {
    addFactor(`Shadow Defense Delay (${metrics.shadowDefenses})`, metrics.shadowDefenses * 0.25, 'defense', false);
  }

  if (metrics.pressureClearances && metrics.pressureClearances > 0) {
    addFactor(`Pressure Clearance (${metrics.pressureClearances})`, metrics.pressureClearances * 0.15, 'defense', false);
  }

  if (metrics.clearances > 0) {
    const clearDelta = Math.round(Math.min(0.60, metrics.clearances * 0.15) * 100) / 100;
    addFactor(`Clearances (${metrics.clearances})`, clearDelta, 'defense', false);
  }

  if (metrics.backboardClears && metrics.backboardClears > 0) {
    addFactor(`Backboard Wall Clear (${metrics.backboardClears})`, metrics.backboardClears * 0.30, 'defense', false);
  }

  if (metrics.backboardHesitations && metrics.backboardHesitations > 0) {
    addFactor(`Backboard Hesitation (${metrics.backboardHesitations})`, metrics.backboardHesitations * -0.25, 'defense', false);
  }

  if (metrics.cleanTackles && metrics.cleanTackles > 0) {
    addFactor(`Clean Tackle (${metrics.cleanTackles})`, metrics.cleanTackles * 0.25, 'defense', false);
  }

  if (metrics.lastManTackles && metrics.lastManTackles > 0) {
    addFactor(`Last-Man Tackle (${metrics.lastManTackles})`, metrics.lastManTackles * 0.55, 'defense', true);
  }

  if (metrics.recklessDives && metrics.recklessDives > 0) {
    addFactor(`Reckless Challenge (${metrics.recklessDives})`, metrics.recklessDives * -0.45, 'defense', false);
  }

  if (metrics.waivedRecklessDives && metrics.waivedRecklessDives > 0) {
    addFactor(`Recovered Dive [50% Waiver] (${metrics.waivedRecklessDives})`, metrics.waivedRecklessDives * -0.20, 'defense', false);
  }

  if (metrics.goalLineScrambles && metrics.goalLineScrambles > 0) {
    addFactor(`Goal-Line Scramble Save (${metrics.goalLineScrambles})`, metrics.goalLineScrambles * 0.40, 'defense', true);
  }

  if (metrics.duelsWon > 0) {
    const duelDelta = Math.round(Math.min(0.60, metrics.duelsWon * 0.20) * 100) / 100;
    addFactor(`50/50 Duels Won (${metrics.duelsWon})`, duelDelta, 'defense', false);
  }

  if (metrics.duelsLost && metrics.duelsLost > 0) {
    const duelLossDelta = Math.round(Math.min(0.60, metrics.duelsLost * 0.20) * -100) / 100;
    addFactor(`50/50 Duels Lost (${metrics.duelsLost})`, duelLossDelta, 'defense', false);
  }

  if (metrics.duelStreakBonus && metrics.duelStreakBonus !== 0) {
    const streakName = metrics.duelStreakBonus > 0 ? '50/50 Winning Streak' : '50/50 Losing Streak';
    addFactor(streakName, metrics.duelStreakBonus, 'defense', false);
  }

  if (metrics.aerialDuelsWon && metrics.aerialDuelsWon > 0) {
    addFactor(`Aerial Duel Won (${metrics.aerialDuelsWon})`, metrics.aerialDuelsWon * 0.30, 'defense', false);
  }

  if (metrics.aerialWhiffs && metrics.aerialWhiffs > 0) {
    addFactor(`Aerial Whiff (${metrics.aerialWhiffs})`, metrics.aerialWhiffs * -0.25, 'defense', false);
  }

  // =========================================================================
  // 3. GOALKEEPING & SAVES
  // =========================================================================
  if (metrics.reflexSaves && metrics.reflexSaves > 0) {
    addFactor(`Reflex Save (${metrics.reflexSaves})`, metrics.reflexSaves * 0.65, 'goalkeeping', true);
  }
  if (metrics.routineSaves && metrics.routineSaves > 0) {
    addFactor(`Routine Save (${metrics.routineSaves})`, metrics.routineSaves * 0.25, 'goalkeeping', false);
  }

  const categorizedSaves = (metrics.reflexSaves || 0) + (metrics.routineSaves || 0);
  const remainingSaves = metrics.saves - categorizedSaves;
  if (remainingSaves > 0) {
    const saveDelta = Math.round(remainingSaves * 0.45 * 100) / 100;
    addFactor(`Saves (${remainingSaves})`, saveDelta, 'goalkeeping', true);
  }

  if (metrics.controlledReboundParries && metrics.controlledReboundParries > 0) {
    addFactor(`Rebound Controlled (${metrics.controlledReboundParries})`, metrics.controlledReboundParries * 0.15, 'goalkeeping', false);
  }

  if (metrics.spilledRebounds && metrics.spilledRebounds > 0) {
    addFactor(`Spilled Rebound (${metrics.spilledRebounds})`, metrics.spilledRebounds * -0.25, 'goalkeeping', false);
  }

  if (metrics.reboundInstantClears && metrics.reboundInstantClears > 0) {
    addFactor(`Instant Rebound Recovery (${metrics.reboundInstantClears})`, 0.0, 'goalkeeping', false);
  }

  // =========================================================================
  // 4. DEFENSIVE ACCOUNTABILITY & REWIND CAUSES
  // =========================================================================
  if (metrics.boostAbandonments && metrics.boostAbandonments > 0) {
    addFactor(`Boost-Over-Ball Concession (${metrics.boostAbandonments})`, metrics.boostAbandonments * -0.75, 'defense', false);
  }

  if (metrics.spectatorConcessions && metrics.spectatorConcessions > 0) {
    addFactor(`Spectator in Goalmouth (${metrics.spectatorConcessions})`, metrics.spectatorConcessions * -0.45, 'defense', false);
  }

  if (metrics.kickoffBreakdowns && metrics.kickoffBreakdowns > 0) {
    addFactor(`Kickoff Breakdown (${metrics.kickoffBreakdowns})`, metrics.kickoffBreakdowns * -0.40, 'defense', false);
  }

  if (metrics.failedSlotRecoveries && metrics.failedSlotRecoveries > 0) {
    addFactor(`Hesitation on Open Slot (${metrics.failedSlotRecoveries})`, metrics.failedSlotRecoveries * -0.50, 'defense', false);
  }

  if (metrics.honestEfforts && metrics.honestEfforts > 0) {
    addFactor(`Honest Recovery Effort (${metrics.honestEfforts})`, metrics.honestEfforts * -0.15, 'defense', false);
  }

  if (metrics.fastBreakImmunities && metrics.fastBreakImmunities > 0) {
    addFactor(`Fast-Break Immunity (${metrics.fastBreakImmunities})`, 0.0, 'defense', false);
  }

  // Generic concession fallback if no causal rewind was mapped
  const causalAttributedConcessions =
    (metrics.boostAbandonments || 0) +
    (metrics.spectatorConcessions || 0) +
    (metrics.kickoffBreakdowns || 0) +
    (metrics.failedSlotRecoveries || 0) +
    (metrics.honestEfforts || 0) +
    (metrics.fastBreakImmunities || 0);

  const unattributedConcessions = metrics.goalsConceded - causalAttributedConcessions;
  if (unattributedConcessions > 0) {
    const concessionPenalty = Math.round(-0.20 * unattributedConcessions * 100) / 100;
    addFactor(`Team Conceded (${unattributedConcessions})`, concessionPenalty, 'defense', false);
  }

  // =========================================================================
  // 5. TURNOVER & 5-SECOND COUNTER-PRESS RECOVERY
  // =========================================================================
  if (metrics.counterPressRecoveries && metrics.counterPressRecoveries > 0) {
    const pressDelta = Math.round(Math.min(0.45, metrics.counterPressRecoveries * 0.15) * 100) / 100;
    addFactor(`5s Counter-Press Recovery (${metrics.counterPressRecoveries})`, pressDelta, 'turnover_recovery', false);
  }

  if (metrics.sloppyTurnovers && metrics.sloppyTurnovers > 0) {
    addFactor(`Sloppy Turnover (${metrics.sloppyTurnovers})`, metrics.sloppyTurnovers * -0.20, 'turnover_recovery', false);
  }

  if (metrics.turnoverConcessions > 0) {
    const toPenalty = Math.round(-0.35 * metrics.turnoverConcessions * 100) / 100;
    addFactor(`Fatal Defensive Turnover (${metrics.turnoverConcessions})`, toPenalty, 'turnover_recovery', false);
  }

  // =========================================================================
  // 6. MOTOR, DISCIPLINE & PHYSICALITY
  // =========================================================================
  const playMs = Math.max(1, metrics.carMs);
  const supersonicRatio = metrics.supersonicMs / playMs;
  if (supersonicRatio >= 0.15) {
    const motorBonus = Math.round(Math.min(0.30, (supersonicRatio - 0.10) * 1.5) * 100) / 100;
    if (motorBonus > 0) {
      addFactor(`Supersonic Pace (${Math.round(supersonicRatio * 100)}%)`, motorBonus, 'discipline', false);
    }
  }

  if (metrics.tacticalDemos && metrics.tacticalDemos > 0) {
    addFactor(`Tactical Demolition (${metrics.tacticalDemos})`, metrics.tacticalDemos * 0.40, 'discipline', false);
  }

  const standardDemos = metrics.demos - (metrics.tacticalDemos || 0);
  if (standardDemos > 0) {
    const demoDelta = Math.round(Math.min(0.30, standardDemos * 0.10) * 100) / 100;
    addFactor(`Demolitions (${standardDemos})`, demoDelta, 'discipline', false);
  }

  if (metrics.tailingOvercommits && metrics.tailingOvercommits > 0) {
    const tailingPenalty = Math.round(metrics.tailingOvercommits * 0.65 * 100) / 100;
    addFactor(`Tailing Overcommit Concession (${metrics.tailingOvercommits})`, -tailingPenalty, 'discipline', false);
  }

  if (metrics.doubleCommits && metrics.doubleCommits > 0) {
    if (metrics.coveredDoubleCommits !== undefined || metrics.netRushDoubleCommits !== undefined) {
      const covered = metrics.coveredDoubleCommits || 0;
      const netRush = metrics.netRushDoubleCommits || 0;
      const openNet = Math.max(0, metrics.doubleCommits - covered - netRush);
      if (covered > 0) {
        addFactor(`Covered 3s Overlap (${covered})`, -Math.round(covered * 0.10 * 100) / 100, 'discipline', false);
      }
      if (openNet > 0) {
        addFactor(`Open-Net Double Commit (${openNet})`, -Math.round(openNet * 0.25 * 100) / 100, 'discipline', false);
      }
      if (netRush > 0) {
        addFactor(`Empty-Net Rush Overcommit (${netRush})`, -Math.round(netRush * 0.50 * 100) / 100, 'discipline', false);
      }
    } else {
      const dcPenalty = Math.round(metrics.doubleCommits * 0.20 * 100) / 100;
      addFactor(`Double Commits (${metrics.doubleCommits})`, -dcPenalty, 'discipline', false);
    }
  }

  if (metrics.fatalDoubleCommits && metrics.fatalDoubleCommits > 0) {
    const fatalPenalty = Math.round(metrics.fatalDoubleCommits * 0.40 * 100) / 100;
    addFactor(`Fatal Double Commit (${metrics.fatalDoubleCommits})`, -fatalPenalty, 'discipline', false);
  }

  if (metrics.thirdManCovers && metrics.thirdManCovers > 0) {
    const coverDelta = Math.round(Math.min(0.30, metrics.thirdManCovers * 0.10) * 100) / 100;
    addFactor(`3rd-Man Safety Cover (${metrics.thirdManCovers})`, coverDelta, 'defense', false);
  }

  if (metrics.ownGoals > 0) {
    const ogPenalty = Math.round(-0.60 * metrics.ownGoals * 100) / 100;
    addFactor(`Unforced Own Goal (${metrics.ownGoals})`, ogPenalty, 'discipline', false);
  }

  if (metrics.deflectedOwnGoals && metrics.deflectedOwnGoals > 0) {
    addFactor(`Deflected Own Goal (${metrics.deflectedOwnGoals})`, metrics.deflectedOwnGoals * -0.15, 'discipline', false);
  }

  const emptyBoostRatio = metrics.emptyBoostMs / playMs;
  if (emptyBoostRatio > 0.15) {
    addFactor(`Boost Starvation (${Math.round(emptyBoostRatio * 100)}% empty)`, -0.25, 'discipline', false);
  }

  if (metrics.smallPadDisciplines && metrics.smallPadDisciplines > 0) {
    addFactor(`Small-Pad Line Discipline (${metrics.smallPadDisciplines})`, metrics.smallPadDisciplines * 0.15, 'discipline', false);
  }

  if (metrics.cornerBoostDesertions && metrics.cornerBoostDesertions > 0) {
    addFactor(`Corner Boost Desertion (${metrics.cornerBoostDesertions})`, metrics.cornerBoostDesertions * -0.35, 'discipline', false);
  }

  if (metrics.kickoffCheatUps && metrics.kickoffCheatUps > 0) {
    addFactor(`Kickoff Cheat-Up Support (${metrics.kickoffCheatUps})`, metrics.kickoffCheatUps * 0.20, 'discipline', false);
  }

  if (metrics.doubleCornerDesertions && metrics.doubleCornerDesertions > 0) {
    addFactor(`Double-Corner Desertion (${metrics.doubleCornerDesertions})`, metrics.doubleCornerDesertions * -0.40, 'discipline', false);
  }

  if (metrics.demoEvasions && metrics.demoEvasions > 0) {
    addFactor(`Demolition Evasion (${metrics.demoEvasions})`, metrics.demoEvasions * 0.15, 'discipline', false);
  }

  if (metrics.boostSteals && metrics.boostSteals > 0) {
    addFactor(`Opponent Boost Starvation / Steal (${metrics.boostSteals})`, metrics.boostSteals * 0.25, 'discipline', false);
  }

  // =========================================================================
  // 7. MATCH OUTCOME & CLUTCH
  // =========================================================================
  if (metrics.isWin) {
    const winDelta = metrics.isOvertime ? 0.15 : 0.25;
    addFactor(metrics.isOvertime ? 'OT Victory' : 'Victory', winDelta, 'clutch', false);
  } else {
    addFactor('Defeat', -0.25, 'clutch', false);
  }

  // Apply FotMob-style score compression above 7.5 with smooth quarter-sine diminishing returns towards 10.0
  let compressedScore = score;
  if (score >= 15.0) {
    compressedScore = 10.0;
  } else if (score > 7.5) {
    const extra = score - 7.5;
    const progress = Math.min(1.0, extra / 7.5);
    compressedScore = 7.5 + 2.5 * Math.sin((progress * Math.PI) / 2);
  }

  // Clamped strictly to [0.0, 10.0], 1 decimal place
  const finalScore = Math.round(Math.max(0.0, Math.min(10.0, compressedScore)) * 10) / 10;

  return {
    score: finalScore,
    factors,
  };
}

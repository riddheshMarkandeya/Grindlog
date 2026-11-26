import type { RadarProfile, TacticalArchetype } from '../../shared/types.ts';

export interface RadarInputMetrics {
  goals: number;
  shots: number;
  assists: number;
  saves: number;
  demos: number;
  clearances: number;
  keyPasses: number;
  duelsWon: number;
  touchesMidfield: number;
  touchesTotal: number;
  carMs: number;
  supersonicMs: number;
  boostAvg: number | null;
  emptyBoostMs: number;
  xg: number;
  aerialTouches?: number;
  doubleCommits?: number;

  // Extended Rule & Rating Telemetry (Optional for backwards compatibility)
  screamers?: number;
  soloGoals?: number;
  counterGoals?: number;
  bigChancesMissed?: number;
  hardestShotKmh?: number | null;

  bigChancesCreated?: number;
  favorablePasses?: number;
  infieldCrosses?: number;
  hockeyAssists?: number;
  hospitalPasses?: number;
  cornerRollGiveaways?: number;

  reflexSaves?: number;
  reboundInstantClears?: number;
  spilledRebounds?: number;
  shadowDefenses?: number;
  backPostRotations?: number;
  backboardClears?: number;
  goalLineScrambles?: number;
  counterPressRecoveries?: number;
  turnoverConcessions?: number;

  tacticalDemos?: number;

  smallPads?: number;
  bigOrbs?: number;
  padRatioPct?: number;
  boostSteals?: number;
  boostAbandonments?: number;
  cornerBoostDesertions?: number;

  aerialGoals?: number;
  flipResets?: number;

  fatalDoubleCommits?: number;
  nearPostTraps?: number;
  recklessDives?: number;
  kickoffCheatUps?: number;
  doubleCornerDesertions?: number;
  touchesDefence?: number;
  touchesAttack?: number;
  coveredDoubleCommits?: number;
  netRushDoubleCommits?: number;
  thirdManCovers?: number;
}

function clamp01(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

export function calculatePlayerRadar(input: RadarInputMetrics): RadarProfile {
  const durationMinutes = Math.max(1.0, input.carMs / 60_000);
  const normFactor = 5.0 / durationMinutes; // Scale to 5-minute regulation

  // 1. Finishing (0 - 100): Volume, conversion, xG clinicality, shot quality nuances, minus big chances missed
  const goalsPer5 = input.goals * normFactor;
  const shotPct = input.shots > 0 ? (input.goals / input.shots) * 100 : 0;
  const clinicalityPer5 = (input.goals - input.xg) * normFactor;
  const qualityFinishesPer5 =
    ((input.screamers ?? 0) + (input.soloGoals ?? 0) * 1.2 + (input.counterGoals ?? 0)) * normFactor;
  const speedBonus = (input.hardestShotKmh ?? 0) >= 105 ? 4 : (input.hardestShotKmh ?? 0) >= 90 ? 2 : 0;
  const bigMissPenalty = ((input.bigChancesMissed ?? 0) * normFactor) * 6;

  const finishRaw =
    clamp01(goalsPer5, 0, 2.4) * 45 +
    clamp01(shotPct, 0, 42) * 30 +
    clamp01(clinicalityPer5, -0.8, 1.4) * 15 +
    clamp01(qualityFinishesPer5, 0, 1.2) * 10 +
    speedBonus -
    bigMissPenalty;
  const finishScore = Math.round(finishRaw);

  // 2. Creation (0 - 100): Assists, key passes, big chances created, favorable passes, infield crosses, minus hospital/corner roll giveaways
  const assistsPer5 = input.assists * normFactor;
  const keyPassesPer5 = input.keyPasses * normFactor;
  const bccPer5 = (input.bigChancesCreated ?? 0) * normFactor;
  const favorablePer5 = (input.favorablePasses ?? 0) * normFactor;
  const infieldPer5 = (input.infieldCrosses ?? 0) * normFactor;
  const hockeyPer5 = (input.hockeyAssists ?? 0) * normFactor;
  const midTouchPct = input.touchesTotal > 0 ? (input.touchesMidfield / input.touchesTotal) * 100 : 0;

  // Playmaking weighted score so both single-match rich events and career box + key pass scans scale accurately
  const playmakingIndex =
    assistsPer5 * 1.6 +
    keyPassesPer5 * 0.65 +
    bccPer5 * 0.9 +
    favorablePer5 * 0.45 +
    infieldPer5 * 0.45 +
    hockeyPer5 * 0.35;

  const badDeliveryPenalty =
    ((input.hospitalPasses ?? 0) * 6 + (input.cornerRollGiveaways ?? 0) * 4) * normFactor;

  const createRaw =
    clamp01(playmakingIndex, 0, 4.2) * 75 +
    clamp01(midTouchPct, 15, 48) * 25 -
    badDeliveryPenalty;
  const createScore = Math.round(createRaw);

  // 3. Defense (0 - 100): Saves, clears + reflex saves, backboard clears, shadow defense, back-post rotations, counter-press, minus errors
  const savesPer5 = input.saves * normFactor;
  const clearsPer5 = input.clearances * normFactor;
  const tacticalDefCount =
    (input.reflexSaves ?? 0) * 1.2 +
    (input.reboundInstantClears ?? 0) * 0.7 +
    (input.shadowDefenses ?? 0) * 1.0 +
    (input.backPostRotations ?? 0) * 0.8 +
    (input.backboardClears ?? 0) * 1.0 +
    (input.goalLineScrambles ?? 0) * 1.2 +
    (input.counterPressRecoveries ?? 0) * 0.5;
  const tacticalDefPer5 = tacticalDefCount * normFactor;
  const defErrorPenalty =
    ((input.spilledRebounds ?? 0) * 5 + (input.turnoverConcessions ?? 0) * 7) * normFactor;

  const defRaw =
    clamp01(savesPer5, 0, 3.5) * 54 +
    clamp01(clearsPer5, 0, 8.0) * 28 +
    clamp01(tacticalDefPer5, 0, 2.5) * 18 -
    defErrorPenalty;
  const defScore = Math.round(defRaw);

  // 4. Motor (0 - 100): Pace, Pitch Coverage, Counter-Press Pursuit & Kickoff Cheat-Up
  let motorScore: number;
  const counterPressPer5 = (input.counterPressRecoveries ?? 0) * normFactor;
  const paceRuleBonus = Math.min(8, counterPressPer5 * 2.5 + ((input.kickoffCheatUps ?? 0) * normFactor) * 2);

  if (input.supersonicMs > 0 && input.carMs > 0) {
    const supersonicPct = (input.supersonicMs / input.carMs) * 100;
    const speedPart = clamp01(supersonicPct, 2.0, 22.0) * 48;
    const touchesPer5 = input.touchesTotal * normFactor;
    const touchPart = clamp01(touchesPer5, 10.0, 45.0) * 34;
    const basePace = 14;
    motorScore = Math.round(basePace + speedPart + touchPart + paceRuleBonus);
  } else {
    const touchesPer5 = input.touchesTotal * normFactor;
    const workPart = clamp01(touchesPer5, 8.0, 42.0) * 52;
    const actionsPer5 = (input.shots + input.saves + input.demos + input.goals) * normFactor;
    const actionPart = clamp01(actionsPer5, 1.0, 8.0) * 24;
    const baseWork = 18;
    motorScore = Math.round(baseWork + workPart + actionPart + paceRuleBonus);
  }

  // 5. Physicality (0 - 100): Realistic Demos/5m (0-2.0) + Tactical Disruption + Real 50/50 Duels Won (0-6.0)
  const effectiveDemosPer5 = (input.demos + (input.tacticalDemos ?? 0) * 0.5) * normFactor;
  const duelsPer5 = input.duelsWon * normFactor;
  const activePhysBase = input.touchesTotal > 5 ? 8 : 0;
  const physRaw =
    activePhysBase +
    clamp01(effectiveDemosPer5, 0, 2.2) * 50 +
    clamp01(duelsPer5, 0, 5.5) * 42;
  const physScore = Math.round(physRaw);

  // 6. Boost IQ (0 - 100): Avg Boost + Low Empty Time + Small Pad Pathing + Opponent Boost Steals - Abandonments
  const boostAvg = input.boostAvg ?? 50.0;
  const emptyPct = input.carMs > 0 ? (input.emptyBoostMs / input.carMs) * 100 : 0;
  const hasPadTelemetry = (input.smallPads ?? 0) + (input.bigOrbs ?? 0) > 0;
  const padBonus = hasPadTelemetry
    ? clamp01(input.padRatioPct ?? 50, 40, 82) * 14
    : emptyPct < 10
    ? 8
    : 3;
  const stealBonus = Math.min(10, ((input.boostSteals ?? 0) * normFactor) * 4);
  const boostPenalty =
    ((input.boostAbandonments ?? 0) * 12 + (input.cornerBoostDesertions ?? 0) * 8) * normFactor;

  const boostRaw =
    clamp01(boostAvg, 30, 75) * 45 +
    (1.0 - clamp01(emptyPct, 0, 20)) * 35 +
    padBonus +
    stealBonus -
    boostPenalty;
  const boostScore = Math.round(boostRaw);

  // 7. Aerial Prowess (0 - 100): Aerial Touches + Backboard Clears + Aerial Goals / Flip Resets
  const aerialPer5 = (input.aerialTouches ?? 0) * normFactor;
  const bbClearsPer5 = (input.backboardClears ?? 0) * normFactor;
  const aerialHighlightsPer5 = ((input.aerialGoals ?? 0) + (input.flipResets ?? 0) * 0.8) * normFactor;
  const aerialRaw =
    clamp01(aerialPer5, 0, 4.0) * 70 +
    clamp01(bbClearsPer5, 0, 1.5) * 15 +
    clamp01(aerialHighlightsPer5, 0, 0.5) * 15;
  const aerialScore = Math.round(aerialRaw);

  // 8. Rotational Discipline (0 - 100): Neutral 50 baseline + Rotational Mastery + Restraint + Anchor Balance - Errors
  const defShare = input.touchesTotal > 0 && input.touchesDefence !== undefined
    ? input.touchesDefence / input.touchesTotal
    : 0.35;
  const attShare = input.touchesTotal > 0 && input.touchesAttack !== undefined
    ? input.touchesAttack / input.touchesTotal
    : 0.30;

  const rawDc = input.doubleCommits ?? 0;
  const coveredDc = input.coveredDoubleCommits ?? 0;
  const netRushDc = input.netRushDoubleCommits ?? 0;
  const exposedDc = Math.max(0, rawDc - coveredDc - netRushDc);
  const dcPer5 = (coveredDc * 0.35 + exposedDc * 1.0 + netRushDc * 1.8) * normFactor;
  const fatalDcPer5 = (input.fatalDoubleCommits ?? 0) * normFactor;
  const nearPostPer5 = (input.nearPostTraps ?? 0) * normFactor;
  const divePer5 = (input.recklessDives ?? 0) * normFactor;
  const koDesertPer5 = (input.doubleCornerDesertions ?? 0) * normFactor;
  const cbdPer5 = (input.cornerBoostDesertions ?? 0) * normFactor;
  const baPer5 = (input.boostAbandonments ?? 0) * normFactor;
  const turnoverPer5 = (input.turnoverConcessions ?? 0) * normFactor;
  const crgPer5 = (input.cornerRollGiveaways ?? 0) * normFactor;
  const hosPer5 = (input.hospitalPasses ?? 0) * normFactor;
  const srPer5 = (input.spilledRebounds ?? 0) * normFactor;

  const positiveRotBonus = Math.min(
    18,
    ((input.backPostRotations ?? 0) * 3.5 +
      (input.shadowDefenses ?? 0) * 3.5 +
      (input.kickoffCheatUps ?? 0) * 2.5 +
      (input.reboundInstantClears ?? 0) * 3.5 +
      (input.thirdManCovers ?? 0) * 3.0 +
      (input.counterPressRecoveries ?? 0) * 0.25) *
      normFactor
  );

  // Clean-play restraint & third-man anchor structure so defenders vs ball-chasers separate accurately
  const cleanRestraintBonus =
    dcPer5 <= 0.15 && turnoverPer5 <= 0.15
      ? 14
      : dcPer5 <= 0.35 && turnoverPer5 <= 0.25
      ? 7
      : dcPer5 <= 0.46
      ? 3
      : 0;

  const structuralAnchorBonus =
    clamp01(defShare - attShare * 0.45, 0.16, 0.42) * 8 +
    clamp01(savesPer5 * 0.75 + clearsPer5 * 0.22, 0.8, 3.2) * 4;

  const disciplinePenalties =
    dcPer5 * 18 +
    fatalDcPer5 * 22 +
    turnoverPer5 * 20 +
    divePer5 * 15 +
    nearPostPer5 * 12 +
    koDesertPer5 * 14 +
    baPer5 * 14 +
    cbdPer5 * 10 +
    crgPer5 * 5 +
    srPer5 * 3 +
    Math.max(0, hosPer5 - 1.5) * 4 +
    (emptyPct > 10 ? 4 : 0);

  const posScore = Math.max(
    10,
    Math.min(
      99,
      Math.round(50 + positiveRotBonus + cleanRestraintBonus + structuralAnchorBonus - disciplinePenalties)
    )
  );

  // Clamp attributes [10, 99]
  const clampedFinishing = Math.max(10, Math.min(99, finishScore));
  const clampedCreation = Math.max(10, Math.min(99, createScore));
  const clampedDefense = Math.max(10, Math.min(99, defScore));
  const clampedMotor = Math.max(10, Math.min(99, motorScore));
  const clampedPhys = Math.max(10, Math.min(99, physScore));
  const clampedBoost = Math.max(10, Math.min(99, boostScore));
  const clampedAerial = Math.max(10, Math.min(99, aerialScore));
  const clampedPos = Math.max(10, Math.min(99, posScore));

  // Archetype Classification based on Relative Dominance across all 8 attributes
  const allScores = [
    clampedFinishing,
    clampedCreation,
    clampedDefense,
    clampedMotor,
    clampedPhys,
    clampedBoost,
    clampedAerial,
    clampedPos,
  ];
  const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;

  const activeScores = [
    clampedFinishing,
    clampedCreation,
    clampedDefense,
    clampedMotor,
    clampedPhys,
    clampedBoost,
    clampedAerial,
  ];
  const maxActive = Math.max(...activeScores);

  let archetype: TacticalArchetype = 'The All-Rounder';

  if (maxActive <= 22) {
    archetype = 'The Passenger';
  } else if (clampedAerial >= 55 && clampedAerial >= clampedFinishing && clampedAerial >= avgScore + 8) {
    archetype = 'The Air Marshal';
  } else if (clampedFinishing >= 55 && clampedFinishing >= clampedCreation + 8 && clampedFinishing >= clampedDefense + 8) {
    archetype = 'The Striker';
  } else if (clampedCreation >= 50 && clampedCreation >= clampedFinishing && clampedCreation >= clampedDefense) {
    archetype = 'The Playmaker';
  } else if (clampedDefense >= 50 && clampedDefense >= clampedFinishing && clampedDefense >= clampedCreation) {
    archetype = 'The Anchor';
  } else if (clampedPhys >= 55 && clampedPhys >= clampedFinishing) {
    archetype = 'The Disruptor';
  } else if (clampedMotor >= 60 && clampedMotor >= avgScore + 10) {
    archetype = 'The Speed Demon';
  } else if (clampedBoost >= 65 && clampedBoost >= avgScore + 12) {
    archetype = 'The Boost Hawk';
  } else if (clampedFinishing >= 50) {
    archetype = 'The Striker';
  } else if (clampedDefense >= 45) {
    archetype = 'The Anchor';
  } else if (clampedCreation >= 45) {
    archetype = 'The Playmaker';
  } else if (clampedPhys >= 45) {
    archetype = 'The Disruptor';
  } else if (clampedAerial >= 45) {
    archetype = 'The Air Marshal';
  } else {
    archetype = 'The All-Rounder';
  }

  return {
    finishing: clampedFinishing,
    creation: clampedCreation,
    defense: clampedDefense,
    motor: clampedMotor,
    physicality: clampedPhys,
    boost_iq: clampedBoost,
    aerial: clampedAerial,
    positioning: clampedPos,
    archetype,
  };
}

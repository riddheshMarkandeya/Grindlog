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

  // Extended FIFA + RL Skill Telemetry
  dribbleChains?: number;
  dribbleTakeOns?: number;
  dribbleGoals?: number;
  dribbleTurnovers?: number;
  cleanDispossessions?: number;
  paceSprints?: number;
  avgTransitionVelocity?: number;
  blitzCounterGoals?: number;
  xgPrevented?: number;

  // Extended Rule & Rating Telemetry
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

function clampAxis(v: number): number {
  return Math.max(10, Math.min(99, Math.round(v)));
}

/**
 * Single canonical Unified 8-Axis FIFA+RL Radar calculator powering every UI radar,
 * FIFA stat strip, OVR badge, and squad profile across OvertimeRL.
 * Cleanly separates Outfield Tackling (`tackling`) from Net Protection (`goalkeeping`),
 * adds Dribbling (`dribbling`), and replaces Motor with Transition Speed (`pace`).
 */
export function calculatePlayerRadar(input: RadarInputMetrics): RadarProfile {
  const durationMinutes = Math.max(1.0, input.carMs / 60_000);
  const normFactor = 5.0 / durationMinutes;

  // 1. Finishing (SHO): Goals, conversion %, xG clinicality, shot quality & power, minus big misses
  const goalsPer5 = input.goals * normFactor;
  const shotPct = input.shots > 0 ? (input.goals / input.shots) * 100 : 0;
  const clinicalityPer5 = (input.goals - input.xg) * normFactor;
  const qualityFinishesPer5 =
    ((input.screamers ?? 0) + (input.soloGoals ?? 0) * 1.2 + (input.counterGoals ?? 0)) * normFactor;
  const speedBonus = (input.hardestShotKmh ?? 0) >= 105 ? 4 : (input.hardestShotKmh ?? 0) >= 90 ? 2 : 0;
  const bigMissPenalty = ((input.bigChancesMissed ?? 0) * normFactor) * 6;

  const clampedFinishing = clampAxis(
    clamp01(goalsPer5, 0, 2.4) * 45 +
      clamp01(shotPct, 0, 42) * 30 +
      clamp01(clinicalityPer5, -0.8, 1.4) * 15 +
      clamp01(qualityFinishesPer5, 0, 1.2) * 10 +
      speedBonus -
      bigMissPenalty
  );

  // 2. Creation (PAS): Assists, key passes, big chances created, favorable passes, infield crosses
  const assistsPer5 = input.assists * normFactor;
  const keyPassesPer5 = input.keyPasses * normFactor;
  const bccPer5 = (input.bigChancesCreated ?? 0) * normFactor;
  const favorablePer5 = (input.favorablePasses ?? 0) * normFactor;
  const infieldPer5 = (input.infieldCrosses ?? 0) * normFactor;
  const hockeyPer5 = (input.hockeyAssists ?? 0) * normFactor;
  const midTouchPct = input.touchesTotal > 0 ? (input.touchesMidfield / input.touchesTotal) * 100 : 0;

  const playmakingIndex =
    assistsPer5 * 1.6 +
    keyPassesPer5 * 0.65 +
    bccPer5 * 0.9 +
    favorablePer5 * 0.45 +
    infieldPer5 * 0.45 +
    hockeyPer5 * 0.35;
  const badDeliveryPenalty =
    ((input.hospitalPasses ?? 0) * 6 + (input.cornerRollGiveaways ?? 0) * 4) * normFactor;

  const clampedCreation = clampAxis(
    clamp01(playmakingIndex, 0, 4.2) * 75 +
      clamp01(midTouchPct, 15, 48) * 25 -
      badDeliveryPenalty
  );

  // 3. Dribbling (DRI): Sustained forward multi-touch carries + challenger take-ons + solo dribble goals
  const dribbleChainsPer5 =
    (input.dribbleChains !== undefined ? input.dribbleChains : Math.max(0, input.touchesTotal * 0.08)) * normFactor;
  const takeOnsPer5 = (input.dribbleTakeOns ?? 0) * normFactor;
  const dribbleGoalsPer5 = ((input.dribbleGoals ?? 0) + (input.soloGoals ?? 0) * 0.7) * normFactor;
  const dribbleLossPenalty =
    ((input.dribbleTurnovers ?? 0) * 4.5 + (input.cornerRollGiveaways ?? 0) * 2.5) * normFactor;
  const activeDribbleBase = input.touchesTotal >= 20 ? 18 : input.touchesTotal > 8 ? 12 : 0;

  const clampedDribbling = clampAxis(
    activeDribbleBase +
      clamp01(dribbleChainsPer5, 0, 3.8) * 38 +
      clamp01(takeOnsPer5, 0, 1.8) * 22 +
      clamp01(dribbleGoalsPer5, 0, 1.0) * 22 -
      dribbleLossPenalty
  );

  // 4. Pace (PAC): Net-to-net ball transition speed + blitz counter goals + supersonic pitch tempo
  const supersonicPct = input.carMs > 0 && input.supersonicMs > 0 ? (input.supersonicMs / input.carMs) * 100 : 0;
  const touchesPer5 = input.touchesTotal * normFactor;
  const paceSprintsPer5 = (input.paceSprints ?? 0) * normFactor;
  const avgTransitionVel = input.avgTransitionVelocity ?? 0;
  const blitzPer5 = ((input.blitzCounterGoals ?? 0) + (input.counterGoals ?? 0) * 0.6) * normFactor;
  const paceRuleBonus = Math.min(
    8,
    ((input.counterPressRecoveries ?? 0) * 2.0 + (input.kickoffCheatUps ?? 0) * 2.0) * normFactor
  );

  let paceRaw: number;
  if (avgTransitionVel > 0 || paceSprintsPer5 > 0) {
    paceRaw =
      10 +
      clamp01(avgTransitionVel, 900, 2100) * 32 +
      clamp01(paceSprintsPer5, 0, 4.5) * 24 +
      clamp01(blitzPer5, 0, 1.0) * 14 +
      clamp01(supersonicPct, 2.0, 22.0) * 20;
  } else if (input.supersonicMs > 0) {
    paceRaw =
      14 +
      clamp01(supersonicPct, 2.0, 22.0) * 48 +
      clamp01(touchesPer5, 10.0, 45.0) * 30 +
      paceRuleBonus +
      Math.min(10, blitzPer5 * 10);
  } else {
    const actionsPer5 = (input.shots + input.saves + input.demos + input.goals) * normFactor;
    paceRaw =
      18 +
      clamp01(touchesPer5, 8.0, 42.0) * 50 +
      clamp01(actionsPer5, 1.0, 8.0) * 22 +
      paceRuleBonus;
  }
  const clampedPace = clampAxis(paceRaw);

  // 5. Tackling (TAC): Outfield ball-winning (won 50/50s + clean steals + shadow defense + backboard clears + demos)
  const duelsPer5 = input.duelsWon * normFactor;
  const stealsPer5 = ((input.cleanDispossessions ?? 0) + (input.counterPressRecoveries ?? 0) * 0.75) * normFactor;
  const outfieldStopPer5 =
    ((input.shadowDefenses ?? 0) * 1.1 +
      (input.backboardClears ?? 0) * 0.8 +
      (input.demos * 0.45 + (input.tacticalDemos ?? 0) * 0.65)) *
    normFactor;
  const tackleDivePenalty = (input.recklessDives ?? 0) * 6 * normFactor;
  const activeTackleBase = input.touchesTotal > 5 ? 8 : 0;

  const clampedTackling = clampAxis(
    activeTackleBase +
      clamp01(duelsPer5, 0, 5.2) * 38 +
      clamp01(stealsPer5, 0, 4.0) * 30 +
      clamp01(outfieldStopPer5, 0, 3.5) * 24 -
      tackleDivePenalty
  );

  // 6. Goalkeeping (GK): Shot-difficulty xG prevented + saves + clearances + safe rebound clears - spills
  const savesPer5 = input.saves * normFactor;
  const xgPreventedPer5 = (input.xgPrevented ?? input.saves * 0.28) * normFactor;
  const clearsPer5 = input.clearances * normFactor;
  const gkClutchPer5 =
    ((input.reflexSaves ?? 0) * 1.2 +
      (input.goalLineScrambles ?? 0) * 1.2 +
      (input.reboundInstantClears ?? 0) * 0.8 +
      (input.backPostRotations ?? 0) * 0.5) *
    normFactor;
  const gkErrorPenalty =
    ((input.spilledRebounds ?? 0) * 6 + (input.turnoverConcessions ?? 0) * 4) * normFactor;

  const clampedGoalkeeping = clampAxis(
    clamp01(xgPreventedPer5, 0, 1.35) * 44 +
      clamp01(savesPer5, 0, 3.5) * 24 +
      clamp01(clearsPer5, 0, 8.0) * 16 +
      clamp01(gkClutchPer5, 0, 2.2) * 16 -
      gkErrorPenalty
  );

  // 7. Aerial Prowess (AER)
  const aerialPer5 = (input.aerialTouches ?? 0) * normFactor;
  const bbClearsPer5 = (input.backboardClears ?? 0) * normFactor;
  const aerialHighlightsPer5 = ((input.aerialGoals ?? 0) + (input.flipResets ?? 0) * 0.8) * normFactor;
  const clampedAerial = clampAxis(
    clamp01(aerialPer5, 0, 4.0) * 70 +
      clamp01(bbClearsPer5, 0, 1.5) * 15 +
      clamp01(aerialHighlightsPer5, 0, 0.5) * 15
  );

  // 8. Discipline (DIS): Rotational spacing, 3rd-man safety covers, restraint & boost/pad discipline
  const defShare =
    input.touchesTotal > 0 && input.touchesDefence !== undefined
      ? input.touchesDefence / input.touchesTotal
      : 0.35;
  const attShare =
    input.touchesTotal > 0 && input.touchesAttack !== undefined
      ? input.touchesAttack / input.touchesTotal
      : 0.30;

  const rawDc = input.doubleCommits ?? 0;
  const coveredDc = input.coveredDoubleCommits ?? 0;
  const netRushDc = input.netRushDoubleCommits ?? 0;
  const exposedDc = Math.max(0, rawDc - coveredDc - netRushDc);
  const dcPer5 = (coveredDc * 0.25 + exposedDc * 1.0 + netRushDc * 1.8) * normFactor;
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

  const boostAvg = input.boostAvg ?? 50.0;
  const emptyPct = input.carMs > 0 ? (input.emptyBoostMs / input.carMs) * 100 : 0;
  const hasPadTelemetry = (input.smallPads ?? 0) + (input.bigOrbs ?? 0) > 0;
  const resourceDisciplineBonus =
    clamp01(boostAvg, 35, 70) * 6 +
    (hasPadTelemetry ? clamp01(input.padRatioPct ?? 50, 45, 80) * 5 : 2) +
    Math.min(4, ((input.boostSteals ?? 0) * normFactor) * 2);

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
    (emptyPct > 10 ? 5 : 0);

  const clampedPos = clampAxis(
    42 +
      positiveRotBonus +
      cleanRestraintBonus +
      structuralAnchorBonus +
      resourceDisciplineBonus -
      disciplinePenalties
  );

  // Archetype Classification across Unified 8 Axes
  const activeScores = [
    clampedFinishing,
    clampedCreation,
    clampedDribbling,
    clampedPace,
    clampedTackling,
    clampedGoalkeeping,
    clampedAerial,
  ];
  const avgScore =
    (activeScores.reduce((a, b) => a + b, 0) + clampedPos) / 8;
  const maxActive = Math.max(...activeScores);

  let archetype: TacticalArchetype = 'The All-Rounder';

  if (maxActive <= 22) {
    archetype = 'The Passenger';
  } else if (clampedAerial >= 55 && clampedAerial >= clampedFinishing && clampedAerial >= avgScore + 8) {
    archetype = 'The Air Marshal';
  } else if (clampedDribbling >= 58 && clampedDribbling >= clampedFinishing && clampedDribbling >= avgScore + 8) {
    archetype = 'The Dribbler';
  } else if (clampedFinishing >= 55 && clampedFinishing >= clampedCreation + 8 && clampedFinishing >= clampedGoalkeeping + 8) {
    archetype = 'The Striker';
  } else if (clampedCreation >= 50 && clampedCreation >= clampedFinishing && clampedCreation >= clampedGoalkeeping) {
    archetype = 'The Playmaker';
  } else if (clampedGoalkeeping >= 52 && clampedGoalkeeping >= clampedFinishing && clampedGoalkeeping >= clampedCreation) {
    archetype = 'The Anchor';
  } else if (clampedTackling >= 55 && clampedTackling >= clampedFinishing) {
    archetype = 'The Disruptor';
  } else if (clampedPace >= 60 && clampedPace >= avgScore + 10) {
    archetype = 'The Speed Demon';
  } else if (clampedFinishing >= 50) {
    archetype = 'The Striker';
  } else if (clampedGoalkeeping >= 45) {
    archetype = 'The Anchor';
  } else if (clampedCreation >= 45) {
    archetype = 'The Playmaker';
  } else if (clampedTackling >= 45) {
    archetype = 'The Disruptor';
  } else if (clampedDribbling >= 45) {
    archetype = 'The Dribbler';
  } else if (clampedAerial >= 45) {
    archetype = 'The Air Marshal';
  } else {
    archetype = 'The All-Rounder';
  }

  return {
    finishing: clampedFinishing,
    creation: clampedCreation,
    dribbling: clampedDribbling,
    pace: clampedPace,
    tackling: clampedTackling,
    goalkeeping: clampedGoalkeeping,
    aerial: clampedAerial,
    positioning: clampedPos,
    archetype,
  };
}

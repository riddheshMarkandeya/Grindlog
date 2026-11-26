import test from 'node:test';
import assert from 'node:assert/strict';
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
} from '../src/server/models/causal-evaluator.ts';

test('evaluatePassDelivery - favorable pass grants bonus and liability shields', () => {
  const passerName = 'Swapo_o';
  const passerTeam = 0;
  const ballTarget = { x: 0, y: 3500, z: 100 }; // Centered into slot

  const players = [
    { name: 'Swapo_o', team_num: 0, x: -2000, y: 3500, z: 50, speed: 1200 },
    { name: 'Teammate', team_num: 0, x: 200, y: 3400, z: 50, speed: 1400 }, // ~223 uu from target
    { name: 'Opponent1', team_num: 1, x: 0, y: 5000, z: 50, speed: 800 },   // ~1500 uu from target (in net)
    { name: 'Opponent2', team_num: 1, x: -1500, y: 2000, z: 50, speed: 1000 },
  ];

  const result = evaluatePassDelivery(passerName, passerTeam, ballTarget, players);

  assert.equal(result.isFavorable, true);
  assert.ok(result.bonusDelta >= 0.45);
  assert.equal(result.liabilityPlayer, 'Teammate'); // Teammate had spatial priority
});

test('evaluatePassDelivery - hospital pass penalizes passer', () => {
  const passerName = 'Swapo_o';
  const passerTeam = 0;
  const ballTarget = { x: 0, y: 4500, z: 100 };

  const players = [
    { name: 'Swapo_o', team_num: 0, x: 0, y: 1000, z: 50, speed: 1000 },
    { name: 'Teammate', team_num: 0, x: -2500, y: 0, z: 50, speed: 500 }, // Far away
    { name: 'Opponent1', team_num: 1, x: 0, y: 4300, z: 50, speed: 1200 }, // Waiting right at target
  ];

  const result = evaluatePassDelivery(passerName, passerTeam, ballTarget, players);

  assert.equal(result.isFavorable, false);
  assert.equal(result.bonusDelta, -0.30);
  assert.equal(result.liabilityPlayer, 'Swapo_o');
});

test('evaluate5sWinBack - waives penalty within 5s and gives recovery bonus', () => {
  const turnoverTs = 10_000;
  const losingTeam = 0;

  const hits = [
    // Opponent claims ball
    { player_name: 'Rival', team_num: 1, start_ts: 10_050, end_ts: 10_050, touch_count: 1, pre_speed: 1000, post_speed: 1200, x: 0, y: 0, z: 50 },
    // Teammate tackles and wins it back at 13.2s (3.2s elapsed)
    { player_name: 'Teammate', team_num: 0, start_ts: 13_200, end_ts: 13_200, touch_count: 1, pre_speed: 1400, post_speed: 1600, x: 200, y: 100, z: 50 },
  ];

  const result = evaluate5sWinBack(turnoverTs, hits, losingTeam);

  assert.equal(result.wonBack, true);
  assert.equal(result.elapsedSec, 3.2);
  assert.equal(result.bonus, 0.15);
  assert.equal(result.deduction, 0.0);
  assert.equal(result.recoveredBy, 'Teammate');
});

test('evaluate5sWinBack - applies deduction when not won back in 5s', () => {
  const turnoverTs = 10_000;
  const losingTeam = 0;

  const hits = [
    { player_name: 'Rival', team_num: 1, start_ts: 10_050, end_ts: 10_050, touch_count: 1, pre_speed: 1000, post_speed: 1200, x: 0, y: 0, z: 50 },
    // No friendly touch until 16.5s (6.5s elapsed)
    { player_name: 'Teammate', team_num: 0, start_ts: 16_500, end_ts: 16_500, touch_count: 1, pre_speed: 1000, post_speed: 1200, x: 0, y: 0, z: 50 },
  ];

  const result = evaluate5sWinBack(turnoverTs, hits, losingTeam, 'midfield');

  assert.equal(result.wonBack, false);
  assert.equal(result.bonus, 0.0);
  assert.equal(result.deduction, -0.20);
});

test('evaluateReboundWaiver - instant clear within 2.5s waives spilled rebound', () => {
  const saveTs = 20_000;
  const keeperName = 'Swapo_o';

  const hits = [
    { player_name: 'Swapo_o', team_num: 0, start_ts: 20_000, end_ts: 20_000, touch_count: 1, pre_speed: 1500, post_speed: 600, x: 0, y: -4800, z: 150 },
    // Keeper follows up and clears at 21.8s (1.8s later)
    { player_name: 'Swapo_o', team_num: 0, start_ts: 21_800, end_ts: 21_800, touch_count: 1, pre_speed: 600, post_speed: 1800, x: 400, y: -4500, z: 80 },
  ];

  const result = evaluateReboundWaiver(saveTs, hits, keeperName);

  assert.equal(result.waived, true);
  assert.equal(result.penalty, 0.0);
});

test('evaluateDefensiveRewind - assigns single primary cause without stacking', () => {
  const goalTs = 50_000;
  const concedingTeam = 0; // Net at Y = -5120

  const players = [
    // Spectator in net with zero velocity
    { name: 'SpectatorBot', team_num: 0, x: 0, y: -4900, z: 50, speed: 120 },
    // Rushing defender trying to save
    { name: 'TryHardDefender', team_num: 0, x: 200, y: -3800, z: 50, speed: 1800 },
    // Abandoning net for corner 100 orb
    { name: 'BoostGremlin', team_num: 0, x: 3400, y: -4500, z: 50, speed: 1600 },
    // Attacking far away on fast break
    { name: 'StrikerUpfield', team_num: 0, x: 500, y: 3500, z: 50, speed: 1200 },
  ];

  const hits = [
    { player_name: 'TryHardDefender', team_num: 0, start_ts: 49_200, end_ts: 49_200, touch_count: 1, pre_speed: 1600, post_speed: 1000, x: 100, y: -4500, z: 100 },
  ];

  const attributions = evaluateDefensiveRewind(goalTs, players, hits, concedingTeam, true);

  const spectator = attributions.find(a => a.playerName === 'SpectatorBot');
  assert.ok(spectator);
  assert.equal(spectator.cause, 'spectator');
  assert.equal(spectator.delta, -0.45);

  const honest = attributions.find(a => a.playerName === 'TryHardDefender');
  assert.ok(honest);
  assert.equal(honest.cause, 'honest_effort');
  assert.equal(honest.delta, -0.15);

  const boostGremlin = attributions.find(a => a.playerName === 'BoostGremlin');
  assert.ok(boostGremlin);
  assert.equal(boostGremlin.cause, 'boost_abandonment');
  assert.equal(boostGremlin.delta, -0.75);

  const fastBreak = attributions.find(a => a.playerName === 'StrikerUpfield');
  assert.ok(fastBreak);
  assert.equal(fastBreak.cause, 'fast_break_immunity');
  assert.equal(fastBreak.delta, 0.0);
});

test('evaluateDoubleCommitLiability - penalizes tailing intruder heavily and grants carrier immunity', () => {
  const carrierHit = {
    player_name: 'CreatorCarrier',
    team_num: 0,
    ts: 10000,
    touch_count: 2,
    y: 2500,
  };
  const tailingHit = {
    player_name: 'TailingTeammate',
    team_num: 0,
    ts: 10250, // 250ms later right behind carrier
    touch_count: 1,
    y: 2550,
  };

  // Scenario A: Fatal Double Commit (Opponent counter-attack goal)
  const fatalResult = evaluateDoubleCommitLiability(carrierHit, tailingHit, true, 2);
  assert.equal(fatalResult.carrier, 'CreatorCarrier');
  assert.equal(fatalResult.intruder, 'TailingTeammate');
  assert.equal(fatalResult.carrierDelta, 0.0, 'Carrier should receive 0.0 fatal penalty due to immunity');
  assert.equal(fatalResult.intruderDelta, -0.65, 'Tailing intruder should receive -0.65 for leaving net exposed');
  assert.equal(fatalResult.cause, 'tailing_overcommit');

  // Scenario B: Non-fatal double commit (retained or non-conceded)
  const nonFatalResult = evaluateDoubleCommitLiability(carrierHit, tailingHit, false, 2);
  assert.equal(nonFatalResult.carrierDelta, 0.0);
  assert.equal(nonFatalResult.intruderDelta, -0.25);

  // Scenario C: 3s Covered Double Commit (3rd man already holding net) -> low penalty
  const covered3s = evaluateDoubleCommitLiability(carrierHit, tailingHit, false, 2, {
    teamSize: 3,
    thirdManInNet: 'Rocinante_.',
    isNetExposed: false,
    intruderRushedFromNet: false,
  });
  assert.equal(covered3s.netStatus, 'covered');
  assert.equal(covered3s.thirdManCovering, 'Rocinante_.');
  assert.equal(covered3s.intruderDelta, -0.10);

  // Scenario D: Empty Net + Intruder rushed out from defensive net -> heavy penalty
  const rusherEmptyNet = evaluateDoubleCommitLiability(carrierHit, tailingHit, false, 2, {
    teamSize: 3,
    thirdManInNet: null,
    isNetExposed: true,
    intruderRushedFromNet: true,
  });
  assert.equal(rusherEmptyNet.netStatus, 'rusher_open_net');
  assert.equal(rusherEmptyNet.rushedFromNet, true);
  assert.equal(rusherEmptyNet.intruderDelta, -0.50);

  const fatalRusher = evaluateDoubleCommitLiability(carrierHit, tailingHit, true, 2, {
    teamSize: 3,
    thirdManInNet: null,
    isNetExposed: true,
    intruderRushedFromNet: true,
  });
  assert.equal(fatalRusher.intruderDelta, -0.85);

  // Scenario E: Zone-aware attack_box open net overlap -> moderate -0.18 penalty
  const attackBoxOpen = evaluateDoubleCommitLiability(carrierHit, tailingHit, false, 2, {
    teamSize: 2,
    thirdManInNet: null,
    isNetExposed: true,
    intruderRushedFromNet: false,
    ballZone: 'attack_box',
  });
  assert.equal(attackBoxOpen.intruderDelta, -0.18);
  assert.equal(attackBoxOpen.ballZone, 'attack_box');
});

test('evaluateBackPostRotation - far-post entry (+0.20) vs near-post trap (-0.35)', () => {
  const ballPos = { x: 1800, y: -3800, z: 100 }; // Opponent attacking from right wing
  const defendingGoalY = -5120; // Defending Blue goal

  // 1. Far-post entry with forward momentum (on left post X = -1000)
  const farPostDef = {
    name: 'SolidDefender',
    team_num: 0,
    x: -1000,
    y: -4800,
    z: 50,
    speed: 1200,
  };
  const farPostResult = evaluateBackPostRotation(farPostDef, ballPos, defendingGoalY);
  assert.equal(farPostResult.isBackPost, true);
  assert.equal(farPostResult.delta, 0.20);

  // 2. Near-post flat-foot trap (sitting stationary on right post X = 1200, speed = 100)
  const nearPostDef = {
    name: 'TrappedGoalie',
    team_num: 0,
    x: 1200,
    y: -4900,
    z: 50,
    speed: 100,
  };
  const nearPostResult = evaluateBackPostRotation(nearPostDef, ballPos, defendingGoalY);
  assert.equal(nearPostResult.isNearPostTrap, true);
  assert.equal(nearPostResult.delta, -0.35);
});

test('evaluateShadowDefense - delaying attacker and forcing turnover grants +0.25', () => {
  const defendingGoalY = -5120;
  const defender = { name: 'ShadowMan', team_num: 0, x: 200, y: -2800, z: 50, speed: 1100 };
  const attacker = { name: 'Dribbler', team_num: 1, x: 250, y: -1600, z: 50, speed: 1100 };
  const ballPos = { x: 250, y: -1650, z: 50 };

  const shadowResult = evaluateShadowDefense(defender, attacker, ballPos, defendingGoalY, true);
  assert.equal(shadowResult.isShadowDefense, true);
  assert.equal(shadowResult.delta, 0.25);
});

test('evaluateRecklessDive - missed lunge (-0.45) vs 3.5s recovery waiver (-0.20)', () => {
  // Scenario 1: Unrecovered reckless dive from distance
  const diveWhiff = evaluateRecklessDive(2400, true, false);
  assert.equal(diveWhiff.isRecklessDive, true);
  assert.equal(diveWhiff.waived50, false);
  assert.equal(diveWhiff.delta, -0.45);

  // Scenario 2: Recovered dive with follow-up save/clear within 3.5s
  const waivedDive = evaluateRecklessDive(2400, true, true);
  assert.equal(waivedDive.isRecklessDive, true);
  assert.equal(waivedDive.waived50, true);
  assert.equal(waivedDive.delta, -0.20);
});

test('evaluateKickoffSupport - cheat-up (+0.20) vs double-corner desertion (-0.40)', () => {
  // 1. Tactical cheat-up positioned at midfield center
  const cheaterSecondMan = { name: 'CheatSupport', team_num: 0, x: 100, y: 300, z: 50 };
  const cheatResult = evaluateKickoffSupport(cheaterSecondMan, true, false);
  assert.equal(cheatResult.isCheatUp, true);
  assert.equal(cheatResult.delta, 0.20);

  // 2. Corner desertion leaving net exposed on neutral kickoff
  const desertingSecondMan = { name: 'BoostGoblin', team_num: 0, x: 3100, y: 4200, z: 50 };
  const desertResult = evaluateKickoffSupport(desertingSecondMan, true, true);
  assert.equal(desertResult.isDesertion, true);
  assert.equal(desertResult.delta, -0.40);
});

test('evaluateBackboardDefense - high wall clear above crossbar grants +0.30', () => {
  // Hit above crossbar height (z=720) on back wall (y=-4900) for Blue team
  const backboardHit = { x: 200, y: -4900, z: 720, post_speed: 1500 };
  const bbResult = evaluateBackboardDefense(backboardHit, 0);
  assert.equal(bbResult.isBackboardClear, true);
  assert.equal(bbResult.delta, 0.30);
});

test('evaluateInfieldCross - infield cross (+0.35) vs corner roll giveaway (-0.25)', () => {
  // 1. Infield cross from wing into center slot
  const wingStart = { x: 2800, y: 2500 };
  const slotTarget = { x: 100, y: 3600 };
  const crossResult = evaluateInfieldCross(wingStart, slotTarget, 0, false);
  assert.equal(crossResult.isInfieldCross, true);
  assert.equal(crossResult.delta, 0.35);

  // 2. Corner roll giveaway into goalie's hands
  const giveawayResult = evaluateInfieldCross(wingStart, slotTarget, 0, true);
  assert.equal(giveawayResult.isCornerRollGiveaway, true);
  assert.equal(giveawayResult.delta, -0.25);
});

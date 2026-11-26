import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlayerRating } from '../src/server/models/rating.ts';

test('rating_engine - baseline is 6.0 with zero events', () => {
  const result = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  // Base score 6.0 + 0.25 (Victory) = 6.3 or baseline 6.0 without team outcome
  assert.ok(result.score >= 6.0 && result.score <= 6.5);
  assert.ok(result.factors.length > 0);
  assert.ok(result.factors.every(f => f.category !== undefined));
});

test('rating_engine - goal nuance: screamer (+1.40) vs solo run (+1.50) vs tap-in (+0.40)', () => {
  const screamerResult = calculatePlayerRating({
    goals: 1,
    assists: 0,
    saves: 0,
    shots: 1,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: true,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    hardestShotKmh: 115,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    screamers: 1,
    shotXGs: [{ xg: 0.15, isGoal: true, isScreamer: true }],
  });

  const screamerFactor = screamerResult.factors.find(f => f.name.includes('Screamer'));
  assert.ok(screamerFactor, 'Expected Screamer factor');
  assert.equal(screamerFactor.delta, 1.40);
  assert.equal(screamerFactor.category, 'attack');

  const soloResult = calculatePlayerRating({
    goals: 1,
    assists: 0,
    saves: 0,
    shots: 1,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: true,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    hardestShotKmh: 80,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    soloGoals: 1,
    shotXGs: [{ xg: 0.40, isGoal: true, isSolo: true }],
  });

  const soloFactor = soloResult.factors.find(f => f.name.includes('Solo Run'));
  assert.ok(soloFactor, 'Expected Solo Run factor');
  assert.equal(soloFactor.delta, 1.50);

  const tapInResult = calculatePlayerRating({
    goals: 1,
    assists: 0,
    saves: 0,
    shots: 1,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: true,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    hardestShotKmh: 45,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    tapIns: 1,
    shotXGs: [{ xg: 0.85, isGoal: true, isTapIn: true }],
  });

  const tapInFactor = tapInResult.factors.find(f => f.name.includes('Tap-In'));
  assert.ok(tapInFactor, 'Expected Tap-In factor');
  assert.equal(tapInFactor.delta, 0.40);
});

test('rating_engine - playmaking: favorable pass (+0.50), key pass (+0.40), hockey assist (+0.35)', () => {
  const result = calculatePlayerRating({
    goals: 0,
    assists: 1,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: false,
    keyPasses: 1,
    bigChancesCreated: 1,
    favorablePasses: 2,
    hockeyAssists: 1,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  const favPassFactor = result.factors.find(f => f.name.includes('Favorable Chance Delivery'));
  assert.ok(favPassFactor);
  assert.equal(favPassFactor.delta, 1.00); // 2 * +0.50

  const hockeyFactor = result.factors.find(f => f.name.includes('Hockey Assist'));
  assert.ok(hockeyFactor);
  assert.equal(hockeyFactor.delta, 0.35);

  const keyPassFactor = result.factors.find(f => f.name.includes('Key Passes'));
  assert.ok(keyPassFactor);
  assert.equal(keyPassFactor.delta, 0.40);
});

test('rating_engine - defensive attribution: spectator (-0.45) vs boost abandonment (-0.75)', () => {
  const spectatorResult = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: false,
    isOvertime: false,
    goalsConceded: 1,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    spectatorConcessions: 1,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  const specFactor = spectatorResult.factors.find(f => f.name.includes('Spectator'));
  assert.ok(specFactor);
  assert.equal(specFactor.delta, -0.45);
  assert.equal(specFactor.category, 'defense');

  const boostResult = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: false,
    isOvertime: false,
    goalsConceded: 1,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    boostAbandonments: 1,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  const boostFactor = boostResult.factors.find(f => f.name.includes('Boost-Over-Ball'));
  assert.ok(boostFactor);
  assert.equal(boostFactor.delta, -0.75);
});

test('rating_engine - tailing overcommit deduction (-0.65) applies to intruder while carrier is protected', () => {
  // Intruder receives tailing overcommit deduction
  const intruderResult = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: false,
    isOvertime: false,
    goalsConceded: 1,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    tailingOvercommits: 1,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  const tailingFactor = intruderResult.factors.find(f => f.name.includes('Tailing Overcommit Concession'));
  assert.ok(tailingFactor);
  assert.equal(tailingFactor.delta, -0.65);
  assert.equal(tailingFactor.category, 'discipline');

  // Carrier had 0 tailing overcommits
  const carrierResult = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 0,
    isWin: false,
    isOvertime: false,
    goalsConceded: 1,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    tailingOvercommits: 0,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [],
  });

  const carrierTailing = carrierResult.factors.find(f => f.name.includes('Tailing Overcommit Concession'));
  assert.equal(carrierTailing, undefined, 'Carrier should not have tailing overcommit deduction');
});

test('rating_engine - clutch multiplier (1.25x) scales major events in crunch time', () => {
  const result = calculatePlayerRating({
    goals: 1,
    assists: 0,
    saves: 1,
    shots: 1,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: true,
    goalsConceded: 0,
    cleanSheet: true,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 0,
    clearances: 0,
    duelsWon: 0,
    reflexSaves: 1,
    clutchMultiplier: 1.25,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 30000,
    emptyBoostMs: 10000,
    turnoverConcessions: 0,
    shotXGs: [{ xg: 0.30, isGoal: true }],
  });

  const clutchSave = result.factors.find(f => f.name.includes('Reflex Save'));
  assert.ok(clutchSave);
  // Base 0.65 * 1.25 = 0.81
  assert.equal(clutchSave.delta, 0.81);
  assert.equal(clutchSave.clutchMultiplier, 1.25);
});

test('rating_engine - score strictly clamped between 0.0 and 10.0', () => {
  // Overwhelming penalty scenario
  const disasterResult = calculatePlayerRating({
    goals: 0,
    assists: 0,
    saves: 0,
    shots: 0,
    demos: 0,
    ownGoals: 5,
    isWin: false,
    isOvertime: false,
    goalsConceded: 8,
    cleanSheet: false,
    keyPasses: 0,
    bigChancesCreated: 0,
    bigChancesMissed: 5,
    clearances: 0,
    duelsWon: 0,
    boostAbandonments: 3,
    spectatorConcessions: 3,
    hardestShotKmh: null,
    carMs: 300000,
    supersonicMs: 1000,
    emptyBoostMs: 200000,
    turnoverConcessions: 5,
    shotXGs: [],
  });
  assert.equal(disasterResult.score, 0.0);

  // Legendary god-mode scenario
  const godResult = calculatePlayerRating({
    goals: 5,
    screamers: 3,
    soloGoals: 2,
    assists: 4,
    favorablePasses: 4,
    keyPasses: 3,
    bigChancesCreated: 3,
    saves: 5,
    reflexSaves: 3,
    cleanTackles: 4,
    lastManTackles: 2,
    shots: 10,
    demos: 4,
    tacticalDemos: 2,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 0,
    cleanSheet: true,
    bigChancesMissed: 0,
    clearances: 6,
    duelsWon: 8,
    hardestShotKmh: 140,
    carMs: 300000,
    supersonicMs: 90000,
    emptyBoostMs: 5000,
    turnoverConcessions: 0,
    shotXGs: [
      { xg: 0.1, isGoal: true },
      { xg: 0.2, isGoal: true },
      { xg: 0.15, isGoal: true },
      { xg: 0.3, isGoal: true },
      { xg: 0.25, isGoal: true },
    ],
  });
  assert.equal(godResult.score, 10.0);
});

test('rating_engine - community tactical factors: back-post, shadow defense, backboard clear, cheat-up, infield cross', () => {
  const result = calculatePlayerRating({
    goals: 1,
    assists: 1,
    saves: 1,
    shots: 2,
    demos: 0,
    ownGoals: 0,
    isWin: true,
    isOvertime: false,
    goalsConceded: 1,
    cleanSheet: false,
    keyPasses: 1,
    bigChancesCreated: 1,
    bigChancesMissed: 0,
    clearances: 2,
    duelsWon: 2,
    hardestShotKmh: 95,
    carMs: 300000,
    supersonicMs: 40000,
    emptyBoostMs: 8000,
    turnoverConcessions: 0,
    backPostRotations: 1,
    nearPostTraps: 1,
    shadowDefenses: 1,
    waivedRecklessDives: 1,
    smallPadDisciplines: 1,
    cornerBoostDesertions: 1,
    kickoffCheatUps: 1,
    doubleCornerDesertions: 1,
    backboardClears: 1,
    infieldCrosses: 1,
    cornerRollGiveaways: 1,
    goalLineScrambles: 1,
    shotXGs: [{ xg: 0.35, isGoal: true }],
  });

  const hasBackPost = result.factors.some(f => f.name.includes('Back-Post Rotation') && f.delta === 0.20);
  const hasNearPostTrap = result.factors.some(f => f.name.includes('Near-Post Flat-Foot Trap') && f.delta === -0.35);
  const hasShadow = result.factors.some(f => f.name.includes('Shadow Defense Delay') && f.delta === 0.25);
  const hasWaivedDive = result.factors.some(f => f.name.includes('Recovered Dive [50% Waiver]') && f.delta === -0.20);
  const hasSmallPad = result.factors.some(f => f.name.includes('Small-Pad Line Discipline') && f.delta === 0.15);
  const hasCornerBoost = result.factors.some(f => f.name.includes('Corner Boost Desertion') && f.delta === -0.35);
  const hasCheatUp = result.factors.some(f => f.name.includes('Kickoff Cheat-Up Support') && f.delta === 0.20);
  const hasDoubleCorner = result.factors.some(f => f.name.includes('Double-Corner Desertion') && f.delta === -0.40);
  const hasBackboard = result.factors.some(f => f.name.includes('Backboard Wall Clear') && f.delta === 0.30);
  const hasInfieldCross = result.factors.some(f => f.name.includes('Infield Cross') && f.delta === 0.35);
  const hasCornerGiveaway = result.factors.some(f => f.name.includes('Corner-Roll Giveaway') && f.delta === -0.25);
  const hasGoalLineScramble = result.factors.some(f => f.name.includes('Goal-Line Scramble Save') && f.delta === 0.40);

  assert.ok(hasBackPost, 'Expected Back-Post Rotation factor');
  assert.ok(hasNearPostTrap, 'Expected Near-Post Trap factor');
  assert.ok(hasShadow, 'Expected Shadow Defense factor');
  assert.ok(hasWaivedDive, 'Expected Waived Dive factor');
  assert.ok(hasSmallPad, 'Expected Small-Pad Discipline factor');
  assert.ok(hasCornerBoost, 'Expected Corner Boost Desertion factor');
  assert.ok(hasCheatUp, 'Expected Kickoff Cheat-Up factor');
  assert.ok(hasDoubleCorner, 'Expected Double-Corner Desertion factor');
  assert.ok(hasBackboard, 'Expected Backboard Wall Clear factor');
  assert.ok(hasInfieldCross, 'Expected Infield Cross factor');
  assert.ok(hasCornerGiveaway, 'Expected Corner Giveaway factor');
  assert.ok(hasGoalLineScramble, 'Expected Goal-Line Scramble factor');
});

test('rating_engine - 3s covered overlap penalty (-0.10) vs empty-net rush penalty (-0.50)', () => {
  const base = {
    goals: 1, assists: 0, saves: 0, shots: 2, demos: 0, ownGoals: 0,
    isWin: true, isOvertime: false, goalsConceded: 0, cleanSheet: true,
    keyPasses: 0, bigChancesCreated: 0, bigChancesMissed: 0, clearances: 2, duelsWon: 1,
    hardestShotKmh: null, carMs: 300000, supersonicMs: 30000, emptyBoostMs: 10000,
    turnoverConcessions: 0, shotXGs: [{ xg: 0.4, isGoal: true }],
  };

  const covered = calculatePlayerRating({ ...base, doubleCommits: 1, coveredDoubleCommits: 1, netRushDoubleCommits: 0, thirdManCovers: 2 });
  const rusher = calculatePlayerRating({ ...base, doubleCommits: 1, coveredDoubleCommits: 0, netRushDoubleCommits: 1 });

  assert.ok(covered.factors.some(f => f.name.includes('Covered 3s Overlap') && f.delta === -0.10));
  assert.ok(covered.factors.some(f => f.name.includes('3rd-Man Safety Cover') && f.delta === 0.20));
  assert.ok(rusher.factors.some(f => f.name.includes('Empty-Net Rush Overcommit') && f.delta === -0.50));
  assert.ok(covered.score > rusher.score, `Expected covered rating > rusher rating (${covered.score} vs ${rusher.score})`);
});

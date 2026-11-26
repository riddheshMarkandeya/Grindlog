import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateXG, calculateClinicality } from '../src/server/models/xg.ts';
import { calculatePlayerRating } from '../src/server/models/rating.ts';
import { calculateMomentumWave } from '../src/server/models/momentum.ts';
import { calculatePlayerRadar } from '../src/server/models/radar.ts';
import { aggregateRadarFromAnalyses } from '../src/server/models/radar-aggregator.ts';
import { getPlayerMatchTitles } from '../src/shared/awards.ts';
import { calculateTacticalOvr } from '../src/shared/ovr.ts';
import { buildSessionPodium, computeSessionTeamTotals } from '../src/server/models/session.ts';
import { extractFifaPlayMetrics, evaluateConcededGoalChains } from '../src/server/models/fifa-telemetry.ts';
import { sliceCardCycleMatches, resolveCardPosition, resolvePromoEdition, extractCardPlayStyles, classifyRowGameMode } from '../src/server/models/fifa-card.ts';
import { OvertimeDBCache } from '../src/server/db/cache.ts';
test('calculateXG - tap in should have high xG and be a big chance', () => {
    // Point blank shot in front of Orange goal (Y = 5120)
    const result = calculateXG({
        x: 0,
        y: 4700,
        z: 100,
        speedKmh: 65,
        attackingTeamNum: 0,
    });
    assert.ok(result.xg >= 0.75, `Expected xG >= 0.75, got ${result.xg}`);
    assert.equal(result.isBigChance, true);
    assert.ok(result.distance < 600, `Expected distance < 600, got ${result.distance}`);
});
test('calculateXG - midfield shot should have moderate xG', () => {
    const result = calculateXG({
        x: 1000,
        y: 1000,
        z: 200,
        speedKmh: 95,
        attackingTeamNum: 0,
    });
    assert.ok(result.xg >= 0.10 && result.xg <= 0.35, `Expected xG in [0.10, 0.35], got ${result.xg}`);
    assert.equal(result.isBigChance, false);
});
test('calculateXG - full field clearance should have negligible xG', () => {
    const result = calculateXG({
        x: 0,
        y: -4500,
        z: 200,
        speedKmh: 90,
        attackingTeamNum: 0,
    });
    assert.ok(result.xg <= 0.05, `Expected xG <= 0.05, got ${result.xg}`);
    assert.equal(result.isBigChance, false);
});
test('calculateClinicality - should calculate goals minus expected goals', () => {
    const clinicality = calculateClinicality(3, 1.45);
    assert.equal(clinicality, 1.55);
});
test('calculatePlayerRating - clamp to [0.0, 10.0] and start at 6.0 baseline', () => {
    const baseline = calculatePlayerRating({
        goals: 0,
        assists: 0,
        saves: 0,
        shots: 0,
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
        hardestShotKmh: null,
        carMs: 300000,
        supersonicMs: 30000,
        emptyBoostMs: 10000,
        turnoverConcessions: 0,
        shotXGs: [],
    });
    // Base 6.0 + 0.25 (win) + 0.35 (clean sheet) = 6.6
    assert.equal(baseline.score, 6.6);
    assert.ok(baseline.factors.length > 0);
});
test('calculatePlayerRating - high performance clamps to 10.0 and penalties reduce score', () => {
    const monsterGame = calculatePlayerRating({
        goals: 5,
        assists: 3,
        saves: 4,
        shots: 7,
        demos: 3,
        ownGoals: 0,
        isWin: true,
        isOvertime: false,
        goalsConceded: 1,
        cleanSheet: false,
        keyPasses: 4,
        bigChancesCreated: 3,
        bigChancesMissed: 0,
        clearances: 5,
        duelsWon: 4,
        hardestShotKmh: 115,
        carMs: 300000,
        supersonicMs: 80000,
        emptyBoostMs: 5000,
        turnoverConcessions: 0,
        shotXGs: [{ xg: 0.2, isGoal: true }, { xg: 0.4, isGoal: true }],
    });
    assert.equal(monsterGame.score, 10.0);
    const disasterGame = calculatePlayerRating({
        goals: 0,
        assists: 0,
        saves: 0,
        shots: 0,
        demos: 0,
        ownGoals: 3,
        isWin: false,
        isOvertime: false,
        goalsConceded: 6,
        cleanSheet: false,
        keyPasses: 0,
        bigChancesCreated: 0,
        bigChancesMissed: 3,
        clearances: 0,
        duelsWon: 0,
        hardestShotKmh: null,
        carMs: 300000,
        supersonicMs: 5000,
        emptyBoostMs: 100000,
        turnoverConcessions: 2,
        shotXGs: [],
    });
    assert.ok(disasterGame.score <= 1.0 && disasterGame.score >= 0.0, `Expected disaster rating in [0.0, 1.0], got ${disasterGame.score}`);
});
test('calculateMomentumWave - creates 10-second buckets with field tilt and touch ratio', () => {
    const startTs = 1000000;
    const duration = 60; // 6 buckets
    const hits = [
        { ts: startTs + 2000, y: 3000, teamNum: 0 },
        { ts: startTs + 5000, y: 4000, teamNum: 0 },
        { ts: startTs + 15000, y: -2000, teamNum: 1 },
    ];
    const events = [
        { ts: startTs + 4000, type: 'goal', team: 0, text: 'Goal scored' },
    ];
    const wave = calculateMomentumWave(startTs, duration, hits, events);
    assert.equal(wave.length, 6);
    assert.equal(wave[0].events.length, 1);
    assert.ok(wave[0].momentum > 0, 'First bucket with Team 0 hits in attack should be positive momentum');
    assert.ok(wave[1].momentum < 0, 'Second bucket with Team 1 hits should be negative momentum');
});
test('calculatePlayerRadar - outputs valid 0-100 scores and assigns archetypes', () => {
    const striker = calculatePlayerRadar({
        goals: 3,
        shots: 6,
        assists: 0,
        saves: 0,
        demos: 0,
        clearances: 0,
        keyPasses: 1,
        duelsWon: 1,
        touchesMidfield: 5,
        touchesTotal: 25,
        carMs: 300000,
        supersonicMs: 90000,
        boostAvg: 55,
        emptyBoostMs: 15000,
        xg: 1.5,
    });
    assert.equal(striker.archetype, 'The Striker');
    assert.ok(striker.finishing >= 65);
    assert.ok(striker.pace >= 55);
    const anchor = calculatePlayerRadar({
        goals: 0,
        shots: 1,
        assists: 1,
        saves: 4,
        demos: 1,
        clearances: 6,
        keyPasses: 1,
        duelsWon: 3,
        touchesMidfield: 8,
        touchesTotal: 30,
        carMs: 300000,
        supersonicMs: 40000,
        boostAvg: 70,
        emptyBoostMs: 5000,
        xg: 0.2,
    });
    assert.equal(anchor.archetype, 'The Anchor');
    assert.ok(anchor.goalkeeping >= 55, `Expected anchor goalkeeping >= 55, got ${anchor.goalkeeping}`);
    assert.ok(anchor.positioning >= 55, `Expected anchor positioning >= 55, got ${anchor.positioning}`);
});

test('calculatePlayerRadar - responds accurately to tactical & disciplinary rules', () => {
    const disciplinedCreator = calculatePlayerRadar({
        goals: 1,
        shots: 3,
        assists: 1,
        saves: 1,
        demos: 1,
        clearances: 4,
        keyPasses: 3,
        duelsWon: 4,
        touchesMidfield: 14,
        touchesTotal: 34,
        carMs: 300000,
        supersonicMs: 42000,
        boostAvg: 58,
        emptyBoostMs: 18000,
        xg: 0.7,
        favorablePasses: 3,
        infieldCrosses: 2,
        bigChancesCreated: 2,
        backPostRotations: 3,
        shadowDefenses: 2,
        kickoffCheatUps: 2,
        smallPads: 48,
        bigOrbs: 14,
        padRatioPct: 77,
        boostSteals: 2,
        doubleCommits: 0,
    });
    assert.ok(disciplinedCreator.creation >= 65, `Expected creation >= 65, got ${disciplinedCreator.creation}`);
    assert.ok(disciplinedCreator.positioning >= 85, `Expected positioning >= 85, got ${disciplinedCreator.positioning}`);
    assert.ok(disciplinedCreator.tackling >= 45, `Expected realistic tackling >= 45, got ${disciplinedCreator.tackling}`);
    assert.ok(disciplinedCreator.goalkeeping >= 30, `Expected goalkeeping >= 30, got ${disciplinedCreator.goalkeeping}`);

    const chaoticTailer = calculatePlayerRadar({
        goals: 1,
        shots: 3,
        assists: 0,
        saves: 0,
        demos: 0,
        clearances: 1,
        keyPasses: 0,
        duelsWon: 1,
        touchesMidfield: 6,
        touchesTotal: 25,
        carMs: 300000,
        supersonicMs: 30000,
        boostAvg: 45,
        emptyBoostMs: 45000,
        xg: 1.0,
        hospitalPasses: 2,
        doubleCommits: 3,
        fatalDoubleCommits: 1,
        recklessDives: 1,
        boostAbandonments: 1,
    });
    assert.ok(chaoticTailer.positioning <= 30, `Expected disciplined positioning <= 30, got ${chaoticTailer.positioning}`);
    assert.ok(chaoticTailer.tackling < disciplinedCreator.tackling);
    assert.ok(chaoticTailer.creation < disciplinedCreator.creation);
});

test('getPlayerMatchTitles - resolves exact and parenthetical titles for specific players', () => {
    const awards = {
        player_of_the_match: 'Swapo_o',
        the_sniper: 'Swapo_o',
        the_iron_wall: 'Limits_Sohail',
        speed_demon: 'Swapo_o (15% Supersonic)',
        the_playmaker: 'Swapo_o (2A, 2 BCC)',
        the_boost_goblin: 'Swapo_o (58 Boost Avg)',
        air_marshal: 'Limits_Sohail (3 Aerials)',
        crossbar_magnet: null,
        the_enforcer: null,
        double_trouble: 'AnnoyedPuma7068 & kick0x0 (3 Double Commits)',
    };
    const swapoTitles = getPlayerMatchTitles('Swapo_o', awards);
    assert.equal(swapoTitles.length, 5);
    assert.equal(swapoTitles.find(t => t.id === 'speed_demon')?.detail, '15% Supersonic');

    const kickTitles = getPlayerMatchTitles('kick0x0', awards);
    assert.equal(kickTitles.length, 1);
    assert.equal(kickTitles[0].id, 'double_trouble');
    assert.ok(kickTitles[0].isNegative);
});

test('aggregateRadarFromAnalyses - unifies multi-match tactical & causal rules into 8-axis radar', () => {
    const emptyRadar = aggregateRadarFromAnalyses([]);
    assert.ok(emptyRadar.finishing >= 0 && emptyRadar.positioning !== undefined);

    const baseEntry = {
        player_key: 'p1',
        primary_id: 'Epic|test|0',
        name: 'Creator',
        team_num: 0,
        is_bot: false,
        is_user: true,
        score: 450,
        goals: 1,
        shots: 3,
        assists: 1,
        saves: 2,
        touches: 34,
        demos: 1,
        rating: 7.4,
        rating_factors: [],
        xg: 0.7,
        xg_diff: 0.3,
        big_chances: 2,
        big_chances_missed: 0,
        big_chances_created: 2,
        key_passes: 3,
        hardest_shot_kmh: 112,
        boost_avg: 58,
        supersonic_pct: 14,
        empty_boost_pct: 6,
        empty_boost_seconds: 18,
        supersonic_seconds: 42,
        touches_defence: 10,
        touches_midfield: 14,
        touches_attack: 10,
        touch_distribution: { defence_pct: 29, midfield_pct: 42, attack_pct: 29 },
        aerial_touches: 4,
        woodwork_hits: 0,
        clearances: 4,
        shot_conversion_pct: 33,
        double_commits: 0,
        fatal_double_commits: 0,
        turnover_concessions: 0,
        errors_leading_to_goal: 0,
        small_pads: 48,
        big_orbs: 14,
        boost_steals: 2,
        pad_ratio_pct: 77,
        tactical_metrics: {
            duels_won: 4,
            favorable_passes: 3,
            infield_crosses: 2,
            hockey_assists: 1,
            hospital_passes: 0,
            corner_roll_giveaways: 0,
            screamers: 1,
            solo_goals: 0,
            counter_goals: 0,
            reflex_saves: 1,
            rebound_instant_clears: 1,
            spilled_rebounds: 0,
            shadow_defenses: 2,
            back_post_rotations: 3,
            backboard_clears: 1,
            goal_line_scrambles: 0,
            counter_press_recoveries: 1,
            tactical_demos: 1,
            boost_abandonments: 0,
            corner_boost_desertions: 0,
            near_post_traps: 0,
            reckless_dives: 0,
            kickoff_cheat_ups: 2,
            double_corner_desertions: 0,
        },
    };

    const disciplinedAgg = aggregateRadarFromAnalyses([baseEntry, baseEntry]);
    const chaoticAgg = aggregateRadarFromAnalyses([
        {
            ...baseEntry,
            name: 'Tailer',
            big_chances_created: 0,
            key_passes: 0,
            small_pads: 12,
            big_orbs: 14,
            double_commits: 3,
            fatal_double_commits: 1,
            turnover_concessions: 3,
            tactical_metrics: {
                ...baseEntry.tactical_metrics,
                duels_won: 1,
                favorable_passes: 0,
                infield_crosses: 0,
                back_post_rotations: 0,
                shadow_defenses: 0,
                hospital_passes: 2,
                reckless_dives: 2,
                boost_abandonments: 1,
                near_post_traps: 1,
            },
        },
    ]);

    assert.ok(disciplinedAgg.positioning > chaoticAgg.positioning, `Expected disciplined positioning > chaotic (${disciplinedAgg.positioning} vs ${chaoticAgg.positioning})`);
    assert.ok(disciplinedAgg.creation > chaoticAgg.creation, `Expected disciplined creation > chaotic (${disciplinedAgg.creation} vs ${chaoticAgg.creation})`);
    assert.ok(disciplinedAgg.tackling > chaoticAgg.tackling, `Expected disciplined tackling > chaotic (${disciplinedAgg.tackling} vs ${chaoticAgg.tackling})`);
    assert.ok(disciplinedAgg.goalkeeping > chaoticAgg.goalkeeping, `Expected disciplined goalkeeping > chaotic (${disciplinedAgg.goalkeeping} vs ${chaoticAgg.goalkeeping})`);
});

test('calculatePlayerRadar - Discipline separates defensive anchor from aggressive striker', () => {
    const anchorProfile = calculatePlayerRadar({
        goals: 0,
        shots: 1,
        assists: 1,
        saves: 2,
        demos: 0,
        clearances: 4,
        keyPasses: 1,
        duelsWon: 2,
        touchesDefence: 16,
        touchesMidfield: 11,
        touchesAttack: 6,
        touchesTotal: 33,
        carMs: 300000,
        supersonicMs: 20000,
        boostAvg: 56,
        emptyBoostMs: 18000,
        xg: 0.2,
        reboundInstantClears: 1,
        shadowDefenses: 1,
        doubleCommits: 0,
        turnoverConcessions: 0,
    });
    const ballChaserProfile = calculatePlayerRadar({
        goals: 1,
        shots: 3,
        assists: 0,
        saves: 0,
        demos: 1,
        clearances: 2,
        keyPasses: 0,
        duelsWon: 2,
        touchesDefence: 10,
        touchesMidfield: 10,
        touchesAttack: 12,
        touchesTotal: 32,
        carMs: 300000,
        supersonicMs: 38000,
        boostAvg: 58,
        emptyBoostMs: 36000,
        xg: 0.8,
        doubleCommits: 1,
        turnoverConcessions: 1,
        cornerRollGiveaways: 1,
        recklessDives: 1,
    });
    assert.ok(
        anchorProfile.positioning >= ballChaserProfile.positioning + 20,
        `Expected anchor discipline >= striker + 20, got ${anchorProfile.positioning} vs ${ballChaserProfile.positioning}`
    );

    const covered3sOverlap = calculatePlayerRadar({
        goals: 1, shots: 3, assists: 1, saves: 1, demos: 0, clearances: 4, keyPasses: 1, duelsWon: 2,
        touchesDefence: 12, touchesMidfield: 12, touchesAttack: 10, touchesTotal: 34,
        carMs: 300000, supersonicMs: 35000, boostAvg: 55, emptyBoostMs: 18000, xg: 0.6,
        doubleCommits: 2,
        coveredDoubleCommits: 2,
        netRushDoubleCommits: 0,
    });
    const rusherEmptyNet = calculatePlayerRadar({
        goals: 1, shots: 3, assists: 1, saves: 1, demos: 0, clearances: 4, keyPasses: 1, duelsWon: 2,
        touchesDefence: 12, touchesMidfield: 12, touchesAttack: 10, touchesTotal: 34,
        carMs: 300000, supersonicMs: 35000, boostAvg: 55, emptyBoostMs: 18000, xg: 0.6,
        doubleCommits: 2,
        coveredDoubleCommits: 0,
        netRushDoubleCommits: 2,
    });
    assert.ok(
        covered3sOverlap.positioning >= rusherEmptyNet.positioning + 30,
        `Expected 3s covered overlaps to have much higher Discipline than empty-net rushes (${covered3sOverlap.positioning} vs ${rusherEmptyNet.positioning})`
    );
});

test('3rd-Man Safety Cover rewards rating and Discipline without affecting non-covering overlaps', () => {
    const coverRating = calculatePlayerRating({
        goals: 0,
        assists: 1,
        saves: 2,
        shots: 1,
        demos: 0,
        ownGoals: 0,
        isWin: true,
        isOvertime: false,
        goalsConceded: 1,
        cleanSheet: false,
        keyPasses: 1,
        bigChancesCreated: 0,
        bigChancesMissed: 0,
        clearances: 3,
        duelsWon: 1,
        hardestShotKmh: 92,
        carMs: 300000,
        supersonicMs: 35000,
        emptyBoostMs: 12000,
        turnoverConcessions: 0,
        shotXGs: [],
        thirdManCovers: 2,
    });
    const coverFactor = coverRating.factors.find(f => f.name.includes('3rd-Man Safety Cover'));
    assert.ok(coverFactor, 'Expected positive 3rd-Man Safety Cover factor');
    assert.equal(coverFactor.delta, 0.2);

    const baseProfile = calculatePlayerRadar({
        goals: 0, shots: 2, assists: 1, saves: 1, demos: 0, clearances: 3, keyPasses: 1, duelsWon: 2,
        touchesDefence: 12, touchesMidfield: 10, touchesAttack: 8, touchesTotal: 30,
        carMs: 300000, supersonicMs: 30000, boostAvg: 54, emptyBoostMs: 16000, xg: 0.4,
        thirdManCovers: 0,
    });
    const anchoredProfile = calculatePlayerRadar({
        goals: 0, shots: 2, assists: 1, saves: 1, demos: 0, clearances: 3, keyPasses: 1, duelsWon: 2,
        touchesDefence: 12, touchesMidfield: 10, touchesAttack: 8, touchesTotal: 30,
        carMs: 300000, supersonicMs: 30000, boostAvg: 54, emptyBoostMs: 16000, xg: 0.4,
        thirdManCovers: 3,
    });
    assert.ok(
        anchoredProfile.positioning > baseProfile.positioning,
        `Expected 3rd-Man covers to raise Discipline (${anchoredProfile.positioning} vs ${baseProfile.positioning})`
    );
});

test('calculateTacticalOvr - computes role-weighted 0-99 OVR and exact /800 totals cleanly', () => {
    const swapo = calculateTacticalOvr({
        finishing: 63, creation: 39, dribbling: 61, pace: 57,
        tackling: 67, goalkeeping: 39, aerial: 47, positioning: 42,
        archetype: 'The Striker',
    });
    const mechless = calculateTacticalOvr({
        finishing: 58, creation: 35, dribbling: 50, pace: 60,
        tackling: 73, goalkeeping: 39, aerial: 68, positioning: 38,
        archetype: 'The Air Marshal',
    });
    const rocinante = calculateTacticalOvr({
        finishing: 24, creation: 52, dribbling: 54, pace: 35,
        tackling: 50, goalkeeping: 44, aerial: 23, positioning: 55,
        archetype: 'The Playmaker',
    });
    const passenger = calculateTacticalOvr({
        finishing: 14, creation: 14, dribbling: 14, pace: 14,
        tackling: 14, goalkeeping: 14, aerial: 14, positioning: 14,
        archetype: 'The Passenger',
    });
    const icon = calculateTacticalOvr({
        finishing: 85, creation: 78, dribbling: 82, pace: 84,
        tackling: 76, goalkeeping: 80, aerial: 80, positioning: 88,
        archetype: 'The All-Rounder',
    });

    assert.equal(swapo.total800, 415);
    assert.equal(mechless.total800, 421);
    assert.equal(rocinante.total800, 337);
    assert.ok(mechless.ovr >= 78 && mechless.ovr <= 85, `Expected Mechless OVR ~81, got ${mechless.ovr}`);
    assert.ok(swapo.ovr >= 76 && swapo.ovr <= 83, `Expected Swapo OVR ~79, got ${swapo.ovr}`);
    assert.ok(rocinante.ovr >= 70 && rocinante.ovr <= 77, `Expected Rocinante OVR ~73, got ${rocinante.ovr}`);
    assert.ok(passenger.ovr < rocinante.ovr && rocinante.ovr < icon.ovr, 'OVR should increase monotonically across tiers');
    assert.equal(icon.tier, 'ICON');

    // Role sensitivity: playmaker axes score higher OVR as Playmaker than as Striker
    const sameAxesAsStriker = calculateTacticalOvr({
        finishing: 24, creation: 52, dribbling: 54, pace: 35,
        tackling: 50, goalkeeping: 44, aerial: 23, positioning: 55,
        archetype: 'The Striker',
    });
    assert.ok(rocinante.ovr > sameAxesAsStriker.ovr, `Role weights should reward true role fit (${rocinante.ovr} vs ${sameAxesAsStriker.ovr})`);
});

test('buildSessionPodium - excludes random opponents/teammates and includes only user + pinned friends', () => {
    const mkPlayer = (name, primaryId, isUser, rating, goals = 1, team = 0) => ({
        player_key: primaryId,
        primary_id: primaryId,
        name,
        team_num: team,
        is_bot: false,
        is_user: isUser,
        score: 400,
        goals,
        shots: 3,
        assists: 1,
        saves: 1,
        touches: 30,
        demos: 0,
        rating,
        xg: 0.5,
        boost_avg: 52,
        double_commits: isUser ? 1 : 0,
    });
    const mkMatch = (guid, players) => ({
        guid,
        started_at: 1000,
        ended_at: 1300,
        playlist_id: 11,
        arena: 'DFH',
        overtime: false,
        score_team0: 3,
        score_team1: 2,
        winner_team_num: 0,
        user_team_num: 0,
        mvp_key: players[0].player_key,
        team0_rating: 7.5,
        team1_rating: 6.5,
        team0_xg: 1.5,
        team1_xg: 1.0,
        players,
        shots: [],
        momentum: [],
        double_commits: [
            { time_seconds: 60, player1_name: 'Swapo_o', player2_name: 'Mechless Madness', team_num: 0, is_fatal: false },
            { time_seconds: 120, player1_name: 'JoyousLimpet1386', player2_name: 'ItsMeNikkhil', team_num: 1, is_fatal: false },
        ],
        awards: [],
        computed_at: 1305,
        engine_version: 6,
    });

    const m1 = mkMatch('m1', [
        mkPlayer('Swapo_o', 'epic-user', true, 8.4),
        mkPlayer('Mechless Madness', 'epic-mech', false, 8.8),
        mkPlayer('HulkingPen12238', 'epic-hulk-live', false, 7.6),
        mkPlayer('JoyousLimpet1386', 'epic-rand-1', false, 9.6, 4, 1),
        mkPlayer('ItsMeNikkhil', 'epic-rand-2', false, 9.2, 3, 1),
    ]);
    const m2 = mkMatch('m2', [
        mkPlayer('Swapo_o', 'epic-user', true, 8.2),
        mkPlayer('Mechless Madness', 'epic-mech', false, 8.6),
        mkPlayer('HulkingPen12238', 'epic-hulk-live', false, 7.8),
        mkPlayer('JoyousLimpet1386', 'epic-rand-1', false, 9.0, 2, 1),
        mkPlayer('ItsMeNikkhil', 'epic-rand-2', false, 8.9, 2, 1),
    ]);

    const podium = buildSessionPodium([m1, m2], {
        friendIds: new Set(['epic-mech']),
        friendNames: new Set(['mechless madness', 'hulkingpen12238']),
    });

    const names = podium.map(p => p.name);
    assert.deepEqual(names, ['Mechless Madness', 'Swapo_o', 'HulkingPen12238']);
    assert.equal(podium[1].total_assists, 2);
    assert.equal(podium[1].total_saves, 2);
    assert.equal(podium[1].total_double_commits, 2);
    assert.ok(!names.includes('JoyousLimpet1386'));
    assert.ok(!names.includes('ItsMeNikkhil'));

    const totals = computeSessionTeamTotals([m1, m2]);
    assert.equal(totals.totalGoalsFor, 6);
    assert.equal(totals.totalGoalsAgainst, 4);
    assert.equal(totals.totalDoubleCommits, 2);
});

test('extractFifaPlayMetrics - computes Dribbling, Tackling 50/50 + dispossessions, Pace velocity, and Goalkeeping xG prevented', () => {
    const t0 = 100000;
    const hits = [
        // Own-half clear/carry by Striker -> forward multi-touch dribble beat + rapid goal
        { start_ts: t0 + 1000, end_ts: t0 + 1100, player_name: 'Striker', team_num: 0, touch_count: 1, x: 0, y: -2600, z: 100 },
        { start_ts: t0 + 2100, end_ts: t0 + 2250, player_name: 'Striker', team_num: 0, touch_count: 2, x: 100, y: -400, z: 120 },
        { start_ts: t0 + 3200, end_ts: t0 + 3400, player_name: 'Striker', team_num: 0, touch_count: 2, x: 50, y: 3400, z: 140 },
        // Opponent carries 2 touches then Anchor cleanly dispossesses & keeps ball
        { start_ts: t0 + 15000, end_ts: t0 + 15200, player_name: 'OppCarrier', team_num: 1, touch_count: 2, x: 300, y: 800, z: 100 },
        { start_ts: t0 + 16100, end_ts: t0 + 16200, player_name: 'Anchor', team_num: 0, touch_count: 1, x: 250, y: 1100, z: 100 },
        { start_ts: t0 + 17200, end_ts: t0 + 17300, player_name: 'Anchor', team_num: 0, touch_count: 1, x: 100, y: 2200, z: 100 },
    ];
    const shots = [
        {
            id: 'shot-saved-1',
            shot_ts: t0 + 25000,
            time_seconds: 25,
            player_name: 'OppCarrier',
            player_key: 'opp',
            team_num: 1,
            x: 0,
            y: -4600,
            z: 100,
            distance: 520,
            speed_kmh: 96,
            xg: 0.72,
            is_big_chance: true,
            outcome: 'saved',
        },
    ];
    const metrics = extractFifaPlayMetrics({
        debouncedHits: hits,
        shots,
        realGoalEvents: [{ ts: t0 + 4200, teamNum: 0, scorerName: 'Striker', speedKmh: 105 }],
        saveEvents: [{ ts: t0 + 25300, playerName: 'Anchor', teamNum: 0, isEpic: true }],
    });

    const strikerM = metrics.get('Striker');
    assert.ok(strikerM, 'Expected Striker FIFA metrics');
    assert.ok(strikerM.dribbleChains >= 1, `Expected >= 1 dribble chain, got ${strikerM.dribbleChains}`);
    assert.equal(strikerM.dribbleGoals, 1);
    assert.ok(strikerM.paceSprints >= 1);
    assert.ok(strikerM.avgTransitionVelocity >= 1500);
    assert.equal(strikerM.blitzCounterGoals, 1);

    const anchorM = metrics.get('Anchor');
    assert.ok(anchorM, 'Expected Anchor FIFA metrics');
    assert.equal(anchorM.cleanDispossessions, 1);
    assert.ok(anchorM.xgPrevented >= 0.7, `Expected xG prevented >= 0.7, got ${anchorM.xgPrevented}`);

    // Feed directly into Unified Radar
    const unified = calculatePlayerRadar({
        goals: 1, shots: 2, assists: 0, saves: 0, demos: 0, clearances: 1, keyPasses: 0,
        duelsWon: 1, touchesMidfield: 10, touchesTotal: 25, carMs: 300000, supersonicMs: 60000,
        boostAvg: 55, emptyBoostMs: 12000, xg: 0.6,
        dribbleChains: strikerM.dribbleChains,
        dribbleTakeOns: strikerM.dribbleTakeOns,
        dribbleGoals: strikerM.dribbleGoals,
        paceSprints: strikerM.paceSprints,
        avgTransitionVelocity: strikerM.avgTransitionVelocity,
        blitzCounterGoals: strikerM.blitzCounterGoals,
    });
    assert.ok(unified.dribbling >= 50, `Expected dribbling >= 50, got ${unified.dribbling}`);
    assert.ok(unified.pace >= 70, `Expected rapid net-to-net pace >= 70, got ${unified.pace}`);
});

test('evaluateConcededGoalChains - constructs 3-step Origin -> Breakdown -> Net Impact film strip', () => {
    const start = 200000;
    const goalTs = start + 42000;
    const chains = evaluateConcededGoalChains({
        goals: [{ idx: 0, ts: goalTs, teamNum: 1, scorerName: 'EnemyScorer', speedKmh: 95 }],
        shots: [{
            id: 'goal-0', shot_ts: goalTs, time_seconds: 42, player_name: 'EnemyScorer',
            player_key: 'enemy', team_num: 1, x: 100, y: -4400, z: 120,
            distance: 720, speed_kmh: 95, xg: 0.68, is_big_chance: true, outcome: 'goal',
        }],
        doubleCommits: [{
            time_seconds: 39, player1_name: 'Swapo_o', player2_name: 'Rocinante_.',
            team_num: 0, is_fatal: true, instigator_name: 'Swapo_o',
            net_status: 'rusher_open_net', rushed_from_net: true,
        }],
        debouncedHits: [
            { start_ts: goalTs - 7000, end_ts: goalTs - 6800, player_name: 'Rocinante_.', team_num: 0, touch_count: 2, x: 0, y: 1200, z: 100 },
            { start_ts: goalTs - 5800, end_ts: goalTs - 5700, player_name: 'EnemyScorer', team_num: 1, touch_count: 1, x: 100, y: 1000, z: 100 },
        ],
        roundStartedTimes: [start],
        matchStartedAt: start,
        userTeamNum: 0,
    });

    assert.equal(chains.length, 1);
    assert.equal(chains[0].steps.length, 3);
    assert.equal(chains[0].steps[0].category, 'Dribbling');
    assert.equal(chains[0].steps[1].category, 'Discipline');
    assert.equal(chains[0].steps[2].category, 'Goalkeeping');
});

test('sliceCardCycleMatches - locks card stats to completed 15-game checkpoints rather than every game', () => {
    const mkRow = (idx) => ({
        match_guid: `m-${idx}`,
        player_key: 'p1',
        primary_id: 'Epic|swapo|0',
        name: 'Swapo_o',
        is_bot: 0,
        team_num: 0,
        score: 400,
        goals: 1,
        shots: 3,
        assists: 1,
        saves: 1,
        touches: 30,
        demos: 0,
        hardest_shot_kmh: 95,
        woodwork_hits: 0,
        aerial_touches: 2,
        car_ms: 300000,
        boost_avg: 50,
        supersonic_ms: 45000,
        empty_boost_ms: 15000,
        touches_defence: 10,
        touches_midfield: 10,
        touches_attack: 10,
        started_at: 1000000 + idx * 500000,
        winner_team_num: 0,
        score_team0: 2,
        score_team1: 1,
    });

    // 10 matches (< 15) -> Provisional window
    const prov = sliceCardCycleMatches(Array.from({ length: 10 }, (_, i) => mkRow(i)), 15);
    assert.equal(prov.isProvisional, true);
    assert.equal(prov.currentCycle, 0);
    assert.equal(prov.matchesUntilRefresh, 5);
    assert.equal(prov.activeSlice.length, 10);

    // 24 matches (sorted newest-first) -> Locked strictly to Cycle #1 (#1..#15)
    const rows24NewestFirst = Array.from({ length: 24 }, (_, i) => mkRow(23 - i));
    const win24 = sliceCardCycleMatches(rows24NewestFirst, 15);
    assert.equal(win24.isProvisional, false);
    assert.equal(win24.currentCycle, 1);
    assert.equal(win24.windowStartMatch, 1);
    assert.equal(win24.windowEndMatch, 15);
    assert.equal(win24.progressInCycle, 9);
    assert.equal(win24.matchesUntilRefresh, 6);
    assert.equal(win24.activeSlice[0].match_guid, 'm-0');
    assert.equal(win24.activeSlice[14].match_guid, 'm-14');

    // Adding matches #25..#29 MUST still lock to Cycle #1 (#1..#15)
    const rows29NewestFirst = Array.from({ length: 29 }, (_, i) => mkRow(28 - i));
    const win29 = sliceCardCycleMatches(rows29NewestFirst, 15);
    assert.equal(win29.currentCycle, 1);
    assert.deepEqual(win29.activeSlice.map(r => r.match_guid), win24.activeSlice.map(r => r.match_guid));

    // Reaching match #30 flips cleanly to Cycle #2 (#16..#30) with prevSlice (#1..#15)
    const rows30NewestFirst = Array.from({ length: 30 }, (_, i) => mkRow(29 - i));
    const win30 = sliceCardCycleMatches(rows30NewestFirst, 15);
    assert.equal(win30.currentCycle, 2);
    assert.equal(win30.windowStartMatch, 16);
    assert.equal(win30.windowEndMatch, 30);
    assert.equal(win30.activeSlice[0].match_guid, 'm-15');
    assert.equal(win30.prevSlice.length, 15);
    assert.equal(win30.prevSlice[0].match_guid, 'm-0');
});

test('FIFA card helpers & OvertimeDBCache player_card_prefs persistence', () => {
    assert.equal(resolveCardPosition({ finishing: 75, creation: 40, dribbling: 55, pace: 50, tackling: 45, goalkeeping: 20, archetype: 'The Striker' }), 'ST');
    assert.equal(resolveCardPosition({ finishing: 30, creation: 45, dribbling: 30, pace: 35, tackling: 50, goalkeeping: 68, archetype: 'The Anchor' }), 'GK');
    assert.equal(resolvePromoEdition(91, false, 8.5), 'OVERTIME ICON');
    assert.equal(resolvePromoEdition(78, true, 7.5), 'PROVISIONAL');

    const playstyles = extractCardPlayStyles(
        { finishing: 82, creation: 55, dribbling: 68, pace: 50, tackling: 40, goalkeeping: 20, aerial: 35, positioning: 52, archetype: 'The Striker' },
        []
    );
    assert.ok(playstyles.length >= 2);
    assert.equal(playstyles[0].id, 'power_shot');
    assert.equal(playstyles[0].tier, 'plus');

    const tmpDb = path.join(os.tmpdir(), `overtime-card-test-${Date.now()}.db`);
    const cache = new OvertimeDBCache(tmpDb);
    const saved = cache.upsertCardPrefs({
        primary_id: 'Epic|swapo|0',
        car_body: 'fennec',
        custom_name: 'SWAPO',
        custom_title: 'NET HUNTER',
    });
    assert.equal(saved.car_body, 'fennec');
    assert.equal(cache.getCardPrefs('Epic|swapo|0')?.custom_title, 'NET HUNTER');
    assert.equal(classifyRowGameMode({ playlist_id: 11, team_size: 2 }), '2s');
    assert.equal(classifyRowGameMode({ playlist_id: 2, team_size: 2 }), '2s');
    assert.equal(classifyRowGameMode({ playlist_id: 13, team_size: 3 }), '3s');
    assert.equal(classifyRowGameMode({ playlist_id: 34, team_size: 2 }), '2s');
    assert.equal(classifyRowGameMode({ playlist_id: 34, team_size: 3 }), '3s');
    cache.close();
    try { fs.unlinkSync(tmpDb); } catch {}
});

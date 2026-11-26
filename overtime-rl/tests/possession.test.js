import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupMicroTouches,
  classifyPossessionState,
  isSimultaneous50,
} from '../src/server/models/possession.ts';

test('groupMicroTouches - merges rapid micro-touches (<350ms) by same player', () => {
  const rawHits = [
    { ts: 1000, player_name: 'Swapo_o', team_num: 0, pre_speed: 1000, post_speed: 1200, x: 100, y: 200, z: 50 },
    { ts: 1150, player_name: 'Swapo_o', team_num: 0, pre_speed: 1200, post_speed: 1350, x: 150, y: 250, z: 60 },
    { ts: 1300, player_name: 'Swapo_o', team_num: 0, pre_speed: 1350, post_speed: 1500, x: 200, y: 300, z: 70 },
    // Later hit after 600ms gap
    { ts: 1900, player_name: 'Swapo_o', team_num: 0, pre_speed: 800, post_speed: 1100, x: 500, y: 600, z: 80 },
  ];

  const debounced = groupMicroTouches(rawHits);

  assert.equal(debounced.length, 2);
  assert.equal(debounced[0].player_name, 'Swapo_o');
  assert.equal(debounced[0].touch_count, 3);
  assert.equal(debounced[0].start_ts, 1000);
  assert.equal(debounced[0].end_ts, 1300);
  assert.equal(debounced[0].post_speed, 1500);
  assert.equal(debounced[0].x, 200);

  assert.equal(debounced[1].touch_count, 1);
  assert.equal(debounced[1].start_ts, 1900);
});

test('groupMicroTouches - does not merge touches by different players', () => {
  const rawHits = [
    { ts: 1000, player_name: 'Swapo_o', team_num: 0, pre_speed: 1000, post_speed: 1200, x: 100, y: 200, z: 50 },
    { ts: 1100, player_name: 'Opponent1', team_num: 1, pre_speed: 1200, post_speed: 1300, x: 105, y: 205, z: 50 },
  ];

  const debounced = groupMicroTouches(rawHits);
  assert.equal(debounced.length, 2);
  assert.equal(debounced[0].player_name, 'Swapo_o');
  assert.equal(debounced[1].player_name, 'Opponent1');
});

test('isSimultaneous50 - detects opposing team touches within threshold', () => {
  const hitA = {
    player_name: 'Swapo_o',
    team_num: 0,
    start_ts: 5000,
    end_ts: 5050,
    touch_count: 1,
    pre_speed: 1000,
    post_speed: 1400,
    x: 0,
    y: 0,
    z: 100,
  };
  const hitB = {
    player_name: 'Rival',
    team_num: 1,
    start_ts: 5200,
    end_ts: 5200,
    touch_count: 1,
    pre_speed: 1200,
    post_speed: 800,
    x: 10,
    y: 10,
    z: 100,
  };
  const teammateHit = {
    player_name: 'Teammate',
    team_num: 0,
    start_ts: 5200,
    end_ts: 5200,
    touch_count: 1,
    pre_speed: 1200,
    post_speed: 800,
    x: 10,
    y: 10,
    z: 100,
  };

  assert.equal(isSimultaneous50(hitA, hitB), true);
  assert.equal(isSimultaneous50(hitA, teammateHit), false); // Teammates cannot be a 50-50 duel
});

test('classifyPossessionState - classifies controlled, contested, and loose states', () => {
  // 1. Contested: touches from opposing teams in close proximity/time
  const contestedHits = [
    {
      player_name: 'Swapo_o',
      team_num: 0,
      start_ts: 1000,
      end_ts: 1000,
      touch_count: 1,
      pre_speed: 1000,
      post_speed: 1200,
      x: 0,
      y: 0,
      z: 50,
    },
    {
      player_name: 'Opponent1',
      team_num: 1,
      start_ts: 1200,
      end_ts: 1200,
      touch_count: 1,
      pre_speed: 1200,
      post_speed: 1500,
      x: 20,
      y: 20,
      z: 60,
    },
  ];
  assert.equal(classifyPossessionState(contestedHits), 'contested');

  // 2. Controlled: player with multiple touches or carry sequence
  const controlledHits = [
    {
      player_name: 'Swapo_o',
      team_num: 0,
      start_ts: 2000,
      end_ts: 2400,
      touch_count: 3,
      pre_speed: 1000,
      post_speed: 1400,
      x: 500,
      y: 500,
      z: 100,
    },
  ];
  assert.equal(classifyPossessionState(controlledHits), 'controlled');

  // 3. Loose: single hit with no follow up or empty history
  const looseHits = [
    {
      player_name: 'Swapo_o',
      team_num: 0,
      start_ts: 3000,
      end_ts: 3000,
      touch_count: 1,
      pre_speed: 1000,
      post_speed: 2000,
      x: 0,
      y: -3000,
      z: 100,
    },
  ];
  assert.equal(classifyPossessionState(looseHits, 1000, 4500), 'loose'); // 1.5s after hit -> loose
});

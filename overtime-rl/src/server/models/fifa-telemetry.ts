import type {
  DebouncedHit,
  DoubleCommitEvent,
  GoalCausalChain,
  GoalCausalStep,
  ShotMapItem,
} from '../../shared/types.ts';
import { isSimultaneous50 } from './possession.ts';

export interface PlayerFifaPlayMetrics {
  dribbleChains: number;
  dribbleTakeOns: number;
  dribbleGoals: number;
  dribbleTurnovers: number;
  duelsWon: number;
  cleanDispossessions: number;
  paceSprints: number;
  avgTransitionVelocity: number;
  blitzCounterGoals: number;
  xgPrevented: number;
}

export interface RealGoalMarker {
  ts: number;
  teamNum: number;
  scorerName?: string;
  speedKmh?: number;
}

function defaultPlayerMetrics(): PlayerFifaPlayMetrics {
  return {
    dribbleChains: 0,
    dribbleTakeOns: 0,
    dribbleGoals: 0,
    dribbleTurnovers: 0,
    duelsWon: 0,
    cleanDispossessions: 0,
    paceSprints: 0,
    avgTransitionVelocity: 0,
    blitzCounterGoals: 0,
    xgPrevented: 0,
  };
}

function getOrCreate(
  map: Map<string, PlayerFifaPlayMetrics>,
  name: string
): PlayerFifaPlayMetrics {
  let entry = map.get(name);
  if (!entry) {
    entry = defaultPlayerMetrics();
    map.set(name, entry);
  }
  return entry;
}

/**
 * Computes FIFA-inspired Rocket League skill telemetry directly from debounced ball contacts,
 * shot outcomes, and goal timestamps: Dribbling, Tackling (outfield 50/50s & steals),
 * Pace (net-to-net transition speed), and Goalkeeping (xG prevented).
 */
export function extractFifaPlayMetrics(params: {
  debouncedHits: DebouncedHit[];
  shots: ShotMapItem[];
  realGoalEvents: RealGoalMarker[];
  saveEvents?: Array<{ ts: number; playerName: string; teamNum: number; isEpic: boolean }>;
}): Map<string, PlayerFifaPlayMetrics> {
  const { debouncedHits, shots, realGoalEvents, saveEvents = [] } = params;
  const result = new Map<string, PlayerFifaPlayMetrics>();
  const transitionVelSamples = new Map<string, number[]>();

  // 1. Dribbling: Continuous same-player ball-control chains with forward progression & pressure retention
  let i = 0;
  while (i < debouncedHits.length) {
    const startHit = debouncedHits[i];
    let endIdx = i;
    let totalContacts = startHit.touch_count;

    while (endIdx + 1 < debouncedHits.length) {
      const next = debouncedHits[endIdx + 1];
      if (
        next.player_name === startHit.player_name &&
        next.start_ts - debouncedHits[endIdx].end_ts <= 2200
      ) {
        endIdx += 1;
        totalContacts += next.touch_count;
      } else {
        break;
      }
    }

    const endHit = debouncedHits[endIdx];
    const durationMs = endHit.end_ts - startHit.start_ts;
    const isMultiTouchDribble =
      totalContacts >= 2 && (durationMs >= 1000 || endIdx > i || totalContacts >= 3);

    if (isMultiTouchDribble) {
      const m = getOrCreate(result, startHit.player_name);
      const forwardY =
        startHit.team_num === 0 ? endHit.y - startHit.y : startHit.y - endHit.y;
      const chainWeight = forwardY >= 1200 ? 1.0 : forwardY > 0 ? 0.65 : 0.35;
      m.dribbleChains += chainWeight;

      // Challenger pressured before or mid-chain and carrier retained control
      const hadPressureBefore =
        i > 0 &&
        debouncedHits[i - 1].team_num !== startHit.team_num &&
        startHit.start_ts - debouncedHits[i - 1].end_ts <= 1100;
      const beatAfter =
        endIdx + 1 < debouncedHits.length &&
        debouncedHits[endIdx + 1].team_num !== startHit.team_num &&
        debouncedHits[endIdx + 1].start_ts - endHit.end_ts <= 1200 &&
        endIdx + 2 < debouncedHits.length &&
        debouncedHits[endIdx + 2].team_num === startHit.team_num &&
        debouncedHits[endIdx + 2].start_ts - debouncedHits[endIdx + 1].end_ts <= 1400;
      if ((hadPressureBefore && forwardY >= 500) || beatAfter) {
        m.dribbleTakeOns += 1;
      }

      // Goal scored cleanly from dribble chain
      const scoredAfterDribble = realGoalEvents.some(
        g =>
          g.teamNum === startHit.team_num &&
          (!g.scorerName || g.scorerName === startHit.player_name) &&
          g.ts >= endHit.start_ts &&
          g.ts <= endHit.end_ts + 2800
      );
      if (scoredAfterDribble) {
        m.dribbleGoals += 1;
      } else if (endIdx + 1 < debouncedHits.length) {
        // Immediate clean loss without shot
        const nextOpp = debouncedHits[endIdx + 1];
        const tookShot = shots.some(
          s =>
            s.player_name === startHit.player_name &&
            s.shot_ts >= startHit.start_ts &&
            s.shot_ts <= endHit.end_ts + 1500
        );
        if (
          !tookShot &&
          nextOpp.team_num !== startHit.team_num &&
          nextOpp.start_ts - endHit.end_ts <= 1200 &&
          endIdx + 2 < debouncedHits.length &&
          debouncedHits[endIdx + 2].team_num === nextOpp.team_num
        ) {
          m.dribbleTurnovers += 1;
        }
      }
    }

    i = endIdx + 1;
  }

  // 2. Tackling: True 50/50 Duel Outcomes & Clean Dispossessions of Controlled Attackers
  for (let k = 0; k < debouncedHits.length - 1; k++) {
    const h1 = debouncedHits[k];
    const h2 = debouncedHits[k + 1];

    // Simultaneous 50/50 challenge: resolve actual winner via follow-up control or forward Δy
    if (isSimultaneous50(h1, h2, 400)) {
      let winner: DebouncedHit | null = null;
      if (k + 2 < debouncedHits.length) {
        const follow = debouncedHits[k + 2];
        if (follow.start_ts - h2.end_ts <= 2000) {
          winner = follow.team_num === h1.team_num ? h1 : h2;
        }
      }
      if (!winner) {
        const h2GainedForward = h2.team_num === 0 ? h2.y > h1.y : h2.y < h1.y;
        winner = h2GainedForward ? h2 : h1;
      }
      getOrCreate(result, winner.player_name).duelsWon += 1;
      continue;
    }

    // Clean Dispossession: h1's team controlled >= 2 recent touches, h2 interrupts cleanly & h2's team keeps control
    if (h1.team_num !== h2.team_num && h2.start_ts - h1.end_ts <= 1800) {
      const h1HadControl =
        h1.touch_count >= 2 ||
        (k > 0 &&
          debouncedHits[k - 1].team_num === h1.team_num &&
          h1.start_ts - debouncedHits[k - 1].end_ts <= 1600);
      const defenderKeptBall =
        k + 2 < debouncedHits.length &&
        debouncedHits[k + 2].team_num === h2.team_num &&
        debouncedHits[k + 2].start_ts - h2.end_ts <= 2200;

      if (h1HadControl && defenderKeptBall) {
        getOrCreate(result, h2.player_name).cleanDispossessions += 1;
      }
    }
  }

  // 3. Pace: Net-to-Net Ball Transition Velocity & Blitz Counter Goals
  const countedBreakEnds = new Set<number>();
  for (let sIdx = 0; sIdx < debouncedHits.length; sIdx++) {
    const origin = debouncedHits[sIdx];
    const team = origin.team_num;
    const isOwnHalf = team === 0 ? origin.y <= -1100 : origin.y >= 1100;
    if (!isOwnHalf) continue;

    // Track continuous team transition up to opponent box (|y| >= 3000) within 6.5s
    const touchedNames = new Set<string>([origin.player_name]);
    let reachedBoxIdx = -1;

    for (let j = sIdx + 1; j < debouncedHits.length; j++) {
      const cur = debouncedHits[j];
      const dtMs = cur.start_ts - origin.start_ts;
      if (dtMs > 6500) break;
      if (cur.team_num !== team) break;

      touchedNames.add(cur.player_name);
      const inOppBox = team === 0 ? cur.y >= 3000 : cur.y <= -3000;
      if (inOppBox && dtMs >= 800) {
        reachedBoxIdx = j;
        break;
      }
    }

    if (reachedBoxIdx !== -1 && !countedBreakEnds.has(reachedBoxIdx)) {
      countedBreakEnds.add(reachedBoxIdx);
      const dest = debouncedHits[reachedBoxIdx];
      const dtSec = Math.max(0.8, (dest.start_ts - origin.start_ts) / 1000);
      const distanceY = Math.abs(dest.y - origin.y);
      const velocityUuSec = Math.min(2600, Math.round(distanceY / dtSec));

      for (const pName of touchedNames) {
        const m = getOrCreate(result, pName);
        m.paceSprints += 1;
        const arr = transitionVelSamples.get(pName) || [];
        arr.push(velocityUuSec);
        transitionVelSamples.set(pName, arr);
      }

      const scoredRapidGoal = realGoalEvents.some(
        g =>
          g.teamNum === team &&
          g.ts >= dest.start_ts - 200 &&
          g.ts <= origin.start_ts + 7000
      );
      if (scoredRapidGoal) {
        const finishingPlayer = debouncedHits[reachedBoxIdx].player_name;
        getOrCreate(result, finishingPlayer).blitzCounterGoals += 1;
      }
    }
  }

  for (const [pName, samples] of transitionVelSamples.entries()) {
    if (samples.length > 0) {
      getOrCreate(result, pName).avgTransitionVelocity = Math.round(
        samples.reduce((a, b) => a + b, 0) / samples.length
      );
    }
  }

  // 4. Goalkeeping: Difficulty-weighted xG Prevented from Saved Shots & Statfeed Saves
  const usedShotIds = new Set<string>();
  for (const se of saveEvents) {
    const oppTeam = se.teamNum === 0 ? 1 : 0;
    const matchedShot = shots.find(
      s =>
        !usedShotIds.has(s.id) &&
        s.outcome === 'saved' &&
        s.team_num === oppTeam &&
        Math.abs(s.shot_ts - se.ts) <= 2000
    );
    const xgVal = matchedShot ? Math.max(0.12, matchedShot.xg) : se.isEpic ? 0.36 : 0.18;
    if (matchedShot) usedShotIds.add(matchedShot.id);
    getOrCreate(result, se.playerName).xgPrevented += xgVal;
  }

  return result;
}

/**
 * Constructs a 3-step Causal Film Strip (Origin -> Mid-Chain Failure -> Net Impact)
 * for every goal conceded, identifying whether Dribbling, Tackling, Discipline, or Goalkeeping failed.
 */
export function evaluateConcededGoalChains(params: {
  goals: Array<{ idx: number; ts: number; teamNum: number; scorerName: string; speedKmh: number }>;
  shots: ShotMapItem[];
  doubleCommits: DoubleCommitEvent[];
  debouncedHits: DebouncedHit[];
  roundStartedTimes: number[];
  matchStartedAt: number;
  userTeamNum: number | null;
}): GoalCausalChain[] {
  const { goals, shots, doubleCommits, debouncedHits, roundStartedTimes, matchStartedAt, userTeamNum } = params;
  const chains: GoalCausalChain[] = [];

  for (const g of goals) {
    const defendingTeam = g.teamNum === 0 ? 1 : 0;
    // Focus diagnostics on goals conceded by the user's team when identified (fallback to all goals)
    if (userTeamNum !== null && defendingTeam !== userTeamNum) continue;

    const goalTimeSec = Math.max(0, Math.round((g.ts - matchStartedAt) / 1000));
    const matchedShot = shots.find(
      s => s.outcome === 'goal' && s.team_num === g.teamNum && Math.abs(s.shot_ts - g.ts) <= 2000
    );
    const shotXg = matchedShot?.xg ?? 0.55;
    const steps: GoalCausalStep[] = [];

    // Step 1: Origin (-9.5s .. -3.0s)
    const isKickoffGoal = roundStartedTimes.some(rt => g.ts >= rt && g.ts - rt <= 9000);
    const windowHits = debouncedHits.filter(h => h.start_ts >= g.ts - 9500 && h.end_ts <= g.ts);

    let originPlayer: string | null = null;
    for (let j = 0; j < windowHits.length - 1; j++) {
      const h = windowHits[j];
      const next = windowHits[j + 1];
      if (h.team_num === defendingTeam && next.team_num === g.teamNum && next.start_ts - h.end_ts <= 1800) {
        const hadDribble =
          h.touch_count >= 2 ||
          (j > 0 && windowHits[j - 1].player_name === h.player_name && h.start_ts - windowHits[j - 1].end_ts <= 1800);
        originPlayer = h.player_name;
        const offsetSec = Math.round((h.end_ts - g.ts) / 1000);
        steps.push({
          offset_label: `${offsetSec}s`,
          player_name: h.player_name,
          team_num: defendingTeam,
          category: hadDribble ? 'Dribbling' : 'Creation',
          title: hadDribble ? 'Dribble Dispossessed' : 'Transition Turnover',
          detail: hadDribble
            ? `${h.player_name} lost possession on a carry into pressure.`
            : `${h.player_name}'s pass/clear was intercepted in transition.`,
          severity: 'medium',
        });
        break;
      }
    }

    if (steps.length === 0) {
      steps.push({
        offset_label: isKickoffGoal ? '-6s' : '-7s',
        player_name: null,
        team_num: g.teamNum,
        category: isKickoffGoal ? 'Discipline' : 'Pace',
        title: isKickoffGoal ? 'Kickoff Sequence Breakdown' : 'Rapid Opponent Counter',
        detail: isKickoffGoal
          ? 'Goal conceded shortly after kickoff before midfield settled.'
          : `${g.scorerName}'s squad launched a fast vertical counter.`,
        severity: 'low',
      });
    }

    // Step 2: Mid-Chain Failure (-6.0s .. -0.8s)
    const recentDc = doubleCommits.find(
      dc =>
        dc.team_num === defendingTeam &&
        dc.time_seconds <= goalTimeSec &&
        goalTimeSec - dc.time_seconds <= 7
    );
    if (recentDc) {
      const culprit = recentDc.instigator_name || recentDc.player2_name;
      steps.push({
        offset_label: `${Math.min(-1, recentDc.time_seconds - goalTimeSec)}s`,
        player_name: culprit,
        team_num: defendingTeam,
        category: 'Discipline',
        title: recentDc.rushed_from_net ? 'Empty-Net Double Commit' : 'Teammate Spatial Overlap',
        detail: `${recentDc.player1_name} & ${recentDc.player2_name} double-committed (${recentDc.ball_zone ?? 'midfield'}), leaving recovery exposed.`,
        severity: 'high',
      });
    } else {
      // Check for lost 50/50 challenge inside final 5.5s
      let lost50Player: string | null = null;
      let lost50Offset = -3;
      for (let j = windowHits.length - 2; j >= 0; j--) {
        const a = windowHits[j];
        const b = windowHits[j + 1];
        if (a.start_ts < g.ts - 5500) break;
        if (isSimultaneous50(a, b, 450)) {
          const defender = a.team_num === defendingTeam ? a : b;
          lost50Player = defender.player_name;
          lost50Offset = Math.min(-1, Math.round((defender.start_ts - g.ts) / 1000));
          break;
        }
      }
      if (lost50Player) {
        steps.push({
          offset_label: `${lost50Offset}s`,
          player_name: lost50Player,
          team_num: defendingTeam,
          category: 'Tackling',
          title: '50/50 Challenge Lost',
          detail: `${lost50Player} contested cleanly but lost the crucial 50/50 into danger.`,
          severity: 'medium',
        });
      }
    }

    // Step 3: Net Impact (0s)
    const speedStr = g.speedKmh > 0 ? `${Math.round(g.speedKmh)} km/h ` : '';
    const isUnstoppable = shotXg >= 0.65 || recentDc?.rushed_from_net;
    steps.push({
      offset_label: '0s',
      player_name: g.scorerName,
      team_num: g.teamNum,
      category: 'Goalkeeping',
      title: recentDc ? 'Exposed Open-Net Finish' : isUnstoppable ? 'High-xG Goal Conceded' : 'Shot Past Last Line',
      detail: `${g.scorerName} buried a ${speedStr}(${shotXg.toFixed(2)} xG) strike.`,
      severity: isUnstoppable ? 'high' : 'medium',
    });

    const primaryStep = steps.find(s => s.severity === 'high') || steps[0];
    chains.push({
      goal_id: `conceded-${g.idx}`,
      time_seconds: goalTimeSec,
      conceding_team: defendingTeam,
      scorer_name: g.scorerName,
      shot_xg: Math.round(shotXg * 100) / 100,
      primary_attribution: originPlayer && primaryStep.player_name === null ? originPlayer : primaryStep.title,
      steps,
    });
  }

  return chains;
}

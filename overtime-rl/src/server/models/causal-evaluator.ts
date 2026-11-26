import type { DebouncedHit } from '../../shared/types.ts';

export interface PlayerSpatialState {
  name: string;
  team_num: number;
  x: number;
  y: number;
  z: number;
  speed?: number;
  boost?: number;
}

export interface PassDeliveryResult {
  isFavorable: boolean;
  deltaDistance: number;
  bonusDelta: number;
  liabilityPlayer: string;
}

export interface WinBackResult {
  wonBack: boolean;
  recoveredBy?: string;
  elapsedSec: number;
  bonus: number;
  deduction: number;
}

export interface ReboundWaiverResult {
  waived: boolean;
  penalty: number;
  clearTs?: number;
}

export type DefensiveBlameCause =
  | 'boost_abandonment'
  | 'spectator'
  | 'honest_effort'
  | 'fast_break_immunity'
  | 'kickoff_breakdown'
  | 'own_goal'
  | 'unmarked_post'
  | 'tailing_overcommit';

export interface CausalDefenseBlame {
  playerName: string;
  cause: DefensiveBlameCause;
  delta: number;
  description: string;
}

export interface DoubleCommitContext {
  teamSize?: number;
  thirdManInNet?: string | null;
  isNetExposed?: boolean;
  intruderRushedFromNet?: boolean;
  ballZone?: 'attack_box' | 'midfield' | 'defense';
}

export interface DoubleCommitLiabilityResult {
  carrier: string;
  intruder: string;
  isFatal: boolean;
  carrierDelta: number;
  intruderDelta: number;
  cause: 'tailing_overcommit' | 'simultaneous_jump' | 'carrier_immunity';
  netStatus: 'covered' | 'open_net' | 'rusher_open_net' | 'unknown';
  thirdManCovering: string | null;
  rushedFromNet: boolean;
  ballZone?: 'attack_box' | 'midfield' | 'defense';
  reason: string;
}

/**
 * Evaluates spatial pass delivery into the box/slot.
 * Calculates ΔD = dist(BallTarget, ClosestOpponent) - dist(BallTarget, Teammate)
 * If ΔD > 0: Favorable Delivery (+0.45 to +0.60 to creator; shields creator on counter)
 * If ΔD <= 0: Hospital Pass (-0.30 to passer)
 */
export function evaluatePassDelivery(
  passerName: string,
  passerTeam: number,
  ballTarget: { x: number; y: number; z: number },
  players: PlayerSpatialState[]
): PassDeliveryResult {
  const teammates = players.filter(
    p => p.team_num === passerTeam && p.name !== passerName
  );
  const opponents = players.filter(p => p.team_num !== passerTeam);

  if (teammates.length === 0) {
    return {
      isFavorable: false,
      deltaDistance: 0,
      bonusDelta: 0.0,
      liabilityPlayer: passerName,
    };
  }

  const dist = (p: PlayerSpatialState) =>
    Math.hypot(p.x - ballTarget.x, p.y - ballTarget.y, p.z - ballTarget.z);

  let closestTeammate = teammates[0];
  let minTeammateDist = dist(closestTeammate);
  for (let i = 1; i < teammates.length; i++) {
    const d = dist(teammates[i]);
    if (d < minTeammateDist) {
      minTeammateDist = d;
      closestTeammate = teammates[i];
    }
  }

  let minOpponentDist = Infinity;
  for (const opp of opponents) {
    const d = dist(opp);
    if (d < minOpponentDist) {
      minOpponentDist = d;
    }
  }

  const deltaDistance = minOpponentDist - minTeammateDist;

  if (deltaDistance > 0) {
    // Favorable pass: Delivered closer to teammate than any opponent
    const bonusDelta = Math.round(
      Math.min(0.60, Math.max(0.45, 0.45 + (deltaDistance / 3000) * 0.15)) * 100
    ) / 100;

    return {
      isFavorable: true,
      deltaDistance,
      bonusDelta,
      liabilityPlayer: closestTeammate.name, // Teammate had spatial priority
    };
  }

  // Hospital Pass: Passed directly into waiting opponent traffic
  return {
    isFavorable: false,
    deltaDistance,
    bonusDelta: -0.30,
    liabilityPlayer: passerName, // Passer is at fault
  };
}

/**
 * 5-Second Counter-Press Win-Back Rule:
 * When possession is lost, holds turnover penalty for 5.0s.
 * If the team wins the ball back within <= 5.0s, deduct 0.0 and grant +0.15 recovery bonus.
 * If not won back, applies pitch-zone scaled penalty.
 */
export function evaluate5sWinBack(
  turnoverTs: number,
  hits: DebouncedHit[],
  losingTeam: number,
  zone: 'attack' | 'midfield' | 'defense' = 'midfield'
): WinBackResult {
  const windowEndTs = turnoverTs + 5000;

  // Find first friendly touch within the 5.0s window after the turnover
  const friendlyTouches = hits.filter(
    h => h.team_num === losingTeam && h.start_ts > turnoverTs && h.start_ts <= windowEndTs
  );

  if (friendlyTouches.length > 0) {
    const firstRecovery = friendlyTouches[0];
    const elapsedSec = Math.round(((firstRecovery.start_ts - turnoverTs) / 1000) * 10) / 10;
    return {
      wonBack: true,
      recoveredBy: firstRecovery.player_name,
      elapsedSec,
      bonus: 0.15,
      deduction: 0.0,
    };
  }

  // Not won back in 5 seconds
  let zoneMultiplier = 1.0;
  if (zone === 'attack') zoneMultiplier = 0.5;
  if (zone === 'defense') zoneMultiplier = 1.5;

  const deduction = Math.round(-0.20 * zoneMultiplier * 100) / 100;

  return {
    wonBack: false,
    elapsedSec: 5.0,
    bonus: 0.0,
    deduction,
  };
}

/**
 * Goalkeeper Rebound Recovery:
 * If a keeper parries a shot into danger, but secures/clears the ball within
 * <= 2.5s, the -0.25 rebound penalty is completely waived to 0.0.
 */
export function evaluateReboundWaiver(
  saveTs: number,
  hits: DebouncedHit[],
  keeperName: string
): ReboundWaiverResult {
  const clearWindowEnd = saveTs + 2500;
  const followUpTouch = hits.find(
    h => h.player_name === keeperName && h.start_ts > saveTs && h.start_ts <= clearWindowEnd
  );

  if (followUpTouch) {
    return {
      waived: true,
      penalty: 0.0,
      clearTs: followUpTouch.start_ts,
    };
  }

  return {
    waived: false,
    penalty: -0.25,
  };
}

/**
 * 5-Second Rewind Defensive Accountability:
 * Evaluates the 5 seconds leading to a conceded goal.
 * Resolves to the Single Primary Cause per player:
 * - Fast-Break Exception (0.0): Attacking upfield when unexpected turnover occurs.
 * - Boost-Over-Ball Abandonment (-0.75): Vacating net for corner boost while opponents attack.
 * - Spectator on Savable Ball (-0.45): Sitting static in net with near-zero movement speed.
 * - Honest Effort (-0.15): Moving with pace or making partial contact attempting a save.
 */
export function evaluateDefensiveRewind(
  goalTs: number,
  players: PlayerSpatialState[],
  hits: DebouncedHit[],
  concedingTeam: number,
  isFastBreak: boolean = false
): CausalDefenseBlame[] {
  const defenders = players.filter(p => p.team_num === concedingTeam);
  const defNetY = concedingTeam === 0 ? -5120 : 5120;
  const attNetY = concedingTeam === 0 ? 5120 : -5120;

  const attributions: CausalDefenseBlame[] = [];

  for (const defender of defenders) {
    const hasTouch = hits.some(
      h =>
        h.player_name === defender.name &&
        h.start_ts >= goalTs - 5000 &&
        h.start_ts <= goalTs
    );

    const distToDefNet = Math.hypot(defender.x, defender.y - defNetY);
    const speed = defender.speed ?? 0;

    // 1. Fast-Break Exception: Player was attacking upfield when quick counter-attack occurred
    const isInAttackingHalf =
      concedingTeam === 0 ? defender.y > 1000 : defender.y < -1000;
    if (isFastBreak && isInAttackingHalf) {
      attributions.push({
        playerName: defender.name,
        cause: 'fast_break_immunity',
        delta: 0.0,
        description: 'Fast-break counter immunity while attacking upfield',
      });
      continue;
    }

    // 2. Boost-Over-Ball Abandonment: Vacating defensive net for corner boost
    const isAtCornerBoost =
      Math.abs(defender.x) > 2800 && Math.abs(defender.y - defNetY) < 2200;
    if (isAtCornerBoost && distToDefNet > 2500 && !hasTouch) {
      attributions.push({
        playerName: defender.name,
        cause: 'boost_abandonment',
        delta: -0.75,
        description: 'Abandoned defensive net for corner boost on conceded play',
      });
      continue;
    }

    // 3. Spectator on Savable Ball: Static in goalmouth without defensive reaction
    const isInGoalmouth =
      distToDefNet < 2200 && Math.abs(defender.x) < 1800;
    if (isInGoalmouth && speed < 350 && !hasTouch) {
      attributions.push({
        playerName: defender.name,
        cause: 'spectator',
        delta: -0.45,
        description: 'Spectating near net with low defensive reaction speed',
      });
      continue;
    }

    // 4. Honest Effort: Moving with pace or making contact attempting a save
    attributions.push({
      playerName: defender.name,
      cause: 'honest_effort',
      delta: -0.15,
      description: 'Active defensive recovery and contest on conceded play',
    });
  }

  return attributions;
}

/**
 * Asymmetric Double-Commit / Tailing Blame Attribution:
 * When two teammates commit into the same spatial zone (<650 uu / <400ms ground or <900 uu / <750ms air):
 * - Carrier (hit1): was already on the ball, carrying, dribbling, or initiating the play.
 * - Intruder (hit2): tailed directly behind the carrier, abandoning last-man rotational depth.
 * If fatal (opponent scores within <= 6.0s):
 * - Intruder receives -0.65 for leaving net open and interfering with carrier.
 * - Carrier receives 0.0 immunity (they were committed forward and cannot teleport back to net in time).
 * If non-fatal:
 * - Intruder receives -0.25 (unnecessary encroachment), carrier receives 0.0.
 */
export function evaluateDoubleCommitLiability(
  hit1: { player_name: string; team_num: number; ts: number; touch_count?: number; y?: number },
  hit2: { player_name: string; team_num: number; ts: number; touch_count?: number; y?: number },
  isFatal: boolean,
  carrierPriorTouches: number = 0,
  context?: DoubleCommitContext
): DoubleCommitLiabilityResult {
  let carrier = hit1.player_name;
  let intruder = hit2.player_name;

  if (carrierPriorTouches === 0 && (hit2.touch_count ?? 1) > (hit1.touch_count ?? 1)) {
    carrier = hit2.player_name;
    intruder = hit1.player_name;
  }

  const thirdMan = context?.thirdManInNet ?? null;
  const rushedFromNet = Boolean(context?.intruderRushedFromNet);
  const ballZone = context?.ballZone;
  const isCovered3s = Boolean(thirdMan) && !rushedFromNet && context?.isNetExposed !== true;

  if (isCovered3s && thirdMan) {
    return {
      carrier,
      intruder,
      isFatal,
      carrierDelta: 0.0,
      intruderDelta: isFatal ? -0.35 : -0.10,
      cause: isFatal ? 'tailing_overcommit' : 'carrier_immunity',
      netStatus: 'covered',
      thirdManCovering: thirdMan,
      rushedFromNet: false,
      ballZone,
      reason: isFatal
        ? `${thirdMan} held net behind play, though opponent capitalized within 8.0s.`
        : `${thirdMan} held 3rd-man net coverage behind the play — reduced spacing penalty.`,
    };
  }

  if (context?.isNetExposed && rushedFromNet) {
    return {
      carrier,
      intruder,
      isFatal,
      carrierDelta: 0.0,
      intruderDelta: isFatal ? -0.85 : -0.50,
      cause: 'tailing_overcommit',
      netStatus: 'rusher_open_net',
      thirdManCovering: null,
      rushedFromNet: true,
      ballZone,
      reason: isFatal
        ? `Goal was empty and ${intruder} rushed forward from defensive depth, leaving an open-net concession.`
        : `Goal was empty and ${intruder} rushed out from defensive net to double-commit, leaving net exposed.`,
    };
  }

  if (isFatal) {
    return {
      carrier,
      intruder,
      isFatal: true,
      carrierDelta: 0.0,
      intruderDelta: -0.65,
      cause: 'tailing_overcommit',
      netStatus: context?.isNetExposed ? 'open_net' : 'unknown',
      thirdManCovering: null,
      rushedFromNet: false,
      ballZone,
      reason: 'Goal was exposed with no 3rd-man safety; opponent scored within 8.0s of this collision.',
    };
  }

  const isAttackPress = context?.isNetExposed && ballZone === 'attack_box';
  return {
    carrier,
    intruder,
    isFatal: false,
    carrierDelta: 0.0,
    intruderDelta: isAttackPress ? -0.18 : -0.25,
    cause: 'carrier_immunity',
    netStatus: context?.isNetExposed ? 'open_net' : 'unknown',
    thirdManCovering: null,
    rushedFromNet: false,
    ballZone,
    reason: isAttackPress
      ? 'Aggressive overlap in opponent attacking box without deep safety — moderate transition risk.'
      : context?.isNetExposed
      ? 'No defender holding goalmouth; teammates overlapped within 750ms and 900uu leaving net open.'
      : 'Spatial overlap within 750ms and 900uu. Rotate behind carrier rather than tailing.',
  };
}

/**
 * Back-Post (Far-Post) Rotation vs Near-Post Flat-Foot Trap:
 * - Back-Post Entry (+0.20): Entering goalmouth from far post with momentum (speed >= 800 uu/s).
 * - Near-Post Trap (-0.35): Stationary inside net on near post (speed <= 300 uu/s) during dangerous shot.
 */
export interface BackPostEvalResult {
  isBackPost: boolean;
  isNearPostTrap: boolean;
  delta: number;
  reason: string;
}

export function evaluateBackPostRotation(
  defender: PlayerSpatialState,
  ballPos: { x: number; y: number; z: number },
  defendingGoalY: number
): BackPostEvalResult {
  const isInDefensiveBox = Math.abs(defender.y - defendingGoalY) <= 1800 && Math.abs(defender.x) <= 1600;
  if (!isInDefensiveBox) {
    return { isBackPost: false, isNearPostTrap: false, delta: 0.0, reason: 'outside_goal_box' };
  }

  const isOppositeSideOfBall = Math.sign(defender.x) !== Math.sign(ballPos.x) || Math.abs(ballPos.x) < 300;
  const speed = defender.speed ?? 0;

  if (isOppositeSideOfBall && speed >= 800) {
    return {
      isBackPost: true,
      isNearPostTrap: false,
      delta: 0.20,
      reason: 'far_post_entry_with_momentum',
    };
  }

  const isNearSide = Math.sign(defender.x) === Math.sign(ballPos.x) && Math.abs(ballPos.x) >= 600;
  if (isNearSide && speed <= 300) {
    return {
      isBackPost: false,
      isNearPostTrap: true,
      delta: -0.35,
      reason: 'near_post_flat_foot_trap',
    };
  }

  return { isBackPost: false, isNearPostTrap: false, delta: 0.0, reason: 'neutral_positioning' };
}

/**
 * Shadow Defense Delay vs First-Man Reckless Dive:
 * - Shadow Defense (+0.25): Defender positions between ball and own goal at controllable distance (500-1800 uu).
 * - Reckless Dive (-0.45 or -0.20 if recovered within 3.5s): Diver commits from >1800 uu, whiffs.
 */
export interface ShadowDefenseResult {
  isShadowDefense: boolean;
  delta: number;
  description: string;
}

export function evaluateShadowDefense(
  defender: PlayerSpatialState,
  attacker: PlayerSpatialState,
  ballPos: { x: number; y: number; z: number },
  defendingGoalY: number,
  isTurnoverOrGiveaway: boolean
): ShadowDefenseResult {
  const defDistToGoal = Math.abs(defendingGoalY - defender.y);
  const ballDistToGoal = Math.abs(defendingGoalY - ballPos.y);

  if (defDistToGoal >= ballDistToGoal) {
    return { isShadowDefense: false, delta: 0.0, description: 'behind_the_ball' };
  }

  const distToAttacker = Math.hypot(defender.x - attacker.x, defender.y - attacker.y);
  const isControllableDistance = distToAttacker >= 500 && distToAttacker <= 1800;

  if (isControllableDistance && isTurnoverOrGiveaway) {
    return {
      isShadowDefense: true,
      delta: 0.25,
      description: 'Shadow defense delayed attack and forced turnover',
    };
  }

  return { isShadowDefense: false, delta: 0.0, description: 'no_shadow_event' };
}

export interface DiveResult {
  isRecklessDive: boolean;
  waived50: boolean;
  delta: number;
  description: string;
}

export function evaluateRecklessDive(
  initialChallengeDist: number,
  isWhiff: boolean,
  recoveryClearWithin3_5s: boolean
): DiveResult {
  if (!isWhiff || initialChallengeDist < 1800) {
    return { isRecklessDive: false, waived50: false, delta: 0.0, description: 'normal_challenge' };
  }

  if (recoveryClearWithin3_5s) {
    return {
      isRecklessDive: true,
      waived50: true,
      delta: -0.20,
      description: 'Reckless dive with successful 3.5s recovery waiver',
    };
  }

  return {
    isRecklessDive: true,
    waived50: false,
    delta: -0.45,
    description: 'First-man reckless dive leaving defense exposed',
  };
}

/**
 * Kickoff Support: Tactical Cheat-Up vs Double-Corner Desertion
 * - Cheat-Up (+0.20): Second player moves toward midfield center (|x| <= 800, |y| <= 1400).
 * - Double Corner Desertion (-0.40): Second player deserts to corner orb when dead-ball leads to conceded shot within 3s.
 */
export interface KickoffSupportResult {
  isCheatUp: boolean;
  isDesertion: boolean;
  delta: number;
  description: string;
}

export function evaluateKickoffSupport(
  secondMan: PlayerSpatialState,
  isDeadBall50: boolean,
  concededWithin3s: boolean
): KickoffSupportResult {
  const isMidfieldCenter = Math.abs(secondMan.x) <= 800 && Math.abs(secondMan.y) <= 1400;
  if (isMidfieldCenter) {
    return {
      isCheatUp: true,
      isDesertion: false,
      delta: 0.20,
      description: 'Tactical kickoff cheat-up supporting first-man 50/50',
    };
  }

  const isCornerOrb = Math.abs(secondMan.x) >= 2800 && Math.abs(secondMan.y) >= 3800;
  if (isCornerOrb && isDeadBall50 && concededWithin3s) {
    return {
      isCheatUp: false,
      isDesertion: true,
      delta: -0.40,
      description: 'Double-corner desertion leaving net exposed on neutral kickoff',
    };
  }

  return { isCheatUp: false, isDesertion: false, delta: 0.0, description: 'standard_kickoff_support' };
}

/**
 * Backboard Wall Clear:
 * High Wall Clear (+0.30): Clearing contact above crossbar height (z >= 640 uu) on back wall (|y| >= 4800).
 */
export interface BackboardEvalResult {
  isBackboardClear: boolean;
  delta: number;
  description: string;
}

export function evaluateBackboardDefense(
  hit: { x: number; y: number; z: number; post_speed?: number },
  defendingTeam: number
): BackboardEvalResult {
  const goalY = defendingTeam === 0 ? -5120 : 5120;
  const isNearBackWall = Math.abs(hit.y - goalY) <= 600;
  const isAboveCrossbar = hit.z >= 640;

  if (isNearBackWall && isAboveCrossbar) {
    return {
      isBackboardClear: true,
      delta: 0.30,
      description: 'High backboard wall clear intercepting aerial threat',
    };
  }

  return { isBackboardClear: false, delta: 0.0, description: 'standard_defense' };
}

/**
 * Infield Centering (+0.35) vs Corner-Roll Giveaway (-0.25):
 * - Infield Cross (+0.35): Cross originating from wing (|x| >= 2200) directed into central slot (|x| <= 950) in attacking half.
 * - Corner Roll Giveaway (-0.25): Soft roll along corner curve claimed directly by opponent goalie.
 */
export interface InfieldCrossResult {
  isInfieldCross: boolean;
  isCornerRollGiveaway: boolean;
  delta: number;
  description: string;
}

export function evaluateInfieldCross(
  hitStart: { x: number; y: number },
  hitTarget: { x: number; y: number },
  attackingTeam: number,
  isOpponentGoalieClaim: boolean
): InfieldCrossResult {
  const isAttackingHalf = attackingTeam === 0 ? hitStart.y > 500 : hitStart.y < -500;
  const isFromWing = Math.abs(hitStart.x) >= 2200;
  const isIntoCenterSlot = Math.abs(hitTarget.x) <= 950;

  if (isAttackingHalf && isFromWing && isIntoCenterSlot && !isOpponentGoalieClaim) {
    return {
      isInfieldCross: true,
      isCornerRollGiveaway: false,
      delta: 0.35,
      description: 'High-yield infield cross into prime shooting slot',
    };
  }

  if (isAttackingHalf && isFromWing && isOpponentGoalieClaim) {
    return {
      isInfieldCross: false,
      isCornerRollGiveaway: true,
      delta: -0.25,
      description: 'Blind corner-roll giveaway claimed by opponent goalie',
    };
  }

  return { isInfieldCross: false, isCornerRollGiveaway: false, delta: 0.0, description: 'standard_touch' };
}

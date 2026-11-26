export interface ShotParameters {
  x: number;
  y: number;
  z: number;
  speedKmh: number;
  attackingTeamNum: number; // 0 = Blue attacking +5120, 1 = Orange attacking -5120
}

export interface XGResult {
  xg: number;
  distance: number;
  apertureRadians: number;
  isBigChance: boolean;
}

const GOAL_WIDTH_HALF = 892.14;
const GOAL_HEIGHT_CENTER = 321.39;
const GOAL_Y_TEAM0_ATTACK = 5120.0;
const GOAL_Y_TEAM1_ATTACK = -5120.0;

/**
 * Calculates Expected Goals (xG) based on geometric distance, visible goal mouth aperture,
 * and post-hit shot velocity.
 */
export function calculateXG(params: ShotParameters): XGResult {
  const goalY = params.attackingTeamNum === 0 ? GOAL_Y_TEAM0_ATTACK : GOAL_Y_TEAM1_ATTACK;

  // 1. 3D Euclidean distance to goal mouth center
  const dx = 0.0 - params.x;
  const dy = goalY - params.y;
  const dz = GOAL_HEIGHT_CENTER - params.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 2. Goal Aperture Angle in 2D horizontal plane (strictly in radians)
  const postLeftX = -GOAL_WIDTH_HALF;
  const postRightX = GOAL_WIDTH_HALF;

  const v1x = postLeftX - params.x;
  const v1y = goalY - params.y;
  const v2x = postRightX - params.x;
  const v2y = goalY - params.y;

  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

  let apertureRadians = 0;
  if (len1 > 0 && len2 > 0) {
    const dot = v1x * v2x + v1y * v2y;
    const cosAngle = Math.max(-1.0, Math.min(1.0, dot / (len1 * len2)));
    apertureRadians = Math.acos(cosAngle);
  }

  // 3. Post-hit speed in km/h (fallback default 60 km/h if 0)
  const vKmh = params.speedKmh > 0 ? params.speedKmh : 60.0;

  // 4. Calibrated Logit Equation
  const logit = -0.85 - (0.00062 * distance) + (1.25 * apertureRadians) + (0.015 * vKmh);
  const rawXG = 1.0 / (1.0 + Math.exp(-logit));

  // Clamped between 0.01 and 0.99
  const xg = Math.round(Math.max(0.01, Math.min(0.99, rawXG)) * 100) / 100;

  return {
    xg,
    distance: Math.round(distance),
    apertureRadians: Math.round(apertureRadians * 1000) / 1000,
    isBigChance: xg >= 0.45,
  };
}

/**
 * Calculates clinical finishing rating: Goals - Total xG
 */
export function calculateClinicality(goals: number, totalXG: number): number {
  return Math.round((goals - totalXG) * 100) / 100;
}

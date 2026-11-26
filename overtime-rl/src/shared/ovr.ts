import type { RadarProfile, TacticalArchetype } from './types.ts';

export type OvrTier = 'ICON' | 'ELITE' | 'GOLD' | 'SILVER' | 'BRONZE';

export interface AxisWeightSpec {
  key: 'finishing' | 'creation' | 'dribbling' | 'pace' | 'tackling' | 'goalkeeping' | 'aerial' | 'positioning';
  label: string;
  weight: number;
}

export interface TacticalOvrResult {
  ovr: number;
  total800: number;
  weightedRaw: number;
  tier: OvrTier;
  accentColor: string;
  topDrivers: Array<{ label: string; value: number; weightPct: number }>;
}

const ARCHETYPE_WEIGHTS: Record<TacticalArchetype, Record<AxisWeightSpec['key'], number>> = {
  'The Striker': {
    finishing: 0.25,
    pace: 0.16,
    dribbling: 0.14,
    aerial: 0.14,
    creation: 0.12,
    positioning: 0.08,
    tackling: 0.07,
    goalkeeping: 0.04,
  },
  'The Air Marshal': {
    aerial: 0.25,
    finishing: 0.18,
    pace: 0.15,
    dribbling: 0.11,
    creation: 0.10,
    goalkeeping: 0.08,
    tackling: 0.07,
    positioning: 0.06,
  },
  'The Dribbler': {
    dribbling: 0.26,
    finishing: 0.16,
    pace: 0.16,
    creation: 0.14,
    aerial: 0.10,
    positioning: 0.08,
    tackling: 0.06,
    goalkeeping: 0.04,
  },
  'The Playmaker': {
    creation: 0.25,
    positioning: 0.16,
    dribbling: 0.15,
    pace: 0.13,
    tackling: 0.11,
    finishing: 0.09,
    goalkeeping: 0.06,
    aerial: 0.05,
  },
  'The Anchor': {
    goalkeeping: 0.24,
    positioning: 0.22,
    tackling: 0.20,
    creation: 0.11,
    pace: 0.09,
    aerial: 0.07,
    dribbling: 0.04,
    finishing: 0.03,
  },
  'The Disruptor': {
    tackling: 0.26,
    pace: 0.18,
    finishing: 0.13,
    positioning: 0.12,
    goalkeeping: 0.11,
    dribbling: 0.08,
    creation: 0.07,
    aerial: 0.05,
  },
  'The Speed Demon': {
    pace: 0.26,
    dribbling: 0.16,
    finishing: 0.14,
    tackling: 0.13,
    creation: 0.11,
    aerial: 0.08,
    positioning: 0.07,
    goalkeeping: 0.05,
  },
  'The Boost Hawk': {
    positioning: 0.22,
    pace: 0.20,
    tackling: 0.15,
    goalkeeping: 0.13,
    creation: 0.11,
    dribbling: 0.08,
    finishing: 0.06,
    aerial: 0.05,
  },
  'The All-Rounder': {
    finishing: 0.14,
    creation: 0.13,
    dribbling: 0.13,
    pace: 0.13,
    tackling: 0.13,
    goalkeeping: 0.12,
    positioning: 0.12,
    aerial: 0.10,
  },
  'The Passenger': {
    finishing: 0.125,
    creation: 0.125,
    dribbling: 0.125,
    pace: 0.125,
    tackling: 0.125,
    goalkeeping: 0.125,
    aerial: 0.125,
    positioning: 0.125,
  },
};

const AXIS_LABELS: Record<AxisWeightSpec['key'], string> = {
  finishing: 'Finishing',
  creation: 'Creation',
  dribbling: 'Dribbling',
  pace: 'Pace',
  tackling: 'Tackling',
  goalkeeping: 'Goalkeeping',
  aerial: 'Aerial',
  positioning: 'Discipline',
};

/**
 * RL Rank-Calibrated FIFA OVR curve: maps raw 8-axis role-weighted average (10..99)
 * onto realistic Bronze/Silver/Gold/Elite/Icon tiers (e.g. Diamond/Champ outfielders land ~72-83 Gold/Silver
 * instead of being penalized into Bronze for low off-role stats like Goalkeeping).
 */
function mapWeightedToOvr(w: number): number {
  const clampedW = Math.max(10, Math.min(99, w));
  let raw: number;
  if (clampedW <= 20) {
    raw = 35 + ((clampedW - 10) / 10) * 15;
  } else if (clampedW <= 40) {
    raw = 50 + ((clampedW - 20) / 20) * 19;
  } else if (clampedW <= 65) {
    raw = 69 + ((clampedW - 40) / 25) * 19;
  } else if (clampedW <= 85) {
    raw = 88 + ((clampedW - 65) / 20) * 8;
  } else {
    raw = 96 + ((clampedW - 85) / 14) * 3;
  }
  return Math.max(10, Math.min(99, Math.round(raw)));
}

function getTierMeta(ovr: number): { tier: OvrTier; accentColor: string } {
  if (ovr >= 90) return { tier: 'ICON', accentColor: '#c084fc' };
  if (ovr >= 83) return { tier: 'ELITE', accentColor: '#38bdf8' };
  if (ovr >= 75) return { tier: 'GOLD', accentColor: '#fbbf24' };
  if (ovr >= 62) return { tier: 'SILVER', accentColor: '#cbd5e1' };
  return { tier: 'BRONZE', accentColor: '#fb923c' };
}

/**
 * Computes both the role-weighted 0–99 Tactical OVR and raw /800 stat total from the unified 8-axis radar.
 */
export function calculateTacticalOvr(radar: RadarProfile): TacticalOvrResult {
  const weights = ARCHETYPE_WEIGHTS[radar.archetype] ?? ARCHETYPE_WEIGHTS['The All-Rounder'];

  const values: Record<AxisWeightSpec['key'], number> = {
    finishing: radar.finishing,
    creation: radar.creation,
    dribbling: radar.dribbling,
    pace: radar.pace,
    tackling: radar.tackling,
    goalkeeping: radar.goalkeeping,
    aerial: radar.aerial ?? Math.round((radar.finishing + radar.pace) / 2),
    positioning: radar.positioning ?? Math.round((radar.tackling + radar.goalkeeping) / 2),
  };

  const keys = Object.keys(values) as Array<AxisWeightSpec['key']>;
  const total800 = Math.round(keys.reduce((acc, k) => acc + values[k], 0));
  const weightedRaw = keys.reduce((acc, k) => acc + values[k] * weights[k], 0);
  const ovr = mapWeightedToOvr(weightedRaw);
  const { tier, accentColor } = getTierMeta(ovr);

  const topDrivers = keys
    .map(k => ({
      label: AXIS_LABELS[k],
      value: Math.round(values[k]),
      weightPct: Math.round(weights[k] * 100),
    }))
    .sort((a, b) => b.weightPct - a.weightPct || b.value - a.value)
    .slice(0, 3);

  return {
    ovr,
    total800,
    weightedRaw: Math.round(weightedRaw * 10) / 10,
    tier,
    accentColor,
    topDrivers,
  };
}

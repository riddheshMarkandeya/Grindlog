import type { RadarProfile, TacticalArchetype } from './types.ts';

export type OvrTier = 'ICON' | 'ELITE' | 'GOLD' | 'SILVER' | 'BRONZE';

export interface AxisWeightSpec {
  key: 'finishing' | 'creation' | 'defense' | 'motor' | 'physicality' | 'boost_iq' | 'aerial' | 'positioning';
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
    finishing: 0.24,
    aerial: 0.15,
    motor: 0.14,
    creation: 0.13,
    physicality: 0.10,
    boost_iq: 0.10,
    positioning: 0.08,
    defense: 0.06,
  },
  'The Air Marshal': {
    aerial: 0.24,
    finishing: 0.18,
    motor: 0.15,
    boost_iq: 0.12,
    creation: 0.10,
    defense: 0.08,
    physicality: 0.07,
    positioning: 0.06,
  },
  'The Playmaker': {
    creation: 0.25,
    positioning: 0.16,
    boost_iq: 0.14,
    defense: 0.12,
    motor: 0.12,
    finishing: 0.09,
    aerial: 0.06,
    physicality: 0.06,
  },
  'The Anchor': {
    defense: 0.25,
    positioning: 0.20,
    boost_iq: 0.14,
    creation: 0.12,
    motor: 0.11,
    aerial: 0.08,
    physicality: 0.06,
    finishing: 0.04,
  },
  'The Disruptor': {
    physicality: 0.24,
    motor: 0.18,
    finishing: 0.14,
    defense: 0.12,
    boost_iq: 0.10,
    creation: 0.08,
    positioning: 0.08,
    aerial: 0.06,
  },
  'The Speed Demon': {
    motor: 0.24,
    boost_iq: 0.16,
    finishing: 0.14,
    creation: 0.12,
    physicality: 0.12,
    defense: 0.08,
    aerial: 0.08,
    positioning: 0.06,
  },
  'The Boost Hawk': {
    boost_iq: 0.25,
    motor: 0.18,
    positioning: 0.14,
    defense: 0.12,
    creation: 0.11,
    finishing: 0.08,
    aerial: 0.06,
    physicality: 0.06,
  },
  'The All-Rounder': {
    finishing: 0.14,
    creation: 0.14,
    defense: 0.14,
    motor: 0.13,
    positioning: 0.13,
    boost_iq: 0.12,
    aerial: 0.10,
    physicality: 0.10,
  },
  'The Passenger': {
    finishing: 0.125,
    creation: 0.125,
    defense: 0.125,
    motor: 0.125,
    physicality: 0.125,
    boost_iq: 0.125,
    aerial: 0.125,
    positioning: 0.125,
  },
};

const AXIS_LABELS: Record<AxisWeightSpec['key'], string> = {
  finishing: 'Finishing',
  creation: 'Creation',
  defense: 'Defense',
  motor: 'Motor',
  physicality: 'Physicality',
  boost_iq: 'Boost IQ',
  aerial: 'Aerial',
  positioning: 'Discipline',
};

/**
 * Piecewise-linear FIFA/EA FC calibration curve mapping weighted role index (10..99)
 * onto an athletic 35..99 OVR band so role specialists score accurately against peers.
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
 * Computes both the role-weighted 0–99 Tactical OVR and raw /800 stat total from an 8-axis radar.
 */
export function calculateTacticalOvr(radar: RadarProfile): TacticalOvrResult {
  const weights = ARCHETYPE_WEIGHTS[radar.archetype] ?? ARCHETYPE_WEIGHTS['The All-Rounder'];

  const values: Record<AxisWeightSpec['key'], number> = {
    finishing: radar.finishing,
    creation: radar.creation,
    defense: radar.defense,
    motor: radar.motor,
    physicality: radar.physicality,
    boost_iq: radar.boost_iq,
    aerial: radar.aerial ?? Math.round((radar.finishing + radar.motor) / 2),
    positioning: radar.positioning ?? Math.round((radar.defense + radar.boost_iq) / 2),
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

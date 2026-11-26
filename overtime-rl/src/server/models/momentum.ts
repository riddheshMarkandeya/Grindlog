import type { MomentumPoint, MomentumEvent } from '../../shared/types.ts';

export interface HitRecord {
  ts: number;
  y: number;
  teamNum: number;
}

export function calculateMomentumWave(
  startTs: number,
  durationSeconds: number,
  hits: HitRecord[],
  events: MomentumEvent[]
): MomentumPoint[] {
  const totalSeconds = Math.max(60, durationSeconds);
  const bucketCount = Math.ceil(totalSeconds / 10);
  const buckets: MomentumPoint[] = [];

  let lastKnownY = 0;

  for (let i = 0; i < bucketCount; i++) {
    const bucketStartTs = startTs + i * 10_000;
    const bucketEndTs = bucketStartTs + 10_000;
    const timeSeconds = i * 10;

    // Filter hits within this 10-second slice
    const sliceHits = hits.filter(h => h.ts >= bucketStartTs && h.ts < bucketEndTs);

    let avgY = lastKnownY;
    let t0 = 0;
    let t1 = 0;

    if (sliceHits.length > 0) {
      const sumY = sliceHits.reduce((acc, h) => acc + h.y, 0);
      avgY = sumY / sliceHits.length;
      lastKnownY = avgY;

      t0 = sliceHits.filter(h => h.teamNum === 0).length;
      t1 = sliceHits.filter(h => h.teamNum === 1).length;
    }

    const touchTotal = t0 + t1;
    const touchRatio = touchTotal > 0 ? (t0 - t1) / touchTotal : 0;

    // Field tilt: +5120 = 100% Team 0 territory, -5120 = 100% Team 1 territory
    const territoryScore = Math.max(-100, Math.min(100, (avgY / 5120) * 100));
    const touchScore = touchRatio * 100;

    // Weighted unified momentum (-100 to +100)
    const rawMomentum = 0.60 * territoryScore + 0.40 * touchScore;
    const momentum = Math.round(Math.max(-100, Math.min(100, rawMomentum)) * 10) / 10;

    // Pinned events in this bucket
    const sliceEvents = events.filter(e => e.ts >= bucketStartTs && e.ts < bucketEndTs);

    buckets.push({
      interval_idx: i,
      time_seconds: timeSeconds,
      momentum,
      ball_y: Math.round(avgY),
      touch_ratio: Math.round(touchRatio * 100) / 100,
      events: sliceEvents,
    });
  }

  return buckets;
}

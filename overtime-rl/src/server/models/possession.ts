import type { DebouncedHit, PossessionState } from '../../shared/types.ts';

export interface RawBallHit {
  seq?: number;
  ts: number;
  player_name: string;
  team_num: number;
  pre_speed?: number;
  post_speed?: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Anti-exploit touch grouping: merges rapid micro-touches (< debounceMs apart)
 * by the same player into a single debounced touch sequence so pinches and
 * multi-frame contacts do not artificially inflate possession/hit stats.
 */
export function groupMicroTouches(hits: RawBallHit[], debounceMs: number = 350): DebouncedHit[] {
  if (!hits || hits.length === 0) return [];

  // Ensure hits are ordered chronologically
  const sorted = [...hits].sort((a, b) => a.ts - b.ts);
  const debounced: DebouncedHit[] = [];

  let current: DebouncedHit | null = null;

  for (const hit of sorted) {
    if (
      current &&
      current.player_name === hit.player_name &&
      hit.ts - current.end_ts < debounceMs
    ) {
      current.end_ts = hit.ts;
      current.touch_count += 1;
      current.post_speed = hit.post_speed ?? current.post_speed;
      current.x = hit.x;
      current.y = hit.y;
      current.z = hit.z;
    } else {
      if (current) {
        debounced.push(current);
      }
      current = {
        player_name: hit.player_name,
        team_num: hit.team_num,
        start_ts: hit.ts,
        end_ts: hit.ts,
        touch_count: 1,
        pre_speed: hit.pre_speed ?? 0,
        post_speed: hit.post_speed ?? 0,
        x: hit.x,
        y: hit.y,
        z: hit.z,
      };
    }
  }

  if (current) {
    debounced.push(current);
  }

  return debounced;
}

/**
 * Checks whether two debounced touches from opposing teams occurred in close temporal
 * proximity, representing a contested 50/50 duel.
 */
export function isSimultaneous50(
  hitA: DebouncedHit,
  hitB: DebouncedHit,
  thresholdMs: number = 400
): boolean {
  if (hitA.team_num === hitB.team_num) return false;
  const timeDiff = Math.abs(hitA.start_ts - hitB.start_ts);
  return timeDiff <= thresholdMs;
}

/**
 * 3-State Possession Classifier:
 * - 'contested': touches by opposing teams within 400ms.
 * - 'controlled': single player registering >= 2 touches or carrying for > 600ms.
 * - 'loose': free ball, single uncontested deflection, or expired window without possession.
 */
export function classifyPossessionState(
  recentHits: DebouncedHit[],
  windowMs: number = 1200,
  currentTs?: number
): PossessionState {
  if (!recentHits || recentHits.length === 0) return 'loose';

  const lastHit = recentHits[recentHits.length - 1];

  // If time elapsed since last contact exceeds windowMs, the ball is loose
  if (currentTs !== undefined && currentTs - lastHit.end_ts > windowMs) {
    return 'loose';
  }

  // Check for contested 50-50 duels within recent window
  const cutoffTs = (currentTs ?? lastHit.end_ts) - windowMs;
  const activeHits = recentHits.filter(h => h.end_ts >= cutoffTs);

  for (let i = activeHits.length - 1; i >= 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      if (isSimultaneous50(activeHits[i], activeHits[j], 400)) {
        return 'contested';
      }
    }
  }

  // Check for controlled possession by the latest active player
  if (lastHit.touch_count >= 2) {
    return 'controlled';
  }

  // Check if the same player had consecutive debounced hits within window
  let consecutiveHitsByPlayer = 0;
  let firstTouchTs = lastHit.start_ts;

  for (let i = activeHits.length - 1; i >= 0; i--) {
    if (activeHits[i].player_name === lastHit.player_name) {
      consecutiveHitsByPlayer++;
      firstTouchTs = activeHits[i].start_ts;
    } else {
      break;
    }
  }

  if (consecutiveHitsByPlayer >= 2 || lastHit.end_ts - firstTouchTs >= 600) {
    return 'controlled';
  }

  return 'loose';
}

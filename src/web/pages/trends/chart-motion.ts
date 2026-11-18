// The Trends charts' motion: each draws in once per page load, then moves between old and new
// values on later data changes.
import { type AnimationEvent, useEffect, useRef, useState } from "react";
import { tweenPoints } from "../../logic/trend-chart";

type Chart = "trend" | "winloss";
type Phase = "draw" | "tween";

// Per page load. Marked in an effect after the first mount, never during render, so StrictMode's
// double render can't see it already set and skip the draw.
const drawn = new Set<Chart>();

/**
 * "draw" on the chart's first mount this page load, "tween" after. The draw hands over to tween on
 * its own animationend (`onDrawEnd`, for the chart's svg), or at once if the data changes mid-draw:
 * the new data shows at once rather than a draw meeting a tween. `data` is the chart's input,
 * compared by identity. Key the plot on the phase, so the switch remounts it.
 */
export function useDrawOnce(chart: Chart, data: unknown, drawClass: string | undefined): { phase: Phase; onDrawEnd: (e: AnimationEvent) => void } {
  const [phase, setPhase] = useState<Phase>(() => (drawn.has(chart) ? "tween" : "draw"));
  const [first] = useState(data);
  useEffect(() => {
    drawn.add(chart);
  }, [chart]);
  if (phase === "draw" && data !== first) setPhase("tween");
  const onDrawEnd = (e: AnimationEvent) => {
    if (drawClass && e.target instanceof Element && e.target.classList.contains(drawClass)) setPhase("tween");
  };
  return { phase, onDrawEnd };
}

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;
// --dur-tween, shared with the W/L bars' d transition; 0 under reduced motion.
const tweenMs = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-tween")) || 0;

/**
 * The points as shown: when `data` changes (compared by identity), they move to the new `target`
 * over --dur-tween; a new target mid-move starts from where the points are. A new target for the
 * same data (a resize) shows at once, as does everything under reduced motion.
 */
export function useTweenedPoints<T extends { x: number; y: number }>(target: readonly T[], data: unknown): readonly T[] {
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  const lastData = useRef(data);
  useEffect(() => {
    const from = at.current;
    if (from === target) return;
    const ms = lastData.current === data ? 0 : tweenMs();
    lastData.current = data;
    if (ms === 0) {
      at.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const k = Math.min(1, (now - start) / ms);
      const points = k === 1 ? target : tweenPoints(from, target, easeOutCubic(k));
      at.current = points;
      setShown(points);
      if (k < 1) frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, data]);
  return shown;
}

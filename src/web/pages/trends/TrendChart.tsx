// The big chart of the selected metric, By date (a point per bucket) or By match (a rolling
// average whose window reaches back before the period). Passive: each column's value is its SVG
// title on hover, and the period's numbers are the tiles'.
import { type AnimationEvent, type ReactNode, useMemo, useRef } from "react";
import type { Season } from "../../../shared/periods";
import type { PeriodView } from "../../../shared/schemas/responses";
import { trendStats } from "../../../shared/trends";
import { cx } from "../../components/cx";
import { Section } from "../../components/Section";
import { useIndicator } from "../../components/useIndicator";
import { useWidth } from "../../components/useWidth";
import { autoNote, chartSummary, FEW, lineGeometry, linePoints, modeText, seasonMarks, type ChartMode, type LineGeometry, type LinePoint } from "../../logic/trend-chart";
import { formatMetric, isRate, METRICS, polyline, rawValue, type MetricId, type XMode } from "../../logic/trends";
import { useDrawOnce, useTweenedPoints } from "./chart-motion";
import styles from "./Trends.module.css";

const heightFor = (width: number) => (width < 560 ? 200 : 280);

interface PlotProps { g: LineGeometry; points: readonly LinePoint[]; width: number; height: number; label: string; marks: { x: number; name: string }[]; avgText: string | null }

/** The first draw: the line strokes in, then the dots fade in. */
function DrawPlot({ onDrawEnd, ...p }: PlotProps & { onDrawEnd: (e: AnimationEvent) => void }) {
  return (
    <Plot {...p} onAnimationEnd={onDrawEnd}>
      <path className={cx(styles.line, styles.drawLine)} pathLength={1} d={p.g.path} />
      {p.g.dots.map((d) => <circle key={`${String(d.x)},${String(d.y)}`} className={cx(d.hollow ? styles.hollow : styles.dot, styles.drawDot)} cx={d.x} cy={d.y} r={4} />)}
    </Plot>
  );
}

/** After the first draw: the line and its dots move from the old values to the new. */
function TweenPlot(p: PlotProps) {
  const line = useTweenedPoints(p.g.line, p.points);
  return (
    <Plot {...p}>
      <path className={styles.line} d={polyline(line)} />
      {p.g.dots.length > 0 && line.map((d, i) => <circle key={i} className={d.hollow ? styles.hollow : styles.dot} cx={d.x} cy={d.y} r={4} />)}
    </Plot>
  );
}

function Plot({ g, points, width, height, label, marks, avgText, children, onAnimationEnd }: PlotProps & { children: ReactNode; onAnimationEnd?: (e: AnimationEvent) => void }) {
  const { plot } = g;
  return (
    <svg className={styles.chart} width={width} height={height} role="img" aria-label={label} onAnimationEnd={onAnimationEnd}>
      {g.yTicks.map((t) => (
        <g key={t.y}>
          <line className={styles.grid} x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} />
          <text className={styles.axis} x={plot.left - 6} y={t.y + 4} textAnchor="end">{t.label}</text>
        </g>
      ))}
      {marks.map((m) => (
        <g key={m.name}>
          <line className={styles.mark} x1={m.x} x2={m.x} y1={plot.top} y2={plot.bottom} />
          <text className={styles.axis} x={m.x + 3} y={plot.top + 10}>{m.name}</text>
        </g>
      ))}
      {g.avgY !== null && avgText !== null && (
        <g>
          <line className={styles.avg} x1={plot.left} x2={plot.right} y1={g.avgY} y2={g.avgY} />
          <text className={styles.axis} x={plot.right} y={g.avgY - 4} textAnchor="end">avg {avgText}</text>
        </g>
      )}
      {children}
      {g.columns.map((c) => (
        <g key={c.x} className={styles.col}>
          <rect x={c.x} y={plot.top} width={c.w} height={plot.bottom - plot.top} />
          <line x1={g.xOf(c.i)} x2={g.xOf(c.i)} y1={plot.top} y2={plot.bottom} />
          <title>{points[c.i]?.title}</title>
        </g>
      ))}
      {g.xLabels.map((l) => <text key={l.x} className={styles.axis} x={l.x} y={height - 6} textAnchor={l.anchor}>{l.text}</text>)}
    </svg>
  );
}

/** `size`: the rolling window `view` was fetched with. */
export function TrendChart({ view, size, metric, chart, seasons, onX }: { view: PeriodView; size: number; metric: MetricId; chart: ChartMode; seasons: readonly Season[]; onX: (x: XMode) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const { mode } = chart;
  const label = METRICS.find((m) => m.id === metric)?.label ?? metric;
  const avg = useMemo(() => rawValue(metric, trendStats(view.aggregate)), [metric, view.aggregate]);
  const avgText = avg === null ? null : formatMetric(metric, avg);
  // Kept across resizes: only the geometry follows the width, and By match can hold thousands of points.
  const points = useMemo(() => linePoints(mode, metric, view, size), [mode, metric, view, size]);
  const height = heightFor(width);
  // Memoized, so the line's points keep their identity until something changes them: the tween
  // starts on a new array.
  const g = useMemo(() => (width > 0 ? lineGeometry(points, avg, { width, height }, { fmt: (v) => formatMetric(metric, v), rate: isRate(metric), centred: mode === "date" }) : null), [points, avg, width, height, metric, mode]);
  const { phase, onDrawEnd } = useDrawOnce("trend", points, styles.drawLine);
  const marks = g && mode === "date" ? seasonMarks(view.buckets, seasons).map((m) => ({ x: g.xOf(m.i), name: m.name })) : [];
  const plot = g && { g, points, width, height, label: chartSummary(label, mode, view.bucket, size, points.length, avgText), marks, avgText };

  return (
    <Section
      level={3} title={`${label} · ${modeText(mode, view.bucket, size)}`}
      aside={
        <XAxis mode={mode} onX={onX} />
      }
    >
      <div className="panel">
        {chart.auto && <p className={styles.note}>{autoNote(chart.withData, view.bucket, size)}</p>}
        <div ref={ref} className={styles.plotBox} style={{ minHeight: height }}>
          {mode === "match" && view.rolling.length === 0 ? (
            <p className={styles.note}>By match needs {size} matches with these filters.</p>
          ) : width > 0 && g === null ? (
            <p className={styles.note}>Nothing measured for {label} in this period.</p>
          ) : (
            plot && (phase === "draw" ? <DrawPlot key="draw" onDrawEnd={onDrawEnd} {...plot} /> : <TweenPlot key="tween" {...plot} />)
          )}
        </div>
        <div className={styles.key}>
          {avgText !== null && (
            <span>
              <svg width="18" height="8" aria-hidden="true"><line className={styles.avg} x1="0" x2="18" y1="4" y2="4" /></svg>
              period average
            </span>
          )}
          {mode === "match" ? (
            <span>each point = your last {size} matches</span>
          ) : (
            <span>
              <svg width="12" height="12" aria-hidden="true"><circle className={styles.hollow} cx="6" cy="6" r="4" /></svg>
              hollow dot = under {FEW} matches
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

function XAxis({ mode, onX }: { mode: XMode; onX: (x: XMode) => void }) {
  const group = useRef<HTMLDivElement>(null);
  useIndicator(group, '[aria-pressed="true"]', "x", mode);
  return (
    <div ref={group} className={cx(styles.xmode, "ind-x", "vt-keep")} role="group" aria-label="X axis">
      <button type="button" aria-pressed={mode === "date"} onClick={() => { onX("date"); }}>By date</button>
      <button type="button" aria-pressed={mode === "match"} onClick={() => { onX("match"); }}>By match</button>
    </div>
  );
}

// The match page's goal timeline: a row per player along the match clock, the running score above,
// goals, saves and assists as icons in your side's or the other side's colour, shots as dots.
// Passive: each mark's hover is its SVG title, and a visually hidden list reads the marks, overtime and any stop in order.
import { useId, useMemo } from "react";
import type { MatchDetail } from "../../shared/schemas/responses";
import { countNote, pack, readOut, scoreText, shortName, timelineFor, type Timeline, type TimelineMark, type TimelineRow } from "../logic/goal-timeline";
import type { IconKey } from "../logic/icons";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Section } from "./Section";
import { useWidth } from "./useWidth";
import styles from "./GoalTimeline.module.css";

/** Nothing when the match isn't drawn (see `timelineFor`): the section is left out, with no note. */
export function GoalTimeline({ detail, className }: { detail: MatchDetail; className?: string }) {
  const tl = useMemo(() => timelineFor(detail), [detail]);
  if (tl === null) return null;
  const note = countNote(detail);
  return (
    <Section title="How the match went" className={className}>
      <div className="panel">
        <TimelineChart tl={tl} />
        <ul className={styles.legend}>
          <li><Icon k="goal" className={cx(styles.legendIco, styles.us)} />Your team</li>
          <li><Icon k="goal" className={cx(styles.legendIco, styles.them)} />Opponents</li>
        </ul>
        {note !== null && <p className={styles.note}>{note}</p>}
      </div>
    </Section>
  );
}

const SCORE_ROW = 18;
/** A lane's height: an icon plus room between stacked marks. */
const STEP = 20;
const ICON = 16;
const SHOT_R = 3.5;
/** Between the track's left end and kickoff: half an icon and a little room. */
const PAD = ICON / 2 + 2;
/** Room for the last tick's label past the axis end. */
const RIGHT = 16;
/** Tick labels closer than this skip every other one (or more), so they don't run together at 320 px. */
const TICK_SPACE = 36;
const ICON_OF: Record<TimelineMark["kind"], IconKey> = { goal: "goal", save: "save", epic_save: "save", assist: "assist", shot: "shot" };

const markWidth = (m: TimelineMark) => (m.kind === "shot" ? 2 * SHOT_R + 2 : ICON + 2);

/**
 * Mounted only once a timeline exists, so the measured box is there on its first render; `useWidth`
 * measures once on mount and then follows resizes.
 */
function TimelineChart({ tl }: { tl: Timeline }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  // Not width's: a resize shouldn't rebuild it.
  const lines = useMemo(() => readOut(tl), [tl]);
  return (
    <div role="group" aria-label="Each player's goals, saves, assists and shots along the match clock">
      <div ref={ref}>{width > 0 && <Chart tl={tl} width={width} />}</div>
      <ol className="visually-hidden">
        {lines.map((text, i) => <li key={i}>{text}</li>)}
      </ol>
    </div>
  );
}

function Chart({ tl, width }: { tl: Timeline; width: number }) {
  const hatchId = `hatch-${useId().replace(/[^\w-]/g, "")}`;
  // The name gutter narrows on a phone, so the clock keeps most of the width.
  const left = Math.min(132, Math.max(72, Math.round(width * 0.28)));
  const nameChars = Math.floor((left - 16) / 7);
  const right = width - RIGHT;
  // The clock starts half an icon into the track, so a mark at kickoff doesn't cover the row's edge bar.
  const start = left + PAD;
  const x = (t: number) => start + (t / tl.end) * (right - start);

  const scoreItems = tl.scores.map((s) => ({ x: x(s.t), w: scoreText(s.us, s.them).length * 7.5 + 6 }));
  const scorePack = pack(scoreItems, 4);
  const top = scorePack.count * SCORE_ROW + 10;

  const { rows, bottom } = layRows(tl.rows, x, top);
  const height = bottom + 18;
  const every = Math.max(1, Math.ceil(TICK_SPACE / (x(60) - x(0))));
  const stop = tl.stop;
  const stopX = stop === null ? 0 : x(stop.t);
  // Near the right edge the label sits to the line's left.
  const stopLeft = stopX > (left + right) / 2;

  return (
    <svg width={width} height={height} className={styles.svg} aria-hidden="true">
      <defs>
        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className={styles.hatch} />
        </pattern>
      </defs>
      {tl.ticks.map((k) => <line key={k.t} x1={x(k.t)} x2={x(k.t)} y1={top} y2={bottom} className={styles.grid} />)}
      {tl.overtime && (
        <>
          <rect x={x(tl.regulation)} y={top} width={x(tl.end) - x(tl.regulation)} height={bottom - top} className={styles.otBand} />
          <text x={x(tl.regulation) + 4} y={top - 2} className={styles.otText}>OT</text>
        </>
      )}
      {tl.scores.map((s, i) => {
        const sx = scoreItems[i]?.x ?? 0;
        const sy = (scorePack.lanes[i] ?? 0) * SCORE_ROW;
        return (
          <g key={i}>
            <text x={sx} y={sy + 12} className={styles.score}>
              <tspan className={s.yours ? styles.scorer : undefined}>{s.us}</tspan>–<tspan className={s.yours ? undefined : styles.scorer}>{s.them}</tspan>
              <title>{s.title}</title>
            </text>
            <line x1={sx - 8} x2={sx + 8} y1={sy + 15} y2={sy + 15} className={s.yours ? styles.underUs : styles.underThem} />
          </g>
        );
      })}
      {rows.map(({ r, y: ry, h, lanes }) => (
        <Row key={r.playerKey} r={r} y={ry} h={h} lanes={lanes} left={left} right={right} x={x} nameChars={nameChars} />
      ))}
      {stop !== null && (
        <g>
          {stop.hatch && <rect x={stopX} y={top} width={x(tl.end) - stopX} height={bottom - top} fill={`url(#${hatchId})`} />}
          <line x1={stopX} x2={stopX} y1={top} y2={bottom} className={styles.stopLine} />
          <text x={stopLeft ? stopX - 6 : stopX + 6} y={top + 13} className={cx(styles.stopText, stopLeft && styles.endAnchor)}>{stop.label}</text>
        </g>
      )}
      {/* Counted from the end, so the end of regulation (or the last overtime minute) always has its label. */}
      {tl.ticks.map((k, i) => (tl.ticks.length - 1 - i) % every === 0 && <text key={k.t} x={x(k.t)} y={height - 4} className={styles.tick}>{k.label}</text>)}
    </svg>
  );
}

/** Each row's top, height and mark lanes, stacked from `top`; a row grows a lane per stacked mark. */
function layRows(rows: readonly TimelineRow[], x: (t: number) => number, top: number) {
  let y = top;
  const out: { r: TimelineRow; y: number; h: number; lanes: number[] }[] = [];
  for (const [i, r] of rows.entries()) {
    const prev = rows[i - 1];
    // A gap between the two teams.
    if (prev !== undefined && prev.yours !== r.yours) y += 8;
    const lanes = pack(r.marks.map((m) => ({ x: x(m.t), w: markWidth(m) })), 3);
    const h = Math.max(1, lanes.count) * STEP + 2;
    out.push({ r, y, h, lanes: lanes.lanes });
    y += h + 3;
  }
  return { rows: out, bottom: y };
}

function Row({ r, y, h, lanes, left, right, x, nameChars }: {
  r: TimelineRow; y: number; h: number; lanes: number[]; left: number; right: number; x: (t: number) => number; nameChars: number;
}) {
  return (
    <g>
      <rect x={left} y={y} width={right - left} height={h} className={styles.track} />
      <rect x={left - 4} y={y} width={3} height={h} className={r.yours ? styles.edgeUs : styles.edgeThem} />
      <text x={left - 10} y={y + h / 2 + 4} className={cx(styles.rowLabel, r.isMe && styles.rowMe)}>
        {shortName(r.name, nameChars)}<title>{r.name}</title>
      </text>
      {r.marks.map((m, i) => (
        <Mark key={i} m={m} x={x(m.t)} y={y + 1 + STEP / 2 + (lanes[i] ?? 0) * STEP} yours={r.yours} />
      ))}
    </g>
  );
}

function Mark({ m, x, y, yours }: { m: TimelineMark; x: number; y: number; yours: boolean }) {
  const side = yours ? styles.us : styles.them;
  const shot = m.kind === "shot";
  return (
    <g>
      {shot ? (
        <circle cx={x} cy={y} r={SHOT_R} className={cx(styles.dot, side)} />
      ) : (
        <foreignObject x={x - ICON / 2} y={y - ICON / 2} width={ICON} height={ICON} className={styles.fo}>
          <Icon k={ICON_OF[m.kind]} className={cx(styles.ico, side)} />
        </foreignObject>
      )}
      {/* A larger transparent circle carries the hover, so a small mark is easy to point at. */}
      <circle cx={x} cy={y} r={shot ? 6 : ICON / 2 + 2} className={styles.hit}><title>{m.title}</title></circle>
    </g>
  );
}

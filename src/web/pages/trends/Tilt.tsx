// The Trends "Tilt" section: a verdict, then win % by game in the session and by the run before a
// match, with the average, 95% range whiskers and match counts. It follows the period and both
// filters; the counts come with the period (shared/tilt.ts) and the text and marks from logic/tilt.ts.
import type { PeriodView } from "../../../shared/schemas/responses";
import { cx } from "../../components/cx";
import { Section } from "../../components/Section";
import { tiltDisplay, type LegendKey, type TiltColumn, type TiltDisplay } from "../../logic/tilt";
import styles from "./Tilt.module.css";

const INTRO = "Do you play worse the longer a session goes, or after a losing run? Each match is placed by when it came in the session and by the run of results just before it. Both count every match you played that session, even ones the filters hide (private and offline matches aside): your fifth game of the session is game 5 even when only ranked is shown. Only casual, ranked and tournament matches are shown.";

const pos = (x: number) => `${String(100 * x)}%`;

export function Tilt({ view }: { view: PeriodView }) {
  const t = view.tilt;
  return (
    <Section level={3} title="Tilt" intro={INTRO}>
      {t === null ? <p className="muted">No casual, ranked or tournament matches with a result here.</p> : <Chart d={tiltDisplay(t)} />}
    </Section>
  );
}

function Chart({ d }: { d: TiltDisplay }) {
  return (
    <div className="panel">
      <p className={cx(styles.verdict, styles[d.verdict.state])}>{d.verdict.text}</p>
      <div className={styles.charts}>
        <Columns title="By game in the session" cols={d.games} avg={d.avg} />
        <Columns title="After…" cols={d.streaks} avg={d.avg} />
      </div>
      <ul className={styles.legend}>
        {d.legend.map((r) => (
          <li key={r.key}>
            <Key k={r.key} />
            {r.text}
          </li>
        ))}
      </ul>
      <p className={styles.note}>{d.note}</p>
    </div>
  );
}

const SWATCH: Record<Exclude<LegendKey, "avg" | "range">, string> = {
  thin: cx(styles.neutral, styles.thin),
  below: cx(styles.below),
  above: cx(styles.above),
  neutral: cx(styles.neutral),
  focus: cx(styles.below, styles.focus),
};

function Key({ k }: { k: LegendKey }) {
  if (k === "avg") return <span className={styles.keyAvg} aria-hidden="true" />;
  if (k === "range") {
    return (
      <svg className={styles.keyWhisk} viewBox="0 0 10 16" aria-hidden="true">
        <path d="M1 1h8M5 1v14M1 15h8" />
      </svg>
    );
  }
  return <span className={cx(styles.keySwatch, SWATCH[k])} aria-hidden="true" />;
}

/** The marks are hidden from screen readers, which read one line per column instead. */
function Columns({ title, cols, avg }: { title: string; cols: TiltColumn[]; avg: number }) {
  return (
    <figure className={styles.fig}>
      <figcaption className={styles.title}>{title}</figcaption>
      <div aria-hidden="true">
        <div className={styles.cols}>
          <i className={styles.avg} style={{ bottom: pos(avg) }} />
          {cols.map((c) => (
            <div key={c.key} className={styles.colCell} title={c.srLabel}>
              <span className={cx(styles.col, styles[c.tone], c.thin && styles.thin, c.outlined && styles.focus)} style={{ height: pos(c.rate) }} />
              {c.n > 0 && <span className={styles.whisk} style={{ bottom: pos(c.lo), height: pos(c.hi - c.lo) }} />}
              <span className={cx("num", styles.colPct)} style={{ bottom: c.n ? `calc(${pos(c.hi)} + 4px)` : "4px" }}>{c.pct}</span>
            </div>
          ))}
        </div>
        <div className={styles.axis}>
          {cols.map((c) => (
            <span key={c.key} className={cx(c.named && styles.named)}>
              {c.label}
              <small className="muted">{c.count}</small>
            </span>
          ))}
        </div>
      </div>
      <ul className="visually-hidden">
        {cols.map((c) => <li key={c.key}>{c.srLabel}</li>)}
      </ul>
    </figure>
  );
}

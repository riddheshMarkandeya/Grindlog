// The grid stat card: an uppercase label (with an optional icon) over a big condensed value, then an
// optional comparison, a small sub line and a sparkline as children. With onClick it's a toggle
// button, as the Trends cards that pick the charted metric are. The caller writes each part's text;
// `vs` is a node so each page keeps its own direction words for screen readers.
import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./StatCard.module.css";

/** `stretch` widens a fixed set of cards to fill the row, instead of leaving the row's end empty. */
export function StatCards({ stretch = false, children }: { stretch?: boolean; children: ReactNode }) {
  return <ul className={cx(styles.cards, stretch && styles.stretch)}>{children}</ul>;
}

/** `vs=""` keeps an empty comparison line (a row of cards that sometimes has none); leave it out to drop the line. */
export function StatCard({ label, icon, value, unit, sub, vs, pressed, onClick, children }: {
  label: string; icon?: string | null; value: string; unit?: string | null; sub?: string | null; vs?: ReactNode;
  pressed?: boolean; onClick?: () => void; children?: ReactNode;
}) {
  const body = (
    <>
      <span className={styles.label}>{icon && <img className={styles.ico} src={icon} alt="" />}{label}</span>
      <b className="num display">{value}{unit && <small>{unit}</small>}</b>
      {vs !== undefined && vs !== null && <span className={styles.vs}>{vs}</span>}
      {sub && <span className={cx(styles.sub, "num")}>{sub}</span>}
      {children}
    </>
  );
  return (
    <li className={styles.item}>
      {onClick ? <button type="button" className={styles.card} aria-pressed={pressed} onClick={onClick}>{body}</button> : <div className={styles.card}>{body}</div>}
    </li>
  );
}

// A share bar segment's "%" label. The segment is a CSS size container, so the label shows only
// where it fits at the bar's current width: a narrow segment drops its "You " prefix, a narrower one
// the whole label. A fixed percent cut-off can't do that: the same share is roomy on a wide screen
// and clipped at 320px.
import styles from "./Bars.module.css";

export function BarPct({ p, you = false }: { p: number; you?: boolean }) {
  if (p <= 0) return null;
  return <span className={styles.pct}>{you && <span className={styles.you}>You </span>}{String(p)}%</span>;
}

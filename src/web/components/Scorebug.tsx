// The recap's scorebug: two skewed sides (green underline left, red right), each a big condensed
// number and its label, around an accent middle. The recap shows wins and losses; the Friends page
// shows the records with and against a friend.
import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Scorebug.module.css";

interface Side { label: string; value: string }

export function Scorebug({ label, left, right, mid, records = false }: { label: string; left: Side; right: Side; mid: ReactNode; records?: boolean }) {
  return (
    <div className={cx(styles.bug, records && styles.records)} role="img" aria-label={label}>
      <div className={styles.side}><span>{left.label}</span><b className="num display">{left.value}</b></div>
      <div className={styles.mid}>{mid}</div>
      <div className={cx(styles.side, styles.right)}><b className="num display">{right.value}</b><span>{right.label}</span></div>
    </div>
  );
}

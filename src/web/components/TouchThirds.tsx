// "Where the touches were": one stacked defence/midfield/attack bar per line (recap: you, friends, the
// rest of your team, the opponents; match page: each player), each third from that side's own goal.
// The legend's squares split each third's shade diagonally, your side's against the other's.
import type { ReactNode } from "react";
import { touchesOf } from "../../shared/lobby";
import { pctText } from "../logic/format";
import { thirdPcts, thirdTitle, ZONES, type ThirdRow, type Tone } from "../logic/thirds";
import { BarPct } from "./BarPct";
import styles from "./Bars.module.css";
import { cx } from "./cx";

const SHADE: Record<Tone, [string | undefined, string | undefined, string | undefined]> = {
  blue: [styles.blue1, styles.blue2, styles.blue3],
  orange: [styles.orange1, styles.orange2, styles.orange3],
  neutral: [styles.neutral1, styles.neutral2, styles.neutral3],
};
const DIAGONAL = [styles.z1, styles.z2, styles.z3];

/** `counts`: each row's touches at its end; `children`: the note under the bars. */
export function TouchThirds({ rows, counts = false, children }: { rows: readonly ThirdRow[]; counts?: boolean; children: ReactNode }) {
  // With no side known, the bars are neutral, so the legend is too.
  const neutral = rows.every((r) => r.tone === "neutral");
  return (
    <>
      <ul className={styles.legend} aria-label="Bar colours">
        {ZONES.map((z, i) => <li key={z}><i className={cx(styles.key, neutral ? SHADE.neutral[i] : DIAGONAL[i])} />{z}</li>)}
      </ul>
      <div className={cx(styles.grid, counts && styles.counts)}>
        {rows.map((r) => <Row key={r.key} row={r} counts={counts} />)}
      </div>
      <p className={styles.note}>{children}</p>
    </>
  );
}

function Row({ row, counts }: { row: ThirdRow; counts: boolean }) {
  const name = row.isMe ? "You" : row.name;
  const total = touchesOf(row.thirds);
  const pcts = thirdPcts(row.thirds);
  const head = <span className={styles.who} title={name}>{name}</span>;
  const tail = counts && <span className={cx(styles.count, "num")}>{total}</span>;
  if (pcts === null) return <>{head}<span className="muted">no touches</span>{tail}</>;
  const spoken = ZONES.map((z, i) => `${z.toLowerCase()} ${pctText(pcts[i] ?? 0)}`).join(", ");
  return (
    <>
      {head}
      <div className={styles.bar} role="img" aria-label={`${name}: ${spoken}${counts ? `, ${String(total)} touches` : ""}`}>
        <div className={styles.split}>
          {([0, 1, 2] as const).map((i) => (
            <span key={i} className={SHADE[row.tone][i]} style={{ width: `${String(pcts[i])}%` }} title={thirdTitle(name, i, row.thirds[i], pcts[i])}>
              <BarPct p={pcts[i]} />
            </span>
          ))}
        </div>
      </div>
      {tail}
    </>
  );
}

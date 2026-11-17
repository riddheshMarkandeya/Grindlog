// Wins against losses as one thin bar (Friends' playlists and cards, the Recap's By playlist).
import { cx } from "./cx";
import styles from "./WlBar.module.css";

/** Wins against losses; an empty bar with no decided match. Hidden from screen readers: the record beside it says it. */
export function WlBar({ w, l, className }: { w: number; l: number; className?: string }) {
  const decided = w + l;
  return (
    <span className={cx(styles.wlbar, decided === 0 && styles.none, className)} aria-hidden="true">
      {decided > 0 && <i style={{ width: `${String((100 * w) / decided)}%` }} />}
    </span>
  );
}

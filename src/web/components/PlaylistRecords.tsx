// By playlist as rows of name, record, a win/loss bar and win % (Friends' zones, the Recap). The bar
// takes its own line when narrow; the record is read as "N won, M lost", the bar hidden from readers.
import { recordLabel, recordText } from "../logic/friends";
import { cx } from "./cx";
import styles from "./PlaylistRecords.module.css";
import { WlBar } from "./WlBar";

/** `record`: null when the playlist has no result to count (shown as "–"); `pct` is the win % text. */
export interface PlaylistRecord { key: string; name: string; record: { w: number; l: number } | null; pct: string }

export function PlaylistRecords({ rows }: { rows: readonly PlaylistRecord[] }) {
  return (
    <ul className={cx("panel", styles.list)}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className={styles.trunc} title={r.name}>{r.name}</span>
          <span className={cx(styles.r, "num")}>
            {r.record === null ? "–" : <><span aria-hidden="true">{recordText(r.record)}</span><span className="visually-hidden">{recordLabel(r.record)}</span></>}
          </span>
          <WlBar w={r.record?.w ?? 0} l={r.record?.l ?? 0} className={styles.wl} />
          <span className={cx(styles.r, "muted", "num")}>{r.pct}</span>
        </li>
      ))}
    </ul>
  );
}

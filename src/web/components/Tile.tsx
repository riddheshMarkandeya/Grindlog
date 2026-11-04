// The big condensed stat tile: a value, an optional icon and an optional ▲/▼ against something,
// over an uppercase label, with an optional small note under it (one line, or two for a long one);
// the caller writes the comparison's and the note's text. The recap's headline tiles and the Friends page's.
import type { ReactNode } from "react";
import { cx } from "./cx";
import { DirArrow } from "./DirArrow";
import styles from "./Tile.module.css";

export interface TileVs { dir: "up" | "down" | "same"; text: string }

export function Tiles({ children }: { children: ReactNode }) {
  return <ul className={styles.tiles}>{children}</ul>;
}

export function Tile({ label, value, icon, vs, note, noteLines = 1 }: { label: string; value: string; icon?: string; vs?: TileVs; note?: string; noteLines?: 1 | 2 }) {
  return (
    <li>
      <b className="num display">
        {icon && <img className={styles.ico} src={icon} alt="" />}
        {value}
        {vs && (
          <small className={vs.dir === "up" ? styles.up : vs.dir === "down" ? styles.down : styles.muted}>
            {vs.dir === "same" ? <><span aria-hidden="true">=</span><span className="visually-hidden">same</span></> : <DirArrow dir={vs.dir} />} {vs.text}
          </small>
        )}
      </b>
      <span className={styles.label}>{label}</span>
      {note && <small className={cx(styles.note, noteLines === 2 && styles.two)} title={note}>{note}</small>}
    </li>
  );
}

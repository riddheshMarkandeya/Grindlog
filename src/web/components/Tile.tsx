// The big condensed stat tile: a value and an optional icon over an uppercase label, then an optional
// ▲/▼ line against something and an optional small note (one line, or two for a long one), all
// centred; the caller writes the comparison's and the note's text. The recap's headline tiles and
// the Friends page's.
import type { ReactNode } from "react";
import { cx } from "./cx";
import { DirArrow } from "./DirArrow";
import styles from "./Tile.module.css";

/** "▲ 5 pts" in the direction's colour, then `rest` muted; "same" draws "≈" (read as "about the same as") before `rest`. */
export interface TileVs { dir: "up" | "down" | "same"; amount: string | null; rest: string }

/** A TileVs as text, for a tile or anywhere else that compares the same way. */
export function VsText({ vs }: { vs: TileVs }) {
  return (
    <>
      {vs.dir === "same"
        ? <><span className="muted" aria-hidden="true">≈</span><span className="visually-hidden">about the same as</span></>
        : vs.amount !== null && <span className={vs.dir}><DirArrow dir={vs.dir} /> {vs.amount}</span>}
      {" "}<span className="muted">{vs.rest}</span>
    </>
  );
}

/** `className` is a page's variant of the row (the Friends zones drop its top margin). */
export function Tiles({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cx(styles.tiles, className)}>{children}</ul>;
}

export function Tile({ label, value, icon, vs, note, noteLines = 1 }: { label: string; value: string; icon?: string; vs?: TileVs; note?: string; noteLines?: 1 | 2 }) {
  return (
    <li>
      <b className="num display">
        {icon && <img className={styles.ico} src={icon} alt="" />}
        {value}
      </b>
      <span className={styles.label}>{label}</span>
      {vs && <small className={styles.vs}><VsText vs={vs} /></small>}
      {note && <small className={cx(styles.note, noteLines === 2 && styles.two)} title={note}>{note}</small>}
    </li>
  );
}

// The big condensed stat tile: a value, an optional icon and an optional ▲/▼ against something,
// over an uppercase label, with an optional small note under it; the caller writes the comparison's
// and the note's text. The recap's headline tiles and the Friends page's.
import type { ReactNode } from "react";
import styles from "./Tile.module.css";

export interface TileVs { dir: "up" | "down" | "same"; text: string }

export function Tiles({ children }: { children: ReactNode }) {
  return <ul className={styles.tiles}>{children}</ul>;
}

export function Tile({ label, value, icon, vs, note }: { label: string; value: string; icon?: string; vs?: TileVs; note?: string }) {
  return (
    <li>
      <b className="num">
        {icon && <img className={styles.ico} src={icon} alt="" />}
        {value}
        {vs && (
          <small className={vs.dir === "up" ? styles.up : vs.dir === "down" ? styles.down : styles.muted}>
            {vs.dir === "up" ? "▲" : vs.dir === "down" ? "▼" : "="} {vs.text}
          </small>
        )}
      </b>
      <span>{label}</span>
      {note && <small className={styles.note} title={note}>{note}</small>}
    </li>
  );
}

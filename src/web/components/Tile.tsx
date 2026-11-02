// The big condensed stat tile: a value, an optional icon and an optional ▲/▼ against something,
// over an uppercase label; the caller writes the comparison's text. The recap's headline tiles.
import type { ReactNode } from "react";
import styles from "./Tile.module.css";

export interface TileVs { dir: "up" | "down" | "same"; text: string }

export function Tiles({ children }: { children: ReactNode }) {
  return <ul className={styles.tiles}>{children}</ul>;
}

export function Tile({ label, value, icon, vs }: { label: string; value: string; icon?: string; vs?: TileVs }) {
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
    </li>
  );
}

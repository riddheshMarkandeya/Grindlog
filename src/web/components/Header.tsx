import { NavLink } from "react-router";
import { CHANNEL } from "../../shared/channel";
import icon from "../assets/icon-small.svg";
import { cx } from "./cx";
import styles from "./Header.module.css";
import { QuitButton, StartSessionButton } from "./HeaderActions";
import { SessionChip } from "./SessionChip";
import { StatusBadge } from "./StatusBadge";

const tab = ({ isActive }: { isActive: boolean }) => cx(styles.tab, isActive && styles.active);
const settings = ({ isActive }: { isActive: boolean }) => cx(styles.hbtn, isActive && styles.current);

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <span className={styles.brand}>
          <img src={icon} alt="" />Grindlog
          {/* The developer's own install, which runs beside a friend's build on the same PC. */}
          {CHANNEL === "dev" && <span className={styles.channel}>Dev</span>}
        </span>
        <nav className={styles.topnav} aria-label="Pages">
          <NavLink to="/recap" className={tab}>Recap</NavLink>
          <NavLink to="/trends" className={tab}>Trends</NavLink>
          <NavLink to="/friends" className={tab}>Friends</NavLink>
        </nav>
        <div className={styles.right}>
          <StatusBadge />
          <SessionChip />
          <StartSessionButton />
          <NavLink to="/settings" className={settings}>Settings</NavLink>
          <QuitButton />
        </div>
      </div>
    </header>
  );
}

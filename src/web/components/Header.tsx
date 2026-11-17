import { NavLink } from "react-router";
import { CHANNEL } from "../../shared/channel";
// The build picks the file by channel: teal on dev builds.
import icon from "@channel/logo.svg";
import { cx } from "./cx";
import styles from "./Header.module.css";
import { IconLabel } from "./Icon";
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
          <NavLink to="/recap" className={tab}><IconLabel k="recap">Recap</IconLabel></NavLink>
          <NavLink to="/trends" className={tab}><IconLabel k="trends">Trends</IconLabel></NavLink>
          <NavLink to="/friends" className={tab}><IconLabel k="friends">Friends</IconLabel></NavLink>
        </nav>
        <div className={styles.right}>
          <StatusBadge />
          <SessionChip />
          <StartSessionButton />
          <NavLink to="/settings" className={settings}><IconLabel k="settings">Settings</IconLabel></NavLink>
          <QuitButton />
        </div>
      </div>
    </header>
  );
}

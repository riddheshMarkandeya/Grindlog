// The dashboard's icons: Lucide, Phosphor's soccer ball for goals (Lucide has none), and two drawn here.
import { SoccerBallIcon } from "@phosphor-icons/react/dist/csr/SoccerBall";
import {
  ArrowLeft, Battery, BatteryMedium, Bomb, CirclePlus, Clock, Copy, Crosshair, Crown, Download, Flag, Flame, Gamepad2,
  Gauge, Handshake, Hash, LayoutGrid, List, Percent, Power, Settings, Share2, Shield, Target, Timer, TrendingDown,
  TrendingUp, Users, Wind, Zap, AlarmClock, Undo2, Scale, CircleArrowUp, CircleArrowDown,
} from "lucide-react";
import { createElement, type ComponentType, type ReactNode } from "react";
import type { IconKey } from "../logic/icons";
import { cx } from "./cx";
import styles from "./Icon.module.css";

interface SvgProps { className?: string | undefined; role?: string | undefined; "aria-label"?: string | undefined; "aria-hidden"?: boolean | undefined }
type IconComponent = ComponentType<SvgProps>;

// Lucide's 24 grid and 2px round stroke, so these sit with the library icons.
const drawn = (name: string, d: ReactNode): IconComponent => {
  const C = (p: SvgProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>{d}</svg>
  );
  C.displayName = name;
  return C;
};
// The ball under the bar, with impact marks.
const Crossbar = drawn("Crossbar", <><path d="M4 21V6h16v15" /><circle cx="12" cy="9.5" r="2.5" /><path d="M12 1.8v1.7M8.6 2.6l.9 1.4M15.4 2.6l-.9 1.4" /></>);
// A ball in the air over the ground line, with its path.
const Aerial = drawn("Aerial", <><path d="M3 20h18" /><circle cx="16" cy="7.5" r="3" /><path d="M5 20c1-5 3.5-9 7.5-11" strokeDasharray="2 3" /></>);

const ICONS: Record<IconKey, IconComponent> = {
  recap: Gamepad2, trends: TrendingUp, friends: Users, settings: Settings, quit: Power, newSession: CirclePlus,
  share: Share2, copy: Copy, download: Download, back: ArrowLeft, flag: Flag, overview: LayoutGrid, matches: List,
  score: Hash, goal: SoccerBallIcon, assist: Handshake, save: Shield, shot: Target, demo: Bomb, mvp: Crown,
  winRate: Percent, shooting: Crosshair, streak: Flame, time: Clock, overtime: Timer, hardest: Gauge, fastest: Zap,
  crossbar: Crossbar, boost: BatteryMedium, supersonic: Wind, empty: Battery, aerial: Aerial,
  trendUp: TrendingUp, trendDown: TrendingDown,
  // Clutch-only: a close game, going 1–0 up or down, a late winner, a goal given straight back.
  oneGoal: Scale, scoredFirst: CircleArrowUp, concededFirst: CircleArrowDown, lateWinner: AlarmClock, concededBack: Undo2,
};

/** One icon, sized by the caller's class. Decorative unless `label` is given. */
export function Icon({ k, className, label }: { k: IconKey; className?: string | undefined; label?: string | undefined }) {
  // createElement: the component comes from a static map, not made in render.
  return createElement(ICONS[k], {
    className: cx(styles.svg, className),
    role: label ? "img" : undefined,
    "aria-label": label,
    "aria-hidden": label ? undefined : true,
  });
}

/** An icon before its text; the text stays the accessible name. */
export function IconLabel({ k, children }: { k: IconKey; children: ReactNode }) {
  return <span className={styles.lbl}><Icon k={k} className={styles.lblIco} />{children}</span>;
}

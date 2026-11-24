// The Trends Clutch section's text: tile values and notes, ladder rung labels, and the best comeback
// and worst collapse links. The numbers come from the server (shared/clutch.ts).
import { LADDER_TOP, SWING_MIN_GOALS, type WL } from "../../shared/clutch";
import type { PlaylistFilter } from "../../shared/playlist-filter";
import type { ClutchView } from "../../shared/schemas/responses";
import type { TeammateFilter } from "../../shared/teammate-filter";
import { whole } from "./format";
import { decided, recordText, winPctText } from "./friends";
import type { IconKey } from "./icons";
import { recapPath } from "./recap";

export interface ClutchTile {
  label: string;
  icon: IconKey;
  value: string;
  note: string | undefined;
}

const EMPTY = "–";
const none = (r: WL) => decided(r) === 0;
export const swingText = `${String(SWING_MIN_GOALS)}+`;

/** The tile row; a stat with no match behind it shows – and no note. */
export function clutchTiles(c: ClutchView): ClutchTile[] {
  const record = (label: string, icon: IconKey, r: WL, note: string) => ({ label, icon, value: none(r) ? EMPTY : recordText(r), note: none(r) ? undefined : note });
  const share = (label: string, icon: IconKey, r: WL, note: string) => ({ label, icon, value: winPctText(r), note: none(r) ? undefined : note });
  const swing = (label: string, icon: IconKey, s: { n: number; of: number }, note: string) => ({ label, icon, value: s.of === 0 ? EMPTY : whole(s.n), note: s.of === 0 ? undefined : note });
  return [
    record("1-goal games", "score", c.oneGoal, `${winPctText(c.oneGoal)} won · ${recordText(c.oneGoalNoOt)} without OT`),
    record("Overtime", "overtime", c.overtime, `${winPctText(c.overtime)} won`),
    share("Scored first", "goal", c.scoredFirst, `won ${recordText(c.scoredFirst)} when you opened the scoring`),
    share("Conceded first", "save", c.concededFirst, `won ${recordText(c.concededFirst)} when they opened it`),
    swing("Comebacks", "trendUp", c.comebacks, `won ${whole(c.comebacks.n)} of ${whole(c.comebacks.of)} after going ${swingText} down`),
    swing("Blown leads", "trendDown", c.blownLeads, `lost ${whole(c.blownLeads.n)} of ${whole(c.blownLeads.of)} after going ${swingText} up`),
    record("Forfeits", "flag", c.forfeits, "matches a side quit early"),
  ];
}

export type LadderSide = "down" | "up";

/** "1 down", "2 down", "3+ down" (or up) for rungs 0–2. */
export const rungLabel = (side: LadderSide, i: number): string => `${String(i + 1)}${i === LADDER_TOP - 1 ? "+" : ""} ${side}`;

/**
 * The best comeback (down side) or worst collapse (up side) as a link under its rung: the 3+ rung,
 * or the 2 rung when the biggest swing was 2. Null with no swing, or with no session to open it in,
 * since a null key opens the latest recap instead.
 */
export function swingLink(c: ClutchView, side: LadderSide, filter: PlaylistFilter, teammate: TeammateFilter): { rung: number; text: string; path: string } | null {
  const ref = side === "down" ? c.best : c.worst;
  if (!ref?.sessionKey) return null;
  return {
    rung: ref.by >= LADDER_TOP ? LADDER_TOP - 1 : 1,
    text: side === "down" ? `Best: won ${ref.score} from ${ref.at}` : `Worst: lost ${ref.score} after leading ${ref.at}`,
    path: recapPath(ref.sessionKey, filter, { match: ref.guid }, teammate),
  };
}

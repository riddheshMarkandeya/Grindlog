// "Where the touches were": counted touches split into defence, midfield and attack thirds, each
// measured from that player's own goal. Rows on the recap (you, friends, the rest of your team, the
// opponents) and on a match page (one per player), shaded blue for your team and orange for theirs
// (neutral when you were on neither).
import { touchesOf, type Thirds } from "../../shared/lobby";
import type { MatchDetail } from "../../shared/schemas/responses";
import { pctText, plural, wholeShares } from "./format";
import { scoreboardTeams } from "./recap";

// Playlists on another pitch (Hoops, Dropshot, Dropshot Rumble, Knockout), where thirds cut at the
// soccar field's lines mean nothing. A private match can be on any; it can't be told, so it counts.
const OTHER_PITCH = new Set([17, 23, 27, 29, 37, 54, 70]);
export const standardPitch = (playlistId: number | null): boolean => playlistId === null || !OTHER_PITCH.has(playlistId);

export const ZONES = ["Defence", "Midfield", "Attack"] as const;
/** Your side, the other side, or neither: with no team of yours the game's teams get no side colour. */
export type Tone = "blue" | "orange" | "neutral";
export interface ThirdRow { key: string; name: string; tone: Tone; thirds: Thirds; isMe: boolean }

/** No touches in any third: a slot the data doesn't fill. */
export const NO_THIRDS: Thirds = [0, 0, 0];

/** Each third as a whole percent of the row's touches, adding up to 100 so the bar fills; null with no touch. */
export function thirdPcts(t: Thirds): Thirds | null {
  // Three counts in, three percents out; non-null since the total isn't zero.
  return touchesOf(t) === 0 ? null : (wholeShares(t) as Thirds);
}

/** A segment's hover: "You · Defence · 12 touches · 40%". */
export const thirdTitle = (name: string, zone: 0 | 1 | 2, n: number, p: number): string => `${name} · ${ZONES[zone]} · ${plural(n, "touch", "touches")} · ${pctText(p)}`;

/**
 * A match page's rows: your team first with you on top (else the game's blue team first, uncoloured), each team
 * by score as on the scoreboard; players with no team left out. Null until every player is recomputed.
 */
export function matchThirdRows(players: readonly MatchDetail["players"][number][]): ThirdRow[] | null {
  if (!players.length || players.some((p) => p.thirds === null)) return null;
  const me = players.find((p) => p.isMe);
  return scoreboardTeams(players, me?.teamNum ?? null).flatMap((team): ThirdRow[] => {
    if (team.side === "unknown") return [];
    const tone: Tone = team.side === "yours" ? "blue" : team.side === "opponents" ? "orange" : "neutral";
    const ps = [...team.players].sort((a, b) => Number(b.isMe) - Number(a.isMe));
    // Every player's thirds are set by the check above; the fallback only satisfies the type.
    return ps.map((p) => ({ key: p.playerKey, name: p.name, tone, thirds: p.thirds ?? NO_THIRDS, isMe: p.isMe }));
  });
}

/**
 * The recap's rows from a mode's thirds, [you, ...each friend, the rest of your team, the opponents]:
 * the rest under `rest` (Contribution's grey-end label), left out when that's null.
 */
export function sessionThirdRows(thirds: readonly Thirds[], friends: readonly string[], rest: string | null): ThirdRow[] {
  const at = (i: number): Thirds => thirds[i] ?? NO_THIRDS;
  const n = friends.length;
  const rows: ThirdRow[] = [
    { key: "you", name: "You", tone: "blue", thirds: at(0), isMe: true },
    ...friends.map((name, i): ThirdRow => ({ key: `friend-${String(i)}`, name, tone: "blue", thirds: at(i + 1), isMe: false })),
  ];
  if (rest !== null) rows.push({ key: "rest", name: rest, tone: "blue", thirds: at(n + 1), isMe: false });
  rows.push({ key: "opponents", name: "Opponents", tone: "orange", thirds: at(n + 2), isMe: false });
  return rows;
}

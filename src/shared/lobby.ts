// One row per match you played, as read for the Friends pages and the Recap's Contribution: your
// line, your final team's totals, and the listed friends by side. Also the "mode" a match reads in,
// so like meets like: standard soccar at a team size, or an even private 2v2/3v3. The base both
// friend-stats and contribution build on.
import { playlistInfo } from "./playlists";
import type { Result } from "./result";

/** Counted touches by third from the player's own goal: defence, midfield, attack. */
export type Thirds = [number, number, number];

const addThirds = (a: Thirds, b: Thirds): Thirds => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sumThirds = (ts: readonly Thirds[]): Thirds => ts.reduce(addThirds, [0, 0, 0]);
export const touchesOf = (t: Thirds) => t[0] + t[1] + t[2];

/** A scoreboard line. */
export interface Line {
  playerKey: string;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  /** Null until the match is recomputed with the touch_thirds rule. */
  thirds: Thirds | null;
}

/** The scoreboard numbers of a line. */
export type Stats = Pick<Line, "score" | "goals" | "assists" | "saves" | "shots">;

/** A listed friend in a match: "with" = on your team at any point, "against" = only ever on the other. */
export interface LobbyFriend extends Line {
  id: string;
  side: "with" | "against";
  /** Seen on both teams. */
  switched: boolean;
}

export interface LobbyMatch {
  guid: string;
  startedAt: number;
  endedAt: number;
  playlistId: number | null;
  overtime: boolean;
  result: Result | null;
  /** Your team's goals minus theirs; null without a final score. */
  goalDiff: number | null;
  /** Players per final team, bots included. */
  sizes: { mine: number; other: number };
  me: Line;
  /** Your final team's sums. */
  myTeamTotals: Stats;
  /**
   * Your final team's and the other team's thirds summed. Null until every player row of the match
   * has its thirds, and then every line's `thirds` is set too.
   */
  touches: { team: Thirds; opponents: Thirds } | null;
  mvpKey: string | null;
  /** Whether the MVP was on your final team; null with no MVP. */
  mvpOnMyTeam: boolean | null;
  youSwitched: boolean;
  friends: LobbyFriend[];
}

export const MODE_ORDER = ["2", "3", "4", "p2", "p3"] as const;
export type Mode = (typeof MODE_ORDER)[number];
/** Standard soccar with a teammate, by playlist id: Doubles, Standard, Casual Quads, and ranked. */
const ONLINE_SIZE: Readonly<Record<number, Mode>> = { 2: "2", 3: "3", 4: "4", 11: "2", 12: "3", 13: "3" };

export const isPrivate = (m: Pick<LobbyMatch, "playlistId">) => playlistInfo(m.playlistId).group === "private";

export function modeOf(m: Pick<LobbyMatch, "playlistId" | "sizes">): Mode | null {
  if (isPrivate(m)) {
    const { mine, other } = m.sizes;
    return mine === other && (mine === 2 || mine === 3) ? (`p${String(mine)}` as Mode) : null;
  }
  return m.playlistId === null ? null : (ONLINE_SIZE[m.playlistId] ?? null);
}

/** Each friend's row in the match, in `ids` order, when every one of them was on `side`. */
export function rowsOn(m: LobbyMatch, ids: readonly string[], side: LobbyFriend["side"]): LobbyFriend[] | null {
  const fs = ids.map((id) => m.friends.find((f) => f.id === id));
  return fs.every((f): f is LobbyFriend => f?.side === side) ? fs : null;
}

/** 0 when you were MVP, i + 1 when friend i was, else null. */
export function mvpIndex(m: LobbyMatch, fs: readonly LobbyFriend[]): number | null {
  if (m.mvpKey === null) return null;
  if (m.mvpKey === m.me.playerKey) return 0;
  const i = fs.findIndex((f) => f.playerKey === m.mvpKey);
  return i < 0 ? null : i + 1;
}

/** How many of `keys` are each person's index, over `n` people. */
export function tally(n: number, keys: readonly (number | null)[]): number[] {
  const counts = new Array<number>(n).fill(0);
  for (const k of keys) if (k !== null) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}

/** A match with the listed friends' rows in it, in the listed order. */
export interface Together {
  m: LobbyMatch;
  fs: LobbyFriend[];
}

/** Final-team totals don't fit a match where you or any listed friend changed team. */
export const steadyOnly = (xs: readonly Together[]): Together[] => xs.filter((x) => !x.m.youSwitched && !x.fs.some((f) => f.switched));

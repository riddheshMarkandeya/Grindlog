// A friend's page, worked out from every match you played (one row each, with the friend's row if
// they were in it). Records, tiles and playlist rows count every match but offline play. The
// with/without comparison reads one "mode" at a time so like meets like: standard soccar at a team
// size, or an even private 2v2/3v3. Extras and LTMs score differently, so they have no mode.
import { maxOrNull, streaks, sum } from "./aggregate";
import { playlistInfo } from "./playlists";
import type { Result } from "./result";

/** A scoreboard line. */
export interface Line {
  playerKey: string;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
}

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
  myTeamTotals: { score: number; goals: number };
  mvpKey: string | null;
  /** Whether the MVP was on your final team; null with no MVP. */
  mvpOnMyTeam: boolean | null;
  youSwitched: boolean;
  friends: LobbyFriend[];
}

export interface WL { w: number; l: number; n: number }
export type Streak = { result: Result; length: number } | null;
export type Mode = (typeof MODE_ORDER)[number];
export interface PlaylistRow extends WL { label: string }
export interface PerMatch { matches: number; winPct: number | null; score: number; goals: number; assists: number; saves: number; shots: number }
/** [you, them, the rest of your team]. */
type Shares = [number, number, number];

export interface ModeView {
  mode: Mode;
  matches: number;
  carry: { matches: number; score: Shares; goals: Shares; mvps: Shares };
  compare: { with: PerMatch; without: PerMatch | null; them: PerMatch };
}

export interface AgainstLine {
  guid: string;
  sessionKey: string | null;
  startedAt: number;
  playlistId: number | null;
  label: string;
  result: Result | null;
  me: Omit<Line, "playerKey">;
  them: Omit<Line, "playerKey">;
  mvp: "me" | "them" | null;
}

export interface FriendView {
  with: {
    record: WL;
    last: number | null;
    playlists: PlaylistRow[];
    streak: Streak;
    bestWinStreak: number;
    best: PlaylistRow | null;
    worst: PlaylistRow | null;
    timeMs: number;
    overtime: WL;
    modes: ModeView[];
    defaultMode: Mode | null;
  };
  against: {
    record: WL;
    last: number | null;
    playlists: PlaylistRow[];
    streak: Streak;
    mvps: [number, number];
    goals: [number, number];
    biggestWin: { guid: string; startedAt: number; label: string; goalDiff: number } | null;
    overtime: WL;
    matches: AgainstLine[];
  };
}

export const MODE_ORDER = ["2", "3", "4", "p2", "p3"] as const;
/** Standard soccar with a teammate, by playlist id: Doubles, Standard, Casual Quads, and ranked. */
const ONLINE_SIZE: Readonly<Record<number, Mode>> = { 2: "2", 3: "3", 4: "4", 11: "2", 12: "3", 13: "3" };
/** Pages read playlist rows with at least this many decided matches for best and worst. */
const BEST_MIN = 5;

const isPrivate = (m: LobbyMatch) => playlistInfo(m.playlistId).group === "private";
const counted = (m: LobbyMatch) => playlistInfo(m.playlistId).group !== "offline";

export function modeOf(m: LobbyMatch): Mode | null {
  if (isPrivate(m)) {
    const { mine, other } = m.sizes;
    return mine === other && (mine === 2 || mine === 3) ? (`p${String(mine)}` as Mode) : null;
  }
  return m.playlistId === null ? null : (ONLINE_SIZE[m.playlistId] ?? null);
}

/** Online playlists by name; private ones by team size, as Private NvN or Private · uneven. */
export function playlistLabel(m: LobbyMatch): string {
  if (!isPrivate(m)) return playlistInfo(m.playlistId).name;
  const { mine, other } = m.sizes;
  return mine === other && mine >= 1 && mine <= 4 ? `Private ${String(mine)}v${String(mine)}` : "Private · uneven";
}

/** Online rows by playlist id (unknown last), then private rows by size, uneven last. */
function rowOrder(m: LobbyMatch): number {
  if (isPrivate(m)) return 1e6 + (m.sizes.mine === m.sizes.other && m.sizes.mine <= 4 ? m.sizes.mine : 9);
  return m.playlistId ?? 1e5;
}

function record(ms: readonly LobbyMatch[]): WL {
  return { w: ms.filter((m) => m.result === "win").length, l: ms.filter((m) => m.result === "loss").length, n: ms.length };
}

const winPct = ({ w, l }: WL) => (w + l === 0 ? null : w / (w + l));

function playlistRows(ms: readonly LobbyMatch[]): PlaylistRow[] {
  const groups = [...Map.groupBy(ms, playlistLabel).values()] as [LobbyMatch, ...LobbyMatch[]][];
  return groups.sort((a, b) => rowOrder(a[0]) - rowOrder(b[0])).map((g) => ({ label: playlistLabel(g[0]), ...record(g) }));
}

function perMatch(lines: readonly Line[], results: WL | null): PerMatch {
  const n = lines.length;
  const avg = (k: keyof Omit<Line, "playerKey">) => sum(lines.map((l) => l[k])) / n;
  return { matches: n, winPct: results && winPct(results), score: avg("score"), goals: avg("goals"), assists: avg("assists"), saves: avg("saves"), shots: avg("shots") };
}

const stats = ({ score, goals, assists, saves, shots }: Line) => ({ score, goals, assists, saves, shots });

export function friendView(matches: readonly LobbyMatch[], id: string, sessionOf: (guid: string) => string | null): FriendView {
  const all = [...matches].filter(counted).sort((a, b) => a.startedAt - b.startedAt);
  const friendIn = (m: LobbyMatch) => m.friends.find((f) => f.id === id);
  const on = (side: LobbyFriend["side"]) => all.flatMap((m) => {
    const f = friendIn(m);
    return f?.side === side ? [{ m, f }] : [];
  });
  const withThem = on("with");
  const againstThem = on("against");
  const withMs = withThem.map((x) => x.m);
  const againstMs = againstThem.map((x) => x.m);

  const withRows = playlistRows(withMs);
  const ranked = playlistRows(withMs.filter((m) => !isPrivate(m)))
    .filter((r) => r.w + r.l >= BEST_MIN)
    .sort((a, b) => (winPct(b) ?? 0) - (winPct(a) ?? 0) || b.n - a.n);
  const [best, worst] = ranked.length >= 2 ? [ranked[0] ?? null, ranked.at(-1) ?? null] : [null, null];
  const withStreaks = streaks(withMs);

  const modes = MODE_ORDER.flatMap((mode): ModeView[] => {
    const at = withThem.filter((x) => modeOf(x.m) === mode);
    if (!at.length) return [];
    // Final-team totals don't fit a match where either of you changed team.
    const steady = at.filter((x) => !x.f.switched && !x.m.youSwitched);
    const share = (k: "score" | "goals"): Shares => {
      const you = sum(steady.map((x) => x.m.me[k]));
      const them = sum(steady.map((x) => x.f[k]));
      return [you, them, sum(steady.map((x) => x.m.myTeamTotals[k])) - you - them];
    };
    const mvpOf = (x: (typeof steady)[number]) => (x.m.mvpKey === x.m.me.playerKey ? 0 : x.m.mvpKey === x.f.playerKey ? 1 : x.m.mvpOnMyTeam ? 2 : null);
    const mvps: Shares = [0, 0, 0];
    for (const x of steady) {
      const i = mvpOf(x);
      if (i !== null) mvps[i]++;
    }
    const without = all.filter((m) => modeOf(m) === mode && friendIn(m)?.side !== "with");
    const withRecord = record(at.map((x) => x.m));
    return [{
      mode,
      matches: at.length,
      carry: { matches: steady.length, score: share("score"), goals: share("goals"), mvps },
      compare: {
        with: perMatch(at.map((x) => x.m.me), withRecord),
        without: without.length ? perMatch(without.map((m) => m.me), record(without)) : null,
        them: perMatch(at.map((x) => x.f), null),
      },
    }];
  });
  const online = modes.filter((m) => !m.mode.startsWith("p"));
  const pick = online.length ? online : modes;
  const defaultMode = pick.reduce<ModeView | null>((a, b) => (a === null || b.matches > a.matches ? b : a), null)?.mode ?? null;

  const wins = againstMs.filter((m) => m.result === "win" && m.goalDiff !== null);
  const biggest = wins.reduce<LobbyMatch | null>((a, b) => (a === null || (b.goalDiff ?? 0) > (a.goalDiff ?? 0) ? b : a), null);
  const overtime = (ms: LobbyMatch[]) => record(ms.filter((m) => m.overtime));

  return {
    with: {
      record: record(withMs),
      last: withMs.at(-1)?.startedAt ?? null,
      playlists: withRows,
      streak: withStreaks.endedOn,
      bestWinStreak: withStreaks.bestWinStreak,
      best,
      worst,
      timeMs: sum(withMs.map((m) => m.endedAt - m.startedAt)),
      overtime: overtime(withMs),
      modes,
      defaultMode,
    },
    against: {
      record: record(againstMs),
      last: againstMs.at(-1)?.startedAt ?? null,
      playlists: playlistRows(againstMs),
      streak: streaks(againstMs).endedOn,
      mvps: [againstThem.filter((x) => x.m.mvpKey === x.m.me.playerKey).length, againstThem.filter((x) => x.m.mvpKey === x.f.playerKey).length],
      goals: [sum(againstThem.map((x) => x.m.me.goals)), sum(againstThem.map((x) => x.f.goals))],
      biggestWin: biggest && { guid: biggest.guid, startedAt: biggest.startedAt, label: playlistLabel(biggest), goalDiff: biggest.goalDiff ?? 0 },
      overtime: overtime(againstMs),
      matches: againstThem
        .map(({ m, f }): AgainstLine => ({
          guid: m.guid,
          sessionKey: sessionOf(m.guid),
          startedAt: m.startedAt,
          playlistId: m.playlistId,
          label: playlistLabel(m),
          result: m.result,
          me: stats(m.me),
          them: stats(f),
          mvp: m.mvpKey === m.me.playerKey ? "me" : m.mvpKey === f.playerKey ? "them" : null,
        }))
        .reverse(),
    },
  };
}

/** The landing card: both records and when you last played them. */
export function friendCard(matches: readonly LobbyMatch[], id: string): { with: WL; against: WL; lastPlayed: number | null } {
  const ms = matches.filter(counted);
  const side = (s: LobbyFriend["side"]) => ms.filter((m) => m.friends.some((f) => f.id === id && f.side === s));
  const theirs = ms.filter((m) => m.friends.some((f) => f.id === id));
  return { with: record(side("with")), against: record(side("against")), lastPlayed: maxOrNull(theirs.map((m) => m.startedAt)) };
}

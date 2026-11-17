// A friend's page, or a group of friends' (a pair), worked out from every match you played (one row
// each, with each friend's row if they were in it). A match counts as "with" only when every friend
// was on your team, "against" only when every one was on the other; a split lobby counts on neither.
// Records, tiles and playlist rows count every match but offline play. The with/without comparison
// reads one "mode" at a time so like meets like: standard soccar at a team size, or an even private
// 2v2/3v3. Extras and LTMs score differently, so they have no mode.
import { maxOrNull, streaks, sum } from "./aggregate";
import { carryOf, type Carry } from "./contribution";
import { isPrivate, modeOf, MODE_ORDER, mvpIndex, rowsOn, steadyOnly, tally, type Line, type LobbyFriend, type LobbyMatch, type Mode, type Stats } from "./lobby";
import { playlistInfo } from "./playlists";
import type { Result } from "./result";

export interface WL { w: number; l: number; n: number }
export type Streak = { result: Result; length: number } | null;
export interface PlaylistRow extends WL { label: string }
export interface PerMatch { matches: number; winPct: number | null; score: number; goals: number; assists: number; saves: number; shots: number }

export interface ModeView {
  mode: Mode;
  matches: number;
  carry: Carry;
  compare: { with: PerMatch; without: PerMatch | null; friends: PerMatch[] };
}

export interface AgainstLine {
  guid: string;
  sessionKey: string | null;
  startedAt: number;
  playlistId: number | null;
  label: string;
  result: Result | null;
  me: Stats;
  friends: Stats[];
  /** 0 = you, i + 1 = friend i. */
  mvp: number | null;
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
    /** [you, ...each friend]. */
    mvps: number[];
    goals: number[];
    biggestWin: { guid: string; startedAt: number; label: string; goalDiff: number } | null;
    overtime: WL;
    matches: AgainstLine[];
  };
}

/** Pages read playlist rows with at least this many decided matches for best and worst. */
const BEST_MIN = 5;

const counted = (m: LobbyMatch) => playlistInfo(m.playlistId).group !== "offline";

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
  const avg = (k: keyof Stats) => sum(lines.map((l) => l[k])) / n;
  return { matches: n, winPct: results && winPct(results), score: avg("score"), goals: avg("goals"), assists: avg("assists"), saves: avg("saves"), shots: avg("shots") };
}

const stats = ({ score, goals, assists, saves, shots }: Line): Stats => ({ score, goals, assists, saves, shots });

/** `ids` is non-empty and distinct; every per-person array is [you, ...ids order]. */
export function friendView(matches: readonly LobbyMatch[], ids: readonly string[], sessionOf: (guid: string) => string | null): FriendView {
  const all = [...matches].filter(counted).sort((a, b) => a.startedAt - b.startedAt);
  const on = (side: LobbyFriend["side"]) => all.flatMap((m) => {
    const fs = rowsOn(m, ids, side);
    return fs ? [{ m, fs }] : [];
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
    const without = all.filter((m) => modeOf(m) === mode && !m.friends.some((f) => f.side === "with" && ids.includes(f.id)));
    const withRecord = record(at.map((x) => x.m));
    return [{
      mode,
      matches: at.length,
      carry: carryOf(steadyOnly(at), ids.length),
      compare: {
        with: perMatch(at.map((x) => x.m.me), withRecord),
        without: without.length ? perMatch(without.map((m) => m.me), record(without)) : null,
        friends: ids.map((_, i) => perMatch(at.flatMap((x) => x.fs[i] ?? []), null)),
      },
    }];
  });
  // Open on the smallest online team that fits everyone (2v2 for one friend, 3v3 for two) if
  // played together; otherwise the most-played online mode, so it never opens on an empty one.
  const fit = modes.find((m) => m.mode === String(ids.length + 1));
  const online = modes.filter((m) => !m.mode.startsWith("p"));
  const pick = online.length ? online : modes;
  const defaultMode = fit?.mode ?? pick.reduce<ModeView | null>((a, b) => (a === null || b.matches > a.matches ? b : a), null)?.mode ?? null;

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
      mvps: tally(ids.length + 1, againstThem.map((x) => mvpIndex(x.m, x.fs))),
      goals: [sum(againstThem.map((x) => x.m.me.goals)), ...ids.map((_, i) => sum(againstThem.map((x) => x.fs[i]?.goals ?? 0)))],
      biggestWin: biggest && { guid: biggest.guid, startedAt: biggest.startedAt, label: playlistLabel(biggest), goalDiff: biggest.goalDiff ?? 0 },
      overtime: overtime(againstMs),
      matches: againstThem
        .map(({ m, fs }): AgainstLine => ({
          guid: m.guid,
          sessionKey: sessionOf(m.guid),
          startedAt: m.startedAt,
          playlistId: m.playlistId,
          label: playlistLabel(m),
          result: m.result,
          me: stats(m.me),
          friends: fs.map(stats),
          mvp: mvpIndex(m, fs),
        }))
        .reverse(),
    },
  };
}

/** The counted matches with every friend on one side together: all with you, or all against you. */
export function together(matches: readonly LobbyMatch[], ids: readonly string[]): LobbyMatch[] {
  return matches.filter((m) => counted(m) && (rowsOn(m, ids, "with") ?? rowsOn(m, ids, "against")));
}

/** The landing card: both records and when you last played them all, on one side together. */
export function friendCard(matches: readonly LobbyMatch[], ids: readonly string[]): { with: WL; against: WL; lastPlayed: number | null } {
  const ms = matches.filter(counted);
  const side = (s: LobbyFriend["side"]) => ms.filter((m) => rowsOn(m, ids, s));
  const w = side("with");
  const a = side("against");
  return { with: record(w), against: record(a), lastPlayed: maxOrNull([...w, ...a].map((m) => m.startedAt)) };
}

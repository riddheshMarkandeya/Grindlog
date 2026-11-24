// What a session gives the remark picker: its mood band, and the quip triggers that fired with
// the numbers their lines show. Thresholds are first guesses from the copy, kept here rather than
// as settings; the inert triggers have no check here, so they never fire.
import type { Aggregate, MyMatch } from "../../shared/aggregate";
import { matchClutch, type ClutchGoal, type MatchClutch } from "../../shared/clutch";
import type { TeammateFilter } from "../../shared/teammate-filter";
import type { Band, GoalKind, TriggerId } from "./copy";

export const THRESHOLDS = {
  /** Fewer decided matches than this get the "short" set. */
  shortUnder: 4,
  usualBelowZ: 0.5,
  extremeFromZ: 1.5,
  epicSaves: 2,
  mvpHaul: 3,
  mvpHaulShare: 0.4,
  hardShotKmh: 130,
  streak: 3,
  demosGiven: 5,
  crossbars: 2,
  marathonMs: 3 * 3_600_000,
  /** Matches with one friend before a duo line; the copy says 3 for good, and bad takes the same. */
  duoMatches: 3,
  soloqueueMatches: 4,
  /** Local hours [from, to) a session's end counts as late night; the spec only fixes the start. */
  lateNightFromHour: 1,
  lateNightToHour: 6,
  /** One-goal losses without overtime in a session (user's choice). */
  closeLosses: 3,
};

export interface Mood {
  band: Band;
  /** Null for the short set. */
  z: number | null;
  /** Decided matches. */
  n: number;
}

/** z = (session win % − baseline win %) / (50 / √n), in points; 50 % stands in for an empty baseline. */
export function moodOf(session: Pick<Aggregate, "wins" | "losses">, base: Pick<Aggregate, "winPct">): Mood {
  const wins = session.wins ?? 0;
  const n = wins + (session.losses ?? 0);
  if (n < THRESHOLDS.shortUnder) return { band: "short", z: null, n };
  const z = ((wins / n - (base.winPct ?? 0.5)) * 100) / (50 / Math.sqrt(n));
  const size = Math.abs(z);
  const band: Band =
    size < THRESHOLDS.usualBelowZ ? "usual" : size < THRESHOLDS.extremeFromZ ? (z > 0 ? "good" : "rough") : z > 0 ? "great" : "disaster";
  return { band, z, n };
}

export type RemarkValues = Partial<Record<"n" | "w" | "l" | "speed" | "hours" | "time", number>> & { friend?: string };

export interface Fired {
  id: TriggerId;
  values: RemarkValues;
  /** Aerial-or-long only: which kinds of goal happened. */
  kinds?: GoalKind[];
  /** Named by the With filter: takes the quip slot over any tier. */
  pinned?: true;
}

/** The whole session's span (time at the PC), and your matches under the filters with their aggregate. */
export interface SessionFacts {
  startedAt: number;
  endedAt: number;
  matches: readonly MyMatch[];
  aggregate: Aggregate;
  /** Friends on your team in the session under the playlist filter, by display name. */
  friendsPresent: readonly { id: string; name: string }[];
  teammate: TeammateFilter;
  /** The session's goals, for the Clutch triggers' goal order. */
  goals: readonly ClutchGoal[];
}

/**
 * The friend you played most with (at least the minimum), with your record together, pinned when
 * the teammate filter names that friend. A tie goes to the filtered friend, then to the lower
 * name, so the pick is stable.
 */
function duo({ matches, friendsPresent, teammate }: SessionFacts): { values: { friend: string; w: number; l: number }; pinned: boolean } | null {
  const filtered = typeof teammate === "object" ? teammate.friends : [];
  const ranked = friendsPresent
    .map((f) => {
      const together = matches.filter((m) => m.me !== null && m.friends.includes(f.id));
      const [w, l] = [together.filter((m) => m.result === "win").length, together.filter((m) => m.result === "loss").length];
      // Decided matches only, so a 1–1 with an unfinished third never fires.
      return { f, n: w + l, w, l };
    })
    .filter((d) => d.n >= THRESHOLDS.duoMatches)
    .sort((a, b) => b.n - a.n || Number(filtered.includes(b.f.id)) - Number(filtered.includes(a.f.id)) || a.f.name.localeCompare(b.f.name));
  const [top] = ranked;
  return top ? { values: { friend: top.f.name, w: top.w, l: top.l }, pinned: filtered.includes(top.f.id) } : null;
}

/** Your team scored nothing; a match without your team or the score can't say. */
function shutOut(m: MyMatch): boolean {
  const team = m.me?.teamNum;
  if (team === null || team === undefined || m.scoreTeam0 === null || m.scoreTeam1 === null) return false;
  return (team === 0 ? m.scoreTeam0 : m.scoreTeam1) === 0;
}

export function triggersFor(facts: SessionFacts): Fired[] {
  const { startedAt, endedAt, matches, aggregate: agg } = facts;
  const out: Fired[] = [];
  const add = (cond: boolean, id: TriggerId, values: RemarkValues = {}) => {
    if (cond) out.push({ id, values });
  };
  const sf = (event: string) => agg.statfeed[event] ?? 0;
  const count = (p: (m: MyMatch) => boolean) => matches.filter((m) => m.me !== null && p(m)).length;

  add(sf("HatTrick") >= 1, "hat_trick", { n: sf("HatTrick") });
  add(sf("Savior") >= 1, "savior", { n: sf("Savior") });

  const kinds: GoalKind[] = [...(sf("AerialGoal") >= 1 ? (["aerial"] as const) : []), ...(sf("LongGoal") >= 1 ? (["long"] as const) : [])];
  if (kinds.length) out.push({ id: "aerial_or_long", values: {}, kinds });
  add(sf("EpicSave") >= THRESHOLDS.epicSaves, "epic_saves", { n: sf("EpicSave") });
  // Overtime, comebacks and close losses follow Clutch: its playlists, decided matches only.
  const clutch = matches.flatMap((m) => {
    const c = matchClutch(m, facts.goals);
    return c ? [{ m, c }] : [];
  });
  const clutchCount = (p: (c: MatchClutch, m: MyMatch) => boolean) => clutch.filter(({ m, c }) => p(c, m)).length;
  const otWins = clutchCount((c, m) => c.ot && m.result === "win");
  const otLosses = clutchCount((c, m) => c.ot && m.result === "loss");
  add(otWins >= 1, "ot_wins", { n: otWins });
  add(otLosses >= 1, "ot_losses", { n: otLosses });
  const comebacks = clutchCount((c) => c.comebackFrom !== null);
  const blown = clutchCount((c) => c.blownFrom !== null);
  add(comebacks >= 1, "comeback", { n: comebacks });
  add(blown >= 1, "blown_lead", { n: blown });
  // Only matches played to the end: a quit, forfeit or crash at 0–1 was never a crossbar away.
  const closeLosses = clutchCount((c, m) => c.oneGoal && !c.ot && m.result === "loss" && m.endKind === "completed");
  add(closeLosses >= THRESHOLDS.closeLosses, "close_losses", { n: closeLosses });
  const mvps = agg.mvps ?? 0;
  add(mvps >= THRESHOLDS.mvpHaul && mvps >= THRESHOLDS.mvpHaulShare * agg.matches, "mvp_haul", { n: mvps });
  const speed = agg.hardestShotKmh;
  add(speed !== null && speed >= THRESHOLDS.hardShotKmh, "hard_shot", { speed: Math.round(speed ?? 0) });
  const shutOuts = count(shutOut);
  add(shutOuts >= 1, "shut_out", { n: shutOuts });

  const bestWin = agg.bestWinStreak ?? 0;
  const bestLoss = agg.bestLossStreak ?? 0;
  add(bestWin >= THRESHOLDS.streak, "win_streak", { n: bestWin });
  add(bestLoss >= THRESHOLDS.streak, "loss_streak", { n: bestLoss });
  // Ending on a loss streak is the loss-streak line's to tell.
  add(agg.endedOn?.result === "win" && (agg.losses ?? 0) > 0, "ended_win");
  add(agg.endedOn?.result === "loss" && agg.endedOn.length < THRESHOLDS.streak, "ended_loss");
  const demos = agg.totals.demos ?? 0;
  add(demos >= THRESHOLDS.demosGiven, "demos_given", { n: demos });
  const crossbars = agg.woodworkHits ?? 0;
  add(crossbars >= THRESHOLDS.crossbars, "crossbar", { n: crossbars });
  add(endedAt - startedAt >= THRESHOLDS.marathonMs, "marathon", { hours: Math.round((endedAt - startedAt) / 3_600_000) });
  const endHour = new Date(endedAt).getHours();
  add(endHour >= THRESHOLDS.lateNightFromHour && endHour < THRESHOLDS.lateNightToHour, "late_night", { time: endedAt });

  const d = duo(facts);
  if (d) out.push({ id: d.values.w < d.values.l ? "duo_bad" : "duo_good", values: d.values, ...(d.pinned ? { pinned: true as const } : {}) });
  add(facts.friendsPresent.length === 0 && count(() => true) >= THRESHOLDS.soloqueueMatches, "soloqueue");
  return out;
}

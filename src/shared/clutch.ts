// Clutch: how you do when it's tight or the lead swings. Read-side only, from stored final scores,
// overtime, end kind and each goal's team in scoring order. Shared so the server's period stats,
// the recap's match cards and the remarks agree on what a comeback is.
import { playlistInfo } from "./playlists";
import type { Result, ResultInput } from "./result";

/**
 * Goals down (or up) at some point for a win (or loss) to be a comeback (or blown lead): a 1-goal
 * deficit happens in almost every match, so it says nothing.
 */
export const SWING_MIN_GOALS = 2;

/** The ladder's top rung (3+), which holds every bigger deficit or lead too. Names the number, not a
 * tunable: the rungs are a fixed 3-tuple. */
export const LADDER_TOP = 3;

/** The match fields Clutch reads; the server's `MyMatch` and the web's `MyMatchWire` both fit. */
export interface ClutchMatch {
  guid: string;
  startedAt: number;
  playlistId: number | null;
  endKind: ResultInput["endKind"];
  overtime: boolean;
  scoreTeam0: number | null;
  scoreTeam1: number | null;
  result: Result | null;
  me: { teamNum: number | null } | null;
}

export interface ClutchGoal {
  matchGuid: string;
  idx: number;
  teamNum: number;
}

/** Scores are "mine–theirs", taken where the max was first reached; null when never behind (or ahead). */
export interface GoalOrder {
  /** Null when nobody scored. */
  firstMine: boolean | null;
  maxDeficit: number;
  deficitAt: string | null;
  maxLead: number;
  leadAt: string | null;
}

export interface MatchClutch {
  oneGoal: boolean;
  ot: boolean;
  /** Ended early by a forfeit. */
  ff: boolean;
  /**
   * False when the result contradicts the final score (a win while behind: the other side quit
   * while ahead; a loss while ahead): such a match stays in the final-score stats and scored first,
   * but not in comebacks, blown leads or the ladder.
   */
  swings: boolean;
  /** The final score as [mine, theirs]; null with no score. */
  final: [number, number] | null;
  /** The score at the biggest deficit of a win from 2+ down. */
  comebackFrom: string | null;
  /** The score at the biggest lead of a loss from 2+ up. */
  blownFrom: string | null;
  /** Null when the goals per team aren't the final score: goal-order stats leave the match out. */
  order: GoalOrder | null;
}

export interface WL {
  w: number;
  l: number;
}

/** A match with the period's biggest swing: its final score, the score at the swing, and its size. */
export interface ClutchRef {
  guid: string;
  startedAt: number;
  score: string;
  at: string;
  by: number;
}

type Rungs = [WL, WL, WL];

export interface ClutchStats {
  /** Counted matches. */
  matches: number;
  /** Counted matches left out of goal-order stats. */
  skippedOrder: number;
  oneGoal: WL;
  oneGoalNoOt: WL;
  overtime: WL;
  scoredFirst: WL;
  concededFirst: WL;
  forfeits: WL;
  /** Wins from 2+ down out of the matches 2+ down; blown leads likewise. */
  comebacks: { n: number; of: number };
  blownLeads: { n: number; of: number };
  /** By the biggest deficit (lead) a match reached: 1, 2, 3+; never behind (ahead) is in neither. */
  ladder: { down: Rungs; up: Rungs };
  best: ClutchRef | null;
  worst: ClutchRef | null;
}

/** Team modes where the most goals win: casual, ranked (extras included) and tournaments. */
export function clutchCounts(playlistId: number | null): boolean {
  const group = playlistInfo(playlistId).group;
  return group === "casual" || group === "ranked" || group === "tournament";
}

const scoreOf = (mine: number, theirs: number) => `${String(mine)}–${String(theirs)}`;

/** The final score as [mine, theirs], or null with no team or no score. */
function finalScore(m: ClutchMatch): [number, number] | null {
  const team = m.me?.teamNum;
  if ((team !== 0 && team !== 1) || m.scoreTeam0 === null || m.scoreTeam1 === null) return null;
  return team === 0 ? [m.scoreTeam0, m.scoreTeam1] : [m.scoreTeam1, m.scoreTeam0];
}

/** How the score went, from the match's goals by idx; null when they don't add up to the final score. */
export function goalOrder(m: ClutchMatch, goals: readonly ClutchGoal[]): GoalOrder | null {
  const fin = finalScore(m);
  if (!fin) return null;
  const ordered = goals.filter((g) => g.matchGuid === m.guid).sort((a, b) => a.idx - b.idx);
  let mine = 0;
  let theirs = 0;
  const o: GoalOrder = { firstMine: null, maxDeficit: 0, deficitAt: null, maxLead: 0, leadAt: null };
  for (const g of ordered) {
    if (g.teamNum === m.me?.teamNum) mine++;
    else theirs++;
    o.firstMine ??= mine === 1;
    if (theirs - mine > o.maxDeficit) [o.maxDeficit, o.deficitAt] = [theirs - mine, scoreOf(mine, theirs)];
    if (mine - theirs > o.maxLead) [o.maxLead, o.leadAt] = [mine - theirs, scoreOf(mine, theirs)];
  }
  return mine === fin[0] && theirs === fin[1] ? o : null;
}

/**
 * A match's Clutch facts, or null when it doesn't count: an uncounted playlist, no team of yours,
 * or no win or loss (a restart, a forfeit with no winner).
 */
export function matchClutch(m: ClutchMatch, goals: readonly ClutchGoal[]): MatchClutch | null {
  const team = m.me?.teamNum;
  if (!clutchCounts(m.playlistId) || m.result === null || (team !== 0 && team !== 1)) return null;
  const fin = finalScore(m);
  const order = goalOrder(m, goals);
  const swings = fin === null || (m.result === "win" ? fin[0] >= fin[1] : fin[0] <= fin[1]);
  return {
    oneGoal: fin !== null && Math.abs(fin[0] - fin[1]) === 1,
    ot: m.overtime,
    ff: m.endKind === "early_end",
    swings,
    final: fin,
    comebackFrom: swings && m.result === "win" && order && order.maxDeficit >= SWING_MIN_GOALS ? order.deficitAt : null,
    blownFrom: swings && m.result === "loss" && order && order.maxLead >= SWING_MIN_GOALS ? order.leadAt : null,
    order,
  };
}

/** The rung for a deficit or lead of `k` (1 or more): 1, 2, 3+. */
const rungOf = (rungs: Rungs, k: number): WL => (k >= LADDER_TOP ? rungs[2] : k === 2 ? rungs[1] : rungs[0]);

/**
 * The period's Clutch stats over its counted matches, with the guids of those left out of
 * goal-order stats (for the log); null when no match counts.
 */
export function clutchStats(matches: readonly ClutchMatch[], goals: readonly ClutchGoal[]): { stats: ClutchStats; skipped: string[] } | null {
  // Grouped first so a long period doesn't filter every goal once per match.
  const byMatch = Map.groupBy(goals, (g) => g.matchGuid);
  const wl = (): WL => ({ w: 0, l: 0 });
  const s: ClutchStats = {
    matches: 0,
    skippedOrder: 0,
    oneGoal: wl(),
    oneGoalNoOt: wl(),
    overtime: wl(),
    scoredFirst: wl(),
    concededFirst: wl(),
    forfeits: wl(),
    comebacks: { n: 0, of: 0 },
    blownLeads: { n: 0, of: 0 },
    ladder: { down: [wl(), wl(), wl()], up: [wl(), wl(), wl()] },
    best: null,
    worst: null,
  };
  const skipped: string[] = [];
  for (const m of matches) {
    const c = matchClutch(m, byMatch.get(m.guid) ?? []);
    if (!c) continue;
    s.matches++;
    const won = m.result === "win";
    const add = (r: WL) => (won ? r.w++ : r.l++);
    if (c.oneGoal) add(s.oneGoal);
    if (c.oneGoal && !c.ot) add(s.oneGoalNoOt);
    if (c.ot) add(s.overtime);
    if (c.ff) add(s.forfeits);
    const o = c.order;
    const fin = c.final;
    // A goal order only exists with a final score; checking both narrows the type.
    if (!o || !fin) {
      skipped.push(m.guid);
      continue;
    }
    if (o.firstMine === true) add(s.scoredFirst);
    if (o.firstMine === false) add(s.concededFirst);
    if (!c.swings) continue;
    if (o.maxDeficit > 0) add(rungOf(s.ladder.down, o.maxDeficit));
    if (o.maxLead > 0) add(rungOf(s.ladder.up, o.maxLead));
    if (o.maxDeficit >= SWING_MIN_GOALS) s.comebacks.of++;
    if (o.maxLead >= SWING_MIN_GOALS) s.blownLeads.of++;
    const ref = (at: string, by: number): ClutchRef => ({ guid: m.guid, startedAt: m.startedAt, score: scoreOf(...fin), at, by });
    // Ties go to the newest match.
    const beats = (cur: ClutchRef | null, by: number) => !cur || by > cur.by || (by === cur.by && m.startedAt > cur.startedAt);
    if (c.comebackFrom) {
      s.comebacks.n++;
      if (beats(s.best, o.maxDeficit)) s.best = ref(c.comebackFrom, o.maxDeficit);
    }
    if (c.blownFrom) {
      s.blownLeads.n++;
      if (beats(s.worst, o.maxLead)) s.worst = ref(c.blownFrom, o.maxLead);
    }
  }
  return s.matches === 0 ? null : { stats: { ...s, skippedOrder: skipped.length }, skipped };
}

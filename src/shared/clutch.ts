// Clutch: how you do when it's tight or the lead swings. Read-side only, from stored final scores,
// overtime, end kind and each goal's team and game clock in scoring order. Shared so the server's period stats,
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

/** A late goal is a regulation goal with this many seconds or fewer left (the reading is the last whole second before it). */
export const LATE_SECONDS = 30;

/** A goal is answered when the other side's next goal comes this many seconds of game clock later or sooner. */
export const ANSWER_SECONDS = 15;

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

/** The last game-clock reading before a goal: time left in regulation, or time played in overtime. */
export interface GoalClock {
  seconds: number;
  overtime: boolean;
}

export interface ClutchGoal {
  matchGuid: string;
  idx: number;
  teamNum: number;
  /** Null until recompute, or with no reading before the goal. */
  clock: GoalClock | null;
}

type ClockedGoal = ClutchGoal & { clock: GoalClock };

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
  /**
   * The deciding goal (the winner's go-ahead goal, never given back) when it came late; `mine` in a win.
   * Null with no deciding goal (a tied score, a match you left, a win that finished behind), when the
   * clock check fails, or when it wasn't late.
   */
  lateWinner: { mine: boolean; seconds: number } | null;
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

/** Goal-clock counts over the clock-checked matches; your and their goals are your team's and the other team's. */
export interface ClockStats {
  matches: number;
  lateScored: number;
  lateConceded: number;
  yourGoals: number;
  theirGoals: number;
  /** Your goals the other team answered within `ANSWER_SECONDS`; `answeredByYou` is the mirror. */
  answeredByThem: number;
  answeredByYou: number;
  /** Matches with your late winner (w) and with theirs (l). */
  lateWinners: WL;
}

export interface ClutchStats {
  /** Counted matches. */
  matches: number;
  /** Counted matches left out of goal-order stats. */
  skippedOrder: number;
  /** Counted matches with a goal order but left out of the goal-clock stats (a goal with no clock, or inconsistent overtime flags). */
  skippedClock: number;
  clock: ClockStats;
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
  return orderOf(m, matchGoals(m, goals));
}

/** The match's own goals by idx, from goals that may span a whole session. */
function matchGoals(m: ClutchMatch, goals: readonly ClutchGoal[]): ClutchGoal[] {
  return goals.filter((g) => g.matchGuid === m.guid).sort((a, b) => a.idx - b.idx);
}

function orderOf(m: ClutchMatch, ordered: readonly ClutchGoal[]): GoalOrder | null {
  const fin = finalScore(m);
  if (!fin) return null;
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

/** Seconds of game clock from goal `a` to the later goal `b`, without needing the regulation length. */
export function secondsBetween(a: GoalClock, b: GoalClock): number {
  if (!a.overtime) return b.overtime ? a.seconds + b.seconds : a.seconds - b.seconds;
  // Both in overtime: clockChecked rules out overtime then regulation.
  return b.seconds - a.seconds;
}

const isLate = (c: GoalClock): boolean => !c.overtime && c.seconds <= LATE_SECONDS;

/**
 * Whether a match's goals (by idx) can feed the goal-clock stats: every goal has a clock, no overtime
 * goal in a match without overtime, no regulation goal after an overtime one, the clock never runs
 * backwards (a negative gap would pass as "answered"), and a completed overtime match ends on an overtime
 * goal (the golden goal). Stands in for the stored clock checks, which the match's fields don't carry.
 */
export function clockChecked(m: ClutchMatch, ordered: readonly ClutchGoal[]): ordered is readonly ClockedGoal[] {
  let prev: GoalClock | null = null;
  for (const g of ordered) {
    if (!g.clock || (g.clock.overtime && !m.overtime) || (prev?.overtime === true && !g.clock.overtime)) return false;
    if (prev && secondsBetween(prev, g.clock) < 0) return false;
    prev = g.clock;
  }
  const inOvertime = prev?.overtime === true;
  return !(m.overtime && m.endKind === "completed" && ordered.length > 0 && !inOvertime);
}

/** The deciding goal when late: the winner's (loser's final + 1)-th goal. The caller has checked the order and clock. */
function lateWinnerOf(m: ClutchMatch, fin: [number, number], ordered: readonly ClockedGoal[]): MatchClutch["lateWinner"] {
  // A match you left stops wherever you stopped watching; a tied score (a forfeit) has no deciding goal.
  if ((m.endKind !== "completed" && m.endKind !== "early_end") || fin[0] === fin[1]) return null;
  const mine = m.result === "win";
  const deciding = ordered.filter((g) => (g.teamNum === m.me?.teamNum) === mine)[mine ? fin[1] : fin[0]];
  return deciding && isLate(deciding.clock) ? { mine, seconds: deciding.clock.seconds } : null;
}

/**
 * A match's Clutch facts, or null when it doesn't count: an uncounted playlist, no team of yours,
 * or no win or loss (a restart, a forfeit with no winner).
 */
export function matchClutch(m: ClutchMatch, goals: readonly ClutchGoal[]): MatchClutch | null {
  const team = m.me?.teamNum;
  if (!clutchCounts(m.playlistId) || m.result === null || (team !== 0 && team !== 1)) return null;
  const fin = finalScore(m);
  const ordered = matchGoals(m, goals);
  const order = orderOf(m, ordered);
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
    lateWinner: swings && order && fin && clockChecked(m, ordered) ? lateWinnerOf(m, fin, ordered) : null,
  };
}

/** The rung for a deficit or lead of `k` (1 or more): 1, 2, 3+. */
const rungOf = (rungs: Rungs, k: number): WL => (k >= LADDER_TOP ? rungs[2] : k === 2 ? rungs[1] : rungs[0]);

/** Adds a clock-checked match's goals, late goals and answered goals to `s`. */
function addClock(s: ClockStats, team: number | null | undefined, ordered: readonly ClockedGoal[]): void {
  s.matches++;
  ordered.forEach((g, i) => {
    const mine = g.teamNum === team;
    if (mine) s.yourGoals++;
    else s.theirGoals++;
    if (isLate(g.clock)) {
      if (mine) s.lateScored++;
      else s.lateConceded++;
    }
    const next = ordered[i + 1];
    if (next && next.teamNum !== g.teamNum && secondsBetween(g.clock, next.clock) <= ANSWER_SECONDS) {
      if (mine) s.answeredByThem++;
      else s.answeredByYou++;
    }
  });
}

/**
 * The period's Clutch stats over its counted matches, with the guids of those left out of goal-order
 * stats and of those left out of goal-clock stats (for the log); null when no match counts.
 */
export function clutchStats(matches: readonly ClutchMatch[], goals: readonly ClutchGoal[]): { stats: ClutchStats; skipped: string[]; skippedClock: string[] } | null {
  // Grouped first so a long period doesn't filter every goal once per match.
  const byMatch = Map.groupBy(goals, (g) => g.matchGuid);
  const wl = (): WL => ({ w: 0, l: 0 });
  const s: ClutchStats = {
    matches: 0,
    skippedOrder: 0,
    skippedClock: 0,
    clock: { matches: 0, lateScored: 0, lateConceded: 0, yourGoals: 0, theirGoals: 0, answeredByThem: 0, answeredByYou: 0, lateWinners: wl() },
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
  const skippedClock: string[] = [];
  for (const m of matches) {
    const own = byMatch.get(m.guid) ?? [];
    const c = matchClutch(m, own);
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
    const ordered = matchGoals(m, own);
    if (clockChecked(m, ordered)) addClock(s.clock, m.me?.teamNum, ordered);
    else skippedClock.push(m.guid);
    if (c.lateWinner) add(s.clock.lateWinners);
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
  return s.matches === 0 ? null : { stats: { ...s, skippedOrder: skipped.length, skippedClock: skippedClock.length }, skipped, skippedClock };
}

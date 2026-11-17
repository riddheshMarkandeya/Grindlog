// What you and your listed teammates put into your team's totals, one "mode" at a time so like meets
// like: standard soccar at a team size, or an even private 2v2/3v3. Friends pages and the Recap
// session show it as the Contribution panel; the Recap adds where everyone's touches were.
import { sum } from "./aggregate";
import { MODE_ORDER, modeOf, mvpIndex, rowsOn, steadyOnly, sumThirds, tally, touchesOf, type Line, type LobbyMatch, type Mode, type Thirds, type Together } from "./lobby";

/** [you, ...each friend in order, the rest of your team]. */
type Shares = number[];
export interface Carry {
  matches: number;
  /** The steady matches with every touch recomputed: the ones `touches` covers. */
  touchMatches: number;
  score: Shares;
  goals: Shares;
  assists: Shares;
  saves: Shares;
  shots: Shares;
  touches: Shares;
  mvps: Shares;
}

type Counted = "score" | "goals" | "assists" | "saves" | "shots";

// Every line has its thirds once the match's `touches` is set, so the fallback never fires.
const thirdsOf = (l: Line | undefined): Thirds => l?.thirds ?? [0, 0, 0];

/**
 * Touches by third over the matches in `xs` with every touch recomputed, so a half-recomputed
 * history never reads as zeros: [you, ...each of `n` friends, the rest of your team, the opponents].
 */
function thirdsBy(xs: readonly Together[], n: number): { matches: number; by: Thirds[] } {
  const done = xs.flatMap((x) => (x.m.touches ? [{ m: x.m, fs: x.fs, touches: x.m.touches }] : []));
  const people = [sumThirds(done.map((x) => thirdsOf(x.m.me))), ...Array.from({ length: n }, (_, i) => sumThirds(done.map((x) => thirdsOf(x.fs[i]))))];
  const team = sumThirds(done.map((x) => x.touches.team));
  const placed = sumThirds(people);
  const rest: Thirds = [team[0] - placed[0], team[1] - placed[1], team[2] - placed[2]];
  return { matches: done.length, by: [...people, rest, sumThirds(done.map((x) => x.touches.opponents))] };
}

/** The shares over `steady` matches (no team switch) for `n` listed friends, and the thirds, from one `thirdsBy` walk. */
function carryAndThirds(steady: readonly Together[], n: number): { carry: Carry; thirds: Thirds[] } {
  const counted = (k: Counted): number[] => {
    const people = [sum(steady.map((x) => x.m.me[k])), ...Array.from({ length: n }, (_, i) => sum(steady.map((x) => x.fs[i]?.[k] ?? 0)))];
    return [...people, sum(steady.map((x) => x.m.myTeamTotals[k])) - sum(people)];
  };
  const mvpOf = (x: Together) => mvpIndex(x.m, x.fs) ?? (x.m.mvpOnMyTeam ? n + 1 : null);
  const touches = thirdsBy(steady, n);
  const carry = {
    matches: steady.length,
    touchMatches: touches.matches,
    score: counted("score"),
    goals: counted("goals"),
    assists: counted("assists"),
    saves: counted("saves"),
    shots: counted("shots"),
    touches: touches.by.slice(0, n + 2).map(touchesOf),
    mvps: tally(n + 2, steady.map(mvpOf)),
  };
  return { carry, thirds: touches.by };
}

export const carryOf = (steady: readonly Together[], n: number): Carry => carryAndThirds(steady, n).carry;

export interface ContributionMode {
  mode: Mode;
  /** Matches in the mode, switched ones included. */
  matches: number;
  carry: Carry;
  /** Over `carry.touchMatches`: [you, ...each friend, the rest of your team, the opponents]. */
  thirds: Thirds[];
}
export interface SessionContribution {
  modes: ContributionMode[];
  defaultMode: Mode;
}

/** A session's matches split by mode with `ids` (the teammate filter's friends, or none) broken out; null with no mode at all. */
export function sessionContribution(matches: readonly LobbyMatch[], ids: readonly string[]): SessionContribution | null {
  const together = matches.flatMap((m): Together[] => {
    const fs = rowsOn(m, ids, "with");
    return fs ? [{ m, fs }] : [];
  });
  const modes = MODE_ORDER.flatMap((mode): ContributionMode[] => {
    const at = together.filter((x) => modeOf(x.m) === mode);
    if (!at.length) return [];
    return [{ mode, matches: at.length, ...carryAndThirds(steadyOnly(at), ids.length) }];
  });
  const [first, ...others] = modes;
  if (!first) return null;
  // The most steady matches, so it never opens on a mode where every match had a switch; modes are
  // in MODE_ORDER, so a tie keeps the earlier one.
  const defaultMode = others.reduce((a, b) => (b.carry.matches > a.carry.matches ? b : a), first).mode;
  return { modes, defaultMode };
}

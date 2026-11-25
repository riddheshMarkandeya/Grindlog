// The match page's goal timeline: a row per player along the match clock, with the running score
// above. Pure; the component lays it out at its measured width.
import { TIMELINE_PLAYLISTS } from "../../shared/playlists";
import { plural } from "./format";
import type { MatchDetail, MomentKind } from "../../shared/schemas/responses";

/**
 * Checks whose failure leaves the marks untrustworthy: a goal or moment without its clock or row,
 * moments that don't add up to the statfeeds, a dropped goal that would end the score row on the
 * wrong score, or a clock reading with no overtime flag, which would put an overtime mark in regulation.
 */
export const HIDING_FLAGS: ReadonlySet<string> = new Set([
  "forfeit_end_clocked",
  "moments_clocked",
  "moments_match_statfeed",
  "goals_clocked",
  "goals_placed",
  "goals_per_team_equal_score",
  "clock_overtime_flagged",
]);

type Clock = NonNullable<MatchDetail["goals"][number]["clock"]>;

export interface TimelineMark {
  kind: "goal" | MomentKind;
  /** Seconds since kickoff. */
  t: number;
  /** The hover text: clock, kind, player and, for a goal, the score after it, yours first. */
  title: string;
  /** Goals only: whether the game counted the goal's shot (it paired a Shot statfeed with it). */
  countedAsShot: boolean;
  /** On the overtime clock: regulation's 0:00 and overtime's +0:00 share a `t`. */
  overtime: boolean;
}

export interface TimelineRow {
  playerKey: string;
  name: string;
  /** On your team. */
  yours: boolean;
  isMe: boolean;
  /** In time order. */
  marks: TimelineMark[];
}

export interface ScoreLabel {
  t: number;
  /** The score after the goal. */
  us: number;
  them: number;
  /** Your team scored it. */
  yours: boolean;
  title: string;
}

/** Where a forfeit or a match you left stopped. */
export interface TimelineStop {
  t: number;
  label: string;
  /** Hatch the unplayed clock after it; overtime has no fixed end to hatch up to. */
  hatch: boolean;
}

export interface Timeline {
  regulation: number;
  /** The axis end, in seconds since kickoff: the regulation length, or later in overtime. */
  end: number;
  overtime: boolean;
  /** Each regulation minute as the clock showed it, then each whole overtime minute before the end. */
  ticks: { t: number; label: string }[];
  /** In match order. */
  scores: ScoreLabel[];
  stop: TimelineStop | null;
  /** You, then your teammates, then the opponents, each team by score as on the scoreboard. */
  rows: TimelineRow[];
}

const KIND_WORD: Record<MomentKind, string> = { shot: "Shot", save: "Save", epic_save: "Save (epic)", assist: "Assist" };

/** A score, yours first, as the score row and a goal's hover both show it. */
export const scoreText = (us: number, them: number) => `${String(us)}–${String(them)}`;
const mmss = (s: number) => `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
/** As the game clock showed it: time left in regulation, "+" time played in overtime. */
const clockText = (c: Clock) => (c.overtime ? `+${mmss(c.seconds)}` : mmss(c.seconds));
const elapsed = (c: Clock, regulation: number) => (c.overtime ? regulation + c.seconds : regulation - c.seconds);

type Goal = MatchDetail["goals"][number];
type Moment = NonNullable<MatchDetail["moments"]>[number];
/** A goal or moment checked to have a clock and a player row. */
type Placed<T> = T & { clock: Clock; name: string };

interface Checked {
  regulation: number;
  myTeam: number;
  goals: Placed<Goal>[];
  moments: Placed<Moment>[];
  /** Non-null for a forfeit or a match you left. */
  endClock: Clock | null;
}

/**
 * The match's goals and moments, each with its clock and its player's name, or null when the match
 * isn't drawn at all: the user chose hiding over a partial or caveated chart.
 */
function checked(d: MatchDetail): Checked | null {
  const m = d.match;
  const regulation = m.regulationSeconds;
  const myTeam = d.players.find((p) => p.isMe)?.teamNum ?? null;
  if (m.playlistId === null || !TIMELINE_PLAYLISTS.has(m.playlistId)) return null;
  if (m.joinedInProgress || m.endKind === "orphaned" || regulation === null) return null;
  if ((m.endKind === "early_end" || m.endKind === "left") && m.endClock === null) return null;
  if (m.checkFlags.some((f) => HIDING_FLAGS.has(f))) return null;
  if (d.moments === null || myTeam === null || d.players.some((p) => p.teamNum === null)) return null;
  const byKey = new Map(d.players.map((p) => [p.playerKey, p]));
  // The icon goes on the scorer's row, in that side's colour, so it must be the side the goal counted for.
  if (d.goals.some((g) => { const s = byKey.get(g.scorerKey); return s !== undefined && s.teamNum !== g.teamNum; })) return null;
  const place = <T extends { clock: Clock | null }>(x: T, key: string): Placed<T> | null => {
    const name = byKey.get(key)?.name;
    return x.clock === null || name === undefined ? null : { ...x, clock: x.clock, name };
  };
  const goals = d.goals.map((g) => place(g, g.scorerKey));
  const moments = d.moments.map((x) => place(x, x.playerKey));
  if (goals.includes(null) || moments.includes(null)) return null;
  return { regulation, myTeam, goals: goals.filter((g) => g !== null), moments: moments.filter((x) => x !== null), endClock: m.endClock };
}

/** The timeline for a match, or null when it isn't drawn (see `checked`). */
export function timelineFor(d: MatchDetail): Timeline | null {
  const c = checked(d);
  if (c === null) return null;
  const { regulation, myTeam } = c;
  const marksOf = new Map<string, TimelineMark[]>();
  const add = (key: string, mark: TimelineMark) => {
    const marks = marksOf.get(key);
    if (marks === undefined) marksOf.set(key, [mark]);
    else marks.push(mark);
  };

  const paired = new Set(c.moments.flatMap((x) => (x.goalIdx === null ? [] : [x.goalIdx])));
  const scores: ScoreLabel[] = [];
  let us = 0;
  let them = 0;
  for (const g of c.goals) {
    const yours = g.teamNum === myTeam;
    if (yours) us++;
    else them++;
    const countedAsShot = paired.has(g.idx);
    const parts = [clockText(g.clock), "Goal", g.name, scoreText(us, them)];
    if (!countedAsShot) parts.push("Not counted as a shot");
    const t = elapsed(g.clock, regulation);
    const title = parts.join(" · ");
    add(g.scorerKey, { kind: "goal", t, title, countedAsShot, overtime: g.clock.overtime });
    scores.push({ t, us, them, yours, title });
  }
  for (const x of c.moments) {
    // The goal it became shows it.
    if (x.goalIdx !== null) continue;
    const title = [clockText(x.clock), KIND_WORD[x.kind], x.name].join(" · ");
    add(x.playerKey, { kind: x.kind, t: elapsed(x.clock, regulation), title, countedAsShot: false, overtime: x.clock.overtime });
  }

  const rows = [...d.players]
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.teamNum === myTeam) - Number(a.teamNum === myTeam) || b.score - a.score)
    .map((p) => ({
      playerKey: p.playerKey,
      name: p.name,
      yours: p.teamNum === myTeam,
      isMe: p.isMe,
      marks: (marksOf.get(p.playerKey) ?? []).sort((a, b) => a.t - b.t),
    }));
  const overtime = d.match.overtime;
  const lastMark = Math.max(0, ...rows.flatMap((r) => r.marks.map((x) => x.t)));
  const endT = c.endClock === null ? 0 : elapsed(c.endClock, regulation);
  const end = Math.max(regulation, lastMark, endT);
  return { regulation, end, overtime, ticks: ticks(regulation, end), scores, stop: stopOf(d.match.endKind, c.endClock, regulation), rows };
}

function ticks(regulation: number, end: number): Timeline["ticks"] {
  const out: Timeline["ticks"] = [];
  for (let left = regulation; left >= 0; left -= 60) out.push({ t: regulation - left, label: mmss(left) });
  for (let s = 60; regulation + s < end; s += 60) out.push({ t: regulation + s, label: `+${mmss(s)}` });
  return out;
}

function stopOf(endKind: MatchDetail["match"]["endKind"], endClock: Clock | null, regulation: number): TimelineStop | null {
  if (endClock === null || (endKind !== "early_end" && endKind !== "left")) return null;
  const label = endKind === "left" ? "You left" : `Forfeit · ${clockText(endClock)}`;
  return { t: elapsed(endClock, regulation), label, hatch: !endClock.overtime };
}

/**
 * The chart's read-out for screen readers, in time order: every mark (a goal before the moments at its
 * second), where overtime started, and where a forfeit or your leaving stopped play.
 */
export function readOut(tl: Timeline): string[] {
  // At one second: regulation's marks, overtime starting, then the overtime clock's goals, its moments and
  // the stop (a regulation goal at 0:00 shares overtime's start).
  const items = tl.rows.flatMap((r) => r.marks.map((m) => ({ t: m.t, rank: (m.overtime ? 3 : 0) + (m.kind === "goal" ? 0 : 1), text: m.title })));
  if (tl.overtime) items.push({ t: tl.regulation, rank: 2, text: "Overtime" });
  if (tl.stop !== null) items.push({ t: tl.stop.t, rank: 5, text: tl.stop.label });
  return items.sort((a, b) => a.t - b.t || a.rank - b.rank).map((x) => x.text);
}

const GRAPHEMES = new Intl.Segmenter();

/** A row name cut to `max` characters with an ellipsis, by grapheme, so an emoji is never split. */
export function shortName(name: string, max: number): string {
  // UTF-16 length is never under the grapheme count.
  if (name.length <= max) return name;
  const chars = Array.from(GRAPHEMES.segment(name), (g) => g.segment);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : name;
}

/**
 * The lane each item lands in, items given in x order and centred on x: the lowest lane whose last
 * item ends at least `gap` px before this one starts. Lanes are added as needed, so marks at the same
 * moment stack rather than overlap.
 */
export function pack(items: readonly { x: number; w: number }[], gap: number): { lanes: number[]; count: number } {
  const ends: number[] = [];
  const lanes = items.map(({ x, w }) => {
    const free = ends.findIndex((e) => x - w / 2 >= e + gap);
    const lane = free === -1 ? ends.length : free;
    ends[lane] = x + w / 2;
    return lane;
  });
  return { lanes, count: ends.length };
}

const COUNTED = [
  { stat: "shots", kinds: ["shot"], word: "shot" },
  { stat: "saves", kinds: ["save", "epic_save"], word: "save" },
  { stat: "assists", kinds: ["assist"], word: "assist" },
] as const satisfies readonly { stat: "shots" | "saves" | "assists"; kinds: readonly MomentKind[]; word: string }[];

/**
 * A note for each kind whose recorded moments don't add up to the scoreboard's total, or null when
 * all do. "Recorded" because a goal the game didn't count as a shot is drawn, yet isn't one of them.
 */
export function countNote(d: MatchDetail): string | null {
  const moments = d.moments;
  if (moments === null) return null;
  const notes = COUNTED.flatMap(({ stat, kinds, word }) => {
    const board = d.players.reduce((n, p) => n + p[stat], 0);
    const recorded = moments.filter((x) => (kinds as readonly MomentKind[]).includes(x.kind)).length;
    if (board === recorded) return [];
    return [`The scoreboard has ${plural(board, word)}; ${plural(recorded, word)} ${recorded === 1 ? "was" : "were"} recorded.`];
  });
  return notes.length === 0 ? null : notes.join(" ");
}

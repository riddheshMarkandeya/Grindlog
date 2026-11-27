// One pass over a match's deduped events into what happened in live play: hits, counted touches,
// shots, woodwork, goals and car samples, each attributed to a roster key. Every extra stat reads
// this view, so the live-window rule and the player resolution live in one place.
import { GOAL_LINE_Y } from "../../shared/constants";
import type { MomentKind } from "../../shared/schemas/responses";
import { isObject, type Data } from "./envelope";
import { playerKey, resolveTarget } from "./players";
import type { StoredEvent } from "./store";
import { num, players, readScore, str, teamOf, type MatchSummary, type TeamNum } from "./summary";

export interface Pos {
  x: number;
  y: number;
  z: number;
}

/**
 * A counted touch: where the ball was, and the toucher's team at that hit, so a mid-match switch
 * frames each touch right. A hitter resolves only with a matching team, so it is set in practice.
 */
export interface Touch extends Pos {
  team: TeamNum | null;
}

/** One BallHit in play. A 50/50 lists both players, and each is a hitter. */
export interface Hit {
  ts: number;
  /** `key` is null when the player isn't on the roster. */
  hitters: { key: string | null; team: TeamNum | null }[];
  /** `Players` has at least one entry, and every one is a player object on the roster. */
  known: boolean;
  speedKmh: number | null;
  pos: Pos | null;
}

/** A car's state from one UpdateState in play, weighted by the time until the next one. */
export interface CarSample {
  key: string;
  boost: number;
  supersonic: boolean;
  weightMs: number;
}

/** One goal, for the goal map. */
export interface GoalPoint {
  /** The team the scoreboard credited, which on an own goal isn't the scorer's. */
  teamNum: TeamNum;
  scorerKey: string;
  assisterKey: string | null;
  /** Whose touch the dot sits at: the scoring team's last touch. Null for an own goal. */
  toucherKey: string | null;
  /** The ball at that touch, raw field coordinates; null for an own goal. */
  pos: Pos | null;
  /** From that touch to the centre of the goal attacked. */
  distance: number | null;
  speedKmh: number | null;
  /** The other team touched the ball after the origin touch. */
  deflected: boolean;
  aerial: boolean;
  /**
   * The goal's team isn't its scorer's (they put it in their own net), or that team never touched
   * the ball since the kickoff; the latter is false when the kickoff came before the recording.
   */
  ownGoal: boolean;
  /**
   * The last ClockUpdatedSeconds reading before the goal, as read: time left in regulation, time
   * played in overtime. Null with no reading before it.
   */
  clock: Clock | null;
}

export interface Clock {
  seconds: number;
  overtime: boolean;
}

/** One Shot, Save, EpicSave or Assist statfeed, for the goal timeline. */
export interface MomentPoint {
  kind: MomentKind;
  key: string;
  /**
   * The last ClockUpdatedSeconds reading before it, as for a goal. Before the first reading it's the
   * regulation length when that reading is the start tick; joined in progress, with no regulation
   * length, or after a late first reading, null.
   */
  clock: Clock | null;
  /** A shot that became that goal (an index into `goals`); null otherwise. */
  goalIdx: number | null;
}

export const MOMENT_KINDS: ReadonlyMap<string, MomentKind> = new Map([
  ["Shot", "shot"],
  ["Save", "save"],
  ["EpicSave", "epic_save"],
  ["Assist", "assist"],
]);

export interface Play {
  goals: GoalPoint[];
  /** Every moment from the start until the first Win statfeed or MatchEnded, in order. */
  moments: MomentPoint[];
  /**
   * The last ClockUpdatedSeconds reading before the first Win statfeed, else the last at all (left,
   * orphaned); null with none. A forfeit resets the clock to 0 only after its Win, hence the cut there.
   */
  endClock: Clock | null;
  /** Counted touches by key, where the ball was: a player's hits merge as `TOUCH_MERGE_MS` says. */
  touches: Record<string, Touch[]>;
  /** The fastest shot by key, over each Shot statfeed's last touch and each goal's origin hit. */
  hardestShot: Record<string, number>;
  /** Woodwork hits by key (CrossbarHit fires for the posts too). */
  woodwork: Record<string, number>;
  samples: CarSample[];
  /** The largest regulation clock reading, up to a whole minute; null with none above 0. */
  regulationSeconds: number | null;
  facts: {
    /** Wall time spent in live play. */
    playMs: number;
    shotsWithoutTouch: number;
    /**
     * Goals whose BallLastTouch player isn't among the last hit's hitters. Only counted when both
     * sides are known: the last touch resolves, and the last hit is `known`, or there was no hit
     * since a seen kickoff.
     */
    lastTouchDisagrees: number;
    /** Goals whose scorer didn't resolve to a roster player with a team, so they have no point. */
    droppedGoals: number;
    /** Live goals with no ClockUpdatedSeconds reading before them, so their clock is null. */
    goalsWithoutClock: number;
    /** Goals whose stretch showed no single +1 scoreboard step, so their team is the scorer's. */
    goalsTeamFromScorer: number;
    /** ClockUpdatedSeconds readings whose bOvertime isn't a boolean; they're taken as regulation readings. */
    clockReadingsWithoutOvertimeFlag: number;
    /** Moments left with a null clock: no reading before them, and joined in progress, no regulation length or a late first reading. */
    momentsWithoutClock: number;
    /** A Win statfeed came before MatchEnded, resolved or not. */
    sawWin: boolean;
    /**
     * Player objects that matched no roster entry, by kind. A missing or non-object reference isn't
     * counted, except a hit's `Players` entry: the entry is a hitter who couldn't be identified.
     */
    unresolved: Record<RefKind, number>;
  };
}

/**
 * States are stored about 2/s; a longer gap (a dropped state, a stall) would otherwise give one
 * sample the whole stretch.
 */
export const CAR_SAMPLE_CAP_MS = 1000;

/**
 * The game sends a BallHit per contact, 1.2–1.8× its own touch count. A player's hit is a new
 * touch only after someone else touched the ball, or this long after their last counted one.
 */
export const TOUCH_MERGE_MS = 1000;

/** A ball rolling along the bar fires CrossbarHit repeatedly; one hit per this window. */
export const WOODWORK_WINDOW_MS = 1000;

type Phase = "countdown" | "play" | "replay" | "paused" | "ended";

interface Acc {
  phase: Phase;
  /** The phase a pause interrupted. */
  beforePause: Phase;
  /** When the current play stretch began; null outside play. */
  playStart: number | null;
  /** The last in-play state's samples, waiting for the next state to weigh them. */
  pending: { ts: number; samples: Omit<CarSample, "weightMs">[] } | null;
  roster: MatchSummary["roster"];
  /** Players of the latest state, for resolving a Shortcut at that moment. */
  latestPlayers: Data[];
  /** Hits since the last RoundStarted, where a goal's origin and a shot's touch are looked for. */
  sinceKickoff: Hit[];
  /** Joined in progress, the hits before the first RoundStarted are only those since the join. */
  sawKickoff: boolean;
  /** Each player's last counted touch, and whether someone else has hit since. */
  lastTouch: Map<string, { ts: number; otherSince: boolean }>;
  lastWoodworkTs: number | null;
  /** AerialGoal statfeeds by scorer key, waiting for their goal. */
  aerialPending: Map<string, number>;
  /** The last ClockUpdatedSeconds reading. A state's own TimeSeconds can tick in a different order, so it isn't used. */
  clock: Clock | null;
  /** The first ClockUpdatedSeconds reading, to tell a start tick from readings that went missing. */
  firstClock: Clock | null;
  /** `play.moments.length` at the last RoundStarted, where a goal's own shot is looked for. */
  kickoffMoment: number;
  /** The latest full scoreboard. */
  score: [number, number] | null;
  /** The scoreboard at the last kickoff, or the first one when joined in progress before any kickoff. */
  stretchStart: [number, number] | null;
  /**
   * The goal waiting for its team: the scoreboard steps up to 2 s either side of the GoalScored, so
   * the team is read when the stretch ends. It keeps what it read at the GoalScored.
   */
  pendingGoal: PendingGoal | null;
  play: Play;
}

interface PendingGoal {
  scorerTeam: TeamNum;
  scorerKey: string;
  assisterKey: string | null;
  speedKmh: number | null;
  aerial: boolean;
  /** The kickoff's hits array; only RoundStarted replaces it, and no hit is added after the goal. */
  hits: readonly Hit[];
  clock: Clock | null;
  sawKickoff: boolean;
}

export const REF_KINDS = ["hit", "shot", "woodwork", "lastTouch"] as const;
export type RefKind = (typeof REF_KINDS)[number];

const resolve = (acc: Acc, target: unknown) => resolveTarget(acc.latestPlayers, acc.roster, (target ?? {}) as Data);

/** Resolves a player reference, counting a player object that isn't on the roster under `kind`. */
function resolveRef(acc: Acc, ref: unknown, kind: RefKind): string | null {
  if (!isObject(ref)) return null;
  const k = resolve(acc, ref);
  if (k === null) acc.play.facts.unresolved[kind]++;
  return k;
}

function readPos(v: unknown): Pos | null {
  const loc = (v ?? {}) as Data;
  const [x, y, z] = [num(loc.X), num(loc.Y), num(loc.Z)];
  return x === null || y === null || z === null ? null : { x, y, z };
}

/** Closes the open sample stretch: its last state weighs 0. */
function endStretch(acc: Acc): void {
  acc.pending = null;
}

function setPhase(acc: Acc, phase: Phase, ts: number): void {
  if (acc.phase === "ended" || acc.phase === phase) return;
  // Max 0: the wall clock can step back mid-match.
  if (acc.phase === "play" && acc.playStart !== null) acc.play.facts.playMs += Math.max(0, ts - acc.playStart);
  if (acc.phase === "play") endStretch(acc);
  acc.playStart = phase === "play" ? ts : null;
  acc.phase = phase;
}

function sampleCars(acc: Acc, ts: number, inReplay: boolean): void {
  if (acc.phase !== "play" || inReplay) {
    endStretch(acc);
    return;
  }
  if (acc.pending) {
    const weightMs = Math.max(0, Math.min(ts - acc.pending.ts, CAR_SAMPLE_CAP_MS));
    for (const s of acc.pending.samples) acc.play.samples.push({ ...s, weightMs });
  }
  const samples = acc.latestPlayers
    .filter((p) => p.bHasCar === true)
    .map((p) => ({ key: playerKey(p), boost: num(p.Boost) ?? 0, supersonic: p.bSupersonic === true }));
  acc.pending = { ts, samples };
}

/** Counts a touch for each hitter it is new for. */
function countTouches(acc: Acc, h: Hit): void {
  const keys = new Set(h.hitters.map((p) => p.key));
  for (const k of keys) {
    if (k === null) continue;
    const last = acc.lastTouch.get(k);
    if (last && !last.otherSince && h.ts - last.ts < TOUCH_MERGE_MS) continue;
    acc.lastTouch.set(k, { ts: h.ts, otherSince: false });
    if (h.pos) (acc.play.touches[k] ??= []).push({ ...h.pos, team: h.hitters.find((p) => p.key === k)?.team ?? null });
  }
  for (const [k, last] of acc.lastTouch) if (!keys.has(k)) last.otherSince = true;
}

/** The last hit in `hits` with a hitter matching `is`, its index and that hitter. */
function lastHitBy(hits: readonly Hit[], is: (p: Hit["hitters"][number]) => boolean) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    const hitter = h?.hitters.find(is);
    if (h && hitter) return { index: i, hit: h, hitter };
  }
  return null;
}

function addShot(acc: Acc, k: string, speed: number | null): void {
  if (speed !== null) acc.play.hardestShot[k] = Math.max(speed, acc.play.hardestShot[k] ?? speed);
}

/** Team 0 attacks +Y, team 1 attacks −Y. */
const goalY = (team: TeamNum) => (team === 0 ? GOAL_LINE_Y : -GOAL_LINE_Y);

function addGoal(acc: Acc, g: PendingGoal, team: TeamNum): void {
  const { hits } = g;
  // Credited against the scorer's team, the scorer put it in their own net: the crediting team's
  // last hit isn't what scored it, so it has no point.
  const intoOwnNet = team !== g.scorerTeam;
  const origin = intoOwnNet ? null : lastHitBy(hits, (p) => p.team === team);
  // In a 50/50 origin the scorer is preferred among the scoring team's hitters.
  const toucher = origin ? (origin.hit.hitters.find((p) => p.key !== null && p.key === g.scorerKey) ?? origin.hitter) : null;
  const pos = origin?.hit.pos ?? null;
  if (origin && toucher?.key) addShot(acc, toucher.key, origin.hit.speedKmh);
  acc.play.goals.push({
    teamNum: team,
    scorerKey: g.scorerKey,
    assisterKey: g.assisterKey,
    toucherKey: toucher?.key ?? null,
    pos,
    distance: pos ? Math.hypot(pos.x, goalY(team) - pos.y) : null,
    speedKmh: g.speedKmh,
    deflected: origin ? hits.slice(origin.index + 1).some((h) => h.hitters.some((p) => p.team !== team)) : false,
    aerial: g.aerial,
    ownGoal: intoOwnNet || (origin === null && g.sawKickoff),
    clock: g.clock,
  });
}

/** The one team whose score rose by exactly 1 over the stretch while the other's held; else null. */
function scoreboardTeam(from: [number, number] | null, to: [number, number] | null): TeamNum | null {
  if (!from || !to) return null;
  const [d0, d1] = [to[0] - from[0], to[1] - from[1]];
  if (d0 === 1 && d1 === 0) return 0;
  if (d0 === 0 && d1 === 1) return 1;
  return null;
}

/** Credits the pending goal to the scoreboard's team, falling back to its scorer's (counted). */
function settleGoal(acc: Acc): void {
  const g = acc.pendingGoal;
  if (!g) return;
  acc.pendingGoal = null;
  let team = scoreboardTeam(acc.stretchStart, acc.score);
  if (team === null) {
    acc.play.facts.goalsTeamFromScorer++;
    team = g.scorerTeam;
  }
  addGoal(acc, g, team);
}

/**
 * The scorer's last unpaired shot since the kickoff becomes this goal's. Not a time window: a goal's
 * own shot can come over a minute before it, and some goals the game never counted as a shot.
 */
function pairShot(acc: Acc, scorerKey: string, goalIdx: number): void {
  const moments = acc.play.moments;
  for (let i = moments.length - 1; i >= acc.kickoffMoment; i--) {
    const m = moments[i];
    if (m?.kind === "shot" && m.key === scorerKey && m.goalIdx === null) {
      m.goalIdx = goalIdx;
      return;
    }
  }
}

function recordMoment(acc: Acc, name: string | null, target: unknown): void {
  // After a Win, statfeeds aren't moments, and the end clock is already set.
  if (acc.phase === "ended" || acc.play.facts.sawWin) return;
  if (name === "Win") {
    acc.play.facts.sawWin = true;
    acc.play.endClock = acc.clock;
    return;
  }
  const kind = name === null ? undefined : MOMENT_KINDS.get(name);
  if (kind === undefined) return;
  // An unresolved target is already counted by the summary's unresolvedStatfeed.
  const key = resolve(acc, target);
  if (key === null) return;
  acc.play.moments.push({ kind, key, clock: acc.clock, goalIdx: null });
}

/**
 * The game clock starts at the kickoff's first touch, and its first reading is often the tick after
 * that, so a kickoff shot can come before any reading. In a match seen from the start the clock then
 * showed the whole regulation length. Joined in progress, the first reading could be mid-match, and a
 * first reading more than 2 s short of the length means early readings went missing, so then such a
 * moment stays null and is counted.
 */
function clockBeforeFirstTick(play: Play, joinedInProgress: boolean, first: Clock | null): void {
  const reg = play.regulationSeconds;
  const fromStart = !joinedInProgress && reg !== null && first !== null && !first.overtime && first.seconds >= reg - 2;
  const start = fromStart ? { seconds: reg, overtime: false } : null;
  for (const m of play.moments) {
    if (m.clock !== null) continue;
    m.clock = start;
    if (start === null) play.facts.momentsWithoutClock++;
  }
}

type Handler = (acc: Acc, ev: StoredEvent) => void;

const HANDLERS: Readonly<Record<string, Handler>> = {
  CountdownBegin: (acc, ev) => {
    setPhase(acc, "countdown", ev.ts);
  },
  RoundStarted: (acc, ev) => {
    // Settle before resetting the baseline, so the goal is read against its own stretch.
    settleGoal(acc);
    acc.stretchStart = acc.score;
    setPhase(acc, "play", ev.ts);
    acc.sinceKickoff = [];
    acc.kickoffMoment = acc.play.moments.length;
    acc.sawKickoff = true;
    acc.aerialPending.clear();
  },
  // Dedup has already dropped the replay's copy, so this is the live goal.
  GoalScored: (acc, ev) => {
    if (acc.phase === "ended") return;
    // With no kickoff since the last goal, the baseline stays put: this one's stretch shows two
    // rises and falls back, flagged, and so does the last one if this goal's step came first.
    settleGoal(acc);
    setPhase(acc, "replay", ev.ts);
    const scorer = (ev.data.Scorer ?? {}) as Data;
    const lastTouchKey = resolveRef(acc, ((ev.data.BallLastTouch ?? {}) as Data).Player, "lastTouch");
    const last = acc.sinceKickoff.at(-1);
    const comparable = lastTouchKey !== null && (last ? last.known : acc.sawKickoff);
    if (comparable && !last?.hitters.some((p) => p.key === lastTouchKey)) acc.play.facts.lastTouchDisagrees++;
    const scorerKey = resolve(acc, scorer);
    const team = teamOf(scorer.TeamNum);
    if (scorerKey === null || team === null) {
      acc.play.facts.droppedGoals++;
      return;
    }
    const aerials = acc.aerialPending.get(scorerKey) ?? 0;
    if (aerials > 0) acc.aerialPending.set(scorerKey, aerials - 1);
    if (acc.clock === null) acc.play.facts.goalsWithoutClock++;
    acc.pendingGoal = {
      scorerTeam: team,
      scorerKey,
      assisterKey: resolve(acc, ev.data.Assister),
      speedKmh: num(ev.data.GoalSpeed),
      aerial: aerials > 0,
      hits: acc.sinceKickoff,
      clock: acc.clock,
      sawKickoff: acc.sawKickoff,
    };
    // Any goal before it is settled, so this one's index is the next.
    pairShot(acc, scorerKey, acc.play.goals.length);
  },
  MatchPaused: (acc, ev) => {
    if (acc.phase === "paused" || acc.phase === "ended") return;
    acc.beforePause = acc.phase;
    setPhase(acc, "paused", ev.ts);
  },
  MatchUnpaused: (acc, ev) => {
    if (acc.phase === "paused") setPhase(acc, acc.beforePause, ev.ts);
  },
  MatchEnded: (acc, ev) => {
    // The states after it may be retagged from the next match, so their scoreboards aren't read.
    settleGoal(acc);
    setPhase(acc, "ended", ev.ts);
  },
  ClockUpdatedSeconds: (acc, ev) => {
    const seconds = num(ev.data.TimeSeconds);
    // As with UpdateState: the podium and teardown readings may be retagged with the next match's guid.
    if (acc.phase === "ended" || seconds === null) return;
    if (typeof ev.data.bOvertime !== "boolean") acc.play.facts.clockReadingsWithoutOvertimeFlag++;
    const overtime = ev.data.bOvertime === true;
    acc.clock = { seconds, overtime };
    acc.firstClock ??= acc.clock;
    // A reading of 0 is the end-of-match reset; on its own (joined at the very end) it gives no length.
    if (!overtime && seconds > 0) acc.play.regulationSeconds = Math.max(Math.ceil(seconds / 60) * 60, acc.play.regulationSeconds ?? 0);
  },
  UpdateState: (acc, ev) => {
    // The podium and teardown states may be retagged with the next match's guid.
    if (acc.phase === "ended") return;
    acc.latestPlayers = players(ev.data);
    const game = (ev.data.Game ?? {}) as Data;
    const score = readScore(game);
    if (score) {
      acc.score = score;
      // Joined in progress, before the first kickoff the first scoreboard is the baseline.
      acc.stretchStart ??= score;
    }
    sampleCars(acc, ev.ts, game.bReplay === true);
  },
  BallHit: (acc, ev) => {
    if (acc.phase !== "play") return;
    const ball = (ev.data.Ball ?? {}) as Data;
    const entries: unknown[] = Array.isArray(ev.data.Players) ? ev.data.Players : [];
    const hitters = entries.filter(isObject).map((p) => ({ key: resolveRef(acc, p, "hit"), team: teamOf(p.TeamNum) }));
    const malformed = entries.length - hitters.length;
    acc.play.facts.unresolved.hit += malformed;
    const h: Hit = {
      ts: ev.ts,
      hitters,
      known: hitters.length > 0 && malformed === 0 && hitters.every((p) => p.key !== null),
      speedKmh: num(ball.PostHitSpeed),
      pos: readPos(ball.Location),
    };
    acc.sinceKickoff.push(h);
    countTouches(acc, h);
  },
  StatfeedEvent: (acc, ev) => {
    const name = str(ev.data.EventName);
    recordMoment(acc, name, ev.data.MainTarget);
    if (acc.phase !== "play" || (name !== "Shot" && name !== "AerialGoal")) return;
    if (name === "AerialGoal") {
      const k = resolve(acc, ev.data.MainTarget);
      // It comes just before its GoalScored; the goal consumes it.
      if (k !== null) acc.aerialPending.set(k, (acc.aerialPending.get(k) ?? 0) + 1);
      return;
    }
    const k = resolveRef(acc, ev.data.MainTarget, "shot");
    if (k === null) return;
    const last = lastHitBy(acc.sinceKickoff, (p) => p.key === k);
    if (last) addShot(acc, k, last.hit.speedKmh);
    else acc.play.facts.shotsWithoutTouch++;
  },
  CrossbarHit: (acc, ev) => {
    if (acc.phase !== "play") return;
    if (acc.lastWoodworkTs !== null && ev.ts - acc.lastWoodworkTs < WOODWORK_WINDOW_MS) return;
    acc.lastWoodworkTs = ev.ts;
    const k = resolveRef(acc, ((ev.data.BallLastTouch ?? {}) as Data).Player, "woodwork");
    if (k !== null) acc.play.woodwork[k] = (acc.play.woodwork[k] ?? 0) + 1;
  },
};

export function emptyPlay(): Play {
  return { goals: [], moments: [], endClock: null, touches: {}, hardestShot: {}, woodwork: {}, samples: [], regulationSeconds: null, facts: emptyFacts() };
}

export function emptyFacts(): Play["facts"] {
  return { playMs: 0, shotsWithoutTouch: 0, lastTouchDisagrees: 0, droppedGoals: 0, goalsWithoutClock: 0, goalsTeamFromScorer: 0, clockReadingsWithoutOvertimeFlag: 0, momentsWithoutClock: 0, sawWin: false, unresolved: { hit: 0, shot: 0, woodwork: 0, lastTouch: 0 } };
}

/** `events` are one match's events, deduped, in seq order. */
export function buildPlay(events: readonly StoredEvent[], summary: Pick<MatchSummary, "roster" | "joinedInProgress">): Play {
  const start: Phase = summary.joinedInProgress ? "play" : "countdown";
  const acc: Acc = {
    phase: start,
    beforePause: start,
    playStart: start === "play" ? (events[0]?.ts ?? 0) : null,
    pending: null,
    roster: summary.roster,
    latestPlayers: [],
    sinceKickoff: [],
    sawKickoff: !summary.joinedInProgress,
    lastTouch: new Map(),
    lastWoodworkTs: null,
    aerialPending: new Map(),
    clock: null,
    firstClock: null,
    kickoffMoment: 0,
    score: null,
    stretchStart: null,
    pendingGoal: null,
    play: emptyPlay(),
  };
  for (const ev of events) HANDLERS[ev.name]?.(acc, ev);
  // Left or orphaned: the last goal's stretch runs to the end of the events.
  settleGoal(acc);
  // A match closed mid-play (left, orphaned) still counts its last stretch.
  setPhase(acc, "ended", events.at(-1)?.ts ?? 0);
  if (!acc.play.facts.sawWin) acc.play.endClock = acc.clock;
  clockBeforeFirstTick(acc.play, summary.joinedInProgress, acc.firstClock);
  return acc.play;
}

// The Trends Tilt section's text and marks: the verdict sentence, each column's label, % and count,
// its tone (grey within chance, red or green past it), stripes and outline, the legend rows the chart
// needs, and the note. The counts come from the server; the maths is shared (shared/tilt.ts).
import type { TiltView } from "../../shared/schemas/responses";
import { FIRM_N, MIN_N, TILT_Z, tiltBuckets, tiltVerdict, type BucketKey, type TiltBucket, type TiltState, type TiltVerdict } from "../../shared/tilt";
import { pctText, plural, whole } from "./format";
import { pct } from "./recap";

const AXIS: Record<BucketKey, string> = { g1: "1–3", g4: "4–6", g7: "7–9", g10: "10+", w: "a win", l1: "1 loss", l2: "2 losses", l3: "3+ losses" };
const PHRASE: Record<BucketKey, string> = {
  g1: "in games 1–3",
  g4: "in games 4–6",
  g7: "in games 7–9",
  g10: "in game 10+",
  w: "after a win",
  l1: "after 1 loss",
  l2: "after 2 losses",
  l3: "after 3+ losses",
};

export const TILT_NOTE = "Win % can't see all tilt: ranked matchmaking gives you easier opponents after losses, and the games you'd have played tilted aren't here if you stopped instead.";

type Tone = "below" | "above" | "neutral";

export interface TiltColumn {
  key: BucketKey;
  label: string;
  /** Bar height, and the whisker's ends; all 0–1. */
  rate: number;
  lo: number;
  hi: number;
  n: number;
  pct: string;
  count: string;
  srLabel: string;
  tone: Tone;
  /** Under FIRM_N matches: striped. */
  thin: boolean;
  /** The dip a "You drop" verdict names: outlined. */
  outlined: boolean;
  /** The bucket the verdict names, whatever the state: bold label. */
  named: boolean;
}

export type LegendKey = "avg" | "range" | "thin" | "below" | "above" | "neutral" | "focus";

export interface TiltDisplay {
  verdict: { state: TiltState; text: string };
  games: TiltColumn[];
  streaks: TiltColumn[];
  /** The average win rate, 0–1, for the dashed line. */
  avg: number;
  legend: { key: LegendKey; text: string }[];
  note: string;
}

const pctOf = (x: number) => pctText(pct(x));
const matches = (n: number) => plural(n, "match", "matches");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Coloured only past chance, and never under MIN_N. */
function toneOf(b: TiltBucket): Tone {
  if (b.n < MIN_N) return "neutral";
  return b.z <= -TILT_Z ? "below" : b.z >= TILT_Z ? "above" : "neutral";
}

function verdictText(v: TiltVerdict, n: number, w: number): string {
  if (v.state === "nosign") return `No clear sign of tilt across ${whole(n)} matches (${pctOf(w / n)} won).`;
  const b = v.bucket;
  if (v.state === "few") return `Too few matches to tell yet: ${whole(n)} in all, ${whole(b.n)} ${PHRASE[b.key]}.`;
  if (v.state === "tilt") return `You drop ${PHRASE[b.key]}: ${pctOf(b.rate)} against ${pctOf(b.restRate)} in your other matches (${matches(b.n)}).`;
  return `No sign of tilt so far, but only ${matches(b.n)} ${PHRASE[b.key]}.`;
}

export function tiltDisplay(t: TiltView): TiltDisplay {
  const b = tiltBuckets(t);
  const v = tiltVerdict(b);
  const column = (x: TiltBucket): TiltColumn => ({
    key: x.key,
    label: AXIS[x.key],
    rate: x.rate,
    lo: x.lo,
    hi: x.hi,
    n: x.n,
    pct: x.n ? pctOf(x.rate) : "–",
    count: matches(x.n),
    srLabel: x.n ? `${capital(PHRASE[x.key])}: ${pctOf(x.rate)} won, ${whole(x.w)} of ${matches(x.n)}` : `${capital(PHRASE[x.key])}: no matches`,
    tone: toneOf(x),
    thin: x.n < FIRM_N,
    outlined: v.state === "tilt" && v.bucket.key === x.key,
    named: v.state !== "nosign" && v.bucket.key === x.key,
  });
  const games = b.games.map(column);
  const streaks = b.streaks.map(column);
  const all = [...games, ...streaks];
  const avg = b.n ? b.w / b.n : 0;
  const legend: TiltDisplay["legend"] = [
    { key: "avg", text: `your ${pctOf(avg)} average` },
    { key: "range", text: "where your real win % likely is; a tall one means few matches" },
  ];
  if (all.some((c) => c.n > 0 && c.thin)) legend.push({ key: "thin", text: `under ${String(FIRM_N)} matches, too few to be sure` });
  if (all.some((c) => c.tone === "below")) legend.push({ key: "below", text: "clearly below your other matches" });
  if (all.some((c) => c.tone === "above")) legend.push({ key: "above", text: "clearly above your other matches" });
  if (all.some((c) => c.n > 0 && c.tone === "neutral")) legend.push({ key: "neutral", text: "within chance of your other matches" });
  if (v.state === "tilt") legend.push({ key: "focus", text: "the drop the verdict names" });
  return {
    verdict: { state: v.state, text: verdictText(v, b.n, b.w) },
    games,
    streaks,
    avg,
    legend,
    note: t.sessions ? `You ended ${whole(t.endedOnLoss)} of ${whole(t.sessions)} sessions on a loss. ${TILT_NOTE}` : TILT_NOTE,
  };
}

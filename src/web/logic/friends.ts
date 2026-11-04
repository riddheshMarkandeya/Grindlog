// The Friends pages' display logic: the head-to-head pager, the team size × Online/Private switch
// over the modes a friend has, carry bars, records as text, and the words that change between one
// friend's page and a pair's.
import type { FriendDetail } from "../../shared/schemas/responses";
import { sum } from "../../shared/aggregate";
import { decimal, whole } from "./format";
import { pct } from "./recap";

export type Mode = NonNullable<FriendDetail["view"]["with"]["defaultMode"]>;
type Size = "2" | "3" | "4";
type Kind = "online" | "private";

export const PAGE_SIZE = 10;

/** One page of rows, the page clamped to those there are (at least one, if empty). */
export function pageOf<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(page, 0), pages - 1);
  return { rows: rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), page: p, pages };
}

export const sizeOf = (m: Mode): Size => (m.startsWith("p") ? m.slice(1) : m) as Size;
const kindOf = (m: Mode): Kind => (m.startsWith("p") ? "private" : "online");
const modeAt = (size: Size, kind: Kind): Mode => (kind === "private" ? `p${size}` : size) as Mode;

/** The picked mode if the friend has it, else their default. */
export function pickMode<D extends Mode | null>(modes: readonly Mode[], defaultMode: D, picked: Mode | null): Mode | D {
  return picked !== null && modes.includes(picked) ? picked : defaultMode;
}

/** Sizes are every size played, so none is a dead end; a kind is enabled only where played at the current size. */
export function modeSwitch(modes: readonly Mode[], current: Mode) {
  const sizes = [...new Set(modes.map(sizeOf))].sort();
  return {
    sizes: sizes.map((size) => ({ size, pressed: size === sizeOf(current) })),
    kinds: (["online", "private"] as const).map((kind) => ({ kind, pressed: kind === kindOf(current), enabled: modes.includes(modeAt(sizeOf(current), kind)) })),
  };
}

/** The size at the current kind if played, else at the other. */
export function pickSize(modes: readonly Mode[], current: Mode, size: Size): Mode {
  const same = modeAt(size, kindOf(current));
  return modes.includes(same) ? same : modeAt(size, kindOf(current) === "online" ? "private" : "online");
}

/** The kind at the current size; unchanged when not played there (its button is disabled). */
export function pickKind(modes: readonly Mode[], current: Mode, kind: Kind): Mode {
  const next = modeAt(sizeOf(current), kind);
  return modes.includes(next) ? next : current;
}

/** [you, ...friends, rest] as whole percents of the team's total, and the even share at that team size. */
export function carryShares(shares: readonly number[], mode: Mode): { pcts: number[]; even: number } | null {
  const total = sum(shares);
  if (total === 0) return null;
  return { pcts: shares.map((s) => pct(s / total)), even: 100 / Number(sizeOf(mode)) };
}

// By team size: with one teammate left over, they're the last one on the team.
const LAST = { "2": "2nd", "3": "3rd", "4": "4th" } as const;
/** The grey end's label when more than one teammate can be in it. */
export const OTHERS = "Others";

/** The legend label for the grey end of a carry bar with `friends` friends on your team; null when no one can be in it. */
export function carryRest(mode: Mode, friends: number): string | null {
  const size = sizeOf(mode);
  const others = Number(size) - friends - 1;
  if (others <= 0) return null;
  return others > 1 ? OTHERS : `${LAST[size]} teammate`;
}

/** The words a friend page uses, for one friend or for a pair ("A and B", "all three"). */
export function sideCopy(names: readonly string[]) {
  const one = names.length === 1;
  const who = names.join(" and ");
  return {
    who,
    title: names.join(" + "),
    withHeading: one ? "On your team" : "Both on your team",
    againstHeading: one ? "On the other team" : "Both on the other team",
    againstLabel: one ? "head-to-head" : "against both",
    withNote: one ? "together" : "all three",
    againstNote: one ? "against them" : "against both",
    versus: ["you", ...names].join(" – "),
    withEmpty: one ? `You haven't teamed up with ${who} yet.` : `You haven't had ${who} on your team together yet.`,
    againstEmpty: one ? `You haven't played against ${who} yet.` : `You haven't played against ${who} on the same team yet.`,
    withColumn: one ? `With ${who}` : "With both",
    together: one ? "together" : "with both",
    anyOfYou: one ? "either" : "any",
    theirColumns: one ? "Their column is their scoreboard only." : "Their columns are their scoreboard only.",
    /** What the Compare table weighs, for `label` matches (e.g. "3v3"): `w` with, `wo` without. */
    compareNote: (label: string, w: number, wo: number) =>
      one
        ? `Your ${label} matches with them (${whole(w)}) against your other ${label} matches (${whole(wo)}), including ones where they were an opponent.`
        : `Your ${label} matches with both on your team (${whole(w)}) against your ${label} matches where neither was (${whole(wo)}).`,
  };
}
export type SideCopy = ReturnType<typeof sideCopy>;

export const recordText = ({ w, l }: { w: number; l: number }): string => `${whole(w)}–${whole(l)}`;

export const winPctText = ({ w, l }: { w: number; l: number }): string => (w + l === 0 ? "–" : `${String(pct(w / (w + l)))}%`);

/** "50% of 4": the count is the decided matches the % is taken over, not every overtime match. */
export const overtimeNote = (ot: { w: number; l: number }): string => `${winPctText(ot)} of ${whole(ot.w + ot.l)}`;

/**
 * A with-minus-without difference: whole points for win %, decimal()'s steps for a stat. The sign and
 * direction come from the rounded text, so a tiny difference reads a muted "0", never a green "+0".
 */
export function diffText(d: number, points = false): { text: string; dir: -1 | 0 | 1 } {
  const text = points ? whole(Math.abs(d)) : decimal(Math.abs(d));
  if (text === "0") return { text, dir: 0 };
  return d > 0 ? { text: `+${text}`, dir: 1 } : { text: `−${text}`, dir: -1 };
}

/**
 * Each pair with both friends' names. Pairs and friends come in one answer, so a missing name is a
 * server bug: logged, and the pair skipped. Used as a query `select`, so it runs once per answer.
 */
export function namedPairs<P extends { ids: readonly string[] }>(data: { friends: readonly { id: string; name: string }[]; pairs: readonly P[] }) {
  const names = new Map(data.friends.map((f) => [f.id, f.name]));
  return data.pairs.flatMap((pair) => {
    const [a, b] = pair.ids.map((id) => names.get(id));
    if (a !== undefined && b !== undefined) return [{ pair, a, b }];
    console.warn("[rlt] friends/pair_unnamed", { ids: pair.ids });
    return [];
  });
}

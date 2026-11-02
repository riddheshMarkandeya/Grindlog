// The Friends page's display logic: the head-to-head pager, the team size × Online/Private switch
// over the modes a friend has, carry bars, and records as text.
import type { FriendDetail } from "../../shared/schemas/responses";
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

/** [you, them, rest] as whole percents of the team's total, and the even share at that team size. */
export function carryShares(shares: readonly [number, number, number], mode: Mode): { pcts: [number, number, number]; even: number } | null {
  const total = shares[0] + shares[1] + shares[2];
  if (total === 0) return null;
  return { pcts: [pct(shares[0] / total), pct(shares[1] / total), pct(shares[2] / total)], even: 100 / Number(sizeOf(mode)) };
}

export const recordText = ({ w, l }: { w: number; l: number }): string => `${String(w)}–${String(l)}`;

export const winPctText = ({ w, l }: { w: number; l: number }): string => (w + l === 0 ? "–" : `${String(pct(w / (w + l)))}%`);

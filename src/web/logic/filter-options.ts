// The playlist dropdown, the same on Recap and Trends: only what was played, no counts. The
// filter lives in the query string as its API value.
import { playlistInfo, type PlaylistGroup } from "../../shared/playlists";
import { filterValue, GROUPS, type PlaylistFilter } from "../../shared/playlist-filter";
import { filterParam, teammateParam } from "../../shared/schemas/params";
import { pairKey, type TeammateFilter } from "../../shared/teammate-filter";

export interface FilterOption {
  value: string;
  label: string;
}
export interface FilterGroup {
  /** The optgroup's label; null for the top entry. */
  label: string | null;
  options: FilterOption[];
}

/** The filter a query value names; left out is the fallback (the page's default), a bad value is the fallback and `bad`. */
export function parseFilter(value: string | null, fallback: PlaylistFilter = "everything"): { filter: PlaylistFilter; bad: boolean } {
  if (value === null) return { filter: fallback, bad: false };
  const parsed = filterParam.safeParse(value);
  return parsed.success ? { filter: parsed.data, bad: false } : { filter: fallback, bad: true };
}

/** The teammate filter `?with=` names; left out is anyone, a bad value is anyone and `bad`. */
export function parseTeammate(value: string | null): { teammate: TeammateFilter; bad: boolean } {
  if (value === null) return { teammate: "anyone", bad: false };
  const parsed = teammateParam.safeParse(value);
  return parsed.success ? { teammate: parsed.data, bad: false } : { teammate: "anyone", bad: true };
}

/** The friends a "with teammate" filter can name: those on your team in at least one match. */
export const offeredFriends = <F extends { with: { n: number } }>(friends: readonly F[]): F[] => friends.filter((f) => f.with.n > 0);

/** Whether the filter names a friend not offered, so it resets to Anyone. Soloqueue always fits. */
export function teammateMissing(value: TeammateFilter, offered: readonly { id: string }[]): boolean {
  if (value === "anyone" || value === "solo") return false;
  return !value.friends.every((id) => offered.some((f) => f.id === id));
}

/**
 * Why a session's recap resets its teammate filter to Anyone, or null to keep it. `friendsPresent`
 * is the union over the session, so a pair who each played but never together passes the missing
 * check yet lists no match: no summary under the filters.
 */
export function recapReset(value: TeammateFilter, session: { friendsPresent: readonly { id: string }[]; summary: object | null }): "not_in_session" | "not_together" | null {
  if (teammateMissing(value, session.friendsPresent)) return "not_in_session";
  return typeof value === "object" && value.friends.length > 1 && session.summary === null ? "not_together" : null;
}

const ticked = (value: TeammateFilter): readonly string[] => (typeof value === "object" ? value.friends : []);

/** The filter after ticking or unticking a friend in the With list: up to two friends, a pair in key order; the last untick is Anyone, a third tick changes nothing. */
export function toggleFriend(value: TeammateFilter, id: string): TeammateFilter {
  const t = ticked(value);
  if (t.includes(id)) {
    const rest = t.filter((x) => x !== id);
    return rest.length === 0 ? "anyone" : { friends: rest };
  }
  const [only, second] = t;
  if (only === undefined) return { friends: [id] };
  return second === undefined ? { friends: pairKey(only, id) } : value;
}

/** Whether two friends were on your team together, as far as a page can tell. */
export type Together = (a: string, b: string) => boolean;

export interface FriendChoice {
  id: string;
  name: string;
  disabled: boolean;
  /** Why it's greyed, shown under the name; null when it can be ticked. */
  reason: string | null;
}

/**
 * The friends in the With list, ticked or greyed. A third friend is greyed once two are ticked; with
 * one ticked, a friend never on your team alongside them is. A ticked friend never is, so it can be
 * unticked. Trends' pairs are thresholded, so its wording doesn't claim "never".
 */
export function friendChoices(value: TeammateFilter, friends: readonly { id: string; name: string }[], together: Together, page: "trends" | "recap"): FriendChoice[] {
  const t = ticked(value);
  const one = t.length === 1 ? t[0] : undefined;
  const first = one === undefined ? null : { id: one, name: friends.find((f) => f.id === one)?.name ?? "them" };
  return friends.map(({ id, name }) => {
    const checked = t.includes(id);
    let reason: string | null = null;
    if (!checked && t.length >= 2) reason = "Two friends at most";
    else if (!checked && first !== null && !together(first.id, id)) {
      reason = page === "trends" ? `Not enough matches with ${first.name} on your team` : `Not on your team with ${first.name} this session`;
    }
    return { id, name, disabled: reason !== null, reason };
  });
}

/** Trends: together when the Friends page lists the pair. While the pairs load (undefined), nobody is ruled out. */
export function pairsTogether(named: readonly { pair: { ids: readonly string[] } }[] | undefined): Together {
  if (named === undefined) return () => true;
  // A pair's ids come in key order, so one string per pair.
  const pairs = new Set(named.map((n) => n.pair.ids.join(",")));
  return (a, b) => pairs.has(pairKey(a, b).join(","));
}

/** Recap: together when one of the shown matches had both on your team. While they're the previous
 *  With's (undefined: placeholder data), nobody is ruled out. */
export function togetherInMatches(matches: readonly { friends: readonly string[] }[] | undefined): Together {
  if (matches === undefined) return () => true;
  return (a, b) => matches.some((m) => m.friends.includes(a) && m.friends.includes(b));
}

/** The closed With button's text. A friend not offered is left out: the filter is about to reset to Anyone. */
export function teammateLabel(value: TeammateFilter, friends: readonly { id: string; name: string }[]): string {
  if (value === "anyone") return "Anyone";
  if (value === "solo") return "Soloqueue";
  const names = value.friends.flatMap((id) => friends.find((f) => f.id === id)?.name ?? []);
  return names.length === 0 ? "Anyone" : names.join(" + ");
}

// Each group's playlists are listed singly under its "All" entry. Private is one entry (its ids are
// friends' lobbies and external matches); Other holds the ids no group filter covers.
type Has = (group: PlaylistGroup | null) => boolean;
const inGroup = (f: keyof typeof GROUPS): Has => (g) => g !== null && GROUPS[f].includes(g);
const covered: Has = (g) => g !== null && Object.values(GROUPS).some((groups) => groups.includes(g));
const SECTIONS: readonly { label: string; all: FilterOption | null; has: Has; singly: boolean }[] = [
  { label: "Ranked", all: { value: "ranked", label: "All ranked" }, has: inGroup("ranked"), singly: true },
  { label: "Casual", all: { value: "casual", label: "All casual" }, has: inGroup("casual"), singly: true },
  { label: "Extra modes", all: { value: "extra", label: "All extra modes" }, has: inGroup("extra"), singly: true },
  { label: "Private", all: { value: "private", label: "Private matches" }, has: inGroup("private"), singly: false },
  { label: "Other", all: null, has: (g) => !covered(g), singly: true },
];

const EVERYTHING: FilterOption = { value: "everything", label: "Everything (excl. private)" };

/** A filter's name where no dropdown is beside it to explain it. */
export function filterLabel(filter: PlaylistFilter): string {
  if (typeof filter === "object") return playlistInfo(filter.playlist).name;
  if (filter === "everything") return EVERYTHING.label;
  return SECTIONS.find((s) => s.all?.value === filter)?.all?.label ?? filter;
}

export function filterOptions(present: readonly number[], selected: PlaylistFilter): FilterGroup[] {
  const ids = [...present].sort((a, b) => a - b);
  const groups: FilterGroup[] = [{ label: null, options: [EVERYTHING] }];
  for (const s of SECTIONS) {
    const mine = ids.filter((id) => s.has(playlistInfo(id).group));
    if (!mine.length) continue;
    const singles = s.singly ? mine.map((id) => ({ value: String(id), label: playlistInfo(id).name })) : [];
    groups.push({ label: s.label, options: [...(s.all ? [s.all] : []), ...singles] });
  }
  const value = filterValue(selected);
  if (!groups.some((g) => g.options.some((o) => o.value === value))) {
    const label = filterLabel(selected);
    const other = groups.find((g) => g.label === "Other");
    if (other) other.options.push({ value, label });
    else groups.push({ label: "Other", options: [{ value, label }] });
  }
  return groups;
}

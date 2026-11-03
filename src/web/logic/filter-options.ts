// The playlist dropdown, the same on Recap and Trends: only what was played, no counts. The
// filter lives in the query string as its API value.
import { playlistInfo, type PlaylistGroup } from "../../shared/playlists";
import { filterValue, GROUPS, type PlaylistFilter } from "../../shared/playlist-filter";
import { filterParam, teammateParam } from "../../shared/schemas/params";
import { teammateValue, type TeammateFilter } from "../../shared/teammate-filter";

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

/**
 * The dropdown's "A + B" entry when the filter names a pair (only a pair page links there), so the
 * select can show it; null otherwise, or when either isn't offered (the filter then resets).
 */
export function pairOption(value: TeammateFilter, friends: readonly { id: string; name: string }[]): FilterOption | null {
  if (typeof value !== "object" || value.friends.length !== 2) return null;
  const names = value.friends.map((id) => friends.find((f) => f.id === id)?.name);
  if (names.some((n) => n === undefined)) return null;
  return { value: teammateValue(value) ?? "", label: names.join(" + ") };
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

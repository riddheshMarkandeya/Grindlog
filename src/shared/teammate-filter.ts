// The "with teammate" filter, independent of the playlist filter. "With" a friend means the friend
// was on your team at some point in the match; "solo" means no added friend was (a friend on the
// other team doesn't count). The friends form takes a list: one friend, or a pair (every one of
// them on your team).
export type TeammateFilter = "anyone" | "solo" | { friends: readonly string[] };

/** A pair's two ids sorted, so a pair has one key, one URL and one order for its per-friend arrays. */
export const pairKey = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** Whether a match passes, given the friends who were on your team in it. */
export function withTeammate(matchFriends: readonly string[], f: TeammateFilter): boolean {
  if (f === "anyone") return true;
  if (f === "solo") return matchFriends.length === 0;
  return f.friends.every((id) => matchFriends.includes(id));
}

/** The `with` query-string value: null for anyone (left out), else `solo` or the friends' PrimaryIds joined with ",". */
export function teammateValue(f: TeammateFilter): string | null {
  if (f === "anyone") return null;
  if (f === "solo") return "solo";
  return f.friends.join(",");
}

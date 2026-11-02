// The "with teammate" filter, independent of the playlist filter. "With" a friend means the friend
// was on your team at some point in the match; "solo" means no added friend was (a friend on the
// other team doesn't count). The friends form takes a list, ready for trio stats; the pages only
// ever send one id.
export type TeammateFilter = "anyone" | "solo" | { friends: readonly string[] };

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

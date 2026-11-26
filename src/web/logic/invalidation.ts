// A new match or a session break makes everything stale except settings, so a query key added
// later is refreshed without anyone listing it. A table save or an account switch also spares the
// two tables.

import type { Query, QueryClient } from "@tanstack/react-query";

export interface CachedQuery {
  queryKey: readonly unknown[];
}

/** The predicate for `invalidateFresh` after a match or a session break. Neither changes settings. */
export const staleAfterLive = ({ queryKey: [kind] }: CachedQuery): boolean => kind !== "settings";

/**
 * The predicate for `invalidateFresh` after a You, Seasons or Friends save, or an account switch in
 * the header. Each can move every stat or period (friends are joined at read time, so any page's
 * filter can change; the account narrows every match read), so it's coarse (the app is local).
 * Settings and the two tables are spared: neither table depends on the other, on friends or on the
 * account, and a table's save put its own answer in the cache.
 */
export const staleAfterTables = ({ queryKey: [kind] }: CachedQuery): boolean => kind !== "settings" && kind !== "ids" && kind !== "seasons";

/**
 * `invalidateQueries`, except that a query still on its first fetch is cancelled first: invalidating
 * would join that fetch and keep its answer, read before whatever made the cache stale.
 */
export async function invalidateFresh(client: QueryClient, predicate?: (query: Query) => boolean): Promise<void> {
  const first = client.getQueryCache().findAll({
    predicate: (q) => q.state.data === undefined && q.state.fetchStatus === "fetching" && (predicate?.(q) ?? true),
  });
  if (first.length > 0) {
    console.info("[grindlog] cache/first_fetch_cancelled", { keys: first.map((q) => q.queryKey) });
    await Promise.all(first.map((q) => q.cancel({ revert: true })));
  }
  await client.invalidateQueries(predicate ? { predicate } : {});
}

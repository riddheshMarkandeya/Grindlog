// Which account the dashboard shows, from the saved `account` setting and your ids. One rule for the
// server (it scopes the reader) and the header picker (it shows the value), so the two can't disagree.
import { ALL_ACCOUNTS } from "./schemas/settings";

/** Why a saved account isn't used: it isn't a confirmed id, or there aren't 2 confirmed ids to choose between. */
export type AccountFallback = "not_confirmed" | "too_few";

/** The fewest confirmed ids that make picking one worthwhile. */
export const MIN_ACCOUNTS = 2;

/** The ids that can be picked: confirmed ones only; pending guesses still count under every account. */
export const confirmedIds = <T extends { status: string }>(ids: readonly T[]): T[] => ids.filter((i) => i.status === "confirmed");

/** The picked id, or null for every account; `fallback` says why a saved id wasn't used. */
export function resolveAccount(
  ids: readonly { primaryId: string; status: string }[],
  saved: string,
): { account: string | null; fallback: AccountFallback | null } {
  if (saved === ALL_ACCOUNTS) return { account: null, fallback: null };
  const confirmed = confirmedIds(ids).map((i) => i.primaryId);
  if (!confirmed.includes(saved)) return { account: null, fallback: "not_confirmed" };
  if (confirmed.length < MIN_ACCOUNTS) return { account: null, fallback: "too_few" };
  return { account: saved, fallback: null };
}

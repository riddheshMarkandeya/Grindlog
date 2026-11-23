// The my_ids rows as the Settings page shows them, and the answer to "is this you?". Readers count
// every id that isn't rejected as you at query time, so a status change re-labels every match.
import { resolveAccount } from "../shared/accounts";
import { platformOf } from "../shared/platforms";
import type { IdRow } from "../shared/schemas/responses";
import type { IdAnswer } from "../shared/schemas/tables";
import type { Db } from "./db/sqlite";
import { createOnce, type Logger } from "./log";

const C = "ids";

type Stored = Omit<IdRow, "platform">;

export function createIds({ tracker, logger }: { tracker: Db; logger: Logger }) {
  // The list is read on every refetch and the account on every query, so each line is logged once per run.
  const once = createOnce();

  function list(): IdRow[] {
    const rows = tracker.all<Stored>("SELECT primary_id AS primaryId, name, status FROM my_ids ORDER BY added_at, primary_id");
    return rows.map((r) => {
      const platform = platformOf(r.primaryId);
      if (!platform.known) once(`platform:${platform.name}`, () => { logger.warn(C, "unknown_platform", { prefix: platform.name }); });
      return { ...r, platform: platform.name };
    });
  }

  /** The whole list after the change, or null for an id that isn't in my_ids. */
  function setStatus(id: string, status: IdAnswer): IdRow[] | null {
    const from = tracker.get<{ status: string }>("SELECT status FROM my_ids WHERE primary_id = ?", id)?.status;
    if (from === undefined) {
      logger.warn(C, "unknown_id", { id });
      return null;
    }
    tracker.run("UPDATE my_ids SET status = ? WHERE primary_id = ?", status, id);
    logger.info(C, "status", { id, from, to: status });
    return list();
  }

  /** The id the dashboard is scoped to, or null for every account (also when `saved` can't be used). */
  function effectiveAccount(saved: string): string | null {
    const { account, fallback } = resolveAccount(tracker.all<Pick<IdRow, "primaryId" | "status">>("SELECT primary_id AS primaryId, status FROM my_ids"), saved);
    if (fallback !== null) once(`fallback:${saved}|${fallback}`, () => { logger.info(C, "account_fallback", { saved, reason: fallback }); });
    return account;
  }

  return { list, setStatus, effectiveAccount };
}

export type Ids = ReturnType<typeof createIds>;

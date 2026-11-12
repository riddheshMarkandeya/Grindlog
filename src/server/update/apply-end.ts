// How an apply ends, the same for the updater and for the supervisor settling one whose updater died.
import type { Logger } from "../log";
import { clearDownloads } from "./files";
import { readState, writeState, type UpdateState } from "./state";

export interface EndApplyOptions {
  /** Adds the version to `skipped` with this reason, so it isn't offered again (and drops it, as `drop`). */
  skip?: string;
  /** Drops `available` and its download. */
  drop?: boolean;
}

export interface ApplyEnd extends EndApplyOptions {
  outcome: string;
  reason?: string;
  nowMs: number;
}

/** Clears `apply` and records how it ended. Returns whether state.json was written. */
export function endApply(dir: string, logger: Logger, apply: { from: string; to: string }, { outcome, reason, nowMs, skip, drop }: ApplyEnd): boolean {
  const changes: Partial<UpdateState> = {
    apply: undefined,
    lastApply: { from: apply.from, to: apply.to, outcome, ...(reason === undefined ? {} : { reason }), at: new Date(nowMs).toISOString() },
  };
  // Read again: a check can't write `skipped` while `apply` is set, but this keeps a write here from undoing one.
  if (skip !== undefined) changes.skipped = [...readState(dir, logger).skipped, { version: apply.to, reason: skip }];
  const dropping = drop === true || skip !== undefined;
  if (dropping) changes.available = undefined;
  const written = writeState(dir, logger, changes);
  // Only once state.json no longer points at it: a failed write keeps the download its `available` names.
  if (written && dropping) clearDownloads(dir, logger);
  return written;
}

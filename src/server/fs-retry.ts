import { renameSync } from "node:fs";
import type { Logger } from "./log";

// Antivirus and indexers briefly open a freshly written file; a rename then fails with one of these
// until they let go.
export const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRY_MS = 100;

export interface RenameRetryOptions {
  logger: Logger;
  timeoutMs?: number;
  rename?: (from: string, to: string) => void;
  /** Synchronous on purpose: the pre-migration backup runs inside synchronous storage opening. */
  sleepSync?: (ms: number) => void;
  now?: () => number;
}

/** `renameSync`, retried while the file is held, up to `timeoutMs`; then the last error is rethrown. */
export function renameRetry(from: string, to: string, { logger, timeoutMs = 2000, rename = renameSync, sleepSync = Bun.sleepSync, now = Date.now }: RenameRetryOptions): void {
  const deadline = now() + timeoutMs;
  let lastCode = "";
  for (let tries = 1; ; tries++) {
    try {
      rename(from, to);
      // Logged only after a retry, so the trail shows how often a held file really happens.
      if (tries > 1) logger.info("fs", "rename_retried", { to, tries, code: lastCode });
      return;
    } catch (err) {
      lastCode = (err as NodeJS.ErrnoException).code ?? "";
      if (!LOCKED.has(lastCode) || now() >= deadline) throw err;
      sleepSync(RETRY_MS);
    }
  }
}

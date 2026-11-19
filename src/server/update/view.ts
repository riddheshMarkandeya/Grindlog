// The tracker's side of updates: what the dashboard and tray show, read from the supervisor's
// state.json, and the user's choices, written to request.json for the supervisor to act on.
import { DAY_MS } from "../../shared/constants";
import { isNewer, releasePage } from "../../shared/release";
import type { UpdateResponse } from "../../shared/schemas/responses";
import type { Logger } from "../log";
import type { InstallerCheck } from "./files";
import { checkAllowedAt, checkPending, readRequest, readState, writeRequest, type LastApply } from "./state";

type InstallerCheckFailure = Extract<InstallerCheck, { ok: false }>["reason"];

export type UpdateView = UpdateResponse;
type UpdateStatus = UpdateResponse["status"];

export interface UpdatesOptions {
  /** <data>\update */
  dir: string;
  logger: Logger;
  running: string | null;
  enabled: boolean;
  now?: () => number;
}

/**
 * The skip reasons a failed signature or signed-comment check writes; others come from a failed update. Built from
 * a record, so the compiler makes a new verify failure land here too.
 */
const SIGNATURE_REASONS = new Set<string>(
  Object.keys({ malformed: true, unknown_algorithm: true, key_mismatch: true, bad_signature: true, bad_comment_signature: true, comment_mismatch: true } satisfies Record<InstallerCheckFailure, true>),
);

/** Which version a lastApply outcome is shown on, and for how long; outcomes not listed (or unknown) show nothing. */
const SHOWN: Record<NonNullable<UpdateResponse["lastApply"]>["outcome"], { on: "from" | "to"; forMs: number }> = {
  updated: { on: "to", forMs: DAY_MS },
  rolled_back: { on: "from", forMs: 7 * DAY_MS },
  rollback_failed: { on: "from", forMs: 7 * DAY_MS },
  unhealthy: { on: "to", forMs: 7 * DAY_MS },
};
const isShown = (outcome: string): outcome is keyof typeof SHOWN => Object.hasOwn(SHOWN, outcome);

export type Updates = ReturnType<typeof createUpdates>;

export function createUpdates({ dir, logger, running, enabled, now = Date.now }: UpdatesOptions) {
  const newer = (version: string) => running !== null && isNewer(version, running);

  function view(): UpdateView {
    // A build that never updates has no choice to show, so autoApply is just the schema's filler.
    if (!enabled || running === null) return { enabled: false, version: running, status: "disabled", available: null, skipped: null, autoApply: true, installRequested: false, checkedAt: null, lastApply: null, checking: false, checkAllowedAt: null };
    const request = readRequest(dir, logger);
    const state = readState(dir, logger);
    const nowMs = now();
    const available = state.available !== undefined && newer(state.available.version) ? { version: state.available.version, page: releasePage(state.available.version) } : null;
    const skipped = state.skipped
      .filter((s) => SIGNATURE_REASONS.has(s.reason))
      .map((s) => s.version).filter(newer).reduce<string | null>((best, v) => (best === null || isNewer(v, best) ? v : best), null);
    let status: UpdateStatus;
    if (available !== null) status = "ready";
    else if (skipped !== null) status = "skipped";
    else if (state.checkedAt === undefined) status = "not_checked";
    else status = state.lastOutcome === "error" ? "error" : "up_to_date";
    return { enabled: true, version: running, status, available, skipped, autoApply: request.autoApply, installRequested: available !== null && request.install === available.version, checkedAt: state.checkedAt ?? null, lastApply: lastApplyView(state.lastApply, running), checking: checkPending(request, state, nowMs), checkAllowedAt: checkAllowedAt(state, nowMs) };
  }

  function lastApplyView(last: LastApply | undefined, version: string): UpdateResponse["lastApply"] {
    if (!last || !isShown(last.outcome)) return null;
    const shown = SHOWN[last.outcome];
    const age = now() - Date.parse(last.at);
    if (last[shown.on] !== version || !(age >= 0 && age < shown.forMs)) return null;
    return { outcome: last.outcome, from: last.from, to: last.to, reason: last.reason ?? null, at: last.at, page: releasePage(last.to) };
  }

  return {
    view,
    /** Asks the supervisor to install `version`; only the version now available can be asked for. */
    install(version: string): "ok" | "conflict" | "failed" {
      if (view().available?.version !== version) return "conflict";
      if (!writeRequest(dir, logger, { install: version })) return "failed";
      logger.info("update", "request", { kind: "install", version });
      return "ok";
    },
    /** Asks the supervisor for a check now; it picks the request up within seconds. Asking while one is pending is a no-op. */
    requestCheck(): "ok" | "too_soon" | "disabled" | "failed" {
      const refuse = (reason: "too_soon" | "disabled") => {
        logger.info("update", "check_refused", { reason });
        return reason;
      };
      if (!enabled || running === null) return refuse("disabled");
      const nowMs = now();
      const request = readRequest(dir, logger);
      const state = readState(dir, logger);
      if (checkPending(request, state, nowMs)) return "ok";
      if (checkAllowedAt(state, nowMs) !== null) return refuse("too_soon");
      if (!writeRequest(dir, logger, { checkRequestedAt: new Date(nowMs).toISOString() })) return "failed";
      logger.info("update", "request", { kind: "check" });
      return "ok";
    },
    setAutoApply(on: boolean): boolean {
      if (!writeRequest(dir, logger, { autoApply: on })) return false;
      logger.info("update", "request", { kind: "auto_apply", on });
      return true;
    },
  };
}

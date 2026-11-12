// The tracker's side of updates: what the dashboard and tray show, read from the supervisor's
// state.json, and the user's choices, written to request.json for the supervisor to act on.
import { isNewer, releasePage } from "../../shared/release";
import type { UpdateResponse } from "../../shared/schemas/responses";
import type { Logger } from "../log";
import { readRequest, readState, writeRequest } from "./state";

export type UpdateView = UpdateResponse;
type UpdateStatus = UpdateResponse["status"];

export interface UpdatesOptions {
  /** <data>\update */
  dir: string;
  logger: Logger;
  running: string | null;
  enabled: boolean;
}

export type Updates = ReturnType<typeof createUpdates>;

export function createUpdates({ dir, logger, running, enabled }: UpdatesOptions) {
  const newer = (version: string) => running !== null && isNewer(version, running);

  function view(): UpdateView {
    // A build that never updates has no choice to show, so autoApply is just the schema's filler.
    if (!enabled || running === null) return { enabled: false, version: running, status: "disabled", available: null, skipped: null, autoApply: true, installRequested: false, checkedAt: null };
    const request = readRequest(dir, logger);
    const state = readState(dir, logger);
    const available = state.available !== undefined && newer(state.available.version) ? { version: state.available.version, page: releasePage(state.available.version) } : null;
    const skipped = state.skipped.map((s) => s.version).filter(newer).reduce<string | null>((best, v) => (best === null || isNewer(v, best) ? v : best), null);
    let status: UpdateStatus;
    if (available !== null) status = "ready";
    else if (skipped !== null) status = "skipped";
    else if (state.checkedAt === undefined) status = "not_checked";
    else status = state.lastOutcome === "error" ? "error" : "up_to_date";
    return { enabled: true, version: running, status, available, skipped, autoApply: request.autoApply, installRequested: available !== null && request.install === available.version, checkedAt: state.checkedAt ?? null };
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
    setAutoApply(on: boolean): boolean {
      if (!writeRequest(dir, logger, { autoApply: on })) return false;
      logger.info("update", "request", { kind: "auto_apply", on });
      return true;
    },
  };
}

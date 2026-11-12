// Which Stats API setup card shows, from the live status and what this tab's own fix attempt got.
import { USER_INI_HINT } from "../../shared/constants";
import { statsSetupError, type StatsSetupError } from "../../shared/schemas/responses";
import type { LiveState } from "../events/live";

/** This tab's last fix attempt, until dismissed: done, or the server's refusal ("unknown" when there was no usable answer). */
export type SetupOutcome = { kind: "done" } | { kind: "failed"; code: StatsSetupError | "unknown" };

/** A failed fix's ApiError code as an outcome; network, http and bad-body failures are unknown. */
export function outcomeOf(code: string): SetupOutcome {
  const known = statsSetupError.shape.error.safeParse(code);
  return { kind: "failed", code: known.success ? known.data : "unknown" };
}

/** Every card names the Documents ini (the real path when known) and the port the tracker connects to, for the manual steps. */
interface Where {
  path: string;
  port: number;
}
export type SetupCard = Where &
  (
    | { kind: "open_game" }
    | { kind: "guide" }
    | { kind: "port_warning" }
    | { kind: "fix"; rate: boolean; webPort: boolean }
    | { kind: "restart" }
    | { kind: "done" }
  );

/** Null when no card shows. A local outcome wins, since it's newer than the status, until the game connects: data arriving ends setup. */
export function setupCard({ link, status }: LiveState, outcome: SetupOutcome | null): SetupCard | null {
  const where: Where = { path: status?.statsIni ?? USER_INI_HINT, port: status?.expectedWebPort ?? 0 };
  if (outcome && status && status.connection !== "waiting") return null;
  if (outcome?.kind === "done") return { kind: "done", ...where };
  if (outcome?.kind === "failed") {
    if (outcome.code === "no_file") return { kind: "open_game", ...where };
    if (outcome.code === "port_needs_consent") return { kind: "port_warning", ...where };
    return { kind: "guide", ...where };
  }
  if (link === "down" || status?.connection !== "waiting") return null;
  const problems = status.configProblems;
  if (problems.includes("no_ini") || problems.includes("user_missing")) return { kind: "open_game", ...where };
  if (status.configUnknown) return { kind: "guide", ...where };
  if (problems.includes("web_port_mismatch")) return { kind: "port_warning", ...where };
  const rate = problems.includes("send_rate_off");
  const webPort = problems.includes("web_port_off");
  if (rate || webPort) return { kind: "fix", ...where, rate, webPort };
  if (status.statsApiOff) return { kind: "restart", ...where };
  return null;
}

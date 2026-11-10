// Stops the running tracker (background or dev) through its shutdown endpoint.
// `bun run stop [--wait]`; GRINDLOG_PORT picks which instance (a dev run is on 49101).
import { join } from "node:path";
import { killExe, requestStop, waitForPortFree, type StopOutcome } from "../src/server/control";
import { dashboardPort, dataDir, identity } from "../src/server/paths";
import { APP_NAME } from "../src/shared/channel";

export function describeStopResult(outcome: StopOutcome): { message: string; exitCode: number } {
  switch (outcome.kind) {
    case "status":
      return outcome.status === 202 ? { message: `${APP_NAME} is stopping.`, exitCode: 0 } : { message: `Stop request failed: HTTP ${String(outcome.status)}.`, exitCode: 1 };
    case "refused":
      return { message: `${APP_NAME} is not running.`, exitCode: 1 };
    case "reset":
      // The tracker answers 202 before tearing down, so a lost answer most likely means it stopped first.
      return { message: `The connection closed before an answer; ${APP_NAME} is probably stopping.`, exitCode: 0 };
    case "error":
      return { message: `Stop request failed: ${outcome.message}`, exitCode: 1 };
  }
}

// Only the installed supervisor: it runs only when the port refused, and a tracker of the same
// install that is still starting up is left alone. A friend's install has another exe path.
function endSupervisor(): boolean {
  const exe = join(dataDir(), "bin", identity().exe);
  const result = killExe(exe, "--supervisor");
  // A failed lookup must not read as "nothing running" without saying so.
  if (result.kind === "failed") console.error(`Could not look for ${exe} processes (${result.error}).`);
  return result.kind === "killed";
}

export interface StopResult {
  message: string;
  exitCode: number;
  /** Nothing answered on the port. */
  notRunning: boolean;
}

/** Asks the tracker on `port` to stop and, with `wait`, waits until it has. */
export async function stopTracker(port: number, wait: boolean, deps: { request?: typeof requestStop; endSupervisor?: () => boolean } = {}): Promise<StopResult> {
  const { request = requestStop, endSupervisor: end = endSupervisor } = deps;
  const outcome = await request(port);
  const notRunning = outcome.kind === "refused";
  // A supervisor sleeping between crash restarts would bring the tracker back. Only this channel's
  // installed port has one; a dev run on another port must not end it.
  if (notRunning && port === identity().port && end()) {
    return { message: `${APP_NAME} wasn't running; ended its supervisor, which was waiting to restart it.`, exitCode: 0, notRunning };
  }
  const result = { ...describeStopResult(outcome), notRunning };
  if (!wait || result.exitCode !== 0) return result;
  return (await waitForPortFree(port))
    ? { message: `${APP_NAME} stopped.`, exitCode: 0, notRunning }
    : { message: `${APP_NAME} still holds port ${String(port)} after 30 s.`, exitCode: 1, notRunning };
}

if (import.meta.main) {
  const { message, exitCode } = await stopTracker(dashboardPort(), process.argv.includes("--wait"));
  console.log(message);
  process.exit(exitCode);
}

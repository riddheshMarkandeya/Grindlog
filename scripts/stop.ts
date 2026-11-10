// Stops the running tracker (background or dev) through its shutdown endpoint.
// `bun run stop [--wait]`; GRINDLOG_PORT picks which instance (a dev run is on 49101).
import { connect } from "node:net";
import { join } from "node:path";
import { APP_NAME } from "../src/shared/channel";
import { dashboardPort, dataDir, identity } from "../src/server/paths";
import { DASHBOARD_HOST, SHUTDOWN_HEADER } from "../src/shared/constants";

export type StopOutcome = { kind: "status"; status: number } | { kind: "refused" } | { kind: "reset" } | { kind: "error"; message: string };

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

export async function requestStop(port: number): Promise<StopOutcome> {
  try {
    const res = await fetch(`http://${DASHBOARD_HOST}:${String(port)}/api/shutdown`, {
      method: "POST",
      headers: { [SHUTDOWN_HEADER]: "1" },
      signal: AbortSignal.timeout(10_000),
    });
    return { kind: "status", status: res.status };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ECONNREFUSED") return { kind: "refused" };
    if (code === "ECONNRESET") return { kind: "reset" };
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Whether anything accepts connections on the port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, DASHBOARD_HOST);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

/** Polls until nothing listens on the port; false if it's still taken after `timeoutMs`. */
export async function waitForPortFree(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (await portInUse(port)) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(250);
  }
  return true;
}

// Matches on the full path, not the image name: a hand-run copy of the same exe elsewhere (another
// data dir or port) may be recording and must survive. The path and arg go in through env, never quoted into the script.
const KILL_SCRIPT = `
$name = Split-Path -Leaf $env:GRINDLOG_KILL_EXE
$p = @(Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object {
  $_.ExecutablePath -eq $env:GRINDLOG_KILL_EXE -and ([string]::IsNullOrEmpty($env:GRINDLOG_KILL_ARG) -or $_.CommandLine -match [regex]::Escape($env:GRINDLOG_KILL_ARG))
})
foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }
if ($p.Count -gt 0) { exit 0 } else { exit 3 }`;

/** Force-ends the processes running `exe` (a full path), only those whose command line has `arg` if given; true if any was running. */
export function killExe(exe: string, arg = ""): boolean {
  const res = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", KILL_SCRIPT], {
    env: { ...process.env, GRINDLOG_KILL_EXE: exe, GRINDLOG_KILL_ARG: arg },
    stdout: "ignore",
    stderr: "pipe",
  });
  if (res.exitCode === 0) return true;
  // 3 is the script's "nothing matched"; anything else is PowerShell or CIM failing, which would
  // otherwise read as nothing running.
  if (res.exitCode !== 3) console.error(`Could not look for ${exe} processes (exit ${String(res.exitCode)}): ${res.stderr.toString().trim()}`);
  return false;
}

// Only the installed supervisor: it runs only when the port refused, and a tracker of the same
// install that is still starting up is left alone. A friend's install has another exe path.
const endSupervisor = () => killExe(join(dataDir(), "bin", identity().exe), "--supervisor");

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

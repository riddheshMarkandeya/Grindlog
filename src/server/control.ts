// Starting, probing and ending this install's processes from outside them: the launcher (--open,
// --quit) and the dev scripts (stop, autostart) share these, so they live in the exe's sources.
import { connect } from "node:net";
import { DASHBOARD_HOST, SHUTDOWN_HEADER } from "../shared/constants";
import { statusSchema } from "../shared/schemas/responses";
import { z } from "zod";
import type { Logger } from "./log";

/** A recording tracker flushes its last scoreboard on stop; this is how long a quit waits for that. */
export const QUIT_TIMEOUT_MS = 30_000;

export type StopOutcome = { kind: "status"; status: number } | { kind: "refused" } | { kind: "reset" } | { kind: "error"; message: string };

/** Whether the tracker took the stop request: any 2xx. */
export const stopAccepted = (o: StopOutcome): boolean => o.kind === "status" && o.status >= 200 && o.status < 300;

/** POSTs the tracker's shutdown endpoint; it answers 202 and then stops with exit 0. */
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

/** What the dashboard port says: nothing there, a tracker still starting (no API yet), or a ready tracker. */
export type Probe = "refused" | "starting" | { pid: number };

/** A ready tracker's identity and state. `version` is null for dev builds and builds too old to report it. */
export interface StatusInfo {
  pid: number;
  version: string | null;
  connection?: string;
}

// Only the pid is required: the updater's new exe probes the old build's tracker (and the old exe the new
// one's), whose status may differ in every other field. Another app's 200 has no pid and reads as starting.
const infoBody = z.object({
  pid: statusSchema.shape.pid,
  version: z.string().nullable().catch(null),
  connection: z.string().optional().catch(undefined),
});

export async function statusInfo(port: number): Promise<"refused" | "starting" | StatusInfo> {
  let res: Response;
  try {
    res = await fetch(`http://${DASHBOARD_HOST}:${String(port)}/api/status`, { signal: AbortSignal.timeout(2000) });
  } catch (err) {
    // Anything but a refusal (a timeout, a reset) means something holds the port.
    return (err as { code?: unknown }).code === "ECONNREFUSED" ? "refused" : "starting";
  }
  // The host binds before migrations and answers 503 until the API mounts.
  if (res.status !== 200) return "starting";
  const body = infoBody.safeParse(await res.json().catch(() => null));
  if (!body.success) return "starting";
  const { pid, version, connection } = body.data;
  return connection === undefined ? { pid, version } : { pid, version, connection };
}

export async function statusProbe(port: number): Promise<Probe> {
  const info = await statusInfo(port);
  return typeof info === "string" ? info : { pid: info.pid };
}

// Matches on the full path, not the image name: a hand-run copy of the same exe elsewhere (another
// data dir or port) may be recording and must survive. The paths ('|'-joined, a character no
// Windows path has) and arg go in through env, never quoted into the script. -in compares without
// case, as Windows paths do. ErrorActionPreference Stop makes a CIM failure exit non-zero instead
// of reading as an empty list.
const MATCH_SCRIPT = `
$ErrorActionPreference = 'Stop'
$paths = @($env:GRINDLOG_MATCH_EXE -split '\\|')
$filter = (@($paths | ForEach-Object { "Name='" + (Split-Path -Leaf $_) + "'" }) -join ' OR ')
$p = @(Get-CimInstance Win32_Process -Filter $filter | Where-Object {
  $_.ExecutablePath -in $paths -and ([string]::IsNullOrEmpty($env:GRINDLOG_MATCH_ARG) -or $_.CommandLine -match [regex]::Escape($env:GRINDLOG_MATCH_ARG))
})`;
const KILL_SCRIPT = `${MATCH_SCRIPT}
foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }
if ($p.Count -gt 0) { exit 0 } else { exit 3 }`;
const LIST_SCRIPT = `${MATCH_SCRIPT}
ConvertTo-Json -Compress -InputObject @($p | ForEach-Object { @{ pid = [int]$_.ProcessId; path = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine } })`;

function runMatchScript(script: string, exes: string[], arg: string) {
  return Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, GRINDLOG_MATCH_EXE: exes.join("|"), GRINDLOG_MATCH_ARG: arg },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    // A hung CIM query would otherwise outlast every caller's own deadline; it then reads as failed.
    timeout: 15_000,
  });
}

export type KillResult = { kind: "killed" } | { kind: "none" } | { kind: "failed"; error: string };

/** Force-ends the processes running `exe` (a full path), only those whose command line has `arg` if given. */
export function killExe(exe: string, arg = ""): KillResult {
  const res = runMatchScript(KILL_SCRIPT, [exe], arg);
  if (res.exitCode === 0) return { kind: "killed" };
  // 3 is the script's "nothing matched"; anything else is PowerShell or CIM failing.
  if (res.exitCode === 3) return { kind: "none" };
  return { kind: "failed", error: `exit ${String(res.exitCode)}: ${res.stderr.toString().trim()}` };
}

export interface ExeProcess {
  pid: number;
  /** Its exe's full path, in the casing Windows reports. */
  path: string;
  commandLine: string;
}

/** The processes running any of `exes` (full paths), in one lookup. Throws when the lookup itself fails, never reads that as none running. */
export function exeProcesses(exes: string[]): ExeProcess[] {
  const res = runMatchScript(LIST_SCRIPT, exes, "");
  if (res.exitCode !== 0) throw new Error(`process lookup for ${exes.join(", ")} failed (exit ${String(res.exitCode)}): ${res.stderr.toString().trim()}`);
  return JSON.parse(res.stdout.toString()) as ExeProcess[];
}

/** Whether a process with this ID exists, including one this process may not signal. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How spawnDetached starts processes, for the logs. */
export const SPAWN_METHOD = "bun_detached";

/**
 * Starts `cmd` outside this process's kill-on-close job, where Bun's ordinary children sit and die
 * with their parent, so it outlives this process; cwd and env pass through as given. Returns the
 * new process ID.
 */
export function spawnDetached(cmd: string[], cwd: string, env: Record<string, string | undefined>): number {
  const child = Bun.spawn(cmd, { cwd, env, detached: true, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
  child.unref();
  return child.pid;
}

/** Opens `url` in the default browser; a failure is logged, never thrown. */
export async function openInBrowser(url: string, logger: Logger): Promise<void> {
  try {
    const child = Bun.spawn(["explorer.exe", url], { stdio: ["ignore", "ignore", "ignore"] });
    // Explorer hands the URL on and exits, with an unreliable code (often 1 on success). Waiting
    // keeps this process's job, which kills its children on exit, from ending explorer first.
    await Promise.race([child.exited, Bun.sleep(5000)]);
  } catch (err) {
    logger.error("launcher", "browser_open_failed", { url, err });
  }
}

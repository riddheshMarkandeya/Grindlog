// The logon task that starts Grindlog at sign-in, read and switched on or off for the dashboard's
// "Start with Windows" setting. The task itself is the only record of the choice, so installers
// must keep a task switched off when they update it.
import type { z } from "zod";
import type { autostartResponse } from "../shared/schemas/responses";
import type { Logger } from "./log";
import { runCommand, type CommandResult } from "./powershell";

/** What the task's XML says; "unknown" when it has no Settings block to read. */
export type ParsedTaskState = "on" | "off" | "unknown";

/**
 * Reads `schtasks /Query /XML` output. Only the task-level Settings block counts: a trigger has its
 * own Enabled. schtasks leaves Enabled out of Settings while the task is on and writes
 * `<Enabled>false</Enabled>` there once it's switched off.
 */
export function parseTaskState(xml: string): ParsedTaskState {
  // `</Settings>` can't match a nested block's close (`</IdleSettings>`), so this is the whole block.
  const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(xml)?.[1];
  if (settings === undefined) return "unknown";
  return /<Enabled>\s*false\s*<\/Enabled>/.test(settings) ? "off" : "on";
}

/** What the dashboard shows: "unavailable" when the task is missing or couldn't be read. */
export type AutostartState = z.infer<typeof autostartResponse>["state"];

/** A switch schtasks refused or never finished; already logged as `logon_task/change_failed`. */
export class LogonTaskError extends Error {}

type Run = (argv: string[], timeoutMs: number) => Promise<CommandResult>;

const C = "logon_task";
// schtasks answers in well under a second (about 45 ms measured); a hang must not hold a request open.
const TIMEOUT_MS = 10_000;

/** A failed run's details for the log: the exit code, a timeout, what schtasks printed, or why it couldn't start. */
function failure(r: CommandResult | Error) {
  return r instanceof Error ? { err: r } : { code: r.code, timedOut: r.timedOut, stderr: r.stderr.trim() };
}

/** `run`, with a program that can't be started returned as its Error instead of thrown. */
async function attempt(run: Run, argv: string[]): Promise<CommandResult | Error> {
  try {
    return await run(argv, TIMEOUT_MS);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

const succeeded = (r: CommandResult | Error): r is CommandResult => !(r instanceof Error) && r.code === 0;

export function createLogonTask({ task, logger, run = runCommand }: { task: string; logger: Logger; run?: Run }) {
  async function get(): Promise<AutostartState> {
    const started = performance.now();
    const r = await attempt(run, ["schtasks", "/Query", "/TN", task, "/XML"]);
    const ms = Math.round(performance.now() - started);
    // A missing task fails like any other query: its message is localized, so it can't be told apart.
    if (!succeeded(r)) {
      logger.warn(C, "query_failed", { task, ms, ...failure(r) });
      return "unavailable";
    }
    const state = parseTaskState(r.stdout);
    if (state === "unknown") {
      logger.warn(C, "unexpected_xml", { task, length: r.stdout.length });
      return "unavailable";
    }
    logger.info(C, "queried", { task, state, ms });
    return state;
  }

  /** Switches the task on or off, then answers what Windows now holds. Throws LogonTaskError when the switch fails. */
  async function set(on: boolean): Promise<AutostartState> {
    const started = performance.now();
    const r = await attempt(run, ["schtasks", "/Change", "/TN", task, on ? "/ENABLE" : "/DISABLE"]);
    if (!succeeded(r)) {
      logger.error(C, "change_failed", { task, on, ms: Math.round(performance.now() - started), ...failure(r) });
      throw new LogonTaskError(`schtasks /Change failed for ${task}`);
    }
    const state = await get();
    // The whole switch, the re-read included.
    logger.info(C, "changed", { task, on, state, ms: Math.round(performance.now() - started) });
    return state;
  }

  return { get, set };
}

export type LogonTask = ReturnType<typeof createLogonTask>;

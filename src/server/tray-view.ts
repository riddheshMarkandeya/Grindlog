// What the tray shows, worked out here so the tray exe stays a dumb renderer. The tray adds only what
// it alone can know: "Starting…" before the first answer and "Not responding" when answers stop.
import type { Status, TrayResponse } from "../shared/schemas/responses";

export interface TrayInputs {
  connection: Status["connection"];
  statsApiOff: boolean;
  configProblems: readonly Status["configProblems"][number][];
  /** Matches the last release recompute couldn't rebuild; 0 until a run finishes. */
  recomputeFailed: number;
}

/** The card that walks through the Stats API setup shows on any dashboard page when it's needed. */
const SETUP_URL = "/";

function state({ connection, statsApiOff, configProblems }: TrayInputs): Pick<TrayResponse, "icon" | "status" | "setupUrl"> {
  // Data flowing beats a config problem: the check reads a file that may be stale.
  if (connection === "recording") return { icon: "active", status: "Recording a match", setupUrl: null };
  if (connection === "connected") return { icon: "active", status: "Connected to Rocket League", setupUrl: null };
  if (statsApiOff) return { icon: "attention", status: "Not getting data from Rocket League", setupUrl: SETUP_URL };
  // Without the game's settings file nothing else can be checked yet; starting the game once writes it.
  if (configProblems.includes("no_ini") || configProblems.includes("user_missing")) {
    return { icon: "attention", status: "Open Rocket League once to finish setup", setupUrl: SETUP_URL };
  }
  if (configProblems.length > 0) return { icon: "attention", status: "Stats API needs setting up", setupUrl: SETUP_URL };
  return { icon: "ready", status: "Ready, waiting for Rocket League", setupUrl: null };
}

/** `feed` is the notifier's poll answer: the pending notices and the run that numbered them. */
export function trayView(inputs: TrayInputs, feed: Pick<TrayResponse, "instance" | "notices">): TrayResponse {
  const n = inputs.recomputeFailed;
  const lines = n > 0 ? [{ text: `${String(n)} ${n === 1 ? "match" : "matches"} couldn't be rebuilt after the update` }] : [];
  return { ...state(inputs), lines, ...feed };
}

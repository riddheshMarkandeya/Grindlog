// What the tray shows, worked out here so the tray exe stays a dumb renderer. The tray adds only what
// it alone can know: "Starting…" before the first answer and "Not responding" when answers stop.
import type { Status, TrayResponse } from "../shared/schemas/responses";
import type { UpdateView } from "./update/view";

export interface TrayInputs {
  connection: Status["connection"];
  statsApiOff: boolean;
  configProblems: readonly Status["configProblems"][number][];
  configUnknown: boolean;
  /** Matches the last release recompute couldn't rebuild; 0 until a run finishes. */
  recomputeFailed: number;
  update: Pick<UpdateView, "available" | "skipped" | "autoApply" | "installRequested">;
}

/** The dashboard section with the Install button and the auto-apply switch. */
const UPDATES_URL = "/settings#updates";

/** The card that walks through the Stats API setup shows on any dashboard page when it's needed. */
const SETUP_URL = "/";

function state({ connection, statsApiOff, configProblems, configUnknown }: TrayInputs): Pick<TrayResponse, "icon" | "status" | "setupUrl"> {
  // Data flowing beats a config problem: the check reads a file that may be stale.
  if (connection === "recording") return { icon: "active", status: "Recording a match", setupUrl: null };
  if (connection === "connected") return { icon: "active", status: "Connected to Rocket League", setupUrl: null };
  if (statsApiOff) return { icon: "attention", status: "Not getting data from Rocket League", setupUrl: SETUP_URL };
  // Without the game's settings file nothing else can be checked yet; starting the game once writes it.
  if (configProblems.includes("no_ini") || configProblems.includes("user_missing")) {
    return { icon: "attention", status: "Open Rocket League once to finish setup", setupUrl: SETUP_URL };
  }
  // Unknown: the card shows the manual steps.
  if (configProblems.length > 0 || configUnknown) return { icon: "attention", status: "Stats API needs setting up", setupUrl: SETUP_URL };
  return { icon: "ready", status: "Ready, waiting for Rocket League", setupUrl: null };
}

/** `feed` is the notifier's poll answer: the pending notices and the run that numbered them. */
export function trayView(inputs: TrayInputs, feed: Pick<TrayResponse, "instance" | "notices">): TrayResponse {
  const n = inputs.recomputeFailed;
  const lines: TrayResponse["lines"] = n > 0 ? [{ text: `${String(n)} ${n === 1 ? "match" : "matches"} couldn't be rebuilt after the update` }] : [];
  return { ...state(inputs), lines: [...lines, ...updateLines(inputs.update)], ...feed };
}

/** With auto-apply on, a ready update needs nothing from the friend: it installs once the game is closed. */
function updateLines({ available, skipped, autoApply, installRequested }: TrayInputs["update"]): TrayResponse["lines"] {
  const lines: TrayResponse["lines"] = [];
  if (available !== null && !autoApply) {
    lines.push(installRequested ? { text: `Update ${available.version} installs once Rocket League is closed` } : { text: `Install update ${available.version}…`, url: UPDATES_URL });
    lines.push({ text: `What changed in ${available.version}`, url: available.page });
  }
  if (skipped !== null) lines.push({ text: `Update ${skipped} failed its signature check` });
  return lines;
}

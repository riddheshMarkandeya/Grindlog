import { describe, expect, test } from "vitest";
import type { Status } from "../../shared/schemas/responses";
import type { LiveState } from "../events/live";
import { outcomeOf, setupCard, type SetupOutcome } from "./setup";

const HINT = "Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini";
const INI = "C:\\Users\\me\\OneDrive\\Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini";
const status = (over: Partial<Status> = {}): Status => ({
  connection: "waiting",
  statsApiOff: false,
  configProblems: [],
  configUnknown: false,
  statsIni: INI,
  expectedWebPort: 49124,
  version: null,
  pid: 1,
  ...over,
});
const live = (over: Partial<Status> = {}, link: LiveState["link"] = "open"): LiveState => ({ link, status: status(over), stopped: false });
const card = (over: Partial<Status> = {}, outcome: SetupOutcome | null = null) => setupCard(live(over), outcome);

describe("setupCard", () => {
  test("hidden while nothing is wrong, before any status, with the link down, or once the game connects", () => {
    expect(card()).toBeNull();
    expect(setupCard({ link: "connecting", status: undefined, stopped: false }, null)).toBeNull();
    expect(setupCard(live({ configProblems: ["send_rate_off"] }, "down"), null)).toBeNull();
    expect(card({ connection: "connected", configProblems: ["send_rate_off"] })).toBeNull();
    expect(card({ connection: "recording", statsApiOff: true })).toBeNull();
  });

  test("no settings file yet: open the game once", () => {
    expect(card({ configProblems: ["no_ini"] })).toEqual({ kind: "open_game", path: INI, port: 49124 });
    expect(card({ configProblems: ["user_missing", "send_rate_off"], statsIni: null })).toEqual({ kind: "open_game", path: HINT, port: 49124 });
  });

  test("a check that found nothing shows the manual steps, with the usual path when the real one is unknown", () => {
    expect(card({ configUnknown: true, statsIni: null })).toEqual({ kind: "guide", path: HINT, port: 49124 });
  });

  test("a custom WebPort warns before moving it", () => {
    expect(card({ configProblems: ["send_rate_off", "web_port_mismatch"], expectedWebPort: 50001 })).toEqual({ kind: "port_warning", path: INI, port: 50001 });
  });

  test("a rate or port that's off gets the one-click fix, naming only what changes", () => {
    expect(card({ configProblems: ["send_rate_off"] })).toEqual({ kind: "fix", path: INI, port: 49124, rate: true, webPort: false });
    expect(card({ configProblems: ["send_rate_off", "web_port_off"] })).toEqual({ kind: "fix", path: INI, port: 49124, rate: true, webPort: true });
  });

  test("settings look right but no data: restart the game", () => {
    expect(card({ statsApiOff: true })).toEqual({ kind: "restart", path: INI, port: 49124 });
    // A problem names the fix rather than a restart.
    expect(card({ statsApiOff: true, configProblems: ["send_rate_off"] })?.kind).toBe("fix");
  });

  test("a local outcome wins over the status, and over a down link", () => {
    const fixable: Partial<Status> = { configProblems: ["send_rate_off"] };
    expect(card(fixable, { kind: "done" })).toEqual({ kind: "done", path: INI, port: 49124 });
    expect(card({}, { kind: "done" })?.kind).toBe("done");
    expect(card(fixable, { kind: "failed", code: "no_file" })?.kind).toBe("open_game");
    expect(card(fixable, { kind: "failed", code: "port_needs_consent" })?.kind).toBe("port_warning");
    expect(card(fixable, { kind: "failed", code: "write_failed" })?.kind).toBe("guide");
    expect(card(fixable, { kind: "failed", code: "check_failed" })?.kind).toBe("guide");
    expect(setupCard(live(fixable, "down"), { kind: "failed", code: "unknown" })?.kind).toBe("guide");
  });

  test("any outcome closes once the game connects: data arriving means setup is over", () => {
    expect(card({ connection: "connected" }, { kind: "done" })).toBeNull();
    expect(card({ connection: "recording" }, { kind: "failed", code: "no_file" })).toBeNull();
    expect(card({ connection: "connected" }, { kind: "failed", code: "write_failed" })).toBeNull();
  });
});

describe("outcomeOf", () => {
  test("a known refusal keeps its code; anything else (network, http, a bad body) is unknown and gets the guide", () => {
    expect(outcomeOf("no_file")).toEqual({ kind: "failed", code: "no_file" });
    expect(outcomeOf("network")).toEqual({ kind: "failed", code: "unknown" });
  });
});

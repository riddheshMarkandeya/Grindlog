import { describe, expect, test } from "vitest";
import { trayView, type TrayInputs } from "./tray-view";

const NO_UPDATE: TrayInputs["update"] = { available: null, skipped: null, autoApply: true, installRequested: false };
const base: TrayInputs = { connection: "waiting", statsApiOff: false, configProblems: [], configUnknown: false, recomputeFailed: 0, update: NO_UPDATE };
const view = (over: Partial<TrayInputs>) => trayView({ ...base, ...over }, { instance: "run1", notices: [] });

describe("trayView", () => {
  test.each([
    [{ connection: "recording" }, "active", "Recording a match", null],
    [{ connection: "connected" }, "active", "Connected to Rocket League", null],
    [{ statsApiOff: true }, "attention", "Not getting data from Rocket League", "/"],
    [{ configProblems: ["no_ini"] }, "attention", "Open Rocket League once to finish setup", "/"],
    [{ configProblems: ["user_missing"] }, "attention", "Open Rocket League once to finish setup", "/"],
    [{ configProblems: ["send_rate_off"] }, "attention", "Stats API needs setting up", "/"],
    [{ configProblems: ["web_port_mismatch"] }, "attention", "Stats API needs setting up", "/"],
    [{ configUnknown: true }, "attention", "Stats API needs setting up", "/"],
    [{}, "ready", "Ready, waiting for Rocket League", null],
  ] as const)("%o → %s, %s", (over, icon, status, setupUrl) => {
    expect(view(over)).toMatchObject({ icon, status, setupUrl });
  });

  test("connected or recording wins over config problems and Stats API off: data is flowing", () => {
    expect(view({ connection: "connected", statsApiOff: true, configProblems: ["send_rate_off"] })).toMatchObject({ icon: "active", setupUrl: null });
    expect(view({ connection: "recording", configProblems: ["no_ini"] }).status).toBe("Recording a match");
  });

  test("Stats API off wins over config problems; first-run problems win over the others", () => {
    expect(view({ statsApiOff: true, configProblems: ["no_ini"] }).status).toBe("Not getting data from Rocket League");
    expect(view({ configProblems: ["send_rate_off", "user_missing"] }).status).toBe("Open Rocket League once to finish setup");
  });

  test("no lines normally; a quiet line, without a url, when the release recompute failed some matches", () => {
    expect(view({}).lines).toEqual([]);
    expect(view({ recomputeFailed: 1 }).lines).toEqual([{ text: "1 match couldn't be rebuilt after the update" }]);
    expect(view({ recomputeFailed: 3, connection: "connected" }).lines).toEqual([{ text: "3 matches couldn't be rebuilt after the update" }]);
  });

  test("passes the notices and the run's instance through", () => {
    const notices = [{ id: 1, title: "Grindlog", body: "hi" }];
    expect(trayView(base, { instance: "run1", notices })).toMatchObject({ instance: "run1", notices });
  });
});

describe("update lines", () => {
  const AVAILABLE = { version: "0.2.0", page: "https://github.com/riddheshMarkandeya/Grindlog/releases/tag/v0.2.0" };
  const update = (over: Partial<TrayInputs["update"]>) => view({ update: { ...NO_UPDATE, ...over } }).lines;

  test("none while nothing is available", () => {
    expect(update({})).toEqual([]);
  });

  test("with auto-apply on, a ready update gets no line: it installs once the game is closed", () => {
    expect(update({ available: AVAILABLE })).toEqual([]);
  });

  test("with auto-apply off, a ready update offers Install (the Updates section) and What changed (its release page)", () => {
    expect(update({ available: AVAILABLE, autoApply: false })).toEqual([
      { text: "Install update 0.2.0…", url: "/settings#updates" },
      { text: "What changed in 0.2.0", url: AVAILABLE.page },
    ]);
  });

  test("once asked for, the Install line says when it happens", () => {
    expect(update({ available: AVAILABLE, autoApply: false, installRequested: true })).toEqual([
      { text: "Update 0.2.0 installs once Rocket League is closed" },
      { text: "What changed in 0.2.0", url: AVAILABLE.page },
    ]);
  });

  test("a version skipped for its signature gets a plain line", () => {
    expect(update({ skipped: "0.3.0" })).toEqual([{ text: "Update 0.3.0 failed its signature check" }]);
  });

  test("update lines come after the recompute line", () => {
    expect(view({ recomputeFailed: 1, update: { ...NO_UPDATE, skipped: "0.3.0" } }).lines.map((l) => l.text)).toEqual(["1 match couldn't be rebuilt after the update", "Update 0.3.0 failed its signature check"]);
  });
});

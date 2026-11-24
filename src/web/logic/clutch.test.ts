import { describe, expect, test } from "vitest";
import type { ClutchView } from "../../shared/schemas/responses";
import { clutchTiles, rungLabel, swingLink } from "./clutch";

const wl = (w: number, l: number) => ({ w, l });
const view = (over: Partial<ClutchView> = {}): ClutchView => ({
  matches: 340,
  skippedOrder: 1,
  oneGoal: wl(70, 84),
  oneGoalNoOt: wl(50, 49),
  overtime: wl(20, 35),
  scoredFirst: wl(116, 49),
  concededFirst: wl(40, 120),
  forfeits: wl(59, 19),
  comebacks: { n: 14, of: 134 },
  blownLeads: { n: 20, of: 143 },
  ladder: { down: [wl(1, 1), wl(1, 1), wl(1, 1)], up: [wl(1, 1), wl(1, 1), wl(1, 1)] },
  best: { guid: "B", startedAt: 1, score: "5–4", at: "0–4", by: 4, sessionKey: "S1" },
  worst: { guid: "W", startedAt: 2, score: "3–4", at: "2–0", by: 2, sessionKey: "S2" },
  ...over,
});

describe("clutchTiles", () => {
  test("values and notes", () => {
    expect(clutchTiles(view()).map((t) => [t.label, t.value, t.note])).toEqual([
      ["1-goal games", "45%", "won 70–84 · 50–49 without OT"],
      ["Overtime", "36%", "won 20–35"],
      ["Scored first", "70%", "won 116–49 when you opened the scoring"],
      ["Conceded first", "25%", "won 40–120 when they opened it"],
      ["Comebacks", "10%", "won 14 of 134 after going 2+ down"],
      ["Blown leads", "14%", "lost 20 of 143 after going 2+ up"],
      ["Forfeits", "59–19", "matches a side quit early"],
    ]);
  });

  test("an empty stat shows – with no note", () => {
    const tiles = clutchTiles(view({ overtime: wl(0, 0), oneGoal: wl(0, 0), oneGoalNoOt: wl(0, 0), scoredFirst: wl(0, 0), comebacks: { n: 0, of: 0 } }));
    const by = (label: string) => tiles.find((t) => t.label === label);
    expect(by("Overtime")).toMatchObject({ value: "–", note: undefined });
    expect(by("1-goal games")).toMatchObject({ value: "–", note: undefined });
    expect(by("Scored first")).toMatchObject({ value: "–", note: undefined });
    expect(by("Comebacks")).toMatchObject({ value: "–", note: undefined });
  });

  test("none out of some is 0%, not –", () => {
    expect(clutchTiles(view({ blownLeads: { n: 0, of: 5 } })).find((t) => t.label === "Blown leads")).toMatchObject({ value: "0%", note: "lost 0 of 5 after going 2+ up" });
  });
});

test("rung labels in words", () => {
  expect([0, 1, 2].map((i) => rungLabel("down", i))).toEqual(["1 down", "2 down", "3+ down"]);
  expect(rungLabel("up", 2)).toBe("3+ up");
});

describe("swingLink", () => {
  test("the best comeback opens its match", () => {
    expect(swingLink(view(), "down", "ranked", "anyone")).toEqual({ text: "Best: won 5–4 from 0–4", path: "/recap/S1/match/B?filter=ranked" });
  });

  test("the worst collapse keeps the With filter", () => {
    expect(swingLink(view(), "up", "everything", { friends: ["Epic|sam|0"] })).toEqual({
      text: "Worst: lost 3–4 after leading 2–0",
      path: "/recap/S2/match/W?filter=everything&with=Epic%7Csam%7C0",
    });
  });

  test("no link with no swing, or no session to open it in (it would open the latest recap)", () => {
    expect(swingLink(view({ best: null }), "down", "ranked", "anyone")).toBeNull();
    const orphan = view().worst;
    expect(swingLink(view({ worst: orphan && { ...orphan, sessionKey: null } }), "up", "ranked", "anyone")).toBeNull();
  });
});

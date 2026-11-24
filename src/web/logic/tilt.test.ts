import { describe, expect, test } from "vitest";
import type { TiltView } from "../../shared/schemas/responses";
import { tiltDisplay, TILT_NOTE } from "./tilt";

/** Counts from [won, played] pairs, as the prototype's demo slides wrote them. */
const view = (games: [number, number][], streaks: [number, number][], sessions = 0, endedOnLoss = 0): TiltView => ({
  games: games.map(([w, n]) => ({ w, l: n - w })) as TiltView["games"],
  streaks: streaks.map(([w, n]) => ({ w, l: n - w })) as TiltView["streaks"],
  sessions,
  endedOnLoss,
});
// The prototype's four demo slides, one per verdict.
const TILT = view([[52, 90], [46, 82], [38, 77], [38, 106]], [[90, 164], [44, 85], [17, 40], [11, 38]], 32, 24);
const NOSIGN = view([[45, 90], [41, 82], [37, 77], [52, 106]], [[72, 150], [40, 82], [31, 64], [29, 61]]);
const SOFAR = view([[28, 54], [27, 55], [30, 50], [22, 45]], [[52, 103], [26, 48], [12, 22], [9, 13]]);
const FEW = view([[7, 18], [3, 9], [2, 9], [9, 24]], [[6, 19], [5, 13], [1, 6], [4, 14]]);

describe("verdict", () => {
  test("each state's sentence", () => {
    expect(tiltDisplay(TILT).verdict).toEqual({ state: "tilt", text: "You drop in game 10+: 36% against 55% in your other matches (106 matches)." });
    expect(tiltDisplay(NOSIGN).verdict).toEqual({ state: "nosign", text: "No clear sign of tilt across 355 matches (49% won)." });
    expect(tiltDisplay(SOFAR).verdict).toEqual({ state: "sofar", text: "No sign of tilt so far, but only 13 matches after 3+ losses." });
    expect(tiltDisplay(FEW).verdict).toEqual({ state: "few", text: "Too few matches to tell yet: 60 in all, 6 after 2 losses." });
  });
});

describe("columns", () => {
  test("axis labels, % and counts, and a screen-reader line per column", () => {
    const d = tiltDisplay(TILT);
    expect(d.games.map((c) => c.label)).toEqual(["1–3", "4–6", "7–9", "10+"]);
    expect(d.streaks.map((c) => c.label)).toEqual(["a win", "1 loss", "2 losses", "3+ losses"]);
    expect(d.games[3]).toMatchObject({ pct: "36%", count: "106 matches", srLabel: "In game 10+: 36% won, 38 of 106 matches" });
  });

  test("an empty bucket shows – and 0 matches; one match is singular", () => {
    const d = tiltDisplay(view([[1, 1], [0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]]));
    expect(d.games[0]?.count).toBe("1 match");
    expect(d.games[1]).toMatchObject({ pct: "–", count: "0 matches" });
  });

  test("red past 2.5 SE below, outline only on the named dip, bold label on the named bucket, stripes under 60", () => {
    const d = tiltDisplay(TILT);
    const g10 = d.games[3];
    const l3 = d.streaks[3];
    expect(g10).toMatchObject({ tone: "below", outlined: true, named: true, thin: false });
    // 3+ losses is past the bar too, but the verdict names only the worst dip.
    expect(l3).toMatchObject({ tone: "below", outlined: false, named: false, thin: true });
    expect(d.streaks[2]).toMatchObject({ tone: "neutral", thin: true });
    expect(d.games[0]).toMatchObject({ tone: "neutral", outlined: false, named: false, thin: false });
  });

  test("green past 2.5 SE above", () => {
    const d = tiltDisplay(view([[70, 100], [40, 100], [40, 100], [40, 100]], [[100, 200], [30, 60], [30, 60], [30, 60]]));
    expect(d.games[0]?.tone).toBe("above");
  });

  test("never coloured under 10 matches; the thinnest bucket is named but not outlined", () => {
    const d = tiltDisplay(FEW);
    expect(d.streaks[2]).toMatchObject({ tone: "neutral", named: true, outlined: false });
  });
});

describe("legend", () => {
  test("a row for every mark shown, and only those", () => {
    expect(tiltDisplay(TILT).legend.map((r) => r.key)).toEqual(["avg", "range", "thin", "below", "neutral", "focus"]);
    expect(tiltDisplay(NOSIGN).legend.map((r) => r.key)).toEqual(["avg", "range", "neutral"]);
    expect(tiltDisplay(TILT).legend[0]?.text).toBe("your 49% average");
    // Every drawn column coloured: no "within chance" row (empty columns draw no bar).
    const coloured = view([[70, 100], [30, 100], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]]);
    expect(tiltDisplay(coloured).legend.map((r) => r.key)).toEqual(["avg", "range", "below", "above"]);
  });
});

describe("note", () => {
  test("sessions ended on a loss, then the fixed text; just the text with no ended session", () => {
    expect(tiltDisplay(TILT).note).toBe(`You ended 24 of 32 sessions on a loss. ${TILT_NOTE}`);
    expect(tiltDisplay(NOSIGN).note).toBe(TILT_NOTE);
  });
});

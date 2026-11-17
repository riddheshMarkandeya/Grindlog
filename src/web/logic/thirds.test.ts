import { describe, expect, test } from "vitest";
import type { MatchDetail } from "../../shared/schemas/responses";
import { matchThirdRows, sessionThirdRows, standardPitch, thirdPcts, thirdTitle } from "./thirds";

type Player = MatchDetail["players"][number];
const player = (name: string, teamNum: number | null, score: number, thirds: [number, number, number] | null, isMe = false) =>
  ({ playerKey: `Epic|${name}|0`, name, teamNum, score, thirds, isMe }) as Player;

describe("thirdPcts", () => {
  test("whole percents of the row's touches adding up to 100; null with none", () => {
    expect(thirdPcts([2, 1, 1])).toEqual([50, 25, 25]);
    // Rounded to add up to 100, so every bar fills its track.
    expect(thirdPcts([1, 1, 1])).toEqual([34, 33, 33]);
    expect(thirdPcts([1, 6, 1])).toEqual([13, 75, 12]);
    expect(thirdPcts([0, 0, 0])).toBeNull();
  });
});

describe("thirdTitle", () => {
  test("who, the third, its touches and share", () => {
    expect(thirdTitle("You", 0, 12, 40)).toBe("You · Defence · 12 touches · 40%");
    expect(thirdTitle("Opponents", 2, 1, 5)).toBe("Opponents · Attack · 1 touch · 5%");
  });
});

describe("matchThirdRows", () => {
  test("your team first with you on top, then the opponents by score; yours blue, theirs orange", () => {
    const rows = matchThirdRows([player("Opp", 0, 500, [1, 1, 1]), player("Mate", 1, 400, [2, 2, 2]), player("Me", 1, 100, [3, 3, 3], true)]);
    expect(rows?.map((r) => [r.name, r.tone, r.isMe])).toEqual([["Me", "blue", true], ["Mate", "blue", false], ["Opp", "orange", false]]);
  });

  test("with no team of yours, the game's blue team first, as on the scoreboard, in neutral shades (blue and orange mean your side and theirs)", () => {
    const rows = matchThirdRows([player("B", 1, 500, [1, 1, 1]), player("A", 0, 100, [2, 2, 2])]);
    expect(rows?.map((r) => [r.name, r.tone])).toEqual([["A", "neutral"], ["B", "neutral"]]);
  });

  test("players with no team are left out; any player not recomputed gives null", () => {
    expect(matchThirdRows([player("Me", 0, 1, [1, 1, 1], true), player("Ghost", null, 1, [1, 1, 1])])?.map((r) => r.name)).toEqual(["Me"]);
    expect(matchThirdRows([player("Me", 0, 1, [1, 1, 1], true), player("Opp", 1, 1, null)])).toBeNull();
    expect(matchThirdRows([])).toBeNull();
  });
});

describe("sessionThirdRows", () => {
  const thirds: [number, number, number][] = [[3, 2, 1], [1, 2, 1], [2, 2, 2], [5, 4, 3]];

  test("you, each friend, the rest of your team under its label, then the opponents", () => {
    expect(sessionThirdRows(thirds, ["Sam"], "Teammate").map((r) => [r.name, r.tone, r.thirds])).toEqual([
      ["You", "blue", [3, 2, 1]],
      ["Sam", "blue", [1, 2, 1]],
      ["Teammate", "blue", [2, 2, 2]],
      ["Opponents", "orange", [5, 4, 3]],
    ]);
  });

  test("no rest row when no one can be in it", () => {
    expect(sessionThirdRows([[3, 2, 1], [1, 2, 1], [0, 0, 0], [5, 4, 3]], ["Sam"], null).map((r) => r.name)).toEqual(["You", "Sam", "Opponents"]);
  });
});

describe("standardPitch", () => {
  test("Hoops, Dropshot and Knockout are played elsewhere; soccar variants, privates and unknown ids count", () => {
    expect([17, 27, 23, 29, 37, 70, 54].map(standardPitch)).toEqual(Array(7).fill(false));
    expect([11, 13, 18, 30, 63, 6, null, 999].map(standardPitch)).toEqual(Array(8).fill(true));
  });
});

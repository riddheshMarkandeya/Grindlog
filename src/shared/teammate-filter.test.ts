import { describe, expect, test } from "vitest";
import { teammateValue, withTeammate } from "./teammate-filter";

const SAM = "Epic|sam|0";
const ALEX = "Steam|76561198000000001|0";

describe("withTeammate", () => {
  test("anyone matches every match", () => {
    expect(withTeammate([], "anyone")).toBe(true);
    expect(withTeammate([SAM], "anyone")).toBe(true);
  });

  test("soloqueue is a match with no friend on your team", () => {
    expect(withTeammate([], "solo")).toBe(true);
    expect(withTeammate([SAM], "solo")).toBe(false);
  });

  test("one friend matches the matches they were on your team for", () => {
    expect(withTeammate([SAM], { friends: [SAM] })).toBe(true);
    expect(withTeammate([SAM, ALEX], { friends: [SAM] })).toBe(true);
    expect(withTeammate([ALEX], { friends: [SAM] })).toBe(false);
    expect(withTeammate([], { friends: [SAM] })).toBe(false);
  });

  test("a list needs every friend in it", () => {
    expect(withTeammate([SAM, ALEX], { friends: [SAM, ALEX] })).toBe(true);
    expect(withTeammate([SAM], { friends: [SAM, ALEX] })).toBe(false);
  });
});

describe("teammateValue", () => {
  test("is null for anyone, so the param is left out", () => {
    expect(teammateValue("anyone")).toBeNull();
    expect(teammateValue("solo")).toBe("solo");
    expect(teammateValue({ friends: [SAM] })).toBe(SAM);
  });
});

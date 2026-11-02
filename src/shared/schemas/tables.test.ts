import { describe, expect, test } from "vitest";
import { friendIdParams, friendNicknameParams, idStatus, NICKNAME_MAX, seasonInput } from "./tables";

describe("seasonInput", () => {
  test("a name is trimmed; the start is a real day", () => {
    expect(seasonInput.parse({ name: "  S25 ", start: "2026-12-09" })).toEqual({ name: "S25", start: "2026-12-09" });
  });

  test("a blank name, a name over 20 characters and a bad day are refused", () => {
    for (const bad of [
      { name: "   ", start: "2026-12-09" },
      { name: "x".repeat(21), start: "2026-12-09" },
      { name: "S25", start: "2026-02-30" },
      { name: "S25", start: "12/09/2026" },
      { name: "S25" },
    ]) {
      expect(seasonInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(seasonInput.safeParse({ name: "x".repeat(20), start: "2026-12-09" }).success).toBe(true);
  });
});

describe("idStatus", () => {
  test("only confirmed and rejected: a guess can't be un-answered", () => {
    expect(idStatus.parse("confirmed")).toBe("confirmed");
    expect(idStatus.parse("rejected")).toBe("rejected");
    expect(idStatus.safeParse("pending").success).toBe(false);
  });
});

describe("friend params", () => {
  test("a nickname is trimmed, blank or left out is none, and 32 characters is the most", () => {
    expect(friendNicknameParams.parse({ id: "Epic|sam|0", nickname: "  Sam  " })).toEqual({ id: "Epic|sam|0", nickname: "Sam" });
    expect(friendNicknameParams.parse({ id: "Epic|sam|0", nickname: "   " }).nickname).toBeNull();
    expect(friendNicknameParams.parse({ id: "Epic|sam|0" }).nickname).toBeNull();
    expect(friendNicknameParams.parse({ id: "Epic|sam|0", nickname: "x".repeat(NICKNAME_MAX) }).nickname).toHaveLength(32);
    expect(friendNicknameParams.safeParse({ id: "Epic|sam|0", nickname: "x".repeat(33) }).success).toBe(false);
  });

  test("an id is needed", () => {
    expect(friendIdParams.safeParse({}).success).toBe(false);
    expect(friendIdParams.safeParse({ id: "" }).success).toBe(false);
    expect(friendIdParams.parse({ id: "Epic|sam|0" })).toEqual({ id: "Epic|sam|0" });
  });
});

import { describe, expect, test, vi } from "vitest";
import { carryRest, carryShares, diffText, modeSwitch, namedPairs, overtimeNote, pageOf, pickKind, pickMode, pickSize, recordText, sideCopy, winPctText } from "./friends";

describe("pager", () => {
  test("ten a page, clamped to the pages there are", () => {
    const xs = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(xs, 0)).toEqual({ rows: xs.slice(0, 10), page: 0, pages: 3 });
    expect(pageOf(xs, 2).rows).toEqual([20, 21, 22]);
    expect(pageOf(xs, 9).page).toBe(2);
    expect(pageOf(xs, -1).page).toBe(0);
    expect(pageOf([], 0)).toEqual({ rows: [], page: 0, pages: 1 });
  });
});

describe("mode switch", () => {
  const modes = ["2", "3", "p3"] as const;
  test("a picked mode the friend lacks falls back to the default", () => {
    expect(pickMode(modes, "3", "p2")).toBe("3");
    expect(pickMode(modes, "3", "p3")).toBe("p3");
    expect(pickMode(modes, "3", null)).toBe("3");
    expect(pickMode([], null, "2")).toBeNull();
  });

  test("sizes are every size played; a kind is enabled when played at the current size", () => {
    expect(modeSwitch(modes, "2")).toEqual({
      sizes: [{ size: "2", pressed: true }, { size: "3", pressed: false }],
      kinds: [{ kind: "online", pressed: true, enabled: true }, { kind: "private", pressed: false, enabled: false }],
    });
    expect(modeSwitch(modes, "p3").kinds).toEqual([{ kind: "online", pressed: false, enabled: true }, { kind: "private", pressed: true, enabled: true }]);
  });

  test("picking a size keeps the kind if played there, else takes the other; picking a kind keeps the size", () => {
    expect(pickSize(modes, "p3", "2")).toBe("2");
    expect(pickSize(["2", "p2", "p3"], "p3", "2")).toBe("p2");
    expect(pickKind(modes, "3", "private")).toBe("p3");
    expect(pickKind(modes, "2", "private")).toBe("2");
  });
});

describe("carry", () => {
  test("each share of the team's total, and the even share for the team size", () => {
    expect(carryShares([300, 200, 500], "3")).toEqual({ pcts: [30, 20, 50], even: 100 / 3 });
    expect(carryShares([1, 1, 0], "p2")).toEqual({ pcts: [50, 50, 0], even: 50 });
    expect(carryShares([0, 0, 0], "2")).toBeNull();
    expect(carryShares([400, 300, 200, 100], "4")).toEqual({ pcts: [40, 30, 20, 10], even: 25 });
  });

  test("the rest is named only when a teammate besides you and the friends can be in it", () => {
    expect(carryRest("2", 1)).toBeNull();
    expect(carryRest("3", 1)).toBe("3rd teammate");
    expect(carryRest("p3", 1)).toBe("3rd teammate");
    expect(carryRest("4", 1)).toBe("Others");
    expect(carryRest("3", 2)).toBeNull();
    expect(carryRest("4", 2)).toBe("4th teammate");
    expect(carryRest("2", 0)).toBe("2nd teammate");
  });
});

describe("copy", () => {
  test("one friend keeps the single-friend words", () => {
    const { compareNote, ...words } = sideCopy(["Sammy"]);
    expect(compareNote("3v3", 4, 9)).toBe("Your 3v3 matches with them (4) against your other 3v3 matches (9), including ones where they were an opponent.");
    expect(words).toEqual({
      who: "Sammy",
      title: "Sammy",
      withHeading: "On your team",
      againstHeading: "On the other team",
      againstLabel: "head-to-head",
      withNote: "together",
      againstNote: "against them",
      versus: "you – Sammy",
      withEmpty: "You haven't teamed up with Sammy yet.",
      againstEmpty: "You haven't played against Sammy yet.",
      withColumn: "With Sammy",
      together: "together",
      anyOfYou: "either",
      theirColumns: "Their column is their scoreboard only.",
    });
  });

  test("a pair is \"A and B\", both on a side, and three numbers against", () => {
    const { compareNote, ...words } = sideCopy(["Kim", "Lee"]);
    expect(compareNote("4v4", 3, 0)).toBe("Your 4v4 matches with both on your team (3) against your 4v4 matches where neither was (0).");
    expect(words).toEqual({
      who: "Kim and Lee",
      title: "Kim + Lee",
      withHeading: "Both on your team",
      againstHeading: "Both on the other team",
      againstLabel: "against both",
      withNote: "all three",
      againstNote: "against both",
      versus: "you – Kim – Lee",
      withEmpty: "You haven't had Kim and Lee on your team together yet.",
      againstEmpty: "You haven't played against Kim and Lee on the same team yet.",
      withColumn: "With both",
      together: "with both",
      anyOfYou: "any",
      theirColumns: "Their columns are their scoreboard only.",
    });
  });
});

describe("records", () => {
  test("w–l, and the win % over decided matches", () => {
    expect(recordText({ w: 12, l: 9 })).toBe("12–9");
    expect(winPctText({ w: 2, l: 1 })).toBe("67%");
    expect(winPctText({ w: 0, l: 0 })).toBe("–");
  });
});

describe("pairs", () => {
  test("each pair gets both names; a pair naming someone not in the list is warned about and skipped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const friends = [{ id: "k", name: "Kim" }, { id: "l", name: "Lee" }];
    const kl = { ids: ["k", "l"] as const, n: 3 };
    const kx = { ids: ["k", "x"] as const, n: 4 };
    expect(namedPairs({ friends, pairs: [kl, kx] })).toEqual([{ pair: kl, a: "Kim", b: "Lee" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[rlt] friends/pair_unnamed", { ids: ["k", "x"] });
    warn.mockRestore();
  });
});

describe("overtime and compare text", () => {
  test("the overtime note counts decided matches, so a no-result doesn't dilute it", () => {
    const withNoResult = { w: 2, l: 2, n: 5 };
    expect(overtimeNote(withNoResult)).toBe("50% of 4");
    expect(overtimeNote({ w: 1, l: 0 })).toBe("100% of 1");
  });

  test("a difference takes its sign and direction from the text it prints", () => {
    expect(diffText(0.001)).toEqual({ text: "0", dir: 0 });
    expect(diffText(-0.004)).toEqual({ text: "0", dir: 0 });
    expect(diffText(0)).toEqual({ text: "0", dir: 0 });
    expect(diffText(1.256)).toEqual({ text: "+1.26", dir: 1 });
    expect(diffText(-0.5)).toEqual({ text: "−0.5", dir: -1 });
    expect(diffText(1234)).toEqual({ text: "+1,234", dir: 1 });
    expect(diffText(-7, true)).toEqual({ text: "−7", dir: -1 });
  });
});

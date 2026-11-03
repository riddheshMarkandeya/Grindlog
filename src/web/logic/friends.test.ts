import { describe, expect, test } from "vitest";
import { carryShares, modeSwitch, pageOf, pickKind, pickMode, pickSize, recordText, winPctText } from "./friends";

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
});

describe("records", () => {
  test("w–l, and the win % over decided matches", () => {
    expect(recordText({ w: 12, l: 9 })).toBe("12–9");
    expect(winPctText({ w: 2, l: 1 })).toBe("67%");
    expect(winPctText({ w: 0, l: 0 })).toBe("–");
  });
});

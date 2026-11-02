import { describe, expect, test } from "vitest";
import { filterValue } from "../../shared/playlist-filter";
import { filterLabel, filterOptions, parseFilter, parseTeammate, teammateMissing } from "./filter-options";

const flat = (groups: ReturnType<typeof filterOptions>) => groups.map((g) => [g.label, g.options.map((o) => `${o.value}=${o.label}`)]);

describe("filterOptions", () => {
  test("only groups with a playlist present, each with its 'All' entry, in id order", () => {
    expect(flat(filterOptions([11, 2, 10, 53, 17], "everything"))).toEqual([
      [null, ["everything=Everything (excl. private)"]],
      ["Ranked", ["ranked=All ranked", "10=Ranked Duel", "11=Ranked Doubles"]],
      ["Casual", ["casual=All casual", "2=Doubles"]],
      ["Extra modes", ["extra=All extra modes", "17=Hoops", "53=Honor Duel"]],
    ]);
  });

  test("private, then unmapped, offline and tournament ids under Other", () => {
    expect(flat(filterOptions([6, 999, 8, 34], "everything")).slice(1)).toEqual([
      ["Private", ["private=Private matches"]],
      ["Other", ["8=Exhibition", "34=Official Tournament", "999=Unknown playlist (999)"]],
    ]);
  });

  test("the selected filter stays listed when nothing in it is present", () => {
    expect(flat(filterOptions([], { playlist: 13 }))).toEqual([
      [null, ["everything=Everything (excl. private)"]],
      ["Other", ["13=Ranked Standard"]],
    ]);
    expect(flat(filterOptions([2], "ranked"))).toContainEqual(["Other", ["ranked=All ranked"]]);
  });
});

describe("filterLabel", () => {
  test("a filter's name for a reader, outside the dropdown", () => {
    expect(filterLabel("everything")).toBe("Everything (excl. private)");
    expect(filterLabel("ranked")).toBe("All ranked");
    expect(filterLabel("private")).toBe("Private matches");
    expect(filterLabel({ playlist: 11 })).toBe("Ranked Doubles");
    expect(filterLabel({ playlist: 99 })).toBe("Unknown playlist (99)");
  });
});

describe("teammate in the URL", () => {
  test("left out is anyone; solo or an id; a bad value is anyone and bad", () => {
    expect(parseTeammate(null)).toEqual({ teammate: "anyone", bad: false });
    expect(parseTeammate("solo")).toEqual({ teammate: "solo", bad: false });
    expect(parseTeammate("Epic|sam|0")).toEqual({ teammate: { friends: ["Epic|sam|0"] }, bad: false });
    expect(parseTeammate("anyone")).toEqual({ teammate: "anyone", bad: true });
  });
});

describe("teammateMissing", () => {
  const sam = [{ id: "Epic|sam|0" }];
  test("anyone and soloqueue always fit; a friend must be offered", () => {
    expect(teammateMissing("anyone", [])).toBe(false);
    expect(teammateMissing("solo", [])).toBe(false);
    expect(teammateMissing("solo", sam)).toBe(false);
    expect(teammateMissing({ friends: ["Epic|sam|0"] }, sam)).toBe(false);
    expect(teammateMissing({ friends: ["Epic|alex|0"] }, sam)).toBe(true);
  });
});

describe("filter in the URL", () => {
  test("a filter round-trips through its query value", () => {
    for (const f of ["everything", "ranked", "casual", "extra", "private", { playlist: 53 }] as const) expect(parseFilter(filterValue(f))).toEqual({ filter: f, bad: false });
  });

  test("left out means everything; a bad value falls back to everything and says so", () => {
    expect(parseFilter(null)).toEqual({ filter: "everything", bad: false });
    expect(parseFilter("bogus")).toEqual({ filter: "everything", bad: true });
  });

  test("a page's default filter stands in for a missing or bad value, never for a real one", () => {
    expect(parseFilter(null, "ranked")).toEqual({ filter: "ranked", bad: false });
    expect(parseFilter("bogus", "casual")).toEqual({ filter: "casual", bad: true });
    expect(parseFilter("everything", "ranked")).toEqual({ filter: "everything", bad: false });
  });
});

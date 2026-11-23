import { describe, expect, test } from "vitest";
import { filterValue } from "../../shared/playlist-filter";
import { filterLabel, filterOptions, offeredFriends, parseFilter, parseTeammate, friendChoices, pairsTogether, recapReset, teammateLabel, teammateMissing, toggleFriend, togetherInMatches } from "./filter-options";

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

  test("a pair: two distinct friend ids, sorted into one value; three, a repeat, an empty half or a malformed id are bad", () => {
    expect(parseTeammate("Epic|sam|0,Epic|alex|0")).toEqual({ teammate: { friends: ["Epic|alex|0", "Epic|sam|0"] }, bad: false });
    expect(parseTeammate("Epic|alex|0,Epic|sam|0")).toEqual({ teammate: { friends: ["Epic|alex|0", "Epic|sam|0"] }, bad: false });
    for (const v of ["Epic|a|0,Epic|b|0,Epic|c|0", "Epic|a|0,Epic|a|0", "Epic|a|0,", ",Epic|a|0", "Epic|a|0,nobars", "solo,Epic|a|0"])
      expect(parseTeammate(v), v).toEqual({ teammate: "anyone", bad: true });
    expect(parseTeammate(`${"x|".repeat(51)},Epic|a|0`).bad).toBe(true);
  });
});

describe("toggleFriend", () => {
  const SAM = "Epic|sam|0", ALEX = "Epic|alex|0", KIM = "Epic|kim|0";
  test("a tick from Anyone or Soloqueue starts a one-friend filter", () => {
    expect(toggleFriend("anyone", SAM)).toEqual({ friends: [SAM] });
    expect(toggleFriend("solo", SAM)).toEqual({ friends: [SAM] });
  });

  test("a second tick makes the pair, in key order whichever was ticked first", () => {
    expect(toggleFriend({ friends: [SAM] }, ALEX)).toEqual({ friends: [ALEX, SAM] });
    expect(toggleFriend({ friends: [ALEX] }, SAM)).toEqual({ friends: [ALEX, SAM] });
  });

  test("unticking leaves the other friend, and the last one goes back to Anyone", () => {
    expect(toggleFriend({ friends: [ALEX, SAM] }, ALEX)).toEqual({ friends: [SAM] });
    expect(toggleFriend({ friends: [SAM] }, SAM)).toBe("anyone");
  });

  test("a third tick is ignored", () => {
    const pair = { friends: [ALEX, SAM] };
    expect(toggleFriend(pair, KIM)).toBe(pair);
  });
});

describe("friendChoices", () => {
  const SAM = "Epic|sam|0", ALEX = "Epic|alex|0", KIM = "Epic|kim|0";
  const friends = [{ id: SAM, name: "Sam" }, { id: ALEX, name: "Alex" }, { id: KIM, name: "Kim" }];
  // Sam has played with Alex, never with Kim.
  const together = (a: string, b: string) => [a, b].includes(SAM) && [a, b].includes(ALEX);
  const row = (rows: ReturnType<typeof friendChoices>, id: string) => rows.find((r) => r.id === id);

  test("nobody is greyed with no friend ticked", () => {
    for (const v of ["anyone", "solo"] as const) {
      expect(friendChoices(v, friends, together, "trends").map((r) => [r.name, r.disabled, r.reason])).toEqual([
        ["Sam", false, null], ["Alex", false, null], ["Kim", false, null],
      ]);
    }
  });

  test("one friend ticked greys those never alongside them, worded per page", () => {
    const trends = friendChoices({ friends: [SAM] }, friends, together, "trends");
    expect(row(trends, SAM)).toMatchObject({ disabled: false, reason: null });
    expect(row(trends, ALEX)).toMatchObject({ disabled: false, reason: null });
    expect(row(trends, KIM)).toMatchObject({ disabled: true, reason: "Not enough matches with Sam on your team" });
    expect(row(friendChoices({ friends: [SAM] }, friends, together, "recap"), KIM)?.reason).toBe("Not on your team with Sam this session");
  });

  test("two ticked grey every third friend, and a checked friend is never greyed", () => {
    const rows = friendChoices({ friends: [ALEX, KIM] }, friends, () => false, "trends");
    expect(row(rows, SAM)).toMatchObject({ disabled: true, reason: "Two friends at most" });
    expect(row(rows, ALEX)).toMatchObject({ disabled: false, reason: null });
    expect(row(rows, KIM)).toMatchObject({ disabled: false, reason: null });
  });
});

describe("pairsTogether", () => {
  const SAM = "Epic|sam|0", ALEX = "Epic|alex|0", KIM = "Epic|kim|0";
  test("a listed pair is together either way round; an unlisted one isn't", () => {
    const together = pairsTogether([{ pair: { ids: [ALEX, SAM] } }]);
    expect(together(SAM, ALEX)).toBe(true);
    expect(together(ALEX, SAM)).toBe(true);
    expect(together(SAM, KIM)).toBe(false);
  });

  test("while the pairs load, nobody is ruled out", () => {
    expect(pairsTogether(undefined)(SAM, KIM)).toBe(true);
  });
});

describe("togetherInMatches", () => {
  const SAM = "Epic|sam|0", ALEX = "Epic|alex|0", KIM = "Epic|kim|0";
  test("while the shown matches are the previous filter's (undefined), nobody is ruled out", () => {
    expect(togetherInMatches(undefined)("Epic|sam|0", "Epic|alex|0")).toBe(true);
  });

  test("together when one shown match had both on your team", () => {
    const together = togetherInMatches([{ friends: [SAM] }, { friends: [SAM, ALEX] }, { friends: [KIM] }]);
    expect(together(SAM, ALEX)).toBe(true);
    expect(together(ALEX, SAM)).toBe(true);
    expect(together(SAM, KIM)).toBe(false);
  });
});

describe("teammateLabel", () => {
  const friends = [{ id: "Epic|alex|0", name: "Alex" }, { id: "Epic|sam|0", name: "Sam" }];
  test("names the filter as the closed With button shows it", () => {
    expect(teammateLabel("anyone", friends)).toBe("Anyone");
    expect(teammateLabel("solo", friends)).toBe("Soloqueue");
    expect(teammateLabel({ friends: ["Epic|sam|0"] }, friends)).toBe("Sam");
    expect(teammateLabel({ friends: ["Epic|alex|0", "Epic|sam|0"] }, friends)).toBe("Alex + Sam");
  });
});

describe("recapReset", () => {
  const both = [{ id: "Epic|alex|0" }, { id: "Epic|sam|0" }];
  const pair = { friends: ["Epic|alex|0", "Epic|sam|0"] };
  test("a pair who both played in the session but never together resets, as one missing does", () => {
    expect(recapReset(pair, { friendsPresent: both, summary: null })).toBe("not_together");
    expect(recapReset(pair, { friendsPresent: both, summary: {} })).toBeNull();
    expect(recapReset(pair, { friendsPresent: both.slice(1), summary: null })).toBe("not_in_session");
  });

  test("a single friend or soloqueue resets only when missing", () => {
    expect(recapReset({ friends: ["Epic|sam|0"] }, { friendsPresent: both, summary: {} })).toBeNull();
    expect(recapReset({ friends: ["Epic|kim|0"] }, { friendsPresent: both, summary: null })).toBe("not_in_session");
    expect(recapReset("solo", { friendsPresent: [], summary: null })).toBeNull();
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

  test("Trends offers only friends ever on your team, so an opponent-only friend resets to Anyone", () => {
    const card = (id: string, n: number) => ({ id, name: id, with: { w: 0, l: 0, n } });
    const offered = offeredFriends([card("Epic|sam|0", 3), card("Epic|alex|0", 0)]);
    expect(offered.map((f) => f.id)).toEqual(["Epic|sam|0"]);
    expect(teammateMissing({ friends: ["Epic|alex|0"] }, offered)).toBe(true);
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

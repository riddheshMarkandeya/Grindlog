import { expect, test } from "vitest";
import { staleAfterLive, staleAfterTables } from "./invalidation";

const q = (queryKey: readonly unknown[]) => ({ queryKey });

test("after a match or a break, settings are spared: only a save changes them, and it writes the answer into the cache", () => {
  expect(staleAfterLive(q(["settings"]))).toBe(false);
});

test("after a match or a break, every session detail is stale, an older one with a next session included", () => {
  expect(staleAfterLive(q(["session", "A", "everything"]))).toBe(true);
  const older = { queryKey: ["session", "A", "everything"], state: { data: { key: "A", next: "B", day: "2026-10-01", nextMonth: "N" } } };
  expect(staleAfterLive(older)).toBe(true);
});

test("after a match or a break, every other key is stale by default, lists and keys added later alike", () => {
  expect(staleAfterLive(q(["sessions", "list", "everything", "2026-10-01", "2026-10-14"]))).toBe(true);
  expect(staleAfterLive(q(["ids"]))).toBe(true);
  expect(staleAfterLive(q(["something-new"]))).toBe(true);
});

test("after an ids or seasons save, everything but settings and the two tables is stale", () => {
  // Neither table's rows depend on the other's, and the save put its own answer in the cache.
  expect(staleAfterTables(q(["ids"]))).toBe(false);
  expect(staleAfterTables(q(["seasons"]))).toBe(false);
  expect(staleAfterTables(q(["settings"]))).toBe(false);
  expect(staleAfterTables(q(["session", "A", "everything"]))).toBe(true);
  expect(staleAfterTables(q(["period", "last7", "ranked"]))).toBe(true);
  expect(staleAfterTables(q(["something-new"]))).toBe(true);
  // A friend write can move a pair's page, which isn't listed anywhere here.
  expect(staleAfterTables(q(["friend-pair", "Epic|a|0", "Epic|b|0"]))).toBe(true);
});

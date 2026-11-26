import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { invalidateFresh, staleAfterLive, staleAfterTables } from "./invalidation";

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

// The first fetch waits for the test to answer it ("old", read before the change); every later one
// answers "new" at once.
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  let calls = 0;
  let answerFirst: ((value: string) => void) | undefined;
  const queryFn = (): Promise<string> => {
    calls += 1;
    return calls === 1 ? new Promise((resolve) => (answerFirst = resolve)) : Promise.resolve("new");
  };
  const observe = (queryKey: readonly unknown[]) => {
    const observer = new QueryObserver<string>(client, { queryKey, queryFn });
    return { observer, unsubscribe: observer.subscribe(() => undefined) };
  };
  return { client, observe, calls: () => calls, answerFirst: () => { answerFirst?.("old"); } };
}

test("library behaviour this exists for: a plain invalidate during a first fetch joins it and keeps its old answer", async () => {
  const { client, observe, calls, answerFirst } = harness();
  const { observer, unsubscribe } = observe(["seasons"]);
  const invalidated = client.invalidateQueries();
  answerFirst();
  await invalidated;
  await vi.waitFor(() => { expect(observer.getCurrentResult().data).toBe("old"); });
  expect(calls()).toBe(1);
  unsubscribe();
});

test("an invalidate during a first fetch starts a new fetch, and its answer wins without an error", async () => {
  const { client, observe, calls, answerFirst } = harness();
  const { observer, unsubscribe } = observe(["seasons"]);
  const invalidated = invalidateFresh(client);
  answerFirst();
  await invalidated;
  await vi.waitFor(() => { expect(observer.getCurrentResult().data).toBe("new"); });
  expect(calls()).toBe(2);
  expect(observer.getCurrentResult().isError).toBe(false);
  unsubscribe();
});

test("a query that already has data refetches as before", async () => {
  const { client, observe, calls, answerFirst } = harness();
  const { observer, unsubscribe } = observe(["seasons"]);
  answerFirst();
  await vi.waitFor(() => { expect(observer.getCurrentResult().data).toBe("old"); });
  await invalidateFresh(client);
  await vi.waitFor(() => { expect(observer.getCurrentResult().data).toBe("new"); });
  expect(calls()).toBe(2);
  unsubscribe();
});

test("a first fetch the predicate spares is neither cancelled nor refetched", async () => {
  const { client, observe, calls, answerFirst } = harness();
  const { observer, unsubscribe } = observe(["settings"]);
  const invalidated = invalidateFresh(client, staleAfterLive);
  answerFirst();
  await invalidated;
  await vi.waitFor(() => { expect(observer.getCurrentResult().data).toBe("old"); });
  expect(calls()).toBe(1);
  unsubscribe();
});

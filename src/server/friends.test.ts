import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createFriends } from "./friends";
import { createQueryReader } from "./query/read";
import { createRecordWriter } from "./records/save";
import { openStorage, type Storage } from "./storage";
import { ME, memoryLogger, player, record, THEM } from "./testing";

const SAM = "Epic|sam|0";
const BOT = "Bot|bot|0";

let dir: string;
let storage: Storage;
let logger: ReturnType<typeof memoryLogger>;
let now = 0;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "grindlog-friends-"));
  logger = memoryLogger();
  storage = openStorage({ dir, logger: memoryLogger() });
  storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', 1)", ME);
  createRecordWriter({ tracker: storage.tracker, logger: memoryLogger(), now: () => 1 }).save(
    record("G", 1000, { players: [player(ME, 0), player(SAM, 0, { name: "Sam" }), player(BOT, 0, { isBot: true }), player(THEM, 1, { name: "Them" })] }),
  );
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const friends = () => {
  const reader = createQueryReader({ tracker: storage.tracker, logger: memoryLogger() });
  return { store: createFriends({ tracker: storage.tracker, logger, now: () => (now += 1) }), reader };
};
const events = () => logger.lines.filter((l) => l.cat === "friends").map((l) => [l.event, l.fields]);
const neverSuggested = () => storage.tracker.all<{ primary_id: string }>("SELECT primary_id FROM never_suggest").map((r) => r.primary_id);

describe("friends store", () => {
  test("add a teammate or an opponent, with or without a nickname", () => {
    const { store, reader } = friends();
    expect(store.add(SAM, "Sammy")).toEqual({ ok: true });
    expect(store.add(THEM, null)).toEqual({ ok: true });
    expect(reader.readFriends()).toEqual([
      { id: SAM, nickname: "Sammy", name: "Sammy" },
      { id: THEM, nickname: null, name: "Them" },
    ]);
    expect(events()).toEqual([
      ["added", { id: SAM, nickname: true }],
      ["added", { id: THEM, nickname: false }],
    ]);
  });

  test("add refuses a bot, one of your ids, someone never seen, and an existing friend", () => {
    const { store } = friends();
    expect(store.add(BOT, null)).toEqual({ ok: false, error: "not_found" });
    expect(store.add(ME, null)).toEqual({ ok: false, error: "not_found" });
    expect(store.add("Epic|nobody|0", null)).toEqual({ ok: false, error: "not_found" });
    store.add(SAM, null);
    expect(store.add(SAM, "again")).toEqual({ ok: false, error: "conflict" });
    expect(events().map(([e]) => e)).toEqual(["refused", "refused", "refused", "added", "refused"]);
  });

  test("remove puts the friend on never-suggest; remove, re-add, remove works", () => {
    const { store, reader } = friends();
    store.add(SAM, null);
    expect(store.remove(SAM)).toEqual({ ok: true });
    expect(reader.readFriends()).toEqual([]);
    expect(neverSuggested()).toEqual([SAM]);
    expect(store.add(SAM, null).ok).toBe(true);
    expect(neverSuggested()).toEqual([]);
    expect(store.remove(SAM)).toEqual({ ok: true });
    expect(neverSuggested()).toEqual([SAM]);
    expect(store.remove(SAM)).toEqual({ ok: false, error: "not_found" });
  });

  test("a nickname is set and cleared on a friend only", () => {
    const { store, reader } = friends();
    expect(store.setNickname(SAM, "x")).toEqual({ ok: false, error: "not_found" });
    store.add(SAM, null);
    expect(store.setNickname(SAM, "Sammy")).toEqual({ ok: true });
    expect(reader.readFriends()).toEqual([{ id: SAM, nickname: "Sammy", name: "Sammy" }]);
    expect(store.setNickname(SAM, null)).toEqual({ ok: true });
    expect(reader.readFriends()).toEqual([{ id: SAM, nickname: null, name: "Sam" }]);
  });

  test("never-suggest: anyone not a friend, twice is fine, a friend is refused", () => {
    const { store } = friends();
    expect(store.neverSuggest(THEM)).toEqual({ ok: true });
    expect(store.neverSuggest(THEM)).toEqual({ ok: true });
    store.add(SAM, null);
    expect(store.neverSuggest(SAM)).toEqual({ ok: false, error: "conflict" });
    expect(neverSuggested()).toEqual([THEM]);
  });

  test("suggest again takes someone off never-suggest, and refuses someone not on it", () => {
    const { store } = friends();
    store.neverSuggest(THEM);
    expect(store.suggestAgain(THEM)).toEqual({ ok: true });
    expect(neverSuggested()).toEqual([]);
    expect(store.suggestAgain(THEM)).toEqual({ ok: false, error: "not_found" });
    expect(events().slice(-2)).toEqual([
      ["suggest_again", { id: THEM }],
      ["refused", { action: "suggest_again", id: THEM, error: "not_found" }],
    ]);
  });
});

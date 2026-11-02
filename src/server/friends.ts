// The friends table's writes. A friend is one PrimaryId of a human seen in any match, teammate or
// opponent, never one of your ids. Matches aren't touched: the readers join friends at query time,
// so adding or removing one re-labels every match. Removing a friend puts them on never-suggest.
import type { Friend } from "../shared/schemas/responses";
import type { Db } from "./db/sqlite";
import type { Logger } from "./log";
import { MINE, type QueryReader } from "./query/read";

const C = "friends";

export type FriendWrite = { ok: true; friends: Friend[] } | { ok: false; error: "not_found" | "conflict" };

export function createFriends({ tracker, reader, logger, now = Date.now }: { tracker: Db; reader: QueryReader; logger: Logger; now?: () => number }) {
  const isFriend = (id: string) => tracker.get("SELECT 1 FROM friends WHERE primary_id = ?", id) !== undefined;

  function refused(action: string, id: string, error: "not_found" | "conflict"): FriendWrite {
    logger.warn(C, "refused", { action, id, error });
    return { ok: false, error };
  }

  const done = (): FriendWrite => ({ ok: true, friends: reader.readFriends() });

  function add(id: string, nickname: string | null): FriendWrite {
    return tracker.transaction(() => {
      const seen = tracker.get(
        `SELECT 1 FROM match_players WHERE primary_id = ? AND is_bot = 0 AND primary_id NOT IN (${MINE})`,
        id,
      );
      if (seen === undefined) return refused("add", id, "not_found");
      if (isFriend(id)) return refused("add", id, "conflict");
      tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, ?, ?)", id, nickname, now());
      tracker.run("DELETE FROM never_suggest WHERE primary_id = ?", id);
      logger.info(C, "added", { id, nickname: nickname !== null });
      return done();
    });
  }

  function setNickname(id: string, nickname: string | null): FriendWrite {
    return tracker.transaction(() => {
      if (!isFriend(id)) return refused("nickname", id, "not_found");
      tracker.run("UPDATE friends SET nickname = ? WHERE primary_id = ?", nickname, id);
      logger.info(C, "nickname", { id, nickname: nickname !== null });
      return done();
    });
  }

  function remove(id: string): FriendWrite {
    return tracker.transaction(() => {
      if (!isFriend(id)) return refused("remove", id, "not_found");
      tracker.run("DELETE FROM friends WHERE primary_id = ?", id);
      tracker.run("INSERT OR IGNORE INTO never_suggest (primary_id, added_at) VALUES (?, ?)", id, now());
      logger.info(C, "removed", { id });
      return done();
    });
  }

  function neverSuggest(id: string): FriendWrite {
    return tracker.transaction(() => {
      if (isFriend(id)) return refused("never_suggest", id, "conflict");
      tracker.run("INSERT OR IGNORE INTO never_suggest (primary_id, added_at) VALUES (?, ?)", id, now());
      logger.info(C, "never_suggest", { id });
      return done();
    });
  }

  return { add, setNickname, remove, neverSuggest };
}

export type Friends = ReturnType<typeof createFriends>;

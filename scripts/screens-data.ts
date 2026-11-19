// Makes the landing page's screenshot data: a pseudonymised copy of a real tracker.db, so the
// screens show real-looking sessions without a real name or account id. `bun run screens-data
// [--from <dir>] [--since YYYY-MM-DD] [--max-matches N]`; the source defaults to GrindlogDev and
// is only ever read. The copy goes to %TEMP%\grindlog-screens, never the repo.
//
// Every non-bot primary id becomes `<Platform>|fake-N|0` (the prefix stays, since the dashboard
// shows the platform), every player name the one gamertag picked for that id, and every friend
// nickname a fake one. Bots keep their names: they are the game's, not anyone's. A final scan of
// every text cell fails the run if any original id or name is left.
//
// Console only, like move-data: it never loads the app's logger.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localAppDataDir } from "../src/server/paths";
import { resolveDir } from "./move-data";

export interface Args {
  from: string | undefined;
  /** Epoch ms of local midnight on the --since date. */
  since: number | undefined;
  maxMatches: number | undefined;
}

export function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { from: undefined, since: undefined, maxMatches: undefined };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) return null;
    switch (argv[i]) {
      case "--from":
        args.from = value;
        break;
      case "--since": {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!m) return null;
        const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
        const date = new Date(y, mo, d);
        // Date rolls 2026-13-01 over into 2027; a date that doesn't round-trip isn't one.
        if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
        args.since = date.getTime();
        break;
      }
      case "--max-matches":
        if (!/^[1-9]\d*$/.test(value)) return null;
        args.maxMatches = Number(value);
        break;
      default:
        return null;
    }
  }
  return args;
}

export const fakeId = (realId: string, n: number) => `${realId.split("|", 1)[0] ?? realId}|fake-${String(n)}|0`;

const FIRST = [
  "Turbo", "Nitro", "Zoomy", "Sneaky", "Boosted", "Flippin", "Lazy", "Cosmic", "Rusty", "Salty", "Chill", "Mighty",
  "Wobbly", "Crispy", "Sleepy", "Spicy", "Fuzzy", "Lucky", "Grumpy", "Jolly", "Rapid", "Silent", "Clumsy", "Brave",
  "Dizzy", "Feral", "Golden", "Hyper", "Icy", "Jumpy", "Mellow", "Noisy", "Pocket", "Quick", "Rogue", "Stormy",
];
const SECOND = [
  "Goose", "Otter", "Falcon", "Badger", "Pigeon", "Walrus", "Panda", "Comet", "Rocket", "Wombat", "Moose", "Gecko",
  "Kraken", "Lobster", "Mantis", "Narwhal", "Possum", "Raccoon", "Squid", "Toucan", "Viking", "Yeti", "Bison", "Cobra",
  "Dingo", "Ferret", "Hornet", "Iguana", "Jackal", "Koala", "Lynx", "Marmot", "Puffin", "Quokka", "Sloth", "Tiger",
];

/**
 * Endless distinct made-up gamertags, in the same order every run. Neighbours differ in both words
 * (so a scoreboard doesn't read as "TurboGoose, TurboOtter, …"), and past the word grid a number
 * is appended. Anything in `avoid` (lower-case) is skipped, so no real name is ever handed out.
 */
export function* gamertags(avoid: ReadonlySet<string>): Generator<string, never> {
  const grid = FIRST.length * SECOND.length;
  for (let i = 0; ; i++) {
    const cell = i % grid;
    const a = cell % FIRST.length;
    // (a, (a + row) % len) visits every pair once per grid: row is recovered as (b - a) mod len.
    const b = (a + Math.floor(cell / FIRST.length)) % SECOND.length;
    const round = Math.floor(i / grid);
    const tag = (FIRST[a] ?? "") + (SECOND[b] ?? "") + (round === 0 ? "" : String(round + 1));
    if (!avoid.has(tag.toLowerCase())) yield tag;
  }
}

const NICKNAMES = ["The Wall", "Captain", "Boost Thief", "Ceiling Guy", "Big Dog", "Coach", "Professor", "Wildcard"];

export interface Pseudonyms {
  /** Real id → its fake id, and the one fake name it shows under. */
  player: Map<string, { id: string; name: string }>;
  /** Real nickname → fake nickname. */
  nickname: Map<string, string>;
}

export function buildPseudonyms({ ids, realNames, nicknames }: { ids: readonly string[]; realNames: readonly string[]; nicknames: readonly string[] }): Pseudonyms {
  const avoid = new Set([...realNames, ...nicknames].map((n) => n.toLowerCase()));
  const tags = gamertags(avoid);
  const player = new Map(ids.map((real, i) => [real, { id: fakeId(real, i + 1), name: tags.next().value }]));
  const nickname = new Map<string, string>();
  const nickAvoid = new Set([...avoid, ...[...player.values()].map((v) => v.name.toLowerCase())]);
  let n = 0;
  for (const real of nicknames) {
    if (nickname.has(real)) continue;
    let fake: string;
    do {
      const round = Math.floor(n / NICKNAMES.length);
      fake = (NICKNAMES[n % NICKNAMES.length] ?? "") + (round === 0 ? "" : ` ${String(round + 1)}`);
      n++;
    } while (nickAvoid.has(fake.toLowerCase()));
    nickname.set(real, fake);
  }
  return { player, nickname };
}

export interface Forbidden {
  ids: readonly string[];
  /** The account part of each id (the middle segment), in case one is stored bare. */
  idParts: readonly string[];
  names: readonly string[];
}

export interface Cell {
  where: string;
  value: string;
}

export interface Leak {
  where: string;
  kind: "id" | "name" | "path";
  value: string;
}

// The Windows username sits in any C:\Users\... path.
const USER_PATH = /[a-z]:[\\/]+users[\\/]/i;

/**
 * Cells still holding an original. Ids are long and unique, so they count anywhere in a cell.
 * Names can be short ordinary words ("Max"), so they count only as a whole cell or a whole JSON
 * string, never as part of a word.
 */
export function findLeaks(cells: Iterable<Cell>, forbidden: Forbidden): Leak[] {
  const ids = [...forbidden.ids, ...forbidden.idParts].map((s) => s.toLowerCase());
  const names = new Set(forbidden.names.map((s) => s.toLowerCase()));
  const quoted = [...names].map((n) => JSON.stringify(n).toLowerCase());
  const leaks: Leak[] = [];
  for (const { where, value } of cells) {
    const v = value.toLowerCase();
    if (ids.some((id) => v.includes(id))) leaks.push({ where, kind: "id", value });
    else if (names.has(v) || quoted.some((q) => v.includes(q))) leaks.push({ where, kind: "name", value });
    else if (USER_PATH.test(value)) leaks.push({ where, kind: "path", value });
  }
  return leaks;
}

/** Keeps the newest matches inside the window, and drops every row that hung off the rest. */
export function trim(db: Database, { since, maxMatches }: { since?: number; maxMatches?: number }): { dropped: number } {
  const before = matchCount(db);
  db.transaction(() => {
    if (since !== undefined) db.run("DELETE FROM matches WHERE started_at < ?", [since]);
    if (maxMatches !== undefined) {
      db.run("DELETE FROM matches WHERE guid NOT IN (SELECT guid FROM matches ORDER BY started_at DESC, guid DESC LIMIT ?)", [maxMatches]);
    }
    for (const t of ["match_players", "match_player_statfeed", "match_goals"]) db.run(`DELETE FROM ${t} WHERE match_guid NOT IN (SELECT guid FROM matches)`);
    // A session's key is its first match's guid, so a remark row whose key matches no remaining
    // match belongs to a session that's gone, or re-keyed because the cut fell inside it.
    for (const t of ["remark_picks", "remark_shown"]) db.run(`DELETE FROM ${t} WHERE session_key NOT IN (SELECT guid FROM matches)`);
  })();
  return { dropped: before - matchCount(db) };
}

const matchCount = (db: Database) => (db.query("SELECT count(*) AS n FROM matches").get() as { n: number }).n;
const column = (db: Database, sql: string) => (db.query(sql).values() as [string | null][]).flatMap(([v]) => (v === null ? [] : [v]));

// Every column holding a player key or primary id. A bot's player key is `bot:<Name>`, never mapped.
const ID_COLUMNS: readonly [table: string, col: string][] = [
  ["match_players", "player_key"],
  ["match_players", "primary_id"],
  ["match_player_statfeed", "player_key"],
  ["match_goals", "scorer_key"],
  ["match_goals", "assister_key"],
  ["match_goals", "toucher_key"],
  ["matches", "mvp_key"],
  ["matches", "camera_primary_id"],
  ["my_ids", "primary_id"],
  ["friends", "primary_id"],
  ["never_suggest", "primary_id"],
];

const WITH = "|with:";

/** A remark pick's filter key, `<playlist>|with:<id>,<id>`, with each teammate id mapped. */
export function rewriteFilter(filter: string, ids: ReadonlyMap<string, string>): string {
  const at = filter.indexOf(WITH);
  if (at < 0) return filter;
  // Sorted like pairKey sorts a pair, or the dashboard would build a different key and miss the row.
  const friends = filter.slice(at + WITH.length).split(",").map((id) => ids.get(id) ?? id).sort();
  return `${filter.slice(0, at + WITH.length)}${friends.join(",")}`;
}

/** Rewrites every id, name and nickname in place; returns the originals for the leak scan. */
export function pseudonymise(db: Database): Forbidden {
  const botIds = new Set(column(db, "SELECT DISTINCT primary_id FROM match_players WHERE is_bot = 1"));
  const botNames = new Set(column(db, "SELECT DISTINCT name FROM match_players WHERE is_bot = 1").map((n) => n.toLowerCase()));
  // Oldest match first, so fake-1 is whoever showed up first; the order is otherwise meaningless.
  const ordered = column(db, "SELECT p.primary_id FROM match_players p JOIN matches m ON m.guid = p.match_guid WHERE p.is_bot = 0 ORDER BY m.started_at, p.rowid");
  const others = ID_COLUMNS.flatMap(([t, c]) => column(db, `SELECT ${c} FROM ${t}`));
  const ids = [...new Set([...ordered, ...others])].filter((id) => !id.startsWith("bot:") && !botIds.has(id));
  const realNames = [...new Set([...column(db, "SELECT name FROM match_players WHERE is_bot = 0"), ...column(db, "SELECT name FROM my_ids")])];
  const nicknames = [...new Set(column(db, "SELECT nickname FROM friends"))];
  const p = buildPseudonyms({ ids, realNames, nicknames });

  db.transaction(() => {
    db.run("CREATE TEMP TABLE idmap (old TEXT PRIMARY KEY, new TEXT NOT NULL, name TEXT NOT NULL)");
    db.run("CREATE TEMP TABLE nickmap (old TEXT PRIMARY KEY, new TEXT NOT NULL)");
    const addId = db.prepare("INSERT INTO idmap VALUES (?, ?, ?)");
    for (const [real, fake] of p.player) addId.run(real, fake.id, fake.name);
    const addNick = db.prepare("INSERT INTO nickmap VALUES (?, ?)");
    for (const [real, fake] of p.nickname) addNick.run(real, fake);

    db.run("UPDATE match_players SET name = (SELECT name FROM idmap WHERE old = primary_id) WHERE is_bot = 0 AND primary_id IN (SELECT old FROM idmap)");
    db.run("UPDATE my_ids SET name = (SELECT name FROM idmap WHERE old = primary_id) WHERE name IS NOT NULL AND primary_id IN (SELECT old FROM idmap)");
    db.run("UPDATE friends SET nickname = (SELECT new FROM nickmap WHERE old = nickname) WHERE nickname IN (SELECT old FROM nickmap)");
    for (const [t, c] of ID_COLUMNS) db.run(`UPDATE ${t} SET ${c} = (SELECT new FROM idmap WHERE old = ${c}) WHERE ${c} IN (SELECT old FROM idmap)`);
    const setFilter = db.prepare("UPDATE remark_picks SET filter = ? WHERE filter = ?");
    const idOf = new Map([...p.player].map(([real, fake]) => [real, fake.id]));
    for (const f of column(db, "SELECT DISTINCT filter FROM remark_picks")) {
      const fake = rewriteFilter(f, idOf);
      if (fake !== f) setFilter.run(fake, f);
    }
    db.run("DROP TABLE idmap");
    db.run("DROP TABLE nickmap");
  })();

  return {
    ids,
    idParts: ids.map((id) => id.split("|")[1] ?? "").filter((part) => part.length >= 6),
    // A human sharing a bot's name ("Viper") can't be told apart from the bot, so it isn't a leak.
    names: [...realNames, ...nicknames].filter((n) => !botNames.has(n.toLowerCase())),
  };
}

/** Every text cell of every table, checked against the originals. */
export function scanLeaks(db: Database, forbidden: Forbidden): Leak[] {
  const tables = column(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  function* cells(): Generator<Cell> {
    for (const t of tables) {
      for (const row of db.query(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]) {
        for (const [c, value] of Object.entries(row)) if (typeof value === "string") yield { where: `${t}.${c}`, value };
      }
    }
  }
  return findLeaks(cells(), forbidden);
}

export const OUT_DIR = join(tmpdir(), "grindlog-screens");

function run(args: Args): number {
  const from = args.from === undefined ? localAppDataDir("GrindlogDev") : resolveDir(args.from);
  const src = join(from, "tracker.db");
  if (!existsSync(src)) {
    console.error(`No tracker.db in ${from}.`);
    return 1;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const dest = join(OUT_DIR, "tracker.db");
  // Built under another name and renamed only once clean, so a crash mid-way can never leave a
  // real, unscrubbed copy where the screens seed looks for one.
  const work = join(OUT_DIR, "tracker.partial.db");
  const removeDb = (path: string) => {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path + suffix, { force: true });
  };
  removeDb(dest);
  removeDb(work);

  try {
    // VACUUM INTO reads one consistent snapshot, WAL included, while the tracker may be writing,
    // and works on a read-only connection, so the source is never written to.
    const source = new Database(src, { readonly: true });
    try {
      source.run("VACUUM INTO ?", [work]);
    } finally {
      source.close();
    }

    const db = new Database(work);
    let leaks: Leak[];
    try {
      const { dropped } = trim(db, args);
      const forbidden = pseudonymise(db);
      leaks = scanLeaks(db, forbidden);
      // Rewritten and deleted rows can linger in free pages; rebuilding the file drops them.
      db.run("VACUUM");
      console.log(`${String(matchCount(db))} matches kept (${String(dropped)} dropped), ${String(forbidden.ids.length)} players pseudonymised.`);
    } finally {
      db.close();
    }

    if (leaks.length > 0) {
      for (const l of leaks) console.error(`leak (${l.kind}) in ${l.where}: ${l.value}`);
      console.error(`${String(leaks.length)} originals left; the copy was deleted.`);
      return 1;
    }
    renameSync(work, dest);
    console.log(`Wrote ${dest}`);
    return 0;
  } finally {
    removeDb(work);
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error("usage: bun run screens-data [--from <dir>] [--since YYYY-MM-DD] [--max-matches N]   (--from defaults to GrindlogDev)");
    process.exit(1);
  }
  process.exit(run(args));
}

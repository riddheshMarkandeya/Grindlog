// The e2e stack, run under Bun by the Playwright fixture (seeding needs bun:sqlite): a temp data dir
// seeded per the mode in argv (`rich`, the default, `empty`, `few`, `share`, `tables`, `guess`, `friends` or `accounts`), the repo's web build copied to the
// installed path, a gated replay of the completed fixture, and the real tracker. Protocol: prints
// `ready {"url","dataDir"}` on stdout; the stdin line `go` releases the replay; the stdin line
// `restart <version>` stops the tracker and starts it again on the same port and data as that
// release (`--define GRINDLOG_VERSION`), then prints `restarted {"version"}`; stdin EOF tears
// everything down. The `update` seed is `rich` with the first start already a release (UPDATE_FROM).
// GRINDLOG_E2E_KEEP=1 keeps the temp dir (and its logs/tracker.log). Every seed gets a stand-in for
// the game's Documents Config folder (GRINDLOG_STATS_CONFIG_DIR) with a good TAStatsAPI.ini, so no
// run reads or writes the real one; the `setup` seed is `empty` with the Stats API off in that ini
// and STATS_API_URL at a port nothing listens on, so the setup card shows. The `screens` seed is no
// seed: it copies the pseudonymised real tracker.db that `bun run screens-data` wrote, for the
// landing page's screenshots (test/site).
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { startReplayServer } from "../../scripts/replay";
import { OUT_DIR as SCREENS_DATA_DIR } from "../../scripts/screens-data";
import { describeStopResult } from "../../scripts/stop";
import { requestStop } from "../../src/server/control";
import { createLogger } from "../../src/server/log";
import { logsDir } from "../../src/server/paths";
import type { MatchRecord } from "../../src/server/records/record";
import { createRecordWriter } from "../../src/server/records/save";
import { openStorage } from "../../src/server/storage";
import { ALT, freePort, goal, ME, player, readFixture, record, THEM } from "../../src/server/testing";
import { dayStart, dayOf } from "../../src/shared/periods";
import type { Seed } from "./fixtures";
import { STATS_CONFIG_SUBDIR } from "./stats-config-dir";
import { DASHBOARD_HOST, STATS_INI } from "../../src/shared/constants";

const REPO = join(import.meta.dirname, "..", "..");
const MIN = 60_000;
/** The completed fixture lasts ~392 s; at 64x the header shows "recording match" for several seconds. */
const REPLAY_SPEED = 64;
const READY_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
/** The `update` seed's first release, so a restart's version change has a non-null baseline. */
const UPDATE_FROM = "e2e-a";
/** A logon task that never exists, so the tracker reads "Run at Windows startup" as unavailable and never switches a real one. */
const E2E_TASK = "GrindlogE2eNoSuchTask";

const say = (msg: string, fields: Record<string, unknown> = {}) => {
  console.log(`[e2e] ${msg}${Object.keys(fields).length ? " " + JSON.stringify(fields) : ""}`);
};

function logTail(dir: string, lines = 30): string {
  try {
    return readFileSync(join(logsDir({ GRINDLOG_DATA_DIR: dir }), "tracker.log"), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch (err) {
    return `(no tracker.log: ${(err as Error).message})`;
  }
}

const HOUR = 60 * MIN;

/** A match of ME's, won or lost, `start` ms after the local day's 4am start. */
type MatchOver = Partial<Pick<MatchRecord["match"], "playlistId" | "checkFlags" | "scoreTeam0" | "endKind" | "winnerTeamNum" | "winnerSource" | "mvpSource" | "mvpKey" | "overtime">>;
const match = (guid: string, day: string, start: number, won: boolean, over: MatchOver = {}, rows: Parameters<typeof record>[2] = {}) => {
  const at = dayStart(day) + start;
  return record(guid, at, rows, { endedAt: at + 5 * MIN, scoreTeam0: won ? 2 : 1, scoreTeam1: won ? 1 : 2, winnerTeamNum: won ? 0 : 1, mvpKey: won ? ME : null, ...over });
};

/**
 * Your 4 goals and a hat trick: 3 more than the usual 1, so goals per game are 12% over the
 * baseline's and stand out. The goal you concede is aerial and deflected (your team touched it last).
 * Your touches lean defensive (6/2/1 by third against everyone's usual 2/2/1), so the touch rows'
 * percentages and order are checkable.
 */
const HAT_TRICK: Parameters<typeof record>[2] = {
  players: [player(ME, 0, { goals: 4, extras: { ...player(ME, 0).extras, touches_defence: 6, touches_midfield: 2, touches_attack: 1 } }), player(THEM, 1)],
  statfeed: [
    { playerKey: ME, eventName: "Goal", count: 4 },
    { playerKey: ME, eventName: "HatTrick", count: 1 },
    { playerKey: THEM, eventName: "Goal", count: 1 },
  ],
  goals: [
    goal(0, ME, { speedKmh: 120 }),
    goal(0, ME, { pos: { x: 300, y: 4100, z: 93 }, distance: 1000 }),
    goal(0, ME, { pos: { x: -300, y: 4100, z: 93 }, distance: 1000 }),
    goal(0, ME, { pos: { x: -800, y: -880, z: 93 }, distance: 6000 }),
    goal(1, THEM, { pos: { x: 600, y: -2920, z: 700 }, distance: 2200, aerial: true, deflected: true }),
  ],
};

/**
 * `rich`: the current session is exactly one won match, ended 5 minutes ago (the header chip reads
 * "This session: 1–0"). Last month, so none is current: a 26-match session, a private-only one,
 * and two sessions on one day. The first of those has four matches on Ranked Doubles: a win, a
 * loss that failed a check, a loss you left, and a win with an inferred MVP. The month before: one session, the
 * 26-match session's only baseline match. In the 26-match session, match 2 is HAT_TRICK and match 3
 * is on Ranked Doubles.
 * `tables`: `rich`, plus a pending guess per You test that answers one and a rejected id, none of
 * them a player in any match (TABLE_IDS).
 * `guess`: `rich`, plus GUESS_IDS: two pending guesses for the recap's "Is this you?" card.
 * `accounts`: `rich`, plus ALT confirmed, named ALT_NAME in its 3 matches (e2e-alt-0 to 2), its only
 * session, last month on the 20th; ME isn't in them.
 * `empty`: no matches at all.
 * `friends`: last month, a 22-match session (e2e-fr-00) with FRIEND, nicknamed FRIEND_NICK, on
 * your team in its first four (a loss, two wins, a loss) and on the other team in the fifth, its
 * last match in Ranked Doubles without them, and a 2-match session (e2e-nofr-a) with no friend in it.
 * For the Friends page, more sessions with FRIEND: on your team in 2 Ranked Doubles (won), 1 Doubles
 * (lost) and 2 Private 2v2 (won, lost), so together they're 5–4 and their modes are 2v2, 3v3 and
 * Private 2v2; against you in 12 Private 1v1 (won, lost in turn; the first an overtime win, the
 * second their MVP), so head-to-head is 7–6 over two pages. OPAL is a friend only ever on the other
 * team; KIM, LEE and MAX are teammates in 3 Casual Quads matches over 2 sessions, so all three are
 * suggested, and any two added are a pair.
 * `share`: the share card's worst case. The current session is 48 matches of mixed results, one
 * left early, under a 32-character name; your saves stand out against three days ago, and you
 * hit no woodwork but had aerial touches, so the 8th tile is the two-line "Aerial touches".
 * A friend with a 32-character nickname is on your team in every match, baseline too, for the
 * longest label.
 */
function seed(dir: string, mode: Seed): void {
  // The tracker's own log file, so a run leaves one log, not two.
  const logger = createLogger({ dir: logsDir({ GRINDLOG_DATA_DIR: dir }) });
  const storage = openStorage({ dir, logger });
  try {
    storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, 'me', 'confirmed', ?)", ME, Date.now());
    if (mode === "tables" || mode === "guess") {
      for (const [i, [id, name, status]] of (mode === "tables" ? TABLE_IDS : GUESS_IDS).entries()) {
        storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, ?, ?, ?)", id, name, status, Date.now() + i + 1);
      }
    }
    if (mode === "empty") return;
    const now = Date.now();
    if (mode === "share") {
      seedShare(storage, logger, now);
      storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, ?, ?)", FRIEND, SHARE_NICK, now);
      return;
    }
    // Days of months before the current session's, so which month holds each session doesn't
    // depend on the run's date.
    const [y = 0, m = 1] = dayOf(now - 10 * MIN).split("-").map(Number);
    const day = (monthsBack: number, d: number) => {
      const i = y * 12 + (m - 1) - monthsBack;
      return `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    };
    const writer = createRecordWriter({ tracker: storage.tracker, logger });
    if (mode === "few") {
      // Under the Trends page's 20 matches: its "not enough data yet" note.
      writer.save(match("e2e-few-a", day(1, 5), 10 * HOUR, true));
      writer.save(match("e2e-few-b", day(1, 5), 10 * HOUR + 10 * MIN, false));
      // ME with no team: the match page can't say whose team is whose, so it names the game's teams.
      writer.save(match("e2e-few-noteam", day(1, 5), 10 * HOUR + 20 * MIN, true, {}, { players: [player(ME, 0, { teamNum: null, teamsSeen: 0 }), player(THEM, 0), player(OTHER, 1)] }));
      return;
    }
    if (mode === "friends") {
      for (let i = 0; i < 22; i++) {
        const players = i < 4 ? [player(ME, 0, { assists: 1, saves: 2 }), player(FRIEND, 0, { name: "SamInGame", assists: 1, saves: 1 }), player(THEM, 1)] : i === 4 ? [player(ME, 0), player(FRIEND, 1, { name: "SamInGame" })] : [player(ME, 0), player(THEM, 1)];
        writer.save(match(`e2e-fr-${String(i).padStart(2, "0")}`, day(1, 5), 10 * HOUR + i * 6 * MIN, i % 3 !== 0, i === 21 ? { playlistId: 11 } : {}, { players }));
      }
      writer.save(match("e2e-nofr-a", day(1, 12), 8 * HOUR, true));
      writer.save(match("e2e-nofr-b", day(1, 12), 8 * HOUR + 10 * MIN, false));
      const sam = (team: 0 | 1) => player(FRIEND, team, { name: "SamInGame" });
      const duo = [player(ME, 0), sam(0), player(THEM, 1), player(OTHER, 1)];
      const together: [number, boolean][] = [[11, true], [11, true], [2, false], [6, true], [6, false]];
      for (const [i, [playlistId, won]] of together.entries()) writer.save(match(`e2e-tog-${String(i)}`, day(1, 18), 10 * HOUR + i * 6 * MIN, won, { playlistId }, { players: duo }));
      for (let i = 0; i < 12; i++) {
        writer.save(match(`e2e-h2h-${String(i).padStart(2, "0")}`, day(1, 22), 10 * HOUR + i * 6 * MIN, i % 2 === 0, { playlistId: 6, overtime: i === 0, ...(i === 1 ? { mvpKey: FRIEND } : {}) }, { players: [player(ME, 0), sam(1)] }));
      }
      writer.save(match("e2e-opal", day(1, 20), 10 * HOUR, true, {}, { players: [player(ME, 0), player(OPAL, 1, { name: "Opal" })] }));
      const pair = [player(ME, 0), player(KIM, 0, { name: "Kim" }), player(LEE, 0, { name: "Lee" }), player(MAX, 0, { name: "Max" }), player(THEM, 1)];
      // Casual Quads: four on your team, so a pair of them leaves a fourth in the carry bars' rest.
      for (const [i, [d, at]] of ([[24, 0], [24, 10], [26, 0]] as const).entries()) writer.save(match(`e2e-pair-${String(i)}`, day(1, d), 10 * HOUR + at * MIN, true, { playlistId: 4 }, { players: pair }));
      storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, ?, ?)", FRIEND, FRIEND_NICK, now);
      storage.tracker.run("INSERT INTO friends (primary_id, nickname, added_at) VALUES (?, NULL, ?)", OPAL, now + 1);
      return;
    }
    writer.save(match("e2e-old", day(2, 15), 14 * HOUR, true));
    for (let i = 0; i < 26; i++) {
      writer.save(match(`e2e-long-${String(i).padStart(2, "0")}`, day(1, 5), 10 * HOUR + i * 6 * MIN, i % 3 !== 0, i === 2 ? { playlistId: 11 } : i === 1 ? { scoreTeam0: 4 } : {}, i === 1 ? HAT_TRICK : {}));
    }
    writer.save(match("e2e-private", day(1, 8), 14 * HOUR, true, { playlistId: 6 }));
    writer.save(match("e2e-first-a", day(1, 12), 8 * HOUR, true, { playlistId: 11 }));
    writer.save(match("e2e-first-b", day(1, 12), 8 * HOUR + 10 * MIN, false, { playlistId: 11, checkFlags: ["mvp_count"] }));
    writer.save(match("e2e-first-c", day(1, 12), 8 * HOUR + 20 * MIN, false, { playlistId: 11, endKind: "left", winnerTeamNum: null, winnerSource: null }));
    writer.save(match("e2e-first-d", day(1, 12), 8 * HOUR + 30 * MIN, true, { playlistId: 11, mvpSource: "inferred" }));
    writer.save(match("e2e-second", day(1, 12), 12 * HOUR, false, { playlistId: 2 }));
    writer.save(record("e2e-seed-won", now - 10 * MIN, {}, { endedAt: now - 5 * MIN }));
    if (mode === "accounts") {
      storage.tracker.run("INSERT INTO my_ids (primary_id, name, status, added_at) VALUES (?, ?, 'confirmed', ?)", ALT, ALT_NAME, now + 1);
      for (let i = 0; i < 3; i++) {
        writer.save(match(`e2e-alt-${String(i)}`, day(1, 20), 10 * HOUR + i * 10 * MIN, i !== 1, { mvpKey: null }, { players: [player(ALT, 0, { name: ALT_NAME }), player(THEM, 1)], statfeed: [], goals: [] }));
      }
    }
  } finally {
    storage.close();
  }
}

/** The You table's e2e rows; the spec names them too. A pending guess can't be put back, so each test answers its own. */
const TABLE_IDS = [
  ["Steam|e2e-guess-yes|0", "GuessYes", "pending"],
  ["XboxOne|e2e-guess-retry|0", "GuessRetry", "pending"],
  ["PS4|e2e-not-me|0", "NotMe", "rejected"],
] as const;

/** ALT's in-game name in the `accounts` seed; the spec names it too. */
const ALT_NAME = "AltAccount";

/** The recap card's e2e guesses, asked in this order: the spec answers the first and dismisses the second. */
const GUESS_IDS = [
  ["Steam|e2e-card-yes|0", "CardYes", "pending"],
  ["XboxOne|e2e-card-later|0", "CardLater", "pending"],
] as const;

/** A TAStatsAPI.ini as the game writes it, CRLF, with a line the setup spec checks is left alone. */
const statsIni = (rate: number, webPort: number) =>
  ["[TAGame.MatchStatsExporter_TA]", "; e2e sentinel: left as it is", "Port=49123", `WebPort=${String(webPort)}`, `PacketSendRate=${String(rate)}`, ""].join("\r\n");

// 32 characters, the most a name has, and wide ones: it has to be cut.
const SHARE_NAME = "WWW_MaximumWidthNameWWWWWWWWWWWW";
// 32 characters too, the most a nickname has.
const SHARE_NICK = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
const FRIEND = "Steam|e2e-sam|0";
const FRIEND_NICK = "Sammy";
const OPAL = "Epic|e2e-opal|0";
const KIM = "Epic|e2e-kim|0";
const LEE = "Epic|e2e-lee|0";
const MAX = "Epic|e2e-max|0";
const OTHER = "Epic|e2e-other|0";

function seedShare(storage: ReturnType<typeof openStorage>, logger: ReturnType<typeof createLogger>, now: number): void {
  const writer = createRecordWriter({ tracker: storage.tracker, logger });
  for (let i = 0; i < 6; i++) writer.save(record(`e2e-base-${String(i)}`, now - 3 * 24 * HOUR + i * 6 * MIN, { players: [player(ME, 0, { saves: 1 }), player(FRIEND, 0, { saves: 0 }), player(THEM, 1)] }, { endedAt: now - 3 * 24 * HOUR + i * 6 * MIN + 5 * MIN }));
  const me = player(ME, 0, { name: SHARE_NAME, saves: 3, extras: { ...player(ME, 0).extras, woodwork_hits: 0, aerial_touches: 4 } });
  const friend = player(FRIEND, 0, { saves: 0 });
  const start = now - (47 * 6 + 10) * MIN;
  for (let i = 0; i < 48; i++) {
    const at = start + i * 6 * MIN;
    const won = (i * 7) % 11 < 6;
    const result: Partial<MatchRecord["match"]> = i === 20 ? { endKind: "left", winnerTeamNum: null, winnerSource: null } : { scoreTeam0: won ? 2 : 1, scoreTeam1: won ? 1 : 2, winnerTeamNum: won ? 0 : 1, mvpKey: won ? ME : null };
    writer.save(record(`e2e-share-${String(i).padStart(2, "0")}`, at, { players: [me, friend, player(THEM, 1)] }, { endedAt: at + 5 * MIN, ...result }));
  }
}

/** Removes the temp data dir unless GRINDLOG_E2E_KEEP=1. Never throws: it runs on the failure paths too. */
function removeDir(dir: string): void {
  if (process.env.GRINDLOG_E2E_KEEP === "1") {
    say("kept the data dir", { dataDir: dir });
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  } catch (err) {
    say("could not remove the data dir", { dataDir: dir, err: (err as Error).message });
  }
}

/**
 * The data a seed's stack holds, `rich` when unlisted: `settings` and `update` seed as `rich`, and
 * `friends-page` as `friends`; their own names only buy a separate stack, so what they do stays there.
 */
const SEED_DATA: Partial<Record<string, Seed>> = {
  empty: "empty",
  few: "few",
  share: "share",
  tables: "tables",
  guess: "guess",
  friends: "friends",
  "friends-page": "friends",
  accounts: "accounts",
  setup: "empty",
};

function copyScreensData(dir: string): void {
  const src = join(SCREENS_DATA_DIR, "tracker.db");
  if (!existsSync(src)) throw new Error(`${src} is missing; run bun run screens-data first`);
  copyFileSync(src, join(dir, "tracker.db"));
  say("copied the screens data", { from: src });
}

async function main(): Promise<void> {
  const dist = join(REPO, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error(`${dist}\\index.html is missing; run vite build first (bun run e2e does)`);

  const dir = mkdtempSync(join(tmpdir(), "grindlog-e2e-"));
  const mode = process.argv[2];
  try {
    // The installed path, so the tracker's default staticDir is what's served.
    cpSync(dist, join(dir, "bin", "web"), { recursive: true });
    if (mode === "screens") copyScreensData(dir);
    else seed(dir, SEED_DATA[mode ?? ""] ?? "rich");
  } catch (err) {
    removeDir(dir);
    throw err;
  }

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const replay = startReplayServer({ lines: readFixture("completed"), speed: REPLAY_SPEED, gate });
  const port = await freePort();
  const url = `http://${DASHBOARD_HOST}:${String(port)}`;
  // `setup`: a port nothing listens on, so the tracker stays waiting and the card stays up.
  const statsPort = mode === "setup" ? await freePort() : replay.port;
  const configDir = join(dir, STATS_CONFIG_SUBDIR);
  mkdirSync(configDir);
  writeFileSync(join(configDir, STATS_INI), statsIni(mode === "setup" ? 0 : 30, statsPort));
  say("starting", { dataDir: dir, trackerPort: port, replayPort: replay.port, statsPort });

  const env: Record<string, string | undefined> = {
    ...process.env,
    GRINDLOG_DATA_DIR: dir,
    GRINDLOG_PORT: String(port),
    GRINDLOG_TASK: E2E_TASK,
    GRINDLOG_STATS_CONFIG_DIR: configDir,
    STATS_API_URL: `ws://127.0.0.1:${String(statsPort)}`,
    // Never the real repo: off, or (`seasons`) the fixture file, synced a second after start.
    GRINDLOG_SEASONS_FEED: mode === "seasons" ? join(REPO, "test", "fixtures", "season-file.json") : "off",
    ...(mode === "seasons" && { GRINDLOG_SEASONS_DELAY_MS: "1000" }),
  };
  delete env.GRINDLOG_STATIC_DIR;

  let tearingDown = false;
  let restarting = false;
  // The log tail is printed before the dir goes; GRINDLOG_E2E_KEEP=1 keeps the whole log.
  const fail = (msg: string, fields: Record<string, unknown>) => {
    say(msg, fields);
    console.log(logTail(dir));
    removeDir(dir);
    process.exit(1);
  };
  const spawnTracker = (version: string | undefined) => {
    // `bun run --define` takes K:V, with the value as JSON; it must come after `run`.
    const define = version === undefined ? [] : ["--define", `GRINDLOG_VERSION:${JSON.stringify(version)}`];
    const child = Bun.spawn([process.execPath, "run", ...define, join(REPO, "src", "server", "main.ts")], { cwd: REPO, env, stdout: "ignore", stderr: "inherit" });
    void child.exited.then((code) => {
      if (!tearingDown && !restarting) fail("tracker exited early", { code, version });
    });
    return child;
  };
  const waitReady = async (child: ReturnType<typeof spawnTracker>) => {
    const started = Date.now();
    for (;;) {
      try {
        if ((await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2000) })).status === 200) return Date.now() - started;
      } catch {
        // Not listening yet, or not answering within 2 s.
      }
      if (Date.now() - started > READY_TIMEOUT_MS) {
        tearingDown = true;
        child.kill();
        await child.exited;
        fail("tracker never became ready", { ms: READY_TIMEOUT_MS });
      }
      await Bun.sleep(100);
    }
  };
  const stopTracker = async (child: ReturnType<typeof spawnTracker>) => {
    const stop = await requestStop(port);
    if (describeStopResult(stop).exitCode !== 0) say("shutdown request failed", { stop });
    const code = await Promise.race([child.exited, Bun.sleep(STOP_TIMEOUT_MS).then(() => null)]);
    if (code === null) {
      say("tracker did not stop; killing it", { ms: STOP_TIMEOUT_MS });
      child.kill();
      await child.exited;
    } else {
      say("tracker stopped", { code });
    }
  };

  let tracker = spawnTracker(mode === "update" ? UPDATE_FROM : undefined);
  say("tracker ready", { ms: await waitReady(tracker) });
  console.log(`ready ${JSON.stringify({ url, dataDir: dir })}`);

  const restart = async (version: string) => {
    restarting = true;
    await stopTracker(tracker);
    tracker = spawnTracker(version);
    restarting = false;
    say("tracker restarted", { version, ms: await waitReady(tracker) });
    console.log(`restarted ${JSON.stringify({ version })}`);
  };

  // Restarts run one after another, and one still in flight when stdin closes finishes first, so
  // teardown stops the tracker it started.
  let pendingRestart: Promise<void> = Promise.resolve();
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const [command, arg] = line.trim().split(/\s+/);
    if (command === "go") {
      say("replay released", { speed: REPLAY_SPEED });
      release();
    } else if (command === "restart" && arg !== undefined) {
      pendingRestart = pendingRestart.then(() => restart(arg)).catch((err: unknown) => {
        fail("restart failed", { err: String(err) });
      });
    }
  });
  await new Promise<void>((resolve) => input.once("close", resolve));

  await pendingRestart;
  tearingDown = true;
  await stopTracker(tracker);
  await replay.stop();
  removeDir(dir);
}

await main();

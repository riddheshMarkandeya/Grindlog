import { afterEach, describe, expect, test, vi } from "vitest";
import { initialWatchState, parseTasklist, startGameWatch, step, TOAST_TITLE, type CheckPhase, type GameWatch, type WatchState } from "./game-watch";
import type { ConfigCheck } from "./stats-config";
import { memoryLogger } from "./testing";

describe("parseTasklist", () => {
  test("a CSV row for the game means it's running", () => {
    expect(parseTasklist('"RocketLeague.exe","1234","Console","1","2,345,678 K"\r\n')).toBe(true);
  });

  test("the 'no tasks' message, in any language, means it isn't", () => {
    expect(parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n")).toBe(false);
    expect(parseTasklist("INFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n")).toBe(false);
    expect(parseTasklist("")).toBe(false);
  });

  test("only the image-name field counts", () => {
    expect(parseTasklist('"Other.exe","1","RocketLeague.exe","1","1 K"\r\n')).toBe(false);
    expect(parseTasklist('"rocketleague.exe","1234","Console","1","1 K"\r\n')).toBe(true);
  });
});

describe("step", () => {
  const S = 1000;
  /** Runs the inputs in order from the initial state, returning every output. */
  const run = (inputs: { gameRunning: boolean; status?: "waiting" | "connected" | "recording"; at: number }[]) => {
    let state: WatchState = initialWatchState;
    return inputs.map(({ gameRunning, status = "waiting", at }) => {
      const out = step(state, { gameRunning, status, now: at * S });
      state = out.state;
      return { off: out.statsApiOff, toast: out.toast, retryNow: out.retryNow };
    });
  };

  test("no game, nothing to report", () => {
    expect(run([{ gameRunning: false, at: 0 }])).toEqual([{ off: false, toast: false, retryNow: false }]);
  });

  test("every poll that sees the game while waiting asks for a reconnect, so the backoff can't outlast the 60 s", () => {
    const out = run([
      { gameRunning: false, at: 0 },
      { gameRunning: true, at: 20 },
      { gameRunning: true, at: 40 },
      { gameRunning: true, status: "connected", at: 60 },
    ]);
    expect(out.map((o) => o.retryNow)).toEqual([false, true, true, false]);
  });

  test("60 s of the game running while still waiting is 'Stats API off', toasted once per game run", () => {
    const out = run([
      { gameRunning: true, at: 0 },
      { gameRunning: true, at: 59 },
      { gameRunning: true, at: 60 },
      { gameRunning: true, at: 80 },
      { gameRunning: false, at: 100 },
      { gameRunning: true, at: 120 },
      { gameRunning: true, at: 180 },
    ]);
    expect(out.map((o) => o.off)).toEqual([false, false, true, true, false, false, true]);
    expect(out.map((o) => o.toast)).toEqual([false, false, true, false, false, false, true]);
  });

  test("a connection clears it and restarts the clock, so a game restarted between polls isn't flagged at once", () => {
    const out = run([
      { gameRunning: true, at: 0 },
      { gameRunning: true, status: "connected", at: 60 },
      { gameRunning: true, status: "recording", at: 600 },
      { gameRunning: true, at: 620 },
      { gameRunning: true, at: 650 },
      { gameRunning: true, at: 680 },
    ]);
    expect(out.map((o) => o.off)).toEqual([false, false, false, false, false, true]);
    expect(out.map((o) => o.retryNow)).toEqual([true, false, false, true, true, true]);
  });
});

describe("startGameWatch", () => {
  const offCheck: ConfigCheck = {
    installDir: "C:\\Games\\rocketleague",
    foundBy: "epic",
    userConfigDir: "C:\\Users\\me\\OneDrive\\Documents\\My Games\\Rocket League\\TAGame\\Config",
    file: "user",
    path: "C:\\Users\\me\\OneDrive\\Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini",
    effective: { packetSendRate: 0, webPort: 49124 },
    problems: ["send_rate_off"],
  };
  const goodCheck: ConfigCheck = { ...offCheck, effective: { packetSendRate: 30, webPort: 49124 }, problems: [] };
  let watch: GameWatch | undefined;
  afterEach(() => {
    watch?.stop();
  });

  /** A watch over a running game whose Stats API never answers; each now() call is 61 s after the last. */
  const start = (checkConfig: (phase: CheckPhase) => Promise<ConfigCheck | null>) => {
    let t = 0;
    const logger = memoryLogger();
    const toast = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
    const detect = vi.fn(() => Promise.resolve(true));
    const check = vi.fn(checkConfig);
    watch = startGameWatch({
      client: { status: () => "waiting", retryNow: () => undefined },
      logger,
      expectedWebPort: 49124,
      pollMs: 10,
      now: () => (t += 61_000),
      detect,
      toast,
      checkConfig: check,
      checkTimeoutMs: 50,
    });
    return { logger, toast, detect, check, watch };
  };

  test("checks at startup, then again when the Stats API turns out off, and the toast names the fix", async () => {
    const { toast, check, watch } = start((phase) => Promise.resolve(phase === "startup" ? goodCheck : offCheck));
    expect(check).toHaveBeenCalledWith("startup");
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(check.mock.calls).toEqual([["startup"], ["game_running"]]);
    expect(toast).toHaveBeenCalledWith("Set PacketSendRate to 30 in Documents\\My Games\\Rocket League\\TAGame\\Config\\TAStatsAPI.ini, then restart the game.");
    expect(watch.statsApiOff()).toBe(true);
    expect(watch.statsConfig()).toEqual(offCheck);
  });

  test("no install found: the generic toast", async () => {
    const { toast } = start(() => Promise.resolve(null));
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(toast.mock.calls[0]?.[0]).toContain("PacketSendRate above 0");
  });

  test("a check that never returns is cut off, the generic toast still shows, and polling goes on", async () => {
    const { toast, detect, logger, watch } = start((phase) => (phase === "startup" ? Promise.resolve(goodCheck) : new Promise(() => undefined)));
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1);
    });
    expect(toast.mock.calls[0]?.[0]).toContain("PacketSendRate above 0");
    expect(logger.events()).toContain("game/stats_config_timeout");
    expect(watch.statsConfig()).toEqual(goodCheck);
    const polls = detect.mock.calls.length;
    await vi.waitFor(() => {
      expect(detect.mock.calls.length).toBeGreaterThan(polls + 2);
    });
  });

  /** A watch with no game running, whose checks resolve only when the test says. */
  const startIdle = () => {
    const pending: ((r: ConfigCheck | null) => void)[] = [];
    const check = vi.fn((): Promise<ConfigCheck | null> => new Promise<ConfigCheck | null>((resolve) => pending.push(resolve)));
    watch = startGameWatch({
      client: { status: () => "waiting", retryNow: () => undefined },
      logger: memoryLogger(),
      expectedWebPort: 49124,
      pollMs: 60_000,
      detect: () => Promise.resolve(false),
      toast: () => Promise.resolve(),
      checkConfig: check,
      checkTimeoutMs: 1_000,
    });
    return { pending, check, watch };
  };

  test("recheck runs a 'setup' check and keeps its result; checked turns true once any check ends, even with nothing found", async () => {
    const { pending, check, watch } = startIdle();
    expect(watch.statsConfigChecked()).toBe(false);
    pending[0]?.(null);
    await vi.waitFor(() => {
      expect(watch.statsConfigChecked()).toBe(true);
    });
    expect(watch.statsConfig()).toBeNull();
    const rechecked = watch.recheck();
    expect(check).toHaveBeenLastCalledWith("setup");
    pending[1]?.(offCheck);
    expect(await rechecked).toEqual(offCheck);
    expect(watch.statsConfig()).toEqual(offCheck);
  });

  test("recheck takes its own timeout, shorter than the poll's backstop", async () => {
    const { watch } = startIdle();
    expect(await watch.recheck(10)).toBe("timeout");
  });

  test("a check that started earlier but ends later doesn't overwrite a newer result", async () => {
    const { pending, watch } = startIdle();
    const rechecked = watch.recheck();
    pending[1]?.(goodCheck);
    await rechecked;
    pending[0]?.(offCheck);
    await new Promise((r) => setTimeout(r, 10));
    expect(watch.statsConfig()).toEqual(goodCheck);
  });

  /** No game running; each check answers from `answers` in turn, and the Documents ini's mtime is whatever `mtime.value` holds. */
  const startWatching = (answers: (ConfigCheck | null)[], fileMtime?: (path: string) => number | null) => {
    const mtime = { value: 1 as number | null, paths: [] as string[] };
    const check = vi.fn((phase: CheckPhase) => Promise.resolve(phase === "startup" ? (answers[0] ?? null) : (answers[Math.min(check.mock.calls.length - 1, answers.length - 1)] ?? null)));
    const logger = memoryLogger();
    watch = startGameWatch({
      client: { status: () => "waiting", retryNow: () => undefined },
      logger,
      expectedWebPort: 49124,
      pollMs: 10,
      detect: () => Promise.resolve(false),
      toast: () => Promise.resolve(),
      checkConfig: check,
      fileMtime:
        fileMtime ??
        ((path) => {
          mtime.paths.push(path);
          return mtime.value;
        }),
    });
    return { check, mtime, logger, watch };
  };

  test("a stored problem is rechecked once the Documents ini changes, and only then", async () => {
    const { check, mtime, logger, watch } = startWatching([offCheck, goodCheck]);
    await vi.waitFor(() => {
      expect(mtime.paths.length).toBeGreaterThan(3);
    });
    expect(check.mock.calls).toEqual([["startup"]]);
    expect(mtime.paths[0]).toBe(offCheck.path);
    mtime.value = 2;
    await vi.waitFor(() => {
      expect(watch.statsConfig()).toEqual(goodCheck);
    });
    expect(check.mock.calls).toEqual([["startup"], ["file_changed"]]);
    expect(logger.lines).toContainEqual({ level: "info", cat: "game", event: "stats_config_file_changed", fields: { path: offCheck.path } });
    // No problem left: the file isn't watched any more.
    const watched = mtime.paths.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(mtime.paths.length).toBe(watched);
  });

  test("a settings file that appears (the game's first run) counts as a change", async () => {
    const missing: ConfigCheck = { ...offCheck, file: "install", problems: ["user_missing"] };
    const { check, mtime, watch } = startWatching([missing, goodCheck]);
    mtime.value = null;
    await vi.waitFor(() => {
      expect(mtime.paths.length).toBeGreaterThan(2);
    });
    mtime.value = 5;
    await vi.waitFor(() => {
      expect(watch.statsConfig()).toEqual(goodCheck);
    });
    expect(check).toHaveBeenLastCalledWith("file_changed");
  });

  test("a failing stat is logged once and polling goes on", async () => {
    const fail = vi.fn((): number | null => {
      throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    });
    const { logger } = startWatching([offCheck], fail);
    await vi.waitFor(() => {
      expect(fail.mock.calls.length).toBeGreaterThan(3);
    });
    expect(logger.events().filter((e) => e === "game/stats_config_stat_failed")).toHaveLength(1);
  });
});

describe("TOAST_TITLE", () => {
  test("names this build's app, so a dev toast says it came from the dev install", () => {
    expect(TOAST_TITLE).toBe("Grindlog Dev isn't getting data");
  });
});

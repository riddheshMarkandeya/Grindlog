import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RELEASES_LATEST_PAGE } from "../../shared/release";
import { backupName, readUserVersion } from "../db/backup";
import { openDb } from "../db/sqlite";
import { memoryLogger } from "../testing";
import { installerArgs, runUpdate, type UpdaterDeps } from "./apply";
import type { HealthReading } from "./health";
import { readState, writeStartFailure, writeState } from "./state";

// The CLI-made fixtures the checker's tests use: payload.bin signed for version 9.9.9 with test.pub's key.
const FIX = join(import.meta.dirname, "fixtures");
const KEY = readFileSync(join(FIX, "test.pub"), "utf8").split(/\r?\n/)[1] ?? "";
const FROM = "9.9.8";
const TO = "9.9.9";
const STARTED = "2026-11-12T10:00:00.000Z";

let data: string;
let upd: string;
let app: string;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "grindlog-apply-"));
  upd = join(data, "update");
  app = join(data, "Program Files", "Grindlog");
  mkdirSync(join(upd, "download"), { recursive: true });
  mkdirSync(join(upd, "previous"), { recursive: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(join(upd, "download", `Grindlog-Setup-${TO}.exe`), readFileSync(join(FIX, "payload.bin")));
  writeFileSync(join(upd, "download", `Grindlog-Setup-${TO}.exe.minisig`), readFileSync(join(FIX, "payload.prehashed.minisig")));
  writeFileSync(join(upd, "previous", "Grindlog-Setup.exe"), "previous installer");
  writeState(upd, memoryLogger(), {
    available: { version: TO, file: `Grindlog-Setup-${TO}.exe`, verifiedAt: STARTED },
    skipped: [{ version: "9.9.7", reason: "bad_signature" }],
    apply: { from: FROM, to: TO, startedAt: STARTED, phase: "starting" },
  });
});
afterEach(() => {
  rmSync(data, { recursive: true, force: true });
});

interface World {
  /** Which version's files are in the app dir, and which one the started supervisor runs. */
  installed: string;
  up: string | null;
  /** Versions whose tracker keeps crashing (a new pid each probe). */
  crashing: Set<string>;
  quits: string[];
  installs: string[][];
  starts: number;
  toasts: { title: string; body: string; url?: string }[];
  phases: () => string[];
}

function world(over: Partial<UpdaterDeps> & { installerCodes?: number[]; quitCodes?: number[]; crashing?: string[] } = {}) {
  const logger = memoryLogger();
  let t = Date.parse(STARTED) + 1000;
  let pid = 100;
  const installerCodes = over.installerCodes ?? [];
  const quitCodes = over.quitCodes ?? [];
  const w: World = {
    installed: FROM,
    up: FROM,
    crashing: new Set(over.crashing ?? []),
    quits: [],
    installs: [],
    starts: 0,
    toasts: [],
    phases: () => logger.lines.filter((l) => l.event === "phase").map((l) => String(l.fields.phase)),
  };
  const deps: UpdaterDeps = {
    appDir: app,
    exeName: "grindlog.exe",
    dataDir: data,
    updateDir: upd,
    logsDir: join(data, "logs"),
    running: FROM,
    publicKey: KEY,
    port: 49_300,
    oldVersions: { tracker: 1, raw: 1 },
    logger,
    quit: (exe) => {
      w.quits.push(exe);
      const code = quitCodes.shift() ?? 0;
      if (code === 0) w.up = null;
      return Promise.resolve(code);
    },
    runInstaller: (argv) => {
      w.installs.push(argv);
      const code = installerCodes.shift() ?? 0;
      if (code === 0) w.installed = argv[0]?.endsWith("rollback-setup.exe") ? FROM : TO;
      return Promise.resolve({ code, timedOut: false });
    },
    startSupervisor: () => {
      w.starts++;
      w.up = w.installed;
    },
    probe: (): Promise<HealthReading> => {
      if (w.up === null) return Promise.resolve("refused");
      return Promise.resolve({ pid: w.crashing.has(w.up) ? pid++ : 42, version: w.up });
    },
    toast: (toast) => {
      w.toasts.push(toast);
      return Promise.resolve();
    },
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, w, logger };
}

const state = () => readState(upd, memoryLogger());

function makeDb(path: string, version: number, mark: string, journal = "wal"): void {
  const db = openDb(path);
  db.run("CREATE TABLE t(v TEXT)");
  db.run("INSERT INTO t VALUES (?)", mark);
  db.run(`PRAGMA user_version = ${String(version)}`);
  if (journal === "delete") db.get("PRAGMA journal_mode = DELETE");
  db.close();
}

describe("installerArgs", () => {
  test("runs Inno silently, leaving the app alone, with its log at a path that may hold spaces", () => {
    const log = String.raw`C:\Users\Jo Smith\AppData\Local\Grindlog\logs\install-9.9.9.log`;
    expect(installerArgs(String.raw`C:\Users\Jo Smith\x\Setup.exe`, log)).toEqual([
      String.raw`C:\Users\Jo Smith\x\Setup.exe`,
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NOCLOSEAPPLICATIONS",
      `/LOG=${log}`,
    ]);
  });
});

describe("runUpdate", () => {
  test("healthy: stops the app, installs, starts it and waits it out, then records the update and cleans up", async () => {
    const backups = join(data, "backups");
    mkdirSync(backups);
    writeFileSync(join(backups, backupName(new Date(STARTED), "premigration", "raw")), "raw copy");
    writeFileSync(join(backups, backupName(new Date(STARTED), "premigration", "tracker")), "tracker copy");
    mkdirSync(join(data, "failed-update", "9.9.5"), { recursive: true });
    const { deps, w, logger } = world();

    expect(await runUpdate(deps)).toBe("updated");

    expect(w.phases()).toEqual(["stopping", "installing", "checking"]);
    expect(w.quits).toEqual([join(app, "grindlog.exe")]);
    expect(w.installs).toEqual([installerArgs(join(upd, "download", `Grindlog-Setup-${TO}.exe`), join(data, "logs", `install-${TO}.log`))]);
    expect(w.starts).toBe(1);
    const s = state();
    expect(s.apply).toBeUndefined();
    expect(s.available).toBeUndefined();
    expect(s.lastApply).toEqual({ from: FROM, to: TO, outcome: "updated", at: expect.any(String) as string });
    expect(readdirSync(join(upd, "download"))).toEqual([]);
    expect(readdirSync(backups)).toEqual([backupName(new Date(STARTED), "premigration", "tracker")]);
    expect(existsSync(join(data, "failed-update"))).toBe(false);
    expect(logger.lines.find((l) => l.event === "health")).toMatchObject({ fields: { version: TO, ok: true, pid: 42 } });
    expect(logger.lines.at(-1)).toMatchObject({ event: "done", fields: { outcome: "updated" } });
    expect(w.toasts).toEqual([]);
  });

  test("a download changed since it was verified is never run: the app isn't stopped, and the version is skipped", async () => {
    writeFileSync(join(upd, "download", `Grindlog-Setup-${TO}.exe`), "tampered");
    const { deps, w, logger } = world();

    expect(await runUpdate(deps)).toBe("not_started");

    expect(w.quits).toEqual([]);
    expect(w.installs).toEqual([]);
    expect(w.starts).toBe(0);
    const s = state();
    expect(s).toMatchObject({ lastApply: { outcome: "not_started", reason: "bad_signature" }, skipped: [{ version: "9.9.7" }, { version: TO, reason: "bad_signature" }] });
    expect(s.apply).toBeUndefined();
    expect(s.available).toBeUndefined();
    expect(logger.lines.find((l) => l.event === "reverify_failed")).toMatchObject({ level: "warn", fields: { reason: "bad_signature" } });
  });

  test("with no previous installer to roll back with, it doesn't start", async () => {
    rmSync(join(upd, "previous"), { recursive: true });
    const { deps, w, logger } = world();

    expect(await runUpdate(deps)).toBe("not_started");

    expect(w.quits).toEqual([]);
    expect(state()).toMatchObject({ lastApply: { outcome: "not_started", reason: "no_rollback_installer" }, available: { version: TO } });
    expect(state().apply).toBeUndefined();
    expect(logger.events()).toContain("update/no_rollback_installer");
  });

  test("an app that won't stop isn't installed over, and is started again", async () => {
    const { deps, w } = world({ quitCodes: [1] });

    expect(await runUpdate(deps)).toBe("not_started");

    expect(w.installs).toEqual([]);
    expect(w.starts).toBe(1);
    expect(state()).toMatchObject({ lastApply: { outcome: "not_started", reason: "stop_failed" }, available: { version: TO } });
  });

  test("a failed install rolls back with the previous installer, checks the old version, skips the new one and says so", async () => {
    const { deps, w, logger } = world({ installerCodes: [1] });

    expect(await runUpdate(deps)).toBe("rolled_back");

    expect(w.phases()).toEqual(["stopping", "installing", "rolling_back", "checking_previous"]);
    expect(w.quits).toHaveLength(2);
    expect(w.installs[1]).toEqual(installerArgs(join(upd, "rollback-setup.exe"), join(data, "logs", `rollback-${FROM}.log`)));
    expect(readFileSync(join(upd, "rollback-setup.exe"), "utf8")).toBe("previous installer");
    const s = state();
    expect(s).toMatchObject({ lastApply: { from: FROM, to: TO, outcome: "rolled_back", reason: "installer_failed" }, skipped: [{ version: "9.9.7" }, { version: TO, reason: "installer_failed" }] });
    expect(s.apply).toBeUndefined();
    expect(s.available).toBeUndefined();
    expect(logger.lines.find((l) => l.event === "installer_exited")).toMatchObject({ level: "error", fields: { code: 1 } });
    expect(w.toasts).toEqual([{ title: "Grindlog's update didn't work", body: `Went back to ${FROM}.` }]);
  });

  test("a new version that keeps crashing is rolled back, with the DBs it migrated put back from their backups", async () => {
    makeDb(join(data, "tracker.db"), 2, "migrated");
    mkdirSync(join(data, "backups"));
    makeDb(join(data, "backups", backupName(new Date(Date.parse(STARTED) + 60_000), "premigration", "tracker")), 1, "before", "delete");
    const { deps, w } = world({ crashing: [TO] });

    expect(await runUpdate(deps)).toBe("rolled_back");

    expect(w.phases()).toEqual(["stopping", "installing", "checking", "rolling_back", "checking_previous"]);
    expect(readUserVersion(join(data, "tracker.db"))).toBe(1);
    expect(readUserVersion(join(data, "failed-update", TO, "tracker.db"))).toBe(2);
    expect(state().lastApply).toMatchObject({ outcome: "rolled_back", reason: "health_check_failed" });
  });

  test("a new version that couldn't start for lack of disk space says so", async () => {
    writeStartFailure(upd, memoryLogger(), { version: TO, reason: "low_disk", freeBytes: 1, needBytes: 2, at: "2026-11-12T10:03:00.000Z" });
    const { deps } = world({ crashing: [TO] });

    expect(await runUpdate(deps)).toBe("rolled_back");
    expect(state()).toMatchObject({ lastApply: { reason: "low_disk" }, skipped: [{ version: "9.9.7" }, { version: TO, reason: "low_disk" }] });
  });

  test("when the old version won't come back either, the toast links the latest release to reinstall from", async () => {
    const { deps, w } = world({ crashing: [TO, FROM] });

    expect(await runUpdate(deps)).toBe("rollback_failed");

    expect(state().lastApply).toMatchObject({ outcome: "rollback_failed", reason: "health_check_failed" });
    expect(w.toasts).toEqual([{ title: "Grindlog couldn't restart", body: `Reinstall it from ${RELEASES_LATEST_PAGE}`, url: RELEASES_LATEST_PAGE }]);
  });

  test("an updater crash after installing began still rolls back", async () => {
    const { deps, w, logger } = world();
    let first = true;
    const probe = deps.probe;
    deps.probe = (port) => {
      if (first) {
        first = false;
        return Promise.reject(new Error("boom"));
      }
      return probe(port);
    };

    expect(await runUpdate(deps)).toBe("rolled_back");

    expect(logger.lines.find((l) => l.event === "crashed")).toMatchObject({ level: "error", fields: { phase: "checking" } });
    expect(state().lastApply).toMatchObject({ outcome: "rolled_back", reason: "crashed" });
    expect(w.up).toBe(FROM);
  });

  test("an updater crash while stopping starts the app again and records it as not started", async () => {
    const { deps, w } = world({ quit: () => Promise.reject(new Error("powershell missing")) });

    expect(await runUpdate(deps)).toBe("not_started");

    expect(w.starts).toBe(1);
    expect(state().lastApply).toMatchObject({ outcome: "not_started", reason: "crashed" });
    expect(state().apply).toBeUndefined();
  });

  test.each([
    ["no apply recorded", { apply: undefined }],
    ["an apply from another version than this updater's", { apply: { from: "9.9.6", to: TO, startedAt: STARTED, phase: "starting" } }],
    ["an apply of another version than the verified download", { available: undefined }],
  ])("does nothing with %s", async (_, changes) => {
    writeState(upd, memoryLogger(), changes);
    const before = readFileSync(join(upd, "state.json"), "utf8");
    const { deps, w, logger } = world();

    expect(await runUpdate(deps)).toBe("no_apply");

    expect(w.quits).toEqual([]);
    expect(readFileSync(join(upd, "state.json"), "utf8")).toBe(before);
    expect(logger.events()).toContain("update/no_apply");
  });
});

describe("runUpdate crashing during the rollback", () => {
  test("starts the app anyway and records the rollback as failed, with the reinstall toast", async () => {
    const { deps, w } = world({ installerCodes: [1] });
    deps.runInstaller = (argv) => {
      w.installs.push(argv);
      return w.installs.length === 1 ? Promise.resolve({ code: 1, timedOut: false }) : Promise.reject(new Error("spawn failed"));
    };

    expect(await runUpdate(deps)).toBe("rollback_failed");

    expect(w.starts).toBe(1);
    expect(state().lastApply).toMatchObject({ outcome: "rollback_failed", reason: "crashed" });
    expect(state().apply).toBeUndefined();
    // Skipped and dropped as after any failed rollback, so the gate doesn't apply it again.
    expect(state().skipped).toContainEqual({ version: TO, reason: "crashed" });
    expect(state().available).toBeUndefined();
    expect(w.toasts).toEqual([{ title: "Grindlog couldn't restart", body: `Reinstall it from ${RELEASES_LATEST_PAGE}`, url: RELEASES_LATEST_PAGE }]);
  });

  test("a crash once the old version was started again doesn't start a second supervisor", async () => {
    const { deps, w } = world({ installerCodes: [1] });
    const probe = deps.probe;
    deps.probe = (port) => (w.installs.length === 2 ? Promise.reject(new Error("boom")) : probe(port));

    expect(await runUpdate(deps)).toBe("rollback_failed");

    expect(w.starts).toBe(1);
    expect(state().skipped).toContainEqual({ version: TO, reason: "crashed" });
  });
});

describe("runUpdate when starting the app throws", () => {
  test("the crash path tries the start again rather than leave the app stopped", async () => {
    const { deps, w } = world({ installerCodes: [1] });
    const start = deps.startSupervisor;
    let tries = 0;
    deps.startSupervisor = (exe) => {
      tries++;
      if (tries === 1) throw new Error("spawn EPERM");
      start(exe);
    };

    expect(await runUpdate(deps)).toBe("rollback_failed");

    expect(tries).toBe(2);
    expect(w.up).toBe(FROM);
  });
});

describe("runUpdate checking the installer again once the app is stopped", () => {
  test("a download swapped during the stop isn't run: the app is started again and the version skipped", async () => {
    const { deps, w } = world();
    const quit = deps.quit;
    deps.quit = async (exe) => {
      const code = await quit(exe);
      writeFileSync(join(upd, "download", `Grindlog-Setup-${TO}.exe`), "swapped");
      return code;
    };

    expect(await runUpdate(deps)).toBe("not_started");

    expect(w.installs).toEqual([]);
    expect(w.starts).toBe(1);
    expect(state()).toMatchObject({ lastApply: { outcome: "not_started", reason: "bad_signature" } });
    expect(state().skipped).toContainEqual({ version: TO, reason: "bad_signature" });
  });
});

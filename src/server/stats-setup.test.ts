import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConfigCheck, ConfigProblem } from "./stats-config";
import { applyStatsFix, fixStatsIni, runStatsFix, type ApplyResult, type FixWant } from "./stats-setup";
import { memoryLogger } from "./testing";

// The shipped file's shape, CRLF, with the rate off.
const SHIPPED = [
  "[TAGame.MatchStatsExporter_TA]",
  "",
  "; Port the client will listen for tcp connections on (must be different than WebPort, set to 0 to disable)",
  "Port=49123",
  "",
  "; Port the client will listen for web connections on (must be different than Port, set to 0 to disable)",
  "WebPort=49124",
  "",
  "; How many times per second the game sends the update state (capped at 120, 0 disables this feature)",
  "PacketSendRate=0",
  "",
].join("\r\n");

describe("fixStatsIni", () => {
  test("rate 0 becomes 30 and every other byte stays as it was", () => {
    const r = fixStatsIni(SHIPPED, { packetSendRate: 30 });
    expect(r.text).toBe(SHIPPED.replace("PacketSendRate=0", "PacketSendRate=30"));
    expect(r).toMatchObject({ changed: ["packetSendRate"], added: [] });
  });

  test("only the value is replaced: key case, spacing and an LF ending survive", () => {
    const text = "[tagame.matchstatsexporter_ta]\npacketsendrate =  0.0 \nPort=1\n";
    expect(fixStatsIni(text, { packetSendRate: 30 }).text).toBe("[tagame.matchstatsexporter_ta]\npacketsendrate =  30 \nPort=1\n");
  });

  test("a value already equal to the wanted number (30.0) is left alone", () => {
    const text = "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=30.0\n";
    expect(fixStatsIni(text, { packetSendRate: 30 })).toEqual({ text, changed: [], added: [] });
  });

  test("WebPort moves to the expected port", () => {
    const r = fixStatsIni(SHIPPED.replace("PacketSendRate=0", "PacketSendRate=30").replace("WebPort=49124", "WebPort=50000"), { webPort: 49124 });
    expect(r.text).toBe(SHIPPED.replace("PacketSendRate=0", "PacketSendRate=30"));
    expect(r.changed).toEqual(["webPort"]);
  });

  test("no trailing newline stays that way", () => {
    expect(fixStatsIni("[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0", { packetSendRate: 30 }).text).toBe("[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=30");
  });

  test("every duplicate is fixed, since the last one wins", () => {
    const text = "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\nPacketSendRate=-1\n";
    expect(fixStatsIni(text, { packetSendRate: 30 }).text).toBe("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=30\nPacketSendRate=30\n");
  });

  test("the same key in another section, or commented out, is untouched", () => {
    const text = "[Other]\nPacketSendRate=0\n[TAGame.MatchStatsExporter_TA]\n;PacketSendRate=0\nPacketSendRate=0\n[Next]\nPacketSendRate=0\n";
    expect(fixStatsIni(text, { packetSendRate: 30 }).text).toBe(
      "[Other]\nPacketSendRate=0\n[TAGame.MatchStatsExporter_TA]\n;PacketSendRate=0\nPacketSendRate=30\n[Next]\nPacketSendRate=0\n",
    );
  });

  test("a wanted key the section lacks goes after its last key line; keys not wanted aren't added", () => {
    const text = "[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nWebPort=49124\r\n\r\n[Next]\r\nA=1\r\n";
    const r = fixStatsIni(text, { packetSendRate: 30 });
    expect(r.text).toBe("[TAGame.MatchStatsExporter_TA]\r\nPort=49123\r\nWebPort=49124\r\nPacketSendRate=30\r\n\r\n[Next]\r\nA=1\r\n");
    expect(r).toMatchObject({ changed: [], added: ["packetSendRate"] });
  });

  test("an insert after a last line without an ending keeps the file unterminated", () => {
    expect(fixStatsIni("[TAGame.MatchStatsExporter_TA]\nPort=1", { webPort: 49124 }).text).toBe("[TAGame.MatchStatsExporter_TA]\nPort=1\nWebPort=49124");
  });

  test("a missing section is appended at the end", () => {
    const r = fixStatsIni("[Other]\r\nA=1\r\n", { packetSendRate: 30, webPort: 49124 });
    expect(r.text).toBe("[Other]\r\nA=1\r\n\r\n[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=30\r\nWebPort=49124\r\n");
    expect(r).toMatchObject({ changed: [], added: ["packetSendRate", "webPort"] });
  });

  test("an empty file gets just the section", () => {
    expect(fixStatsIni("", { packetSendRate: 30 }).text).toBe("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=30\n");
  });

  test("nothing wanted changes nothing", () => {
    expect(fixStatsIni(SHIPPED, {})).toEqual({ text: SHIPPED, changed: [], added: [] });
  });
});

describe("applyStatsFix", () => {
  let dir: string;
  let ini: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "grindlog-setup-"));
    ini = join(dir, "TAStatsAPI.ini");
  });
  afterEach(() => {
    if (existsSync(ini)) chmodSync(ini, 0o666);
    rmSync(dir, { recursive: true, force: true });
  });

  const OFF = "[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\nWebPort=49124\r\n";
  const ON = OFF.replace("=0", "=30");

  test.each([
    ["UTF-8", Buffer.from(OFF, "utf8"), Buffer.from(ON, "utf8")],
    ["UTF-8 with a BOM", Buffer.from(`\uFEFF${OFF}`, "utf8"), Buffer.from(`\uFEFF${ON}`, "utf8")],
    ["UTF-16LE", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(OFF, "utf16le")]), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ON, "utf16le")])],
  ])("%s is written back in the same encoding", (_name, before, after) => {
    writeFileSync(ini, before);
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: true, changed: ["packetSendRate"], added: [] });
    expect(readFileSync(ini)).toEqual(after);
    expect(logger.lines).toContainEqual({
      level: "info",
      cat: "game",
      event: "stats_setup_fixed",
      fields: { path: ini, changed: ["packetSendRate"], added: [], before: { packetSendRate: 0, webPort: 49124 }, after: { packetSendRate: 30, webPort: 49124 } },
    });
  });

  test("an inserted key is also logged as a warning: no game-written file has been seen without it", () => {
    writeFileSync(ini, "[TAGame.MatchStatsExporter_TA]\nWebPort=49124\n");
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: true, changed: [], added: ["packetSendRate"] });
    expect(logger.lines).toContainEqual({ level: "warn", cat: "game", event: "stats_setup_key_added", fields: { path: ini, added: ["packetSendRate"] } });
  });

  test("a file already right isn't written", () => {
    writeFileSync(ini, ON);
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: true, changed: [], added: [] });
    expect(logger.events()).toEqual(["game/stats_setup_already_right"]);
  });

  test("a missing file is not created", () => {
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: false, error: "no_file" });
    expect(existsSync(ini)).toBe(false);
    expect(logger.events()).toEqual(["game/stats_setup_no_file"]);
  });

  test("a read-only file is a failed write, logged with the error", () => {
    writeFileSync(ini, OFF);
    chmodSync(ini, 0o444);
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: false, error: "write_failed" });
    expect(readFileSync(ini, "utf8")).toBe(OFF);
    const line = logger.lines.find((l) => l.event === "stats_setup_write_failed");
    expect(line).toMatchObject({ level: "warn", cat: "game", fields: { path: ini } });
    expect((line?.fields.err as NodeJS.ErrnoException).code).toMatch(/EPERM|EACCES/);
  });

  test("a file that can't be read answers write_failed too, but the log says the read failed", () => {
    mkdirSync(ini);
    const logger = memoryLogger();
    expect(applyStatsFix({ iniPath: ini, want: { packetSendRate: 30 }, logger })).toEqual({ ok: false, error: "write_failed" });
    const line = logger.lines.find((l) => l.event === "stats_setup_read_failed");
    expect(line).toMatchObject({ level: "warn", cat: "game", fields: { path: ini } });
    expect((line?.fields.err as NodeJS.ErrnoException).code).toBe("EISDIR");
  });
});

describe("runStatsFix", () => {
  const DIR = "C:\\Docs\\My Games\\Rocket League\\TAGame\\Config";
  const check = (problems: ConfigProblem[]): ConfigCheck => ({
    installDir: null,
    foundBy: null,
    userConfigDir: DIR,
    file: "user",
    path: join(DIR, "TAStatsAPI.ini"),
    effective: {},
    problems,
  });
  const setup = (first: ConfigCheck | null | "timeout", applied: ApplyResult = { ok: true, changed: ["packetSendRate"], added: [] }) => {
    const recheck = vi.fn<() => Promise<ConfigCheck | null | "timeout">>(() => Promise.resolve(first));
    const apply = vi.fn<(iniPath: string, want: FixWant) => ApplyResult>(() => applied);
    return { recheck, apply, logger: memoryLogger(), expectedWebPort: 49124 };
  };

  test.each([
    ["no check result", null, "check_failed"],
    ["a check that timed out", "timeout", "check_failed"],
    ["no ini anywhere", check(["no_ini"]), "no_file"],
    ["no Documents copy", check(["user_missing", "send_rate_off"]), "no_file"],
    ["a custom WebPort without consent", check(["send_rate_off", "web_port_mismatch"]), "port_needs_consent"],
  ] as const)("%s: nothing is written", async (_name, first, error) => {
    const deps = setup(first);
    expect(await runStatsFix({ ...deps, portConsent: false })).toEqual({ ok: false, error });
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.recheck).toHaveBeenCalledTimes(1);
  });

  test("nothing to fix: no write, no second check", async () => {
    const deps = setup(check([]));
    expect(await runStatsFix({ ...deps, portConsent: false })).toEqual({ ok: true, changed: [], added: [] });
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.recheck).toHaveBeenCalledTimes(1);
  });

  test("a write fixes only the wrong keys in the Documents copy, then rechecks in the background", async () => {
    const deps = setup(check(["send_rate_off", "web_port_mismatch"]), { ok: true, changed: ["packetSendRate", "webPort"], added: [] });
    expect(await runStatsFix({ ...deps, portConsent: true })).toEqual({ ok: true, changed: ["packetSendRate", "webPort"], added: [] });
    expect(deps.apply).toHaveBeenCalledWith(join(DIR, "TAStatsAPI.ini"), { packetSendRate: 30, webPort: 49124 });
    expect(deps.recheck).toHaveBeenCalledTimes(2);
  });

  test("a port that's off is set without consent; the rate isn't touched when it's on", async () => {
    const deps = setup(check(["web_port_off"]), { ok: true, changed: ["webPort"], added: [] });
    await runStatsFix({ ...deps, portConsent: false });
    expect(deps.apply).toHaveBeenCalledWith(join(DIR, "TAStatsAPI.ini"), { webPort: 49124 });
  });

  test("a failed write is passed on, with no second check", async () => {
    const deps = setup(check(["send_rate_off"]), { ok: false, error: "write_failed" });
    expect(await runStatsFix({ ...deps, portConsent: false })).toEqual({ ok: false, error: "write_failed" });
    expect(deps.recheck).toHaveBeenCalledTimes(1);
  });
});

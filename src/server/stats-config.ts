// Finds the game's Stats API settings and says what's wrong with them, so "Stats API off" can name
// the fix instead of a generic hint.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "./log";
import { runCommand } from "./powershell";
import { STATS_INI, SUGGESTED_RATE, USER_INI_HINT } from "../shared/constants";

const SECTION = "tagame.matchstatsexporter_ta";
const KEYS = { packetsendrate: "packetSendRate", port: "port", webport: "webPort" } as const;

export interface StatsIni {
  packetSendRate?: number;
  port?: number;
  webPort?: number;
}

/** The exporter section's name as written in the game's own files. */
export const SECTION_HEADER = "[TAGame.MatchStatsExporter_TA]";
/** The ini key each StatsIni field is written as. */
export const INI_KEY_NAMES: Record<keyof StatsIni, string> = { packetSendRate: "PacketSendRate", port: "Port", webPort: "WebPort" };

/**
 * One ini line (without its ending): a section header, saying whether it opens the exporter section;
 * a line naming an exporter key, with where its trimmed value sits in `raw`; or anything else.
 */
export type IniLine =
  | { kind: "section"; exporter: boolean }
  | { kind: "key"; key: keyof StatsIni; value: string; valueStart: number; valueEnd: number }
  | { kind: "other" };

export function classifyIniLine(raw: string): IniLine {
  const line = raw.trim();
  if (line === "" || line.startsWith(";")) return { kind: "other" };
  const header = /^\[(.*)\]$/.exec(line);
  if (header) return { kind: "section", exporter: header[1]?.trim().toLowerCase() === SECTION };
  const eq = raw.indexOf("=");
  if (eq < 0) return { kind: "other" };
  const key = KEYS[raw.slice(0, eq).trim().toLowerCase() as keyof typeof KEYS] as keyof StatsIni | undefined;
  if (!key) return { kind: "other" };
  const after = raw.slice(eq + 1);
  const valueStart = eq + 1 + (after.length - after.trimStart().length);
  const value = after.trim();
  return { kind: "key", key, value, valueStart, valueEnd: valueStart + value.length };
}

/** A value the game reads as a number: Psyonix documents the send rate as a float, so `30.0` counts. */
export const INI_NUMBER = /^-?\d+(\.\d+)?$/;

/** The exporter section of a Stats API ini. Keys are case-insensitive; a non-numeric value is left out. */
export function parseStatsIni(text: string): StatsIni {
  const out: StatsIni = {};
  let inSection = false;
  for (const raw of (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)) {
    const line = classifyIniLine(raw);
    if (line.kind === "section") inSection = line.exporter;
    else if (line.kind === "key" && inSection && INI_NUMBER.test(line.value)) out[line.key] = Number(line.value);
  }
  return out;
}

const DEFAULT_INI = "DefaultStatsAPI.ini";

export type ConfigProblem = "no_ini" | "user_missing" | "send_rate_off" | "web_port_off" | "web_port_mismatch";
/** Which copy of the settings is in effect: the per-user one in Documents, or the install's. */
export type IniLayer = "user" | "install" | "default";

export interface Diagnosis {
  /** The highest layer present, or null when there's none. */
  file: IniLayer | null;
  effective: StatsIni;
  /** Most fundamental first: the toast names only the first. */
  problems: ConfigProblem[];
}

/**
 * Each layer's parsed ini, null when absent: `user` is `Documents\My Games\Rocket
 * League\TAGame\Config\TAStatsAPI.ini`, `install` is `<install>\TAGame\Config\TAStatsAPI.ini`,
 * `default` is `<install>\TAGame\Config\DefaultStatsAPI.ini`.
 */
export type IniLayers = Record<IniLayer, StatsIni | null>;

/**
 * What the game ends up with, per key: the Documents copy, else the install's TAStatsAPI.ini, else
 * its Default. The Documents copy is proven to win over the install copy; a key missing from every
 * layer reads as off.
 */
export function diagnose(layers: IniLayers, expectedWebPort: number): Diagnosis {
  const { user, install, default: def } = layers;
  if (!user && !install && !def) return { file: null, effective: {}, problems: ["no_ini"] };
  const effective: StatsIni = { ...def, ...install, ...user };
  const problems: ConfigProblem[] = [];
  // The game writes the Documents copy at launch and the check runs while it's open, so a missing one
  // most likely means the wrong Documents folder: flag it even when the install copy looks right.
  if (!user) problems.push("user_missing");
  if ((effective.packetSendRate ?? 0) <= 0) problems.push("send_rate_off");
  // The file's own comment says 0 disables the port; not tried in game.
  if ((effective.webPort ?? 0) <= 0) problems.push("web_port_off");
  else if (effective.webPort !== expectedWebPort) problems.push("web_port_mismatch");
  return { file: user ? "user" : install ? "install" : "default", effective, problems };
}

/** One fix-first sentence for the toast, which shows about two lines; undefined is "no problem found". */
export function describeProblem(problem: ConfigProblem | undefined, expectedWebPort: number, file: IniLayer | null): string {
  const rate = String(SUGGESTED_RATE);
  const port = String(expectedWebPort);
  const where = file === "user" ? USER_INI_HINT : `${STATS_INI} in the game's TAGame\\Config folder`;
  switch (problem) {
    case "no_ini":
    case "user_missing":
      return `Rocket League's settings file ${USER_INI_HINT} wasn't found. Set PacketSendRate=${rate} there, then restart the game.`;
    case "send_rate_off":
      return `Set PacketSendRate to ${rate} in ${where}, then restart the game.`;
    case "web_port_off":
      return `Set WebPort to ${port} in ${where}, then restart the game.`;
    case "web_port_mismatch":
      return `Set WebPort to ${port} in ${where} (the port the tracker connects to), then restart the game.`;
    case undefined:
      return "The settings file looks right but no data arrived. Restart the game if you edited it while it was running.";
  }
}

/** Rocket League's install location from an Epic `.item` manifest (its AppName is "Sugar"), else null. */
export function parseEpicManifest(json: string): string | null {
  let m: unknown;
  try {
    m = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const { AppName, InstallLocation } = m as { AppName?: unknown; InstallLocation?: unknown };
  return AppName === "Sugar" && typeof InstallLocation === "string" && InstallLocation !== "" ? InstallLocation : null;
}

/**
 * A string value from `reg query ... /v <name>` output: everything after the type token, so spaces in
 * a path survive. Null when the value isn't listed or is empty.
 */
export function parseRegSz(stdout: string, name: string): string | null {
  const nameLower = name.toLowerCase();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m?.[1]?.toLowerCase() !== nameLower) continue;
    const value = (m[2] ?? "").trimEnd();
    return value === "" ? null : value;
  }
  return null;
}

/** `%VAR%` expanded from `env`, names case-insensitive as on Windows; an unknown one is left as-is. */
export function expandEnv(value: string, env: Record<string, string | undefined>): string {
  const lower = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  return value.replace(/%([^%]+)%/g, (whole, name: string) => lower.get(name.toLowerCase()) ?? whole);
}

export interface Attempt {
  method: string;
  outcome: string;
}
export type LocatorResult = { dir: string } | { outcome: string };
export interface Locator {
  method: string;
  /** May reject; checkStatsConfig records the error and moves on. */
  find: () => Promise<LocatorResult>;
}

/** Epic's install manifests, one JSON `.item` file per installed game. */
export const fromEpic: Locator = {
  method: "epic",
  find: () => {
    const manifests = join(process.env.ProgramData ?? "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
    let names: string[];
    try {
      names = readdirSync(manifests).filter((n) => n.toLowerCase().endsWith(".item"));
    } catch (err) {
      if (isNodeError(err, "ENOENT")) return Promise.resolve({ outcome: "no_manifests" });
      throw err;
    }
    for (const name of names) {
      let dir: string | null;
      try {
        dir = parseEpicManifest(readFileSync(join(manifests, name), "utf8"));
      } catch {
        // One unreadable manifest belongs to some other game as often as not; the rest still count.
        continue;
      }
      if (dir) return Promise.resolve({ dir });
    }
    return Promise.resolve({ outcome: "not_listed" });
  },
};

/**
 * Install locators. The running game's exe path would cover any store, but anti-cheat hides it, so
 * asking cost a PowerShell spawn for nothing. The install only adds the fallback layers anyway.
 */
export const LOCATORS: Locator[] = [fromEpic];

/** The Documents config dir, how it was found and what failed first; `outcome` when there's none. */
export type UserDirResult = { dir: string; foundBy: "registry" | "userprofile" | "override"; tried: Attempt[] } | { outcome: string };

const SHELL_FOLDERS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
const REG_TIMEOUT_MS = 5_000;
const USER_CONFIG_SUBDIR = join("My Games", "Rocket League", "TAGame", "Config");

/**
 * Where the game keeps its per-user settings: under the real Documents folder, which OneDrive's folder
 * backup or a user may have moved, so it comes from the registry. Falls back to
 * `%USERPROFILE%\Documents`. Never rejects unless `run` can't start `reg`.
 */
export async function findUserConfigDir(
  deps: { run?: typeof runCommand; env?: Record<string, string | undefined> } = {},
): Promise<UserDirResult> {
  const { run = runCommand, env = process.env } = deps;
  const r = await run(["reg", "query", SHELL_FOLDERS_KEY, "/v", "Personal"], REG_TIMEOUT_MS);
  let outcome: string;
  if (r.timedOut) outcome = "timeout";
  else if (r.code !== 0) outcome = `exit ${String(r.code)}`;
  else {
    const value = parseRegSz(r.stdout, "Personal");
    const docs = value === null ? null : expandEnv(value, env);
    // reg prints in the OEM code page, so a non-ASCII profile name may decode wrong: only a folder
    // that's there counts.
    if (docs !== null && existsSync(docs)) return { dir: join(docs, USER_CONFIG_SUBDIR), foundBy: "registry", tried: [] };
    outcome = docs === null ? "unparsable" : `missing ${docs}`;
  }
  const profile = env.USERPROFILE;
  if (!profile) return { outcome: `${outcome}; no_userprofile` };
  return { dir: join(profile, "Documents", USER_CONFIG_SUBDIR), foundBy: "userprofile", tried: [{ method: "documents", outcome }] };
}

export interface ConfigCheck extends Diagnosis {
  /** Null when no locator found the install. */
  installDir: string | null;
  foundBy: string | null;
  /** Null when the Documents folder couldn't be found. */
  userConfigDir: string | null;
  /** Full path of the file in effect, or null when there's none. */
  path: string | null;
}

/** The Documents ini, the copy the setup fix writes; null when the Documents folder wasn't found. */
export function userIniPath(check: Pick<ConfigCheck, "userConfigDir">): string | null {
  return check.userConfigDir === null ? null : join(check.userConfigDir, STATS_INI);
}

/** A Node error with this code, or with any code when none is given (an fs failure rather than a bug). */
export function isNodeError(err: unknown, code?: string): err is NodeJS.ErrnoException {
  const c = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  return typeof c === "string" && (code === undefined || c === code);
}

const errorText = (err: unknown) => `error: ${err instanceof Error ? err.message : String(err)}`;

export type IniEncoding = "utf16le" | "utf8" | "utf8bom";

/** An ini's text without its BOM, and how to write it back. Windows editors may save UTF-16, marked by its FF FE BOM. */
export function decodeIni(buf: Buffer): { text: string; encoding: IniEncoding } {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf16le" };
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString("utf8"), encoding: "utf8bom" };
  return { text: buf.toString("utf8"), encoding: "utf8" };
}

/** The bytes decodeIni read `text` from, BOM included. */
export function encodeIni(text: string, encoding: IniEncoding): Buffer {
  if (encoding === "utf16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  if (encoding === "utf8bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
  return Buffer.from(text, "utf8");
}

/** A parsed ini, or null when the file doesn't exist. */
function readIni(path: string): StatsIni | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (err) {
    if (isNodeError(err, "ENOENT")) return null;
    throw err;
  }
  return parseStatsIni(decodeIni(buf).text);
}

/** The first install whose TAGame\Config exists, recording every miss in `tried`. */
async function findInstall(locators: Locator[], tried: Attempt[]): Promise<{ dir: string; configDir: string; method: string } | null> {
  for (const { method, find } of locators) {
    let found: LocatorResult;
    try {
      found = await find();
    } catch (err) {
      tried.push({ method, outcome: errorText(err) });
      continue;
    }
    if (!("dir" in found)) {
      tried.push({ method, outcome: found.outcome });
      continue;
    }
    const configDir = join(found.dir, "TAGame", "Config");
    if (existsSync(configDir)) return { dir: found.dir, configDir, method };
    tried.push({ method, outcome: "no_config_dir" });
  }
  return null;
}

/**
 * Finds the Documents copy and the install, reads every Stats API ini there is and logs what's wrong
 * with them. Never throws; null when neither was found or a file couldn't be read.
 */
export async function checkStatsConfig(opts: {
  expectedWebPort: number;
  logger: Logger;
  locators: Locator[];
  userDir?: () => Promise<UserDirResult>;
}): Promise<ConfigCheck | null> {
  const { expectedWebPort, logger, locators, userDir = findUserConfigDir } = opts;
  const tried: Attempt[] = [];
  let user: { dir: string; foundBy: string } | null = null;
  try {
    const r = await userDir();
    if ("dir" in r) {
      user = r;
      tried.push(...r.tried);
    } else tried.push({ method: "documents", outcome: r.outcome });
  } catch (err) {
    tried.push({ method: "documents", outcome: errorText(err) });
  }
  const install = await findInstall(locators, tried);
  if (!user && !install) {
    logger.warn("game", "stats_config_unknown", { tried });
    return null;
  }

  const paths: Record<IniLayer, string | null> = {
    user: user && join(user.dir, STATS_INI),
    install: install && join(install.configDir, STATS_INI),
    default: install && join(install.configDir, DEFAULT_INI),
  };
  let reading: string | null = null;
  const read = (path: string | null) => (path === null ? null : readIni((reading = path)));
  let layers: IniLayers;
  try {
    layers = { user: read(paths.user), install: read(paths.install), default: read(paths.default) };
  } catch (err) {
    // Permissions, or a OneDrive placeholder that won't download: the place is right, the check just can't see in.
    logger.warn("game", "stats_config_read_failed", { path: reading, err });
    return null;
  }

  const diagnosis = diagnose(layers, expectedWebPort);
  const result: ConfigCheck = {
    ...diagnosis,
    installDir: install?.dir ?? null,
    foundBy: install?.method ?? null,
    userConfigDir: user?.dir ?? null,
    path: diagnosis.file && paths[diagnosis.file],
  };
  const level = result.problems.length > 0 ? "warn" : "info";
  logger[level]("game", "stats_config", {
    userConfigDir: result.userConfigDir,
    userFoundBy: user?.foundBy ?? null,
    installDir: result.installDir,
    foundBy: result.foundBy,
    file: result.file,
    path: result.path,
    layers,
    effective: result.effective,
    problems: result.problems,
    tried,
  });
  return result;
}

/** The port a ws:// or wss:// URL connects to, the scheme default when it names none. */
export function expectedPort(url: string): number {
  const u = new URL(url);
  if (u.port !== "") return Number(u.port);
  return u.protocol === "wss:" ? 443 : 80;
}

import { homedir } from "node:os";
import { join } from "node:path";
import { CHANNEL, type Channel } from "../shared/channel";

type Env = Record<string, string | undefined>;

export interface Identity {
  /** The folder under %LOCALAPPDATA%. */
  dataDirName: string;
  /** The dashboard's port, which also guards a single instance. */
  port: number;
  /** The one installed exe, which runs as both tracker and (with --supervisor) supervisor. */
  exe: string;
  /** The logon task's name. */
  task: string;
  /** The Start menu shortcut's file name. */
  shortcut: string;
}

/**
 * Everything that tells a friend's install apart from the developer's, so the two never share data,
 * a port, a task or an exe name. The ports sit near the game's and below the Windows dynamic range
 * (49152+); `bun run dev` uses 49101 between them.
 */
export function identity(channel: Channel = CHANNEL): Identity {
  return channel === "prod"
    ? { dataDirName: "Grindlog", port: 49100, exe: "grindlog.exe", task: "Grindlog", shortcut: "Grindlog.url" }
    : { dataDirName: "GrindlogDev", port: 49102, exe: "grindlog-dev.exe", task: "GrindlogDev", shortcut: "Grindlog Dev.url" };
}

/** Where the tracker keeps its logs and databases. GRINDLOG_DATA_DIR overrides it (tests, dev). */
export function dataDir(env: Env = process.env, channel: Channel = CHANNEL): string {
  if (env.GRINDLOG_DATA_DIR) return env.GRINDLOG_DATA_DIR;
  return localAppDataDir(identity(channel).dataDirName, env);
}

/** A folder under %LOCALAPPDATA%. */
export function localAppDataDir(name: string, env: Env = process.env): string {
  // Truthy, not just defined: an empty LOCALAPPDATA (a stripped service environment) would make
  // the path relative to cwd.
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, name);
  return join(homedir(), "AppData", "Local", name);
}

/** Every log file the tracker and supervisor write. */
export function logsDir(env: Env = process.env, channel: Channel = CHANNEL): string {
  return join(dataDir(env, channel), "logs");
}

/** The dashboard's port. GRINDLOG_PORT overrides it (tests, dev). */
export function dashboardPort(env: Env = process.env, channel: Channel = CHANNEL): number {
  const raw = env.GRINDLOG_PORT;
  if (raw === undefined) return identity(channel).port;
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new Error(`GRINDLOG_PORT must be a port number (1-65535), got "${raw}"`);
  return port;
}

/**
 * The built dashboard to serve: GRINDLOG_STATIC_DIR, else the web build installed beside the exe in
 * `<dataDir>\bin\web`, so it is replaced with it and removed by uninstall. In dev that folder
 * doesn't exist and the tracker answers "dashboard not built"; dev serves the UI with `web:dev`.
 */
export function staticDir(env: Env = process.env, channel: Channel = CHANNEL): string {
  if (env.GRINDLOG_STATIC_DIR) return env.GRINDLOG_STATIC_DIR;
  return join(dataDir(env, channel), "bin", "web");
}

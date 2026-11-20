// Builds the friends release: the prod exe, tray and dashboard staged in release/app, smoke-run, then
// packed by Inno Setup into release/Grindlog-Setup-<version>.exe. The tag workflow runs it with
// --tag; locally it runs bare. `bun run build-release [--tag vX.Y.Z] [--update-key <minisign.pub>]`;
// --update-key bakes in another public key, for a local rehearsal signed with a test key.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, win32 } from "node:path";
import { version as packageVersion } from "../package.json";
import { identity, type Identity, PROD_APP_USER_MODEL_ID } from "../src/server/paths";
import { publicKeyLine } from "../src/server/update/minisign";
import { appName } from "../src/shared/channel";
import { installerName, parseReleaseVersion, type ReleaseVersion } from "../src/shared/release";
import { taskXml } from "./autostart";
import { compileArgs, COPYRIGHT } from "./build-exe";
import { exeIconIssue, fixExeIcon } from "./exe-icon";
import { freePort } from "../src/server/testing";
import { buildTray } from "./build-tray";
import { ensureRcedit, rceditArgs } from "./rcedit";
import { run, runSteps, step, StepFailed, versionInfo } from "./steps";
import { stopTracker } from "./stop";

type Env = Record<string, string | undefined>;

const REPO = join(import.meta.dirname, "..");
const ENTRY = join(REPO, "src", "server", "grindlog.ts");
const EXE_ICON = join(REPO, "src", "web", "public", "favicon.ico");
const ISS = join(REPO, "installer", "grindlog.iss");
const RELEASE = join(REPO, "release");
const APP = join(RELEASE, "app");
const RCEDIT_CACHE = join(REPO, ".cache", "rcedit");
const UPDATE_KEY_FILE = join(REPO, "minisign.pub");
const SMOKE_TIMEOUT_MS = 30_000;
// Per request, so a tracker that accepts the connection and never answers can't outlast the deadline.
const FETCH_TIMEOUT_MS = 5_000;

/** ISCC.exe: the ISCC override, else Inno Setup 6 machine-wide (CI) or per-user (winget's default here). */
export function findIscc(env: Env = process.env, exists: (path: string) => boolean = existsSync): string | null {
  if (env.ISCC) return exists(env.ISCC) ? env.ISCC : null;
  for (const root of [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs")]) {
    if (!root) continue;
    const iscc = win32.join(root, "Inno Setup 6", "ISCC.exe");
    if (exists(iscc)) return iscc;
  }
  return null;
}

/**
 * The logon task definition with tokens the installer fills in (XML-escaped) for the user, the exe and
 * its folder. Without the UTF-16 declaration, so Inno can save it as UTF-8 with no BOM, which
 * schtasks reads when no declaration says otherwise.
 */
export function taskTemplate(): string {
  return taskXml({ userId: "@@USER@@", exe: "@@EXE@@", args: "--supervisor", workDir: "@@WORKDIR@@" }).replace(/^<\?xml[^>]*\?>\r?\n/, "");
}

export function isccArgs({ version, sourceDir, outDir, iss, id }: { version: ReleaseVersion; sourceDir: string; outDir: string; iss: string; id: Identity }): string[] {
  return [
    "/Qp",
    `/DAppVersion=${version.full}`,
    `/DAppNumericVersion=${version.numeric}`,
    `/DSourceDir=${sourceDir}`,
    `/DExeName=${id.exe}`,
    `/DTrayExeName=${id.trayExe}`,
    `/DDataDirName=${id.dataDirName}`,
    `/DTaskName=${id.task}`,
    // Inno adds the .lnk itself.
    `/DShortcutName=${id.shortcut.replace(/\.lnk$/, "")}`,
    `/DAppUserModelID=${PROD_APP_USER_MODEL_ID}`,
    `/DAppCopyright=${COPYRIGHT}`,
    `/O${outDir}`,
    iss,
  ];
}

/** The base64 key line of a minisign public key file, which the exe trusts for updates. */
export function readUpdateKey(path: string, read: (path: string) => string = (p) => readFileSync(p, "utf8")): string {
  let text: string;
  try {
    text = read(path);
  } catch (err) {
    throw new StepFailed(`${path} can't be read (${(err as Error).message}); create the release key with \`minisign -G -p minisign.pub\` (docs/releasing.md).`);
  }
  const line = publicKeyLine(text);
  if (line === null) throw new StepFailed(`${path} is not a minisign public key.`);
  return line;
}

/** The value after `flag` in argv, undefined when the flag is absent; a flag with no value fails. */
function option(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new StepFailed("usage: bun run build-release [--tag vX.Y.Z] [--update-key <minisign.pub>]");
  return value;
}

function releaseVersion(tag: string | undefined): ReleaseVersion {
  let version: ReleaseVersion;
  try {
    version = parseReleaseVersion(packageVersion);
  } catch (err) {
    throw new StepFailed(`package.json: ${(err as Error).message}`);
  }
  if (tag !== undefined && tag !== `v${version.full}`) throw new StepFailed(`The tag ${tag} doesn't match package.json's version ${version.full}; tag v${version.full}, or bump package.json.`);
  return version;
}

/** The tracker's `started` log line, or null before it's written. */
function startedLine(dataDir: string): { channel?: unknown; version?: unknown } | null {
  const file = join(dataDir, "logs", "tracker.log");
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n").slice(0, -1)) {
    let entry: { cat?: string; event?: string; channel?: unknown; version?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      throw new StepFailed(`Smoke run: ${file} has a line that isn't JSON: ${line.slice(0, 200)}`);
    }
    if (entry.cat === "app" && entry.event === "started") return entry;
  }
  return null;
}

/**
 * The minifier folds the channel define, so a prod bundle has no `dev` string literal left and a dev
 * bundle has one. Coupled to the minifier's output, but a change there fails the build loudly.
 */
function webChannelIssue(webDir: string): string | null {
  const assets = join(webDir, "assets");
  const js = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
  if (/[`"']dev[`"']/.test(js)) return "the web build still carries the dev channel literal";
  if (!/[`"']prod[`"']/.test(js)) return "the web build has no prod channel literal";
  return null;
}

/** Runs the staged exe as a bare tracker in a throwaway environment and checks it's a prod build of this version. */
async function smokeRun(exe: string, webDir: string, version: ReleaseVersion): Promise<void> {
  const issue = webChannelIssue(webDir);
  if (issue !== null) throw new StepFailed(`Smoke run: ${issue}.`);
  const tmp = mkdtempSync(join(tmpdir(), "grindlog-smoke-"));
  const port = await freePort();
  const configDir = join(tmp, "Config");
  mkdirSync(configDir);
  const env: Env = {
    ...process.env,
    GRINDLOG_DATA_DIR: tmp,
    GRINDLOG_PORT: String(port),
    GRINDLOG_STATS_CONFIG_DIR: configDir,
    // A task that doesn't exist, so the run can't read or switch the real one.
    GRINDLOG_TASK: "GrindlogReleaseSmokeTest",
    // Nothing listens on port 9, so it never connects to a running game.
    STATS_API_URL: "ws://127.0.0.1:9",
  };
  // Unset, so the prod staticDir (web beside the exe) is what gets served.
  delete env.GRINDLOG_STATIC_DIR;
  const child = Bun.spawn([exe], { env, stdout: "ignore", stderr: "ignore" });
  const base = `http://127.0.0.1:${String(port)}`;
  try {
    const deadline = Date.now() + SMOKE_TIMEOUT_MS;
    let status: { version?: unknown };
    for (;;) {
      if (child.exitCode !== null) throw new StepFailed(`Smoke run: the exe exited with ${String(child.exitCode)}; see ${join(tmp, "logs")}.`);
      if (Date.now() > deadline) throw new StepFailed(`Smoke run: no answer on ${base}/api/status within ${String(SMOKE_TIMEOUT_MS / 1000)} s.`);
      try {
        const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.ok) {
          status = (await res.json()) as { version?: unknown };
          break;
        }
      } catch {
        // Refused (or timed out) until the server is up; the deadline above bounds the wait.
      }
      await Bun.sleep(250);
    }
    if (status.version !== version.full) throw new StepFailed(`Smoke run: /api/status says version ${JSON.stringify(status.version)}, expected "${version.full}".`);
    const started = startedLine(tmp);
    if (started?.channel !== "prod") throw new StepFailed(`Smoke run: the started log line says channel ${JSON.stringify(started?.channel)}, expected "prod".`);
    let page: Response;
    try {
      page = await fetch(`${base}/`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw new StepFailed(`Smoke run: GET / failed (${(err as Error).message}).`);
    }
    if (page.status !== 200) throw new StepFailed(`Smoke run: GET / answered ${String(page.status)}, so the dashboard beside the exe isn't served.`);
    // A build without the baked key would never update, and nothing else would show it.
    let update: { enabled?: unknown };
    try {
      update = (await (await fetch(`${base}/api/update`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json()) as { enabled?: unknown };
    } catch (err) {
      throw new StepFailed(`Smoke run: GET /api/update failed (${(err as Error).message}).`);
    }
    if (update.enabled !== true) throw new StepFailed(`Smoke run: /api/update says enabled ${JSON.stringify(update.enabled)}, so this build wouldn't update.`);
    console.log(`Version ${version.full}, channel prod, updates on, dashboard served from ${webDir}.`);
  } finally {
    const stopped = await stopTracker(port, true);
    if (stopped.exitCode !== 0) {
      console.log(`${stopped.message} Killing it.`);
      child.kill();
    }
    await child.exited;
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function main(): Promise<void> {
  const tag = option("--tag");
  const keyFile = option("--update-key") ?? UPDATE_KEY_FILE;
  const id = identity("prod");

  step("Version");
  const version = releaseVersion(tag);
  console.log(`${version.full}${version.prerelease ? " (prerelease)" : ""}`);

  step("Update key");
  const updateKey = readUpdateKey(keyFile);
  console.log(`${updateKey} from ${keyFile}`);

  // Checked up front, so a missing Inno Setup fails before minutes of building.
  const iscc = findIscc();
  if (iscc === null) throw new StepFailed("ISCC.exe (Inno Setup 6) was not found; install it (winget install JRSoftware.InnoSetup) or set ISCC to its path.");

  step("Dashboard");
  rmSync(RELEASE, { recursive: true, force: true });
  mkdirSync(APP, { recursive: true });
  const web = join(APP, "web");
  // Absolute: Vite resolves a relative outDir against its root, src/web.
  run([process.execPath, "x", "vite", "build", "--outDir", web, "--emptyOutDir"], { cwd: REPO, env: { ...process.env, GRINDLOG_CHANNEL: "prod" } });

  step("Exe");
  const exe = join(APP, id.exe);
  run([process.execPath, ...compileArgs({ entry: ENTRY, outfile: exe, description: appName("prod"), icon: EXE_ICON, version: version.full, defines: { GRINDLOG_CHANNEL: "prod", GRINDLOG_VERSION: version.full, GRINDLOG_UPDATE_KEY: updateKey } })]);

  step("Icon");
  console.log(await fixExeIcon(exe, EXE_ICON));

  step("Tray");
  // Unlike the dev install, a release without its tray is a broken release, so its failure isn't caught.
  buildTray({ out: join(APP, id.trayExe), channel: "prod", version: version.numeric });

  step("InternalName");
  const internalName = id.exe.replace(/\.exe$/, "");
  run([await ensureRcedit(RCEDIT_CACHE), ...rceditArgs(exe, { InternalName: internalName })]);

  step("Smoke run");
  await smokeRun(exe, web, version);
  const name = versionInfo(exe, "InternalName");
  if (name !== internalName) throw new StepFailed(`InternalName is "${name}" after rcedit, expected "${internalName}".`);
  console.log(`InternalName ${name}.`);
  // Read back, so a Bun or csc change that silently drops the value fails the release here.
  for (const file of [exe, join(APP, id.trayExe)]) {
    const copyright = versionInfo(file, "LegalCopyright");
    if (copyright !== COPYRIGHT) throw new StepFailed(`LegalCopyright of ${file} is "${copyright}", expected "${COPYRIGHT}".`);
    console.log(`LegalCopyright of ${file}: ${copyright}.`);
  }
  // rcedit rewrites every resource, so the icon fix is checked again after it.
  const iconIssue = await exeIconIssue(exe, EXE_ICON);
  if (iconIssue !== null) throw new StepFailed(`The exe's icon after rcedit: ${iconIssue}.`);
  console.log(`Icon: the first icon group is ${basename(EXE_ICON)}'s frames.`);

  step("Task definition");
  writeFileSync(join(APP, "task.xml"), taskTemplate());

  step("Installer");
  run([iscc, ...isccArgs({ version, sourceDir: APP, outDir: RELEASE, iss: ISS, id })]);
  const asset = join(RELEASE, installerName(version.full));
  if (!existsSync(asset)) throw new StepFailed(`ISCC finished but ${asset} is missing.`);

  console.log(`\n${asset}`);
  // Read by the release workflow, which marks the draft a prerelease.
  console.log(`prerelease=${String(version.prerelease)}`);
}

if (import.meta.main) await runSteps("build-release", main);

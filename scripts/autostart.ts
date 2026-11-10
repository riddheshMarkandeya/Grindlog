// Installs the developer's background tracker: compiles the one exe (tracker and supervisor) into
// <dataDir>\bin, builds the dashboard into <dataDir>\bin\web, registers a logon task that runs the
// exe as the supervisor, and adds a Start menu shortcut to the dashboard. Running it again is the
// update path. Every name comes from this build's channel, so it never touches a friend's install.
// `bun run install-autostart` / `bun run uninstall-autostart`.
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, identity } from "../src/server/paths";
import { APP_NAME } from "../src/shared/channel";
import { DASHBOARD_HOST } from "../src/shared/constants";
import { version as appVersion } from "../package.json";
import { killExe } from "../src/server/control";
import { stopTracker } from "./stop";

const ID = identity();
const PUBLISHER = "Grindlog";
const REPO = join(import.meta.dirname, "..");
const ENTRY = join(REPO, "src", "server", "grindlog.ts");
// Absolute, because the builds run with no cwd.
const EXE_ICON = join(REPO, "src", "web", "public", "favicon.ico");
const DASHBOARD_URL = `http://${DASHBOARD_HOST}:${String(ID.port)}/`;

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Task Scheduler definition. Declared UTF-16, so it must be written as UTF-16 with a BOM. */
export function taskXml({ userId, exe, args, workDir }: { userId: string; exe: string; args: string; workDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Grindlog: records Rocket League matches in the background.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(userId)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(exe)}</Command><Arguments>${xmlEscape(args)}</Arguments><WorkingDirectory>${xmlEscape(workDir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

/** A Start menu Internet Shortcut: it opens the URL in the default browser and never runs the tracker. */
export function shortcutFile(url: string, iconFile: string): string {
  return `[InternetShortcut]\r\nURL=${url}\r\nIconFile=${iconFile}\r\nIconIndex=0\r\n`;
}

/** The `bun` arguments that compile an entry. Task Manager's Processes tab shows the description. */
export function compileArgs({ entry, outfile, description, icon, version }: { entry: string; outfile: string; description: string; icon: string; version: string }): string[] {
  return [
    "build",
    "--compile",
    "--windows-hide-console",
    "--windows-icon",
    icon,
    "--windows-title",
    APP_NAME,
    "--windows-publisher",
    PUBLISHER,
    "--windows-description",
    description,
    "--windows-version",
    `${version}.0`,
    entry,
    "--outfile",
    outfile,
  ];
}

class StepFailed extends Error {}

function run(cmd: string[], cwd?: string): string {
  const res = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) throw new StepFailed(`${cmd.slice(0, 2).join(" ")} failed (exit ${String(res.exitCode)}):\n${res.stderr.toString().trim() || res.stdout.toString().trim()}`);
  return res.stdout.toString();
}

/** A running exe can't be opened for writing, so this says whether it's still in use. */
function locked(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    closeSync(openSync(path, "r+"));
    return false;
  } catch {
    return true;
  }
}

async function waitUnlocked(paths: string[], ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (paths.some(locked)) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(250);
  }
  return true;
}

/** Stops the background tracker and its supervisor, so their exe can be replaced or removed. */
async function stopInstalled(bin: string): Promise<void> {
  const exe = join(bin, ID.exe);
  const { message, exitCode, notRunning } = await stopTracker(ID.port, true);
  console.log(message);
  if (exitCode !== 0 && !notRunning) throw new StepFailed("Could not stop the running tracker.");
  if (await waitUnlocked([exe], 10_000)) return;
  // A supervisor sleeping between restarts has no tracker to ask; nothing is recording, so ending
  // it loses nothing. Only processes running this install's exe hold it. The supervisor goes first,
  // so it can't restart the tracker in between.
  console.log("Ending the leftover background processes.");
  for (const arg of ["--supervisor", ""]) {
    const result = killExe(exe, arg);
    if (result.kind === "failed") console.error(`Could not end ${[exe, arg].filter(Boolean).join(" ")} (${result.error}).`);
  }
  if (!(await waitUnlocked([exe], 10_000))) throw new StepFailed(`${bin} is still in use; end ${ID.exe} in Task Manager's Details tab and try again.`);
}

/** Moves `from` over `to`, retrying while antivirus still holds the fresh exe. */
async function replace(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const locked = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!locked || Date.now() > deadline) throw new StepFailed(`Could not replace ${to}: ${(err as Error).message}. Run bun run install-autostart again.`);
      await Bun.sleep(250);
    }
  }
}

export type ExeSwap = { kind: "updated" } | { kind: "kept_old"; reason: string } | { kind: "not_installed"; reason: string };

export interface SwapDeps {
  replace: (from: string, to: string) => Promise<void>;
  exists: (path: string) => boolean;
}

/** Moves the fresh exe over the installed one, and says what is left to run if that fails. */
export async function swapExe(fresh: string, exe: string, deps: SwapDeps = { replace, exists: existsSync }): Promise<ExeSwap> {
  try {
    await deps.replace(fresh, exe);
    return { kind: "updated" };
  } catch (err) {
    // replace only throws StepFailed (a rename that stayed refused); the message says which file.
    const reason = (err as Error).message;
    // The rename is atomic, so a failure leaves the old exe as it was, or no exe on a first install.
    return deps.exists(exe) ? { kind: "kept_old", reason } : { kind: "not_installed", reason };
  }
}

/** Best-effort removal of an install leftover: a held file only costs disk until the next install. */
function removeLeftover(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5 });
  } catch (err) {
    // Only rmSync above; a failure here must not hide the real outcome or skip the restart.
    console.log(`Could not remove ${path} (${(err as Error).message}); the next install removes it.`);
  }
}

/** Swaps the fresh web build in, putting the old one back if that fails. Runs with the tracker stopped. */
async function swapWeb(fresh: string, web: string): Promise<void> {
  const old = `${web}.old`;
  let hadOld: boolean;
  if (existsSync(web)) {
    removeLeftover(old);
    await replace(web, old);
    hadOld = true;
  } else {
    // From an interrupted install whose rollback failed: the leftover is the only working dashboard,
    // so it stays as the backup rather than being deleted.
    hadOld = existsSync(old);
  }
  try {
    await replace(fresh, web);
  } catch (err) {
    if (hadOld) {
      try {
        renameSync(old, web);
      } catch (rollback) {
        throw new StepFailed(`${(err as Error).message} Putting the previous dashboard back also failed (${(rollback as Error).message}); it is in ${old}.`);
      }
    }
    throw err;
  }
  removeLeftover(old);
}

/** The Start menu's Programs folder, or null when APPDATA is unset. */
function startMenuDir(): string | null {
  const appData = process.env.APPDATA;
  return appData ? join(appData, "Microsoft", "Windows", "Start Menu", "Programs") : null;
}

/** Best-effort, like writing one: a shortcut left behind only costs deleting it by hand. */
function removeShortcut(path: string): void {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { force: true });
    console.log(`Removed the Start menu shortcut ${path}`);
  } catch (err) {
    console.log(`Could not remove the Start menu shortcut ${path} (${(err as Error).message}); delete it by hand.`);
  }
}

/** Why the shortcut would show a generic icon, or null. */
export function iconIssue(iconFile: string, exists: boolean): string | null {
  // A failed swap keeps the old build, which may predate the icon.
  if (!exists) return `${iconFile} is missing, so the shortcut shows a generic icon until the next install.`;
  // Windows is expected to read a .url in the system code page, and this one is written as UTF-8.
  if (/[^\x20-\x7e]/.test(iconFile)) return `${iconFile} has non-ASCII characters, so the shortcut may show a generic icon.`;
  return null;
}

/** Best-effort: by now the tracker is installed and running, so a missing shortcut only costs a lookup of the URL. */
export function writeShortcut(iconFile: string): void {
  const dir = startMenuDir();
  if (dir === null) {
    console.log(`Could not create the Start menu shortcut (APPDATA is not set); the dashboard is at ${DASHBOARD_URL}`);
    return;
  }
  const issue = iconIssue(iconFile, existsSync(iconFile));
  if (issue !== null) console.log(issue);
  const path = join(dir, ID.shortcut);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, shortcutFile(DASHBOARD_URL, iconFile));
    console.log(`Added the Start menu shortcut ${path}`);
  } catch (err) {
    // Only filesystem calls above; any failure degrades the same way.
    console.log(`Could not create the Start menu shortcut (${(err as Error).message}); the dashboard is at ${DASHBOARD_URL}`);
  }
}

export function removeShortcuts(): void {
  const dir = startMenuDir();
  if (dir !== null) removeShortcut(join(dir, ID.shortcut));
}

async function install(): Promise<void> {
  const bin = join(dataDir(), "bin");
  mkdirSync(bin, { recursive: true });
  // Build beside the installed exe while it keeps recording, and stop it only once everything built,
  // so a failed build leaves it intact and running.
  const exe = join(bin, ID.exe);
  const fresh = join(bin, ID.exe.replace(/\.exe$/, ".new.exe"));
  const web = join(bin, "web");
  const webFresh = join(bin, "web.new");
  let swapFailed: StepFailed | null = null;
  let exeSwap: ExeSwap;
  try {
    console.log(`Building ${exe}`);
    run([process.execPath, ...compileArgs({ entry: ENTRY, outfile: fresh, description: APP_NAME, icon: EXE_ICON, version: appVersion })]);
    // Its own build, not the repo's dist/, which may be stale.
    console.log(`Building the dashboard into ${web}`);
    try {
      run([process.execPath, "run", "web:build", "--outDir", webFresh, "--emptyOutDir"], REPO);
    } catch (err) {
      if (!(err instanceof StepFailed)) throw err;
      throw new StepFailed(`Building the dashboard failed: ${err.message}`);
    }
    await stopInstalled(bin);
    exeSwap = await swapExe(fresh, exe);
    // A kept old exe keeps its old dashboard too: a new dashboard can call API routes it lacks.
    if (exeSwap.kind === "updated") {
      console.log("Swapping in the new dashboard");
      try {
        await swapWeb(webFresh, web);
      } catch (err) {
        // Only filesystem calls in swapWeb, so any failure degrades the same way: the new exe is in
        // place, the tracker still gets restarted below, and the install reports it once it's running.
        swapFailed = err instanceof StepFailed ? err : new StepFailed(`Could not swap in the new dashboard: ${(err as Error).message}.`);
      }
    }
  } finally {
    // A swapped-in build is gone already; whatever failed leaves no ~92 MB leftovers.
    removeLeftover(fresh);
    removeLeftover(webFresh);
  }

  // Nothing to start: registering a task for a missing exe would only fail at each logon.
  if (exeSwap.kind === "not_installed") throw new StepFailed(`${APP_NAME} is not installed: ${exeSwap.reason}`);
  const xmlPath = join(tmpdir(), "grindlog-task.xml");
  writeFileSync(xmlPath, "﻿" + taskXml({ userId: `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`, exe, args: "--supervisor", workDir: bin }), "utf16le");
  try {
    run(["schtasks", "/Create", "/TN", ID.task, "/XML", xmlPath, "/F"]);
  } finally {
    rmSync(xmlPath, { force: true });
  }
  run(["schtasks", "/Run", "/TN", ID.task]);
  writeShortcut(join(web, "favicon.ico"));
  if (exeSwap.kind === "kept_old") throw new StepFailed(`${APP_NAME} is running again, but not updated: ${exeSwap.reason}`);
  if (swapFailed !== null) throw new StepFailed(`${APP_NAME} is running again, but the dashboard was not updated: ${swapFailed.message}`);
  console.log(`${APP_NAME} is installed in ${bin} and running; it starts at each logon. The dashboard is at ${DASHBOARD_URL}`);
  console.log("Stop it: bun run stop. Remove it: bun run uninstall-autostart. After code changes, run bun run deploy.");
}

async function uninstall(): Promise<void> {
  const bin = join(dataDir(), "bin");
  try {
    run(["schtasks", "/Delete", "/TN", ID.task, "/F"]);
    console.log(`Removed the ${ID.task} task.`);
  } catch (err) {
    // Usually it's already gone. If the delete failed for another reason (printed above), going on is
    // still safe: a task left pointing at a removed exe just fails at logon.
    console.log((err as Error).message);
  }
  await stopInstalled(bin);
  removeShortcuts();
  try {
    rmSync(bin, { recursive: true, force: true });
    console.log(`Removed ${bin}. Your data in ${dataDir()} is kept.`);
  } catch (err) {
    throw new StepFailed(`Could not remove ${bin} (${(err as Error).message}); run bun run stop first.`);
  }
}

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "install" && action !== "uninstall") {
    console.error("usage: bun run scripts/autostart.ts install|uninstall");
    process.exit(1);
  }
  try {
    await (action === "install" ? install() : uninstall());
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}

// Compiles the tray exe (src/tray/Tray.cs) with the csc.exe that ships with .NET Framework 4.8 in
// every Windows 10/11, so the build needs no SDK. The install script and the release build call
// buildTray.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { appName, type Channel } from "../src/shared/channel";
import { parseReleaseVersion } from "../src/shared/release";
import { StepFailed } from "./steps";

const REPO = join(import.meta.dirname, "..");
const SOURCE = join(REPO, "src", "tray", "Tray.cs");
const ICON = join(REPO, "src", "web", "public", "favicon.ico");
const TRAY_ICONS = join(REPO, "src", "tray", "icons");
// Marks the exe DPI-aware, or Windows stretches the 16 px icon frame and the menu at 125/150 %.
const MANIFEST = join(REPO, "src", "tray", "tray.manifest");
const TRAY_STATES = ["ready", "active", "attention", "stopped"] as const;
type TrayIcons = Record<(typeof TRAY_STATES)[number], string>;

/** The channel's state icons from `bun run icons`; Tray.cs loads them as Grindlog.tray.<state>.ico. */
export function trayIconPaths(channel: Channel, dir = TRAY_ICONS): TrayIcons {
  return Object.fromEntries(TRAY_STATES.map((state) => [state, win32.join(dir, `${channel}-${state}.ico`)])) as TrayIcons;
}

/** The framework's csc.exe, 64-bit first, or null when neither is there. */
export function findCsc(windir = process.env.WINDIR, exists: (path: string) => boolean = existsSync): string | null {
  if (!windir) return null;
  for (const framework of ["Framework64", "Framework"]) {
    const csc = win32.join(windir, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
    if (exists(csc)) return csc;
  }
  return null;
}

export function trayCompileArgs({ out, icon, trayIcons, manifest, sources }: { out: string; icon: string; trayIcons: TrayIcons; manifest: string; sources: string[] }): string[] {
  return [
    "/nologo",
    "/target:winexe",
    "/optimize+",
    `/win32icon:${icon}`,
    `/win32manifest:${manifest}`,
    ...TRAY_STATES.map((state) => `/resource:${trayIcons[state]},Grindlog.tray.${state}.ico`),
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    // JavaScriptSerializer, to read /api/tray.
    "/reference:System.Web.Extensions.dll",
    `/out:${out}`,
    ...sources,
  ];
}

const csString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The generated attributes: Task Manager shows the title. The version is numeric x.y.z.0 (any -rc suffix dropped), as for the main exe. */
export function assemblyInfo({ title, version }: { title: string; version: string }): string {
  const v = csString(`${parseReleaseVersion(version).numeric}.0`);
  return `using System.Reflection;
[assembly: AssemblyTitle(${csString(title)})]
[assembly: AssemblyProduct(${csString(title)})]
[assembly: AssemblyVersion(${v})]
[assembly: AssemblyFileVersion(${v})]
`;
}

// A StepFailed, so the release build fails on it as is; the dev install catches it and goes on without a tray.
export class TrayBuildFailed extends StepFailed {}

/** Builds the tray exe to `out`; throws TrayBuildFailed with csc's output when there's no csc or it fails. */
export function buildTray({ out, channel, version }: { out: string; channel: Channel; version: string }): void {
  const csc = findCsc();
  if (csc === null) throw new TrayBuildFailed("csc.exe from .NET Framework 4.8 was not found under %WINDIR%\\Microsoft.NET");
  const dir = mkdtempSync(join(tmpdir(), "grindlog-tray-"));
  try {
    const info = join(dir, "AssemblyInfo.cs");
    writeFileSync(info, assemblyInfo({ title: appName(channel), version }));
    const res = Bun.spawnSync([csc, ...trayCompileArgs({ out, icon: ICON, trayIcons: trayIconPaths(channel), manifest: MANIFEST, sources: [SOURCE, info] })], { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
    // csc prints its errors to stdout.
    if (res.exitCode !== 0) throw new TrayBuildFailed(`csc failed (exit ${String(res.exitCode)}):\n${(res.stdout.toString() + res.stderr.toString()).trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

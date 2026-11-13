// The step runner the release scripts share: each step prints its name, and any failure is a
// StepFailed that names what failed and quotes the tool's output, which the script prints and exits 1 on.

export class StepFailed extends Error {}

type Env = Record<string, string | undefined>;

export function step(name: string): void {
  console.log(`\n== ${name}`);
}

/** Bun throws from spawnSync when the program can't start (not on PATH, not executable). */
function spawn<T>(cmd: string[], spawnSync: () => T): T {
  try {
    return spawnSync();
  } catch (err) {
    throw new StepFailed(`${cmd[0] ?? ""} could not start (${(err as Error).message}); is it installed and on PATH?`);
  }
}

/** Runs a program to completion and returns its stdout; StepFailed with its output on a nonzero exit. */
export function run(cmd: string[], opts: { cwd?: string; env?: Env } = {}): string {
  const res = spawn(cmd, () => Bun.spawnSync(cmd, { ...opts, stdout: "pipe", stderr: "pipe" }));
  if (res.exitCode !== 0) throw new StepFailed(`${cmd.slice(0, 3).join(" ")} failed (exit ${String(res.exitCode)}):\n${res.stderr.toString().trim() || res.stdout.toString().trim()}`);
  return res.stdout.toString();
}

/** Runs with the terminal attached, for a password prompt. */
export function runInteractive(cmd: string[]): void {
  const res = spawn(cmd, () => Bun.spawnSync(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }));
  if (res.exitCode !== 0) throw new StepFailed(`${cmd.slice(0, 2).join(" ")} failed (exit ${String(res.exitCode)}).`);
}

/** One field of an exe's version resource, trimmed: Windows pads the strings. */
export function versionInfo(file: string, field: "InternalName" | "ProductVersion" | "FileVersion" | "LegalCopyright"): string {
  return run(["powershell", "-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo.${field}`]).trim();
}

/** The standard entry point: runs main, prints a StepFailed as "<script> failed: ..." and exits 1. */
export async function runSteps(script: string, main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    console.error(`\n${script} failed: ${err.message}`);
    process.exit(1);
  }
}

// One-off: moves (or with --copy, copies) a data dir to a new name, verifying the copy before the
// source is touched. `bun run move-data <from> <to> [--copy]`; a bare name is a folder under
// %LOCALAPPDATA%. Run it with the tracker stopped.
//
// Console only: it must never load the app's logger (log.ts, or storage/maintenance, which import
// it), whose first write would create <to>\logs and make <to> look taken. paths.ts imports only
// the channel, so it is safe.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { localAppDataDir } from "../src/server/paths";

type Out = (line: string) => void;

/** A bare name means a folder under LOCALAPPDATA; anything with a separator is a path. */
export function resolveDir(arg: string, env: Record<string, string | undefined> = process.env): string {
  if (isAbsolute(arg) || /[\\/]/.test(arg)) return resolve(arg);
  return localAppDataDir(arg, env);
}

export function parseArgs(argv: readonly string[]): { from: string; to: string; copy: boolean } | null {
  const copy = argv.includes("--copy");
  const rest = argv.filter((a) => a !== "--copy");
  const [from, to] = rest;
  if (rest.length !== 2 || from === undefined || to === undefined || rest.some((a) => a.startsWith("--"))) return null;
  return { from, to, copy };
}

export interface Entry {
  src: string;
  dest: string;
  bytes: number;
}

// The tracker used to log into the data dir's root; those files now belong in logs\.
const ROOT_LOG = /\.log(\.\d+)?$/i;

/** What to copy where: everything but bin\ (deploy rebuilds it, and a dev bin must never reach prod). */
export function planCopy(from: string, to: string): Entry[] {
  const entries: Entry[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const src = join(dir, d.name);
      const atRoot = dir === from;
      if (d.isDirectory()) {
        if (!(atRoot && d.name.toLowerCase() === "bin")) walk(src);
      } else if (d.isFile()) {
        const dest = atRoot && ROOT_LOG.test(d.name) ? join(to, "logs", d.name) : join(to, relative(from, src));
        entries.push({ src, dest, bytes: statSync(src).size });
      } else {
        // No data dir has held a link so far; copying one could follow it out of the folder.
        throw new Error(`${src} is not a plain file or folder; move it out and run again.`);
      }
    }
  };
  walk(from);
  const seen = new Set<string>();
  for (const { dest } of entries) {
    const key = dest.toLowerCase();
    if (seen.has(key)) throw new Error(`Two files would be copied to ${dest}; rename one and run again.`);
    seen.add(key);
  }
  return entries;
}

function sha256(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * null when the database passes, else what was wrong. A read-only open of a WAL database leaves empty
 * -shm and -wal files beside it; SQLite opens those as a normal empty journal.
 */
function quickCheck(path: string): string | null {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    const result = (db.query("PRAGMA quick_check").all() as { quick_check: string }[]).map((r) => r.quick_check).join("; ");
    return result === "ok" ? null : result;
  } catch (err) {
    // bun:sqlite throws SQLiteError for a file that isn't a database or can't be opened; either fails the check.
    return (err as Error).message;
  } finally {
    db?.close();
  }
}

/** Every way the copy differs from its source; empty when it is good. */
function verify(entries: Entry[], out: Out): string[] {
  const failures: string[] = [];
  // Hashes first: opening a database can touch its -shm file.
  for (const { src, dest } of entries) {
    if (sha256(src) !== sha256(dest)) failures.push(`${dest}: SHA-256 differs from ${src}`);
  }
  out(`SHA-256: ${String(entries.length - failures.length)} of ${String(entries.length)} files match.`);
  for (const { dest } of entries.filter((e) => e.dest.toLowerCase().endsWith(".db"))) {
    const problem = quickCheck(dest);
    out(`quick_check ${dest}: ${problem ?? "ok"}`);
    if (problem !== null) failures.push(`${dest}: quick_check failed: ${problem}`);
  }
  return failures;
}

const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Whether anything holds a file inside `dir`: Windows refuses to rename a folder then. The folder is
 * renamed and straight back; if the way back keeps failing, this throws naming both paths, so the
 * data dir is never left under another name without a word.
 */
export async function probeInUse(dir: string, deps: { rename?: (a: string, b: string) => void; sleep?: (ms: number) => Promise<unknown>; timeoutMs?: number } = {}): Promise<"free" | "in_use"> {
  const { rename = renameSync, sleep = Bun.sleep, timeoutMs = 10_000 } = deps;
  const probe = `${dir}.probe`;
  try {
    rename(dir, probe);
  } catch (err) {
    if (LOCKED.has((err as NodeJS.ErrnoException).code ?? "")) return "in_use";
    throw err;
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      rename(probe, dir);
      return "free";
    } catch (err) {
      if (Date.now() >= deadline) throw new Error(`${dir} was renamed to ${probe} to check that nothing holds it, and renaming it back failed (${(err as Error).message}). Rename ${probe} back to ${dir} by hand.`, { cause: err });
      await sleep(250);
    }
  }
}

/** Why the move can't start, or null. Checks only; nothing is written. */
function refusal(from: string, to: string, backup: string | null): string | null {
  if (!existsSync(from)) return `${from} does not exist.`;
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (f === t || t.startsWith(f + sep) || f.startsWith(t + sep)) return `${from} and ${to} overlap.`;
  if (existsSync(to)) {
    if (!statSync(to).isDirectory()) return `${to} is a file, not a folder.`;
    if (readdirSync(to).length > 0) return `${to} already has files in it.`;
  }
  if (existsSync(`${from}.probe`)) return `${from}.probe exists, left by an earlier run; rename it back to ${from} or remove it.`;
  if (backup !== null && existsSync(backup)) return `${backup} exists, left by an earlier move; remove it first.`;
  return null;
}

function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface MoveDeps {
  out?: Out;
  copyFile?: (src: string, dest: string) => void;
  rename?: (a: string, b: string) => void;
  remove?: (dir: string) => void;
}

/** Copies `from` to `to`, verifies it, and in move mode renames `from` to the backup. Returns the exit code. */
export async function moveData({ from, to, copy }: { from: string; to: string; copy: boolean }, deps: MoveDeps = {}): Promise<number> {
  const { out = console.log, copyFile = copyFileSync, rename = renameSync, remove = removeDir } = deps;
  const backup = copy ? null : `${to}.pre-move-backup`;
  const refused = refusal(from, to, backup);
  if (refused !== null) {
    out(`Refused: ${refused}`);
    return 1;
  }
  try {
    if ((await probeInUse(from, { rename })) === "in_use") {
      out(`Refused: something holds a file in ${from}. Stop the tracker (bun run stop) and close anything open in that folder.`);
      return 1;
    }
  } catch (err) {
    // probeInUse throws only for a rename it could not undo; the message names both paths.
    out((err as Error).message);
    return 1;
  }

  let entries: Entry[];
  try {
    entries = planCopy(from, to);
  } catch (err) {
    // planCopy's own refusals, or a read that failed; nothing is written yet.
    out(`Refused: ${(err as Error).message}`);
    return 1;
  }
  if (entries.length === 0) {
    // A move would put the source aside with nothing in its place.
    out(`Refused: ${from} holds nothing to move (bin\\ is never copied).`);
    return 1;
  }
  const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  out(`Copying ${String(entries.length)} files (${String(bytes)} bytes) from ${from} to ${to}, without bin\\:`);
  let failures: string[];
  try {
    for (const { src, dest, bytes: size } of entries) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFile(src, dest);
      out(`  ${relative(to, dest)} (${String(size)} bytes)`);
    }
    failures = verify(entries, out);
  } catch (err) {
    // Any filesystem failure mid-copy (disk full, a file vanished) ends the same way as a bad copy.
    failures = [`copy failed: ${(err as Error).message}`];
  }
  if (failures.length > 0) {
    for (const f of failures) out(`FAILED ${f}`);
    try {
      remove(to);
      out(`Removed ${to}. ${from} is untouched.`);
    } catch (err) {
      // Antivirus can still hold a file it just scanned; a partial copy left unannounced would pass for data.
      out(`${to} could not be removed (${(err as Error).message}); delete it by hand before running again. ${from} is untouched.`);
    }
    return 1;
  }
  out(`Verified ${String(entries.length)} files in ${to}.`);
  if (backup === null) {
    out(`Copied; ${from} is untouched.`);
    return 0;
  }
  try {
    rename(from, backup);
  } catch (err) {
    out(`The copy in ${to} is verified, but renaming ${from} to ${backup} failed (${(err as Error).message}). Both are kept; rename or delete ${from} by hand.`);
    return 1;
  }
  out(`Moved. The old folder is now ${backup}; delete it once the dashboard shows your history.`);
  return 0;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error("usage: bun run move-data <from> <to> [--copy]   (a bare name is a folder under %LOCALAPPDATA%)");
    process.exit(1);
  }
  process.exit(await moveData({ from: resolveDir(args.from), to: resolveDir(args.to), copy: args.copy }));
}

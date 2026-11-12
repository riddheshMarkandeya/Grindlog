// rcedit edits an exe's version resource. Bun's compile flags can't set InternalName, so the
// release build sets it with this pinned, hash-checked copy, downloaded once into .cache/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StepFailed } from "./steps";

const RCEDIT_URL = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe";
// The v2.0.0 release asset predates GitHub's published digests, so this is the hash of the download,
// cross-checked against the identical rcedit-x64.exe that npm's rcedit@5.0.0 package bundles.
const RCEDIT_SHA256 = "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a";

export class RceditFailed extends StepFailed {}

export function sha256Matches(bytes: Uint8Array, expectedHex: string): boolean {
  return createHash("sha256").update(bytes).digest("hex") === expectedHex.toLowerCase();
}

/** Arguments that set each version string on the exe, in place. */
export function rceditArgs(exe: string, strings: Record<string, string>): string[] {
  return [exe, ...Object.entries(strings).flatMap(([k, v]) => ["--set-version-string", k, v])];
}

/** The cached rcedit, downloaded and checked first if needed. Throws RceditFailed on a failed download or a hash mismatch. */
export async function ensureRcedit(cacheDir: string): Promise<string> {
  const exe = join(cacheDir, "rcedit-x64.exe");
  // Checked on every use, not just after download, so a tampered or truncated cache fails too.
  if (existsSync(exe)) {
    if (sha256Matches(readFileSync(exe), RCEDIT_SHA256)) return exe;
    throw new RceditFailed(`${exe} does not match the pinned SHA-256; delete it and build again.`);
  }
  console.log(`Downloading ${RCEDIT_URL}`);
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetch(RCEDIT_URL);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    throw new RceditFailed(`Downloading rcedit failed: ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) throw new RceditFailed(`Downloading rcedit failed: HTTP ${String(res.status)}`);
  if (!sha256Matches(bytes, RCEDIT_SHA256)) throw new RceditFailed(`The downloaded rcedit does not match the pinned SHA-256 ${RCEDIT_SHA256}; not using it.`);
  mkdirSync(cacheDir, { recursive: true });
  // Written beside and renamed, so an interrupted write never leaves a half file under the real name.
  writeFileSync(`${exe}.part`, bytes);
  renameSync(`${exe}.part`, exe);
  return exe;
}

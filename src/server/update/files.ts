// The downloaded installer's files and their check, shared by the supervisor's check (after a download)
// and the updater (on the bytes it's about to run).
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { installerName, parseTrustedComment } from "../../shared/release";
import type { Logger } from "../log";
import { verifyMinisign, type VerifyFailure } from "./minisign";

export const downloadDir = (dir: string) => join(dir, "download");

/** A version's installer and signature paths, built from the validated version (never a feed's file name). */
export function installerFiles(dir: string, version: string): { installer: string; signature: string } {
  const installer = join(downloadDir(dir), installerName(version));
  return { installer, signature: `${installer}.minisig` };
}

export function haveInstallerFiles(dir: string, version: string): boolean {
  const f = installerFiles(dir, version);
  return existsSync(f.installer) && existsSync(f.signature);
}

/** Removes every download except `keep`'s two files. Best effort: a leftover is only disk space. */
export function clearDownloads(dir: string, logger: Logger, keep?: string): void {
  const keepNames = keep === undefined ? [] : [installerName(keep), `${installerName(keep)}.minisig`];
  let names: string[];
  try {
    names = readdirSync(downloadDir(dir));
  } catch {
    return;
  }
  for (const name of names.filter((n) => !keepNames.includes(n))) {
    try {
      rmSync(join(downloadDir(dir), name), { force: true });
    } catch (err) {
      logger.warn("update", "cleanup_failed", { name, err });
    }
  }
}

export type InstallerCheck = { ok: true } | { ok: false; reason: VerifyFailure } | { ok: false; reason: "comment_mismatch"; comment: string };

/** Whether `installer` is signed by the release key and its signed comment names `version` and its file. */
export function checkInstaller({ publicKey, version, signature, installer }: { publicKey: string; version: string; signature: string; installer: Uint8Array }): InstallerCheck {
  const verified = verifyMinisign({ publicKey, signature, file: installer });
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const comment = parseTrustedComment(verified.trustedComment);
  if (comment?.version !== version || comment.file !== installerName(version)) return { ok: false, reason: "comment_mismatch", comment: verified.trustedComment };
  return { ok: true };
}

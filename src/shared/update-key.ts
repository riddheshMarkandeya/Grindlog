// The minisign public key (the base64 line of minisign.pub) that update installers must be signed
// with. Only the release build defines it; dev and source runs have none, and never self-update.
import type { Channel } from "./channel";

declare const GRINDLOG_UPDATE_KEY: string | undefined;

// The typeof guard covers unbundled Bun runs (tests, `bun run start`), where nothing defines it.
export const UPDATE_KEY: string | null = typeof GRINDLOG_UPDATE_KEY !== "undefined" && GRINDLOG_UPDATE_KEY !== "" ? GRINDLOG_UPDATE_KEY : null;

/** Why this build never checks for updates, or null when it does. */
export function disabledReason(channel: Channel, version: string | null, key: string | null): string | null {
  if (channel !== "prod") return "dev_build";
  if (version === null) return "no_version";
  if (key === null) return "no_key";
  return null;
}

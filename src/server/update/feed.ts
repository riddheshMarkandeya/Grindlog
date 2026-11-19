// Where updates come from: GitHub's latest release, or GRINDLOG_UPDATE_FEED for testing (an http(s)
// URL serving the same JSON, or a folder holding latest.json). Every source is still signature-checked
// by the caller, so the override can't install anything unsigned.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { installerName, isNewer, isReleaseVersion, parseReleaseVersion, RELEASES_API } from "../../shared/release";

export type FeedSource = { kind: "http"; url: string } | { kind: "folder"; dir: string };

export interface Asset {
  name: string;
  size: number;
  /** An http(s) URL, or an absolute path inside a folder feed. */
  url: string;
}

export interface Release {
  tag: string;
  draft: boolean;
  prerelease: boolean;
  assets: Asset[];
}

export const USER_AGENT = "Grindlog-updater";

/** An http(s) URL, fetched; anything else from a feed is a path in a folder, copied. */
export const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s);

export function feedSource(env: Record<string, string | undefined>): FeedSource {
  const feed = env.GRINDLOG_UPDATE_FEED;
  if (feed === undefined || feed === "") return { kind: "http", url: RELEASES_API };
  return isHttpUrl(feed) ? { kind: "http", url: feed } : { kind: "folder", dir: feed };
}

// Only the fields used; GitHub's other fields (and any it adds) are ignored.
const releaseJson = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), size: z.number().int().nonnegative(), browser_download_url: z.string() })),
});

/** A folder feed's asset url must be a bare file name: no separators, drive, UNC or `..`. */
const BARE_NAME = /^[^\\/:]+$/;

function assetUrl(url: string, source: FeedSource): string | null {
  if (source.kind === "folder") return BARE_NAME.test(url) && url !== "." && url !== ".." ? join(source.dir, url) : null;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return null;
  }
  // GitHub serves https only; a local http test server is allowed only when the feed itself was overridden.
  const allowed = source.url === RELEASES_API ? ["https:"] : ["https:", "http:"];
  return allowed.includes(protocol) ? url : null;
}

export function parseRelease(json: unknown, source: FeedSource): { ok: true; release: Release } | { ok: false; error: string } {
  const parsed = releaseJson.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const assets: Asset[] = [];
  for (const a of parsed.data.assets) {
    const url = assetUrl(a.browser_download_url, source);
    if (url === null) return { ok: false, error: `asset ${a.name} has a refused url: ${a.browser_download_url}` };
    assets.push({ name: a.name, size: a.size, url });
  }
  const { tag_name: tag, draft, prerelease } = parsed.data;
  return { ok: true, release: { tag, draft, prerelease, assets } };
}

export type FetchResult =
  | { kind: "not_modified" }
  | { kind: "release"; release: Release; etag?: string }
  | { kind: "error"; error: string; status?: number; rateLimitReset?: number };

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const FETCH_TIMEOUT_MS = 30_000;

/** The latest release from `source`. Never throws: every failure is an `error` result. */
export async function fetchLatest(source: FeedSource, { etag, fetch = globalThis.fetch }: { etag?: string; fetch?: FetchFn }): Promise<FetchResult> {
  if (source.kind === "folder") {
    try {
      const parsed = parseRelease(JSON.parse(readFileSync(join(source.dir, "latest.json"), "utf8")), source);
      return parsed.ok ? { kind: "release", release: parsed.release } : { kind: "error", error: parsed.error };
    } catch (err) {
      return { kind: "error", error: String(err) };
    }
  }
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (etag !== undefined) headers["If-None-Match"] = etag;
  let res: Response;
  try {
    res = await fetch(source.url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return { kind: "error", error: String(err) };
  }
  if (res.status === 304) return { kind: "not_modified" };
  if (!res.ok) {
    const limited = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return limited && Number.isFinite(reset) ? { kind: "error", status: res.status, rateLimitReset: reset, error: `HTTP ${String(res.status)}` } : { kind: "error", status: res.status, error: `HTTP ${String(res.status)}` };
  }
  try {
    const parsed = parseRelease(await res.json(), source);
    if (!parsed.ok) return { kind: "error", status: res.status, error: parsed.error };
    const tag = res.headers.get("ETag");
    return tag === null ? { kind: "release", release: parsed.release } : { kind: "release", release: parsed.release, etag: tag };
  } catch (err) {
    return { kind: "error", status: res.status, error: String(err) };
  }
}

export type Pick =
  | { kind: "candidate"; version: string; installer: Asset; signature: Asset }
  | { kind: "up_to_date"; version: string }
  | { kind: "skipped_before"; version: string }
  | { kind: "assets_missing"; version: string; have: string[] }
  | { kind: "bad_tag"; tag: string };

/** What to do with the latest release, given the running version and the versions skipped before. */
export function pickCandidate(release: Release, running: string, skipped: readonly string[]): Pick {
  if (!release.tag.startsWith("v") || !isReleaseVersion(release.tag.slice(1))) return { kind: "bad_tag", tag: release.tag };
  const version = parseReleaseVersion(release.tag.slice(1));
  // Friends never get a prerelease, and a running rc compares by its numeric part.
  if (release.draft || release.prerelease || version.prerelease || !isNewer(version.full, running)) return { kind: "up_to_date", version: version.full };
  if (skipped.includes(version.full)) return { kind: "skipped_before", version: version.full };
  const name = installerName(version.full);
  const installer = release.assets.find((a) => a.name === name);
  const signature = release.assets.find((a) => a.name === `${name}.minisig`);
  if (installer === undefined || signature === undefined) return { kind: "assets_missing", version: version.full, have: release.assets.map((a) => a.name) };
  return { kind: "candidate", version: version.full, installer, signature };
}

// Facts about a release that the build, the signing script and the updater must agree on.

export interface ReleaseVersion {
  /** As in package.json and the tag: "1.2.3" or "1.2.3-rc.1". */
  full: string;
  /** The x.y.z part, which is all a Windows file version can hold. */
  numeric: string;
  prerelease: boolean;
}

// No leading zeros, and a suffix of dot-separated letters and digits, as in semver.
const VERSION_RE = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

export const isReleaseVersion = (s: string): boolean => VERSION_RE.test(s);

export function parseReleaseVersion(s: string): ReleaseVersion {
  const m = VERSION_RE.exec(s);
  if (!m?.[1]) throw new Error(`"${s}" is not a release version (x.y.z or x.y.z-suffix)`);
  return { full: s, numeric: m[1], prerelease: m[2] !== undefined };
}

export function installerName(full: string): string {
  return `Grindlog-Setup-${full}.exe`;
}

/**
 * The minisign trusted comment, which the signature covers. The updater reads it back, and must
 * accept it with or without a tab-separated suffix minisign may append.
 */
export function trustedComment(full: string): string {
  return `version=${full} file=${installerName(full)}`;
}

/** -1, 0 or 1 comparing two `x.y.z` strings part by part as numbers. */
export function compareNumeric(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether release version `version` is newer than `than`, by numeric parts (an rc ties its final). */
export const isNewer = (version: string, than: string): boolean => compareNumeric(parseReleaseVersion(version).numeric, parseReleaseVersion(than).numeric) > 0;

// Exactly `trustedComment`'s shape; `\S` excludes the tab, so only the one literal suffix passes.
const COMMENT_RE = /^version=(\S+) file=(\S+)(?:\thashed)?$/;

/** The version and file a signed trusted comment names, or null for anything but that shape. */
export function parseTrustedComment(line: string): { version: string; file: string } | null {
  const m = COMMENT_RE.exec(line);
  return m?.[1] !== undefined && m[2] !== undefined ? { version: m[1], file: m[2] } : null;
}

export const UPDATE_REPO = "riddheshMarkandeya/Grindlog";
export const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
/** The season file every install fetches daily, so a new season needs no release. */
export const SEASONS_FILE_URL = `https://raw.githubusercontent.com/${UPDATE_REPO}/master/seasons.json`;
/** The only https prefix the tray opens; it is passed to the tray so both sides share it. */
export const RELEASE_PAGE_PREFIX = `https://github.com/${UPDATE_REPO}/releases/tag/`;
/** Where a user reinstalls from when an update and its rollback both failed. */
export const RELEASES_LATEST_PAGE = `https://github.com/${UPDATE_REPO}/releases/latest`;

/** Built from a verified version, never taken from the feed, so it can't point outside the repo. */
export function releasePage(version: string): string {
  return `${RELEASE_PAGE_PREFIX}v${version}`;
}

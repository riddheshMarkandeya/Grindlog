// Facts about a release that the build, the signing script and (later) the updater must agree on.

export interface ReleaseVersion {
  /** As in package.json and the tag: "1.2.3" or "1.2.3-rc.1". */
  full: string;
  /** The x.y.z part, which is all a Windows file version can hold. */
  numeric: string;
  prerelease: boolean;
}

// No leading zeros, and a suffix of dot-separated letters and digits, as in semver.
const VERSION_RE = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

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

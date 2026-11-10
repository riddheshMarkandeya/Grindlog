/** A change: the baseline version it replaces. */
export interface VersionChange {
  from: string | null;
}

/**
 * Tells a tab when the tracker it talks to is a different release from the one it loaded with.
 * The first version seen is the baseline; a later different one is a change exactly once, so a
 * reload that fails (or lands on the same old page) can't turn into a reload loop. A dev tracker
 * has no version, and null never differs from null.
 */
export function createVersionWatch(): (version: string | null) => VersionChange | undefined {
  let baseline: { version: string | null } | undefined;
  let fired = false;
  return (version) => {
    if (baseline === undefined) {
      baseline = { version };
      return undefined;
    }
    if (fired || version === baseline.version) return undefined;
    fired = true;
    return { from: baseline.version };
  };
}

// The release this build is, e.g. "0.3.1". Only the release build defines it (`--define`); dev and
// source runs have none, which is how the app tells a release from a dev build (a dev build never
// self-recomputes on a version change).
declare const GRINDLOG_VERSION: string | undefined;

// The typeof guard covers unbundled Bun runs (tests, `bun run start`), where nothing defines it.
export const VERSION: string | null = typeof GRINDLOG_VERSION !== "undefined" && GRINDLOG_VERSION !== "" ? GRINDLOG_VERSION : null;

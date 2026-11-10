// Which install this build is: a friend's ("prod") or the developer's ("dev"). The release build
// replaces the bare global below with `--define`; it is never read from process.env at runtime, so
// an environment variable can't turn a dev run into prod (and point it at a friend's data).
declare const GRINDLOG_CHANNEL: string | undefined;

export type Channel = "dev" | "prod";

// The typeof guard covers unbundled Bun runs (tests, `bun run start`), where nothing defines it.
export const CHANNEL: Channel = typeof GRINDLOG_CHANNEL !== "undefined" && GRINDLOG_CHANNEL === "prod" ? "prod" : "dev";

/** What the user sees: tab title, toasts, Task Manager. */
export const APP_NAME = CHANNEL === "prod" ? "Grindlog" : "Grindlog Dev";

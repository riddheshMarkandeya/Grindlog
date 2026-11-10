// The tracker's exit codes, which the supervisor reads to decide whether to restart it.
// Bun itself exits 1 on an uncaught exception or rejection; a Task Manager kill shows up as 255.
// The supervisor restarts on any code but the ones below that say not to.

/** A clean stop: Ctrl+C, a signal or the shutdown endpoint. Not restarted. */
export const EXIT_OK = 0;
/** Storage or migration failed before recording started. Restarted with backoff: often transient (a locked DB, antivirus). */
export const EXIT_START_FAILED = 2;
/** Another instance holds the dashboard port. Not restarted. */
export const EXIT_PORT_TAKEN = 3;
/** An environment setting (GRINDLOG_PORT, STATS_API_URL) is invalid. Not restarted: no retry fixes it. */
export const EXIT_CONFIG_INVALID = 4;

// The tray exe's exit codes, mirrored by the tray's own ExitCodes class. Only Quit stops the app:
// a closed stdin is the supervisor (this one or a duplicate) telling the tray to go.

/** "Quit" clicked in the tray menu. */
export const TRAY_EXIT_QUIT = 0;
/** An unhandled exception; restarted like any other failure. */
export const TRAY_EXIT_CRASHED = 1;
/** Bad command-line arguments. Not restarted: no retry fixes them. */
export const TRAY_EXIT_BAD_ARGS = 2;
/** Its stdin closed (EOF or a broken pipe). */
export const TRAY_EXIT_STDIN_CLOSED = 3;

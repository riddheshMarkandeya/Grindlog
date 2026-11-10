# The tray exe runs as a second supervised child, and its Quit stops the app

Date: 2026-11-10

## Context
Friends need a visible sign that Grindlog is running and one way to quit it. Bun has no tray API,
so the distribution map (`docs/plans/2026-11-06-distribution-map.md`) settled on a .NET Framework
4.8 WinForms `NotifyIcon` exe, compiled by the `csc.exe` every Windows 10/11 ships with. WP3a
covers the process model around it; the tray's view, icon states and toasts are WP3b. Plan:
`docs/plans/2026-11-10-wp3a-tray-process-model.md`.

## Decision
- **Process tree.** The supervisor (`--supervisor`) runs two children: the tracker, as before, and
  `grindlog-tray.exe` (`grindlog-dev-tray.exe` for dev) from the same `bin` folder. The supervisor
  passes the tray everything on its command line (`--port --name --logs --channel [--version]`),
  so the tray reads no config. The tray only talks HTTP to the tracker.
- **Tray exit codes** (`exit-codes.ts` and `ExitCodes` in `Tray.cs`): 0 = Quit clicked, 1 =
  crashed, 2 = bad arguments, 3 = stdin closed. **Only 0 means quit.** A closed stdin gets its own
  code so that a duplicate supervisor closing its own tray can never stop the running app.
- **Quit protocol.** Tray exits 0, which ends the tray loop (nothing respawns it), and the
  supervisor probes `/api/status`. If the port answers with the supervisor's own
  tracker pid, it POSTs `/api/shutdown`, retrying every 250 ms on any non-2xx outcome for about
  30 s (`QUIT_TIMEOUT_MS`; a round in flight at the deadline finishes). A tracker still in its
  synchronous startup (migrations, a backup) answers nothing, so its probe times out with no pid.
  Such a port is asked only once the child has run 5 s: a tracker binds its port first and exits
  at once if it can't, so by then the port is almost surely its own. The request waits and is
  handled when startup ends, so a quit during a long backup stops cleanly. An accepted stop then gets its own 30 s for the
  exit, so slow asking never eats into the flush. A different pid is a duplicate supervisor's
  tracker: it logs `quit_foreign_tracker` and asks nothing. Every wait races the tracker's exit, so
  a tracker that crashes mid-quit isn't restarted. Past either deadline it logs `quit_timeout` and
  exits; Bun's job object kills the tracker and startup recovery covers it.
  A quit during a restart wait cancels the wait (`restart_cancelled`).
- **The tracker stops on its own** (0, port taken, config invalid): the supervisor closes the
  tray's stdin and waits up to 5 s for it to exit (it hides its icon first), then kills it.
- **Tray restarts.** Bad arguments (2) give up at once, since no retry fixes them; any other exit
  but 0 or 3 restarts after 5 s, then 10 s. A third short
  failure (under 60 s uptime) in a row gives up for this supervisor run (`tray/gave_up`), and the
  tracker carries on. A run of 60 s or more resets the count. A missing exe (ENOENT) counts as a
  failure. The plan also listed a 20 s step, but with give-up on the third failure that step is
  never reached, so there is none.
- **Logging goes through the supervisor.** The tray writes one JSON object per stdout line (UTF-8
  without a BOM). The supervisor writes each as `tray/<event>` in `supervisor.log`, so "send
  tracker.log and supervisor.log" stays the whole diagnostics story and the tray needs no rotation.
  The `started` line carries the Windows build (registry `CurrentBuild.UBR`, since
  `Environment.OSVersion` reports 6.2 without a manifest) and the .NET release number.
- **No crash dialogs.** `SetUnhandledExceptionMode(ThrowException)` comes first in `Main`, and an
  `UnhandledException` handler logs `crashed` and exits 1. Otherwise WinForms shows a modal dialog
  and the process hangs where the supervisor can't restart it.
- **`--quit` covers the tray.** The process lookup takes several exe paths in one PowerShell call.
  `quitApp` waits for the tray too, so the installer can replace it. It kills a tray that has no
  supervisor listed (an orphan records nothing). Once a stop has been accepted, it gives the
  supervisor 8 s from the first refused probe before killing it, which covers the tracker's exit,
  the 5 s tray wait and the 1 s output drain.
  Without that grace, every installer quit would leave a ghost icon.
- **Install.** `install-autostart` builds the tray beside the main exe and swaps it in the same
  way, but only when the main exe was replaced too: the tray's command line is the supervisor's
  to define. With no csc, or a failed tray build, it warns and installs without the tray, because
  recording matters more than the icon.

## Why
- A child of the supervisor, not of the tracker: a tracker crash or restart must not take the
  icon with it, and the supervisor already owns restarts and the job object.
- A closed stdin as the stop signal: it needs no port, no window message and no second protocol,
  and it also fires when the supervisor dies in a way that leaves the pipe broken.
- HTTP only between tray and tracker, and arguments only from the supervisor: the tray stays a
  thin view that 3b can redraw from `/api/tray` without the C# knowing any config or schema.

## Assumptions
- A browser or Explorer window the tray opens leaves Bun's job (libuv sets silent breakaway), so
  quitting doesn't close it. Checked by hand on 2026-11-10: a dashboard tab and the logs folder
  window both stayed open after Quit.
- Started by hand without redirected stdin, the tray exits at once with code 3. Its stdin reads
  EOF, so a manual debug run that vanishes is expected, not a bug.

## Corrects
`2026-10-19-supervisor-autostart.md` said Task Scheduler's **End** kills only the supervisor and
leaves the tracker running. In fact it takes down the whole tree (supervisor, tracker and now the
tray) through Bun's kill-on-close job object. The stop is abrupt, and startup recovery covers it.
Checked on 2026-11-10 with `schtasks /End`: nothing was left running.

## Limits
- A force-killed supervisor (Task Scheduler End, Task Manager) can't hide the tray icon. A ghost
  icon could stay until the mouse passes over it, but none was seen after `schtasks /End` on
  Windows 11 build 26200, where the icon went with the process.
- A duplicate supervisor from the `--open` race can flash a second icon for about a second before
  its tracker exits on the taken port and it closes its tray.
- The 5 s rule assumes a tracker binds its port within 5 s of starting. If a duplicate
  supervisor's tracker holds the port while it is starting, and this supervisor's tracker took more
  than 5 s even to bind (a cold boot, antivirus), a Quit in that window stops the duplicate's
  tracker instead. It stops cleanly, through the shutdown route. A definitive check would ask
  Windows which pid owns the port; that wasn't worth a PowerShell call on this rare path.

## Files touched
`src/tray/Tray.cs`, `scripts/build-tray.ts`, `src/server/{supervisor,launcher,control,exit-codes,paths}.ts`,
`src/shared/channel.ts` (`appName`), `scripts/autostart.ts`, and their tests, including the live
`src/tray/tray.test.ts`.

## Verification
Unit and scenario tests for `decideTray`, `trayCmd`, `trayCompileArgs` and the supervisor with
fake children (quit, cancelled restart, stdin close and kill, exit 3 that isn't a quit, foreign
pid, crash mid-quit, retries and deadline, no respawn while stopping, give-up, stdout line
handling). Also `quitApp`'s tray cases and the live multi-path lookup. A live test
(`src/tray/tray.test.ts`) builds the real exe and checks `started`, then `stdin_closed` and exit 3.
On this PC after install: tray killed and back in 5 s, tracker killed and restarted with the tray
staying, `--quit` exit 0 in 1.2 s with the tray out 15 ms after its stdin closed, `--open` brought
all three back, and `schtasks /End` ended everything with no ghost icon left. The tray's private
working set is 4.8 MB. Checked by the user: Open dashboard, Open logs folder and left-click work.
Quit removes the icon and stops everything in about 70 ms, with the expected `supervisor.log`
sequence. The icon comes back after an Explorer restart without the tray process restarting.

## Related
- `docs/plans/2026-11-10-wp3a-tray-process-model.md` (plan, manual checks, review log)
- `docs/plans/2026-11-06-distribution-map.md` (the tray and process model this fills in)
- `docs/decisions/2026-10-19-supervisor-autostart.md` (the supervisor this extends)

# WP3a: tray exe and process model (friends release step 4, package 3, first half)

## Context
Package 3 of the frozen distribution map (`docs/plans/2026-11-06-distribution-map.md`, "Process model",
"Tray behaviour and first run", "Build work packages" item 3; BACKLOG step 4 item 3). Friends need a visible,
reliable signal that Grindlog is running, plus one way to quit it. Bun has no native tray, so the map settled on a
.NET Framework 4.8 WinForms `NotifyIcon` exe that the supervisor starts and restarts. Measured idle: 5.9 MB private
working set.

User decisions (2026-11-10):
- **Split** like WP2a/2b. **3a** (this plan) covers the process model: the tray exe skeleton, the supervisor running
  both children, the quit protocol with the stdin-close test, build and install, `--quit` covering the tray, and the
  decision file. **3b** (its own session) covers the tray view, icon states, menu lines, toasts and the
  recompute-failure fold-in.
- **The tracker works out the tray's view**: a tray-only endpoint returns icon state, text, lines, URLs and pending
  toasts. The C# only draws it (3b).
- **Toasts go through the tray** when it has polled in the last ~10 s, **otherwise PowerShell** as today (3b).
- **The dev tray gets a tinted icon set** (3b, from `scripts/make-icons.ts`).

Settled by the map and not reopened: the tray only talks HTTP; "Quit Grindlog" exits 0; the supervisor then stops
the tracker through `/api/shutdown` or cancels a waiting restart. When the tracker stops another way, the supervisor
closes the tray's stdin and exits. A tray crash never stops recording, and the tray gives up after a few failed
tries. The exe names follow `grindlog-dev*.exe` for dev.

## Approach (3a)

### 1. Identity: tray exe name
`src/server/paths.ts` `identity()`: add `trayExe` (`grindlog-tray.exe` / `grindlog-dev-tray.exe`), with a test in
`paths.test.ts`.

### 2. Tray exe: `src/tray/Tray.cs` (C# 5: the OS `csc.exe` has no `$""`, `?.`, `nameof` or `=>` members)
- Args: `--port N --name "Grindlog Dev" --logs <dir> --version V --channel C`. The supervisor passes all of them, so
  the tray reads no config.
- An `ApplicationContext` with a `NotifyIcon` (3a uses the embedded `favicon.ico`; 3b brings the icon set) and the
  tooltip set to the name. Left-click opens `http://127.0.0.1:<port>/`. Menu: Open dashboard, Open logs folder, a
  separator, then "Quit <name>". The status line and other lines come in 3b.
- **Exit codes** (named constants on both sides): 0 = Quit clicked (the map), 3 = stdin closed, 1 = crashed, 2 =
  anything else. Only 0 means quit.
- **Stdin watcher**: a background thread reads `Console.OpenStandardInput()` until it returns 0 (EOF or a broken
  pipe), then marshals to the UI thread: icon hidden and disposed, exit 3. Started by hand without redirected stdin,
  the tray exits at once. The decision file says so, so a manual debug run doesn't look like a bug.
- **Quit**: icon hidden and disposed, exit 0.
- **No crash dialogs**: `Application.SetUnhandledExceptionMode(ThrowException)` runs first in `Main`, before any
  control exists. An `AppDomain.UnhandledException` handler writes a `crashed` line and calls
  `Environment.Exit(1)`. Without this, WinForms shows a modal dialog and the process hangs instead of exiting.
- **Logging to stdout** through `new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) {
  AutoFlush = true }`. A redirected `Console.Out` would use the OEM code page and garble a non-ASCII username in
  paths. The log helper swallows `IOException`, so a broken pipe can't re-crash the crash handler. Output is one JSON
  object per line (`{"event":"started",...}`), escaped by a small helper. Lines:
  `started` (pid, version, channel, Windows build from `HKLM\...\Windows NT\CurrentVersion` `CurrentBuild`+`UBR`,
  since `Environment.OSVersion` reports 6.2 without a manifest, and the .NET release from `NDP\v4\Full` `Release`),
  `quit_clicked`, `stdin_closed`, `open_failed` (`Process.Start` of a URL or folder), `crashed`. The supervisor writes
  them into `supervisor.log`, which keeps "send tracker.log and supervisor.log" true (Diagnostics for friends). The
  tray needs no rotation code.
- Explorer restarts: WinForms `NotifyIcon` already re-adds itself on `TaskbarCreated`, so this is verified manually
  only.
- Assembly attributes (`AssemblyTitle` = "Grindlog" or "Grindlog Dev" for Task Manager, plus `AssemblyVersion`) go
  in a small generated `.cs` the build writes to a temp folder.

### 3. Build: `scripts/build-tray.ts`
- `findCsc()`: `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, then `Framework\`. Returns null if missing.
- `trayCompileArgs({ out, icon, title, version, sources })`: `/nologo /target:winexe /optimize+ /win32icon:
  /resource:<ico>,Grindlog.tray.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /out:`. Pure,
  so it gets a unit test like `compileArgs`.
- `buildTray({ out, channel, version })`: writes the attributes file (`AssemblyVersion` numeric `x.y.z.0`, built the
  way `compileArgs` builds `--windows-version`) and runs csc. On failure it throws with csc's output. Package
  5's tag workflow calls the same function.

### 4. Install: `scripts/autostart.ts`
- The tray builds to `<trayExe>.new.exe` next to the exe build and moves into place through the existing `swapExe`.
  `stopInstalled`'s `waitUnlocked` covers both exes; the tray dies with the supervisor through Bun's job object, so
  no extra kill is needed.
- **No csc, or a failed tray build**: log a warning and install without the tray. The supervisor's give-up handles
  the missing exe. Recording matters more than the tray.
- `uninstall` already deletes the whole `bin` folder, so it needs no change.

### 5. Supervisor with two children: `src/server/supervisor.ts`
- `decide` stays as it is for the tracker. Add a pure `decideTray(code, uptimeMs, shortFailures)`:
  - 0 means `quit`; 3 (stdin closed) means `done`, never a quit.
  - Otherwise `restart` at 5 s, 10 s, 20 s.
  - A run of 3 consecutive failures, each under 60 s uptime, means `give_up` for this supervisor run.
  - A run that lasted 60 s or more resets the count.
- `runSupervisor` gains an optional `tray: { cmd, cwd }` and `requestStop` (default `control.requestStop` on
  `dashboardPort()`). The spawn fake type widens to cover the tray's `stdin: "pipe"`, `stdout`/`stderr: "pipe"`.
  Structure:
  - **A shared `stopping` flag**, set at the first quit or tracker stop decision. Once it is set, the tray loop
    spawns nothing new and ignores exit codes.
  - **Tracker loop as now**, except each wait (on `child.exited` or the restart `sleep`) races a `quit` promise.
  - **Tray loop**: spawn, then pump stdout lines into the logger with a line splitter that handles lines split
    across chunks: `tray/<event>` with the JSON fields, `tray/output` for non-JSON, `tray/stderr`. Await exit *and*
    stdout's end, so `quit_clicked` is logged before it, then log `tray/exited {code, uptimeMs}` and apply
    `decideTray`. On `quit` it resolves the quit promise, unless `stopping` is set. On `give_up` it logs
    `tray/gave_up` and stops spawning; the tracker carries on.
  - **Quit while the tracker child is alive**: log `quit_requested`.
    - Ask only the supervisor's own tracker: `statusProbe` must return that child's pid. A probe that answers with
      another pid means a duplicate supervisor; log `quit_foreign_tracker` and request no stop.
    - Then retry `requestStop` every 250 ms on any non-2xx outcome (refused, reset, error, 4xx/5xx), under one 30 s
      deadline (the launcher's `QUIT_TIMEOUT_MS`) that also covers waiting for the exit. Everything races
      `child.exited`, so a tracker that crashes mid-quit ends the wait with no respawn.
    - At the deadline, log `quit_timeout` and exit. The job kills the tracker, and startup recovery covers it.
  - **Quit during a restart wait**: cancel the sleep, log `restart_cancelled`, return 0.
  - **Tracker stop decision** (0 / port taken / config invalid): `stdin.end()` on the tray, await its exit for up to
    5 s, otherwise `kill()` (log `tray/killed`). Then return the code as today.
- A pure, tested `trayCmd({ trayExe, name, channel, logs, port, version })` builds the command line, with no
  `--version` arg when `VERSION` is null (dev). `superviseSelf` reads `dashboardPort()` inside a try. On a bad
  `GRINDLOG_PORT` it logs `tray/skipped {err}` and supervises the tracker alone; that tracker then exits
  `EXIT_CONFIG_INVALID` as today.
- Assumption to note in the decision file: a browser or Explorer window the tray opens leaves Bun's job (libuv sets
  silent breakaway), so quitting doesn't close it. Checked manually.
- Logs answer: did the tray start, on what Windows and .NET? Why did it exit, and is it being restarted or given up
  on? Did a quit come from the tray, and did the tracker stop cleanly and how long did that take?

### 6. `--quit` also waits for the tray: `src/server/control.ts`, `src/server/launcher.ts`
- `exeProcesses` takes several exe paths in one PowerShell call. `GRINDLOG_MATCH_EXE` becomes a `|`-joined list,
  and both the WQL `Name=` filter (`control.ts:78-79`) and the `ExecutablePath` match change to sets. `killExe`
  keeps its single-path behaviour. Every caller is grepped and updated.
- `quitApp` waits for the tray exe too, so the installer can replace it. A tray with no supervisor listed is an
  orphan and gets killed (it records nothing). Otherwise it is left to the supervisor.
- **Supervisor grace period**: once a stop has been accepted (`asked` is non-empty), a "refused" port no longer
  kills `--supervisor` straight away. It waits 6 s from the first refused probe, which covers the supervisor's 5 s
  tray wait. Without this, every installer `--quit` would cut the tray off abruptly and leave a ghost icon. A
  supervisor sleeping between restarts (nothing asked) is still killed at once.

### 7. Decision file: `docs/decisions/2026-11-10-tray-process-model.md`
Covers the process model, the quit protocol and the tray's exit codes (0 quit, 3 stdin closed, 1 crashed, 2 other),
the own-pid check, the browser-breakaway assumption, logging through the supervisor, and the tray's
give-up policy. It also **corrects the Limit** in `docs/decisions/2026-10-19-supervisor-autostart.md`: Task
Scheduler's End takes down the whole tree through Bun's kill-on-close job object, abruptly, and startup recovery
covers it. The old file's Limit line gets a superseded note. Limits it records: a force-killed supervisor leaves a
ghost icon until hovered, and a duplicate supervisor from the `--open` race can flash a second icon for about a
second.

### 8. Records
`documentation-backlog-hygiene`: the BACKLOG item becomes "3a done, 3b open" with 3b's decided points; the review
file goes in `docs/reviews/`. Step 1 of implementation copies this plan to `docs/plans/2026-11-10-wp3a-tray-process-model.md`.

## Tests (`tdd-live-code-carveout`)
- **Pure, TDD**:
  - `decideTray` in `supervisor.test.ts`.
  - Supervisor scenarios with fake spawn/sleep/requestStop/probe:
    - tray exits 0, so stop is requested and the run returns 0;
    - quit during a restart sleep, so nothing respawns;
    - tracker exits 0, so tray stdin is ended, or the tray is killed after 5 s;
    - **tray exits 3 after the stdin close: no quit and no stop request** (the duplicate-supervisor case);
    - **quit while the probe answers a foreign pid: no stop request**;
    - **tracker crashes mid-quit: return 0, no respawn**;
    - non-2xx and error stop outcomes are retried until the deadline;
    - **a tray crash just before the stop decision: no respawn once stopping**;
    - tray crashes restart, and 3 short ones give up while the tracker keeps running;
    - a tray spawn that throws ENOENT counts as a failure;
    - stdout JSON or non-JSON lines and lines split across chunks are logged, and stdout drains before `exited`.
  - Also:
    - `trayCompileArgs` and the attribute version;
    - `trayCmd` with and without a version;
    - `identity().trayExe`;
    - the `quitApp` tray cases: it waits for the tray, kills an orphan, and gives the supervisor 6 s after an
      accepted stop but kills a sleeping one at once.
- **Live (the map's stdin-close test)**: `src/tray/tray.test.ts` builds the tray to a temp dir. It is skipped with a
  logged reason when `findCsc()` is null. It spawns the tray with piped stdin, waits for the `started` line, closes
  stdin, and expects `stdin_closed` and exit 3 within 5 s. A second case kills the process and expects a nonzero
  code.
- **Manual (live-only, on this PC)**, after `bun run install-autostart`:
  1. The "Grindlog Dev" tray appears.
  2. Open dashboard and Open logs folder work.
  3. Quit: icon gone, every process gone, and `supervisor.log` shows `tray/quit_clicked`, `tray/exited 0`,
     `quit_requested`, the stop, `child_exited 0`, `stopped`.
  4. `grindlog-dev.exe --open` brings the whole set back.
  5. End the tray in Task Manager: it is back in about 5 s.
  6. End the tracker: it restarts and the tray stays.
  7. Task Scheduler End: everything goes. Record whether a ghost icon is left.
  8. `grindlog-dev.exe --quit`: tray included, exit 0, and no ghost icon left.
  9. Quitting leaves an open dashboard tab and Explorer window open.
  10. Restart Explorer: the icon comes back.
  11. Read the tray's working set.
- Full `bun run check` green. The `/compact` line is offered at the implementation→review boundary, then
  `independent-review-pass`.

## 3b outline (planned in its own session, decisions above already fixed)
- `GET /api/tray` (requires an `X-Grindlog-Tray` header, so a cross-site page can't drain toasts) returns:
  - icon `ready|active|attention`, status text, extra lines `{text, url?}`, setup URL, pending notices;
  - built by a pure `trayView(...)`.
  - The tray turns red itself when the tracker stops answering after it has answered, or after 15 s at startup.
  - The tray polls every 2 s.
- A notifier module: queued for the tray if it polled in the last 10 s, otherwise `showToast` (PowerShell).
  `game-watch` uses it. "First match recorded" fires when the first match is saved. "Update failed" waits for
  package 6. A balloon click opens the dashboard. If balloons don't show on Windows 11, it stays PowerShell-only and
  the reason is recorded.
- Recompute-failure line from `release-recompute`'s last result (BACKLOG fold-in).
- `make-icons.ts` renders the tray set: base, green, amber and red dots, in prod and dev tint, at 16–48 px.
- `ui-implementation-guidelines` applies.

## Plan review
plan-reviewer (opus), 2026-11-10. All findings folded in:
1. **High.** A stdin-close exit 0 was indistinguishable from Quit, so a duplicate supervisor could stop the
   running app. Fixed with exit 3 for stdin closed (the map fixes only Quit's 0), the `stopping` flag, and the
   own-pid probe before `requestStop`. Tests added (§2, §5).
2. **Med.** `quitApp` would kill the supervisor during its 5 s tray wait, leaving a ghost icon on every installer
   quit. Fixed with a 6 s grace period after an accepted stop (§6).
3. **Med.** The quit retry loop had no end. Fixed with retries on any non-2xx under one 30 s deadline, raced
   against `child.exited` (§5).
4. **Med.** The tray could respawn while stopping. Fixed by the `stopping` flag (§5).
5. **Med.** `dashboardPort()` throws in `superviseSelf`, and dev `VERSION` is null. Fixed with the try,
   `tray/skipped`, and a pure `trayCmd` (§5).
6. **Low-med.** OEM code page on redirected stdout, and the crash handler could re-crash on a broken pipe. Fixed
   with a UTF-8 writer without a BOM and a helper that swallows `IOException` (§2).
7. **Low.** The WQL `Name=` filter, stdout drained before `exited`, and chunked lines. All folded into §5, §6 and
   the tests.
8. **Low.** `uninstall` needs no change; `ThreadException` is dropped; the hand-run tray exits at once
   (documented); `buildTray` takes a version. All folded in.

## Implementation status (2026-11-10)
Steps 1 to 7 are implemented. `bun run check` is green: 102 files, 1348 tests. Deviations:
- The tray is spawned through its own injected `spawnTray` rather than a widened `spawn` type.
- Tray restarts run 5 s then 10 s. The third short failure gives up, so the 20 s step never comes.
- `QUIT_TIMEOUT_MS` moved to `control.ts` and is shared by the launcher and the supervisor.
- `appName(channel)` was added to `channel.ts`, so `buildTray` can name a channel other than its own.
- `stopInstalled`'s leftover path also kills an orphan tray (one `killExe` line).
- After review round 1 (these supersede the body above): no shared `stopping` flag; it is private
  to `superviseTray` and set by its `stop()`, since on a Quit the tray loop has already ended.
  Exit 2 is bad arguments and gives up at once. A probe with no pid (a tracker busy starting) is asked once the child has run 5 s (rounds
  2-4); an accepted stop
  gets its own 30 s. The `quitApp` grace is 8 s, not 6 s.

Manual checks done by script on this PC: 4 (`--open`), 5 (tray killed, back in 5 s), 6 (tracker
killed and restarted, tray stays), 7 (`schtasks /End` ends everything, but the ghost icon wasn't
looked at), 8 (`--quit` exit 0, tray closed by stdin, no kills) and 11 (4.8 MB private working
set). Checked by the user the same day:
- 1, 2: the icon shows, and Open dashboard, Open logs folder and left-click work.
- 3: Quit removes the icon and stops everything. The log shows `tray/quit_clicked` →
  `tray/exited 0` → `quit_requested` → `stop_accepted` (8 ms) → `child_exited 0` (37 ms) →
  `stopped`.
- 7: no ghost icon after `schtasks /End`.
- 9: the dashboard tab and the logs folder window stay open after Quit.
- 10: the icon comes back after an Explorer restart, from the same tray pid.
A first try at 10 was invalid, because the app had been quit before Explorer restarted.

The Start menu entry is still the dashboard `.url` and can't start the app. That is expected:
the map moves it to a `.lnk` running `--open` in package 5.

## Review log

Tier: Substantial (design tier Substantial; ~800 non-test lines). Round 1 snapshot `49cffe9`.

### Round 1: code-review high, arch-reviewer (opus), security-reviewer, /simplify
- security: no findings.
- cr: `quitTracker` never asked a tracker still "starting" (or too busy to answer the probe), so a
  quit during a long migration backup ended in a job kill at 30 s. [Fixed] "starting" is asked too,
  as `quitApp` does; the shutdown route answers before the API.
- cr: the 30 s deadline covered asking and the exit together, so slow asking cut the flush.
  [Fixed] an accepted stop gets its own 30 s for the exit (test: stop accepted at 500 ms, then 30 s).
- cr + arch: the tray swap ran even when the main exe kept its old version. [Fixed] swapped only
  beside an updated exe, as the dashboard is.
- cr: bad arguments (2) were retried like a crash. [Fixed] `decideTray` gives up at once.
- cr + arch: `TrayContext.ExitCode` defaulted to BadArgs. [Fixed] defaults to Crashed. Exit 2 is
  "bad args" rather than the plan's "anything else" (recorded deviation).
- cr: the stdin watcher's `BeginInvoke` could throw after Quit had ended the loop, and a queued
  stdin close could overwrite Quit's 0. [Fixed] caught `InvalidOperationException`; `Exit` runs once.
- cr: `SUPERVISOR_GRACE_MS` 6 s left no margin over 5 s tray wait + 1 s drain + the tracker's exit.
  [Fixed] 8 s.
- cr: `stop.ts endSupervisor` and a quit of a supervisor sleeping between restarts force-kill it,
  which could leave a ghost icon. [Verified, no fix needed] the documented Limit; on Windows 11
  26200 no ghost icon was seen after `schtasks /End`.
- cr: `stopAccepted` duplicated in launcher and supervisor. [Fixed] one `stopAccepted` in control.ts.
- cr + arch: build-tray header named a release workflow that doesn't exist. [Fixed] "and so will".
- arch: `runSupervisor` grew to ~170 lines holding tracker policy, tray lifecycle and the quit
  protocol. [Fixed] `superviseTray` (returns `{done, stop}`, owns its stopping flag) and
  `quitTracker` are top-level; this also removes the `trayDone` use-before-declaration and flattens
  the probe branching.
- arch: `kill`'s `arg` took the pseudo-value "tray". [Fixed] renamed `target`, doc says so.
- arch: exit-code mirror note one-way. [Fixed] both sides name the other's constant group.
- arch: autostart header unwrapped. [Fixed]
- arch: decision file lacked Why / Files touched / Related. [Fixed]
- arch: BACKLOG / PROJECT_INDEX not updated. [Fixed in documentation-backlog-hygiene, below.]
- simplify (4 angles): no edits. Skipped: lingering `Bun.sleep` timers (the supervisor
  `process.exit`s at the end); `withinMs` for the tray stop wait (would make the test wait real
  time); quitApp's per-tick PowerShell lookup (pre-existing design); a shared `windowsVersion` and
  `trayExePath` helper (two uses each); altitude's reroute of Quit through `--quit`, tray-owned
  logs, and dropping the grace (all settled by the map and plan: Quit exits 0 and the supervisor
  stops the tracker; logs go through the supervisor; a force-killed supervisor takes the tray down
  through the job before its stdin closes, so the grace is needed); smaller style items.

Checks after fixes: `bun run check` green (102 files, 1352 tests), live `src/tray/tray.test.ts` passes.

### Round 2 (delta `git diff 49cffe9`): code-review high, arch-reviewer (sonnet), security-reviewer
- security: no findings.
- cr: asking a "starting" port (round 1's fix) dropped the foreign-tracker guard for that case.
  The same topic as round 1's first finding, now with a clean fix: [Fixed] "starting" is asked only
  once the child has run 5 s (`OWNS_PORT_AFTER_MS`). A tracker binds first and exits at once on a
  taken port, so by then the port is its own. Tests cover both sides and both fail with the guard
  disabled.
- cr: one asking round can take ~12 s (2 s probe + 10 s request), so asking can overrun 30 s.
  [Verified, no fix needed] bounded to one round; that time goes to stopping cleanly. The comment
  and decision file say "about 30 s, a round in flight finishes".
- cr: `quit_retrying` and `stop_accepted` didn't say what the probe saw. [Fixed] they log
  `{probe, stop}` and `{probe, waitedMs}`, deduped on both.
- cr: an older tray exe that defaults to exit 2 would now be given up on. [Verified, no fix needed]
  no such exe was ever released; dev installs rebuild the tray with the exe.
- cr: `stop()` raced the loop's end (which includes the 1 s drain), so a tray exiting at 4–5 s
  could be logged as killed. [Fixed] it races the tray's exit, then awaits the loop's end.
- cr: Deps built twice in `runSupervisor`. [Fixed] one `deps`.
- arch: the decision file still said Quit sets `stopping`. [Fixed]
- arch: the plan body still describes a shared `stopping`, the 6 s grace, and exit 2 as
  "anything else". [Fixed] a superseding deviation line in Implementation status.
- arch: autostart header last line unwrapped. [Fixed]

Checks: `bun run check` green (102 files, 1353 tests).

### Round 3 (round-2 fixes in `supervisor.ts`): code-review medium, security-reviewer
- security: no findings.
- cr: the 5 s rule counts from spawn, not bind: a tracker slowed past 5 s before it binds (cold
  boot, antivirus) while a duplicate's tracker answers 503 would let Quit stop the duplicate. The
  third finding on how Quit treats a port with no pid (rounds 1, 2, 3). Escalated to the user
  under the stop rule; the user chose the root fix. [Fixed] the host's pre-API 503 carries its pid;
  `portOwner` (control.ts) reports `{pid, ready}` and `statusProbe` is built on it unchanged for
  the launcher; the supervisor asks its own pid whether ready or starting and refuses a foreign
  one either way. The 5 s rule stays only for a probe with no pid (a timeout). Tests: host 503
  body, `portOwner` against a real host, own-starting asked at once, foreign-starting not asked.
- cr: no test told `childStarted` from the quit's start. [Fixed] a test where the child aged 5 s
  before Quit is asked at once (fails with the check measured from the quit's start).
- cr: no test pinned `stop()` racing the tray's exit rather than the loop's end. [Fixed] a fake
  tray with held-open pipes; the test fails against the old race.
- cr: `stop()` during the drain of an already-exited tray sends `stdin.end()` to a dead pipe.
  [Verified, no fix needed] already caught and logged as `stdin_close_failed`; clearing `current`
  earlier would let `stopped` log before the tray's `exited`.
- cr: the kill path's 2 s bound has no test. [Verified, no fix needed] a fake whose kill fails
  would cost a 2 s real-time test for a one-line `withinMs`; the bound is visible in review.
- cr: `lastOutcome` JSON round-trip and dead null branch. [Fixed] object plus key.
- cr: the tray loop got `QuitDeps` it never uses. [Fixed] it gets `{logger, now, sleep}`.

Checks: `bun run check` green (102 files, 1355 tests; 1359 after the 503 pid fix).

### Round 4 (delta `git diff 51b9330`, full table since host.ts was new): code-review high, arch-reviewer (sonnet), security-reviewer
- security: no findings.
- cr: the pid-in-503 path never runs. `main()` goes from `startHost` to `mount` with no await, and
  migrations and backups are synchronous, so a starting tracker answers nothing and its probe
  times out. The fourth round on this topic, back to the user. The user chose the simplest fix:
  [Fixed] reverted `portOwner` and the 503 pid (host.ts and control.ts are back to `51b9330`). The 5 s
  rule for a probe with no pid stays. The leftover case (a duplicate's tracker holding the port
  while ours took >5 s even to bind) is a Limit in the decision file. The supervisor comment no
  longer claims the shutdown route answers during startup.
- cr: `portOwner` trusting a pid on any status, and reading every body. Moot after the revert.
- cr: the round-3 narrowing undid round 2's single `deps`. [Verified, no fix needed] deliberate:
  the tray loop now gets only `{logger, now, sleep}` (round 3's finding); both literals come from
  the same three locals.
- cr + arch: `lastKey` duplicates `JSON.stringify(lastOutcome)`. [Verified, no fix needed] it
  keeps one serialization per round; `{}` at the timeout can't happen, since a round always runs.
- arch: the index named a review file not yet written. [Fixed] written with this round.
- arch: "now carries" narrative wording, and a missing `statusProbe` doc comment. Moot after the revert.

Checks: `bun run check` green (102 files, 1355 tests). The revert only restores reviewed code, and the
supervisor delta is a comment plus test renames, so the review closes here.

# WP2a: process control (distribution package 2, first part)

## Context
Friends release step 4 is built as seven packages (BACKLOG; frozen design in
`docs/plans/2026-11-06-distribution-map.md`). Package 2, "Release-aware app", is too big for one session, so it is
split three ways (user, 2026-11-10):
- **2a, process control (this plan)**: the detached-spawn spike, baked `GRINDLOG_VERSION`, version and process ID in
  `/api/status`, the tracker's and supervisor's `started` fields, log rotation, `--open`, `--quit`.
- **2b, release data**: Recompute in a release, `Cache-Control: no-cache` on static files, tabs reloading once after
  an update (with several tabs open, because of the shared worker).
- **2c**: the dashboard "Start with Windows" setting (`schtasks /Query` and `/Change`).
2b and 2c are each planned in their own session.

Map sections that bind 2a: "Build work packages" item 2, "Process model" (`--open`, the job-object test of
2026-11-06), "Updater design" (steps 1 and 3 start processes detached, so the spike's result feeds package 6),
"Diagnostics for friends" (rotation, `started` fields), "Release workflow" (the baked version) and "Dev and prod
identity". Tier: Substantial. Pure logic gets TDD (`tdd-live-code-carveout`); live-only code (spawning, killing,
the browser) gets manual repros. No UI in 2a.

Facts from the code that shape it:
- `src/server/grindlog.ts` `mode(argv)` picks supervisor or tracker. No other flag exists.
- `src/server/supervisor.ts` runs the tracker through `Bun.spawn`. The 2026-11-06 test showed `Bun.spawn` children
  sit in a job object that kills them with the parent. So `--open` can't simply `Bun.spawn` the supervisor and exit.
- `scripts/stop.ts` already has `requestStop` (POST `/api/shutdown` with the header), `waitForPortFree` and
  `killExe(exe, arg)` (CIM lookup by full exe path plus a command-line match, then `Stop-Process -Force`).
- `src/server/log.ts` already rotates at 5 MiB × 5 files for every logger. The map's "Keep 5 MB × 5 files rotation"
  needs no code. 2a only checks it's still the default.
- The tracker's `started` has `{pid, dataDir, bun}` (`main.ts:28`). The supervisor's has `{pid, cmd}`
  (`supervisor.ts:40`).
- `/api/status` is `{connection, statsApiOff, configProblems}` (`main.ts:118`, schema `responses.ts:325`). The web
  only sees it through the SSE `status` event, which re-sends on change.
- No repo script builds a prod exe or passes `--define` yet. `PROJECT_INDEX.md:55` says otherwise; package 5 adds
  the release build. 2a only makes the code read the define.

## Design

### 1. Spike: does a detached child outlive its parent?
Run in the scratchpad, never in the repo. Two tiny compiled Bun exes (`bun build --compile --windows-hide-console`):
- `child.exe` appends a timestamp and its PID to a heartbeat file every 500 ms.
- `parent.exe <method>` starts `child.exe` with one method, writes the child PID, then idles until ended. With
  `exit` as an extra argument it exits 0 right away.

Methods, in order of preference:
- **A.** `Bun.spawn` with `detached: true`, if Bun 1.4.3's types and runtime have it (check `bun-types` first). If
  they don't, A is marked not available.
- **B.** `node:child_process` `spawn(..., { detached: true, stdio: "ignore", windowsHide: true })` plus `unref()`.
- **C.** WMI: `powershell -NoProfile -Command Invoke-CimMethod Win32_Process -MethodName Create` with the command
  line and working directory passed through env vars, never quoted into the script (`killExe`'s pattern). WMI's
  service creates the process, so it can't be in our job. It costs about 1 s of PowerShell start-up, which is fine
  for `--open` and the updater.

Ends, for each method:
1. The parent, started from a shell, exits 0 on its own (`--open`).
2. `taskkill /F /PID <parent>`.
3. The parent, started by a scratch per-user task `GrindlogSpike`, exits 0 on its own. This is updater step 1: the
   supervisor runs under the logon task, and a breakaway request can be refused by the task's own job, so a method
   can pass end 1 and fail here.
4. Task Scheduler's End: the task runs `parent.exe <method>` idling, then `schtasks /End /TN GrindlogSpike`.
The task is created and deleted with the user's go-ahead.

Pass for one cell:
- 5 s after the parent is gone, the child's PID still exists (`tasklist /FI "PID eq …"`) and the heartbeat file is
  still growing.
- The child's first heartbeat line records its cwd and a marker env var the parent set, and both are right. WMI
  starts processes with the user's default environment, not the caller's. A child that loses `GRINDLOG_DATA_DIR`
  or `GRINDLOG_PORT` would open the dev install's data.
- A spawn error is recorded per cell, not just pass or fail.
- For the winning method, one cell is watched for 5 minutes, past WmiPrvSE's idle exit for C. That run also checks
  that the child of a detached child survives that child's own exit (the updater starts the new supervisor
  detached).

Decision rule: the first method that passes ends 1, 2 and 3 with the right cwd and env becomes `spawnDetached`. If C
wins, it passes the env explicitly through `Win32_ProcessStartup.EnvironmentVariables`, and the spike checks that.
End 4 is recorded either way. It only matters if someone ends the task mid-update, so a fail there is noted for
package 6 rather than blocking. If no method passes 1–3, stop and take it to the user before writing any other 2a
code. `--open` and package 6 both depend on it. bun-types has `Bun.spawn`'s `detached` (mapped to
`UV_PROCESS_DETACHED`; plan review), so A is tried first.

Record: a "Spike result" section in this plan's repo copy (the 3×3 table, Bun version, date), plus a one-line pointer
on BACKLOG's package 6 item. Package 3's decision file, which already has to correct the supervisor-autostart Limit,
cites it.

### 2. Baked version and runtime info
- New `src/shared/version.ts`, the same pattern as `channel.ts`: `declare const GRINDLOG_VERSION: string | undefined`
  gives `VERSION: string | null`, which is null when undefined or empty. Only the release build defines it (package
  5). Dev and source runs are null, which 2b relies on ("dev builds never self-recompute").
- New `src/server/runtime-info.ts` `runtimeInfo()`: `{ version: VERSION, channel: CHANNEL, windows: os.release(),
  bun: Bun.version }`. `os.release()` gives `10.0.<build>`.
- The tracker's `started` becomes `{ pid, dataDir, ...runtimeInfo() }` and the supervisor's `{ pid, cmd,
  ...runtimeInfo() }`. Package 3 (tray) and package 6 (updater) reuse it.
- `/api/status` gains `version: string | null` and `pid: number`. The schema is `statusSchema` in
  `src/shared/schemas/responses.ts`, built in `main.ts`. Both are constant per process, so the SSE `status` event
  carries them without extra broadcasts. Web fixtures and tests that build a status object get the two fields.

### 3. Shared control module
`requestStop`, `portInUse` and `waitForPortFree` move from `scripts/stop.ts` to a new `src/server/control.ts`,
so the compiled exe can use them. `killExe` moves too, with one change: it returns `"killed" | "none" | "failed"`
(with stderr) instead of logging with `console.error`, which a hidden console throws away, and returning `false`,
which reads as nothing running. Callers log the failure: `stop.ts` to the console, the launcher to its log. Every
importer is updated rather than re-exporting: `scripts/stop.ts`, `scripts/autostart.ts:13` (`killExe`) and
`test/e2e/stack.ts:12` (`requestStop`). `autostart.ts`'s `stopInstalled` stays as it is. Deploy runs the old exe,
which has no `--quit`. New here:
- `exeProcesses(exe)`: `{ pid, commandLine }[]` for that full exe path, through the same CIM query as `killExe`,
  with the path passed through env. A PowerShell or CIM failure throws, never reads as "none running".
- `statusProbe(port)`: `"refused" | "starting" | { pid }`. 503 or any non-200 answer is `starting`, since the host
  binds the port before migrations and answers 503 until the API mounts (`host.ts:57`). 200 gives the tracker's
  `pid` from the body.
- `spawnDetached(cmd, cwd, env)`: the spike's winning method, with stdio ignored, the window hidden and the env
  passed explicitly. It returns the new PID when the method reports one.
- `openInBrowser(url)`: `explorer.exe <url>` through `Bun.spawn`, then await `exited` for up to 5 s, ignoring the
  code. Explorer's exit code is unreliable (often 1 on success). Without the wait, the launcher's exit could kill
  explorer through Bun's job before it hands on the URL. A spawn throw is logged as `browser_open_failed`.

### 4. Entry modes
`mode(argv)` returns `"open" | "quit" | "supervisor" | "tracker"`: `--open` and `--quit` win over `--supervisor`, and
bare is still tracker. `grindlog.ts` dynamically imports `./launcher` for open and quit, so neither loads the
tracker's modules or opens a database. Both log to their own `<logs>\launcher.log`, since two processes rotating one
file would race (the reason the supervisor has its own file). Rotation is the same 5 MiB × 5. Each run logs
`started` with `{ pid, mode, ...runtimeInfo() }`. A bad `GRINDLOG_PORT` makes `dashboardPort()` throw
(`paths.ts:55`). The launcher logs `config_invalid` and exits `EXIT_CONFIG_INVALID`.

Unknown flags still mean tracker. An exe from before 2a, given `--quit`, would start a tracker, but no installed
build predates 2a's flags except the dev install, which the installer never touches. Making unknown flags fail is
left out (plan review, low).

### 5. `--open` (`src/server/launcher.ts` `openDashboard(deps)`)
With the dependencies injected (`statusProbe`, `spawnDetached`, `pidAlive`, `openInBrowser`, `sleep`, `now`,
logger) so the flow gets unit tests:
1. A ready probe (`{ pid }`): open `http://127.0.0.1:<port>/` and exit 0 (`already_running`).
2. `starting`: a tracker is mid-startup, so skip the spawn and go to step 4 (`waiting_for_startup`).
3. `refused`: `spawnDetached([execPath, "--supervisor"], dirname(execPath), process.env)` (`starting_supervisor`
   with method and PID). If the spawn throws, log `spawn_failed` and exit 1.
4. Probe every 250 ms for up to 60 s (a pre-migration backup of a large `raw.db` takes seconds). On ready, open the
   dashboard. Stop early if the spawned supervisor's PID is gone (a port-taken or config exit), and log
   `supervisor_exited`. On that or `ready_timeout`, open the dashboard anyway, so the friend sees the browser's
   error page rather than nothing, then exit 1.
- The port comes from `dashboardPort()`, so dev (`grindlog-dev.exe --open`) gets 49102.
- Accepted race: a supervisor sleeping between crash restarts leaves the port closed, so `--open` starts a second
  one. Whichever tracker loses gets port-taken (exit 3), and its supervisor stops. This is logged, not prevented: a
  CIM lookup on every click costs about a second.
- Log questions: was it already running? Which method and PID started the supervisor? How long until ready? Did
  the browser open fail?

### 6. `--quit` (`quitApp(deps)` in the same file)
The installer (package 5) and the updater (6) run it and need every process of this install gone. Its loop, with
the dependencies injected and a fake clock in tests:
- The wait set is `exeProcesses(execPath)` minus its own PID and minus any process whose command line has `--open`
  or `--quit`. A concurrent `--open` (up to 60 s) or a second `--quit` would otherwise keep the set non-empty until
  timeout. Until the wait set is empty, or 30 s pass:
  - If the probe gives `{ pid }` and that PID isn't in the `asked` set, `requestStop(port)` and add it. The tracker
    exits 0, and the supervisor's `decide` stops on 0. If the probe gives `starting` (no PID yet), request once per
    change from refused or ready to starting. `/api/shutdown` works before mount (`host.ts:46-55`).
  - If the port refuses, `killExe(execPath, "--supervisor")`. Only a supervisor can be waiting to restart a tracker,
    so nothing that records is force-killed. A starting tracker that the job takes down with its supervisor
    has bound the port but not opened storage yet (`main.ts:74-88`). A comment at that ordering in `main.ts` says
    `--quit` relies on it. A `failed` result is logged and retried on the next tick.
  - Sleep 250 ms.
- Exit 0 when nothing is left (`done`, with waitedMs and what it did), including "wasn't running". Exit 1 on
  timeout, logging the PIDs left (`timeout`). Remaining processes are never force-killed: a recording tracker gets
  the time it needs, and the installer then reports a locked file.
- Exe path, not image name: a hand-run copy elsewhere survives, and dev and prod can't touch each other.
  `--quit`'s own process is excluded by PID.
- The tray (package 3) isn't spawned yet. Once it is, the supervisor closes its stdin on exit, the quit protocol.
  `grindlog-tray.exe` is a separate path, so package 3 adds it to the wait set.

## Spike result (2026-11-10, Bun 1.4.3, Windows 11 10.0.26200)
Scratch `parent.exe`/`child.exe`, both `--compile --windows-hide-console`. Each cell: 5 s after the parent is gone, the
child's PID is in `tasklist`, its heartbeat file grew (10 lines in 5 s), and its first line shows the right cwd
(`cwdtest`) and the marker env var the parent set. No spawn errors in any cell.

| Method | 1: parent exits (shell) | 2: `taskkill /F` parent | 3: parent exits under task | 4: Task Scheduler End |
|---|---|---|---|---|
| A `Bun.spawn` `detached: true` | pass | pass | pass | pass |
| B `node:child_process` detached + `unref` | pass | pass | pass | pass |
| C WMI `Win32_Process.Create` (env via `EnvironmentVariables`) | pass | pass | pass | pass |
| Control: plain `Bun.spawn` | child dies | child dies | child dies | child dies |

- The control proves the cells can fail: a plain `Bun.spawn` child dies in every end, as on 2026-11-06.
- The task was the logon task's XML (`InteractiveToken`, `LeastPrivilege`) minus the trigger. In end 3 the task
  read "Ready" right after the parent exited, with the detached child still running.
- 5-minute watch on A: the parent exited, its detached child started a detached grandchild and exited 3 s later.
  The grandchild was still alive with a growing heartbeat after 5 minutes, and had the right cwd and env.
- Decision: **A** becomes `spawnDetached`. It's the simplest, needs no PowerShell, and passes the env through as
  given. End 4 passing means ending the logon task mid-update doesn't kill a detached child (package 6).

## Steps
0. `git status` is clean (checked at plan time).
1. Save this plan to `docs/plans/2026-11-10-wp2a-process-control.md`. On BACKLOG, split package 2 into 2a, 2b and
   2c as ordered sub-items, each with its scope line.
2. Spike (Design 1) in the scratchpad. Each `schtasks /Create` and `/Delete` of `GrindlogSpike` waits for the
   user's go-ahead. Record the result in the plan and add the BACKLOG package 6 pointer. Gate: no method passes ends
   1–3 with the right cwd and env → stop and ask.
3. Failing tests first, then code: `version.ts` (a `Bun.build` of a tiny entry with and without the define, as in
   `channel.test.ts`, including an empty string giving null), `runtimeInfo` shape, both `started` lines (logger
   fakes), `statusSchema` with version and pid, and `mode()` for every flag mix. Then `bun run check`.
4. Move the control helpers, update the three importers, and keep `stop.ts`'s and `autostart.ts`'s tests green,
   including `killExe`'s three-state result. Then failing tests:
   - `statusProbe`, in-process against `startHost`: refused, 503 before mount, `{ pid }` after.
   - `openDashboard`: already running; starting (no spawn, waits); cold start then ready; spawn throws; supervisor
     PID gone exits early; timeout opens anyway and exits 1; bad port exits config-invalid.
   - `quitApp`: nothing running; tracker answers then exits; the same PID is asked only once across ticks; a starting
     tracker is asked once per change; port refused with a supervisor left, so it's killed; a `--open` or second
     `--quit` process is ignored; `killExe` failed is logged and retried; timeout leaves processes and exits 1.
   Implement. Also check that `createLogger`'s defaults are still 5 MiB × 5 (an existing test covers it, or add one
   line).
5. Implement `exeProcesses` (with a Windows-only test like WP1's `killExe` test, including the throw on failure),
   `spawnDetached` and `openInBrowser`. Manual repros on a scratch compiled `grindlog.ts` with `GRINDLOG_DATA_DIR`
   and `GRINDLOG_PORT` pointed at scratch. They never touch the dev install, and the spike has proved the env
   reaches the child.
   - (a) `--open` cold starts the supervisor and tracker, opens the browser, and the launcher exits while both keep
     running. Run it once with no browser open, which checks explorer survives the launcher's exit.
   - (b) `--open` again opens only the browser.
   - (c) `--quit` with both running ends both and exits 0.
   - (d) `taskkill /F` the tracker, then `--quit` within the 5 s backoff: the supervisor is killed and nothing
     restarts.
   - (e) `--quit` with nothing running exits 0.
   - (f) `launcher.log`, `supervisor.log` and `tracker.log` show the `started` fields and each decision, and the dev
     install's logs and port are untouched.
6. `bun run check` and `bun run e2e`. Then `bun run deploy` to the dev install with the user's go-ahead.
   `127.0.0.1:49102/api/status` shows `version: null` and the tracker PID, and the dev logs show the new `started`
   fields.
7. `/compact` line, then `independent-review-pass`, then docs (`documentation-backlog-hygiene`): close 2a on
   BACKLOG, and update PROJECT_INDEX (control module, launcher modes, `launcher.log`, the version define, and the
   wrong `--define` claim at line 55). The commit body records the spike result.

## Verification
- `bun run check` and `bun run e2e` green, with figures in the Review log.
- The spike table is recorded, with a method chosen or the gate raised.
- Manual repros 5a–5f observed.
- The dev install after deploy: `/api/status` has `version` and `pid`, and the `started` lines carry version,
  channel and Windows build.

## Out of scope
2b (recompute, cache headers, tab reload) and 2c (Start with Windows). The prod build and its `--define` (package 5).
The tray and its stdin close (3). Using `spawnDetached` for the updater (6). The Start menu `.lnk` (5).

## Plan review
Plan-reviewer agent (opus), 2026-11-10. All findings folded in except 10:
1. High: if WMI (C) won, the child would get the user's default env, so scratch repros would hit the dev install.
   Fixed: cwd and a marker env var are a pass criterion in every spike cell, and `spawnDetached` passes the env
   explicitly.
2. Med-high: the spike skipped "the parent exits under the task", which is updater step 1. Fixed: added as end 3
   and made blocking. Spawn errors are recorded per cell, and the winner is watched for 5 minutes.
3. Med: `explorer.exe` in the launcher's kill-on-close job could die before handing on the URL. Fixed: await
   `exited` for up to 5 s, plus a repro with no browser open.
4. Med: `--open` treated a 503 (starting) tracker as not running. Fixed: `statusProbe` is three-state; starting
   skips the spawn, and the wait ends early if the spawned supervisor dies.
5. Med: `--quit`'s "once per process" had no mechanism. Fixed: an `asked` set of PIDs from `/api/status`, plus once
   per change into starting.
6. Med: concurrent `--open`/`--quit` processes kept `--quit` waiting. Fixed: excluded by command line.
7. Med: `killExe`'s failure reporting went to a hidden console. Fixed: three-state result, logged by callers.
8. Low: `autostart.ts` and `test/e2e/stack.ts` also import from `stop.ts`. Fixed: all importers updated.
   `stopInstalled` stays (deploy runs the old exe).
9. Low: test seams. Fixed: an in-process `statusProbe` test, a Windows-only `exeProcesses` test, and a bad-port exit.
10. Low: unknown flags mean tracker. Not applied: no installed build predates the flags except dev, which the
    installer never touches (see Design 4).

## Review log
Implementation (2026-11-10), steps 1–6 done:
- `bun run check`: 97 files, 1267 tests passed. `bun run e2e`: 96 passed (4.0 min).
- New: `src/shared/version.ts`, `src/server/runtime-info.ts`, `src/server/control.ts` (moved `requestStop`,
  `portInUse`, `waitForPortFree`, `killExe` now three-state; new `exeProcesses`, `statusProbe`, `pidAlive`,
  `spawnDetached`, `openInBrowser`), `src/server/launcher.ts` (`openDashboard`, `quitApp`, `runLauncher`), with tests.
  `killExe`'s Windows test moved from `scripts/stop.test.ts` to `src/server/control.test.ts` and gained
  `exeProcesses` and a real CIM failure (a quote in the exe name). The match script now sets
  `$ErrorActionPreference = 'Stop'`, so a CIM failure no longer reads as nothing running.
- Rotation: `LOG_ROTATION` (5 MiB × 5) is now exported and pinned by a test.
- Manual repros on a scratch compiled `grindlog.ts` (`GRINDLOG_DATA_DIR`/`GRINDLOG_PORT=49150` in scratch):
  (a) cold `--open`: exit 0 in 0.8 s, supervisor and tracker left running, ready after 256 ms, browser tab opened
  (user confirmed); (b) second `--open`: `already_running`, browser only; (c) `--quit`: one stop request, tracker
  stopped 0, supervisor stopped on 0, done in 1.2 s; (d) tracker force-killed, `--quit` in the backoff:
  `supervisor_killed`, nothing restarted 7 s later; (e) `--quit` idle: `done` in 0.6 s; (f) all three logs carry
  version/channel/windows/bun, dev install logs untouched. The no-browser-open run of 5a was skipped (user, both
  tabs opened).
- Deploy to dev: `/api/status` shows `version: null` and the tracker's pid; both `started` lines carry the new fields.

Review round 1 (diff ~430 non-test lines; Substantial by design tier): `/code-review high`, arch-reviewer (opus),
security-reviewer, `/simplify`. Snapshot `22c7189`.
- Security: no issues.
- [Fixed] code-review: `--quit` ignored a concurrent `--open`, which holds the exe the installer replaces and can start
  a supervisor after `done`. `--quit` now ends `--open` launchers (they record nothing). This revisits plan-review item
  6 ("excluded by command line") on new information; user OK'd 2026-11-10. A second `--quit` is still not waited for.
- [Fixed] code-review: a stop request that failed was never sent again (pid added to `asked` regardless). Now only a
  2xx counts; regression test.
- [Fixed] code-review: `--open` whose first probe saw a stopping tracker (503) never started one once the port freed.
  It now starts the supervisor on a later refused; regression test.
- [Fixed] code-review: `statusProbe` parsed the whole status, so an older or newer tracker build read as starting. Now
  only `pid` (`statusSchema.pick`); regression test.
- [Fixed] code-review: `killExe` in `quitApp` ran even with no supervisor listed, a second PowerShell per tick.
  Superseded by `/simplify`: `quitApp` kills by pid from its own list (`killPid`), only listed matches.
- [Fixed] code-review: a throw outside the lookup's try (PowerShell missing) escaped `runLauncher` unlogged. Now
  logged as `crashed`, exit 1.
- [Verified, no fix needed] code-review: 2 s probe timeout vs a slow loopback refusal. Measured: ECONNREFUSED in
  0-12 ms (Bun 1.4.3, this machine).
- [Fixed] code-review: `pidAlive` read EPERM as gone. Now alive; Windows test on pid 4 (System).
- [Fixed] code-review + arch: `lookup_failed` logged every tick. Now once per run, with `lookupFailures` in the last line.
- [Fixed] code-review + arch: the `spawnDetached` comment retold the spike. Trimmed to the reasoning.
- [Fixed] arch: `method: "bun_detached"` hardcoded in the launcher. Now `SPAWN_METHOD` beside `spawnDetached`.
- [Fixed] arch: the `launcher.log` comment overstated what the own file buys. Reworded.
- [Fixed] arch (risk): `--quit` also relies on the shutdown order (host stops last). Comment on the `host` step.
- `/simplify` applied: kill by pid from the listing; the counter derived from the flag; dead `failure` variable
  removed; `portInUse` unexported; shared `LauncherDeps` base; a 15 s timeout on the PowerShell lookups; the
  autostart message's trailing space. Skipped: a shared `roleOf` with `mode()` (argv vs a command-line string), a
  `Control` interface, splitting control.ts, a shared poll helper, a shared kill-failure printer (two callers, two
  sinks), a lookup cadence backoff (each lookup already takes ~0.5 s).
- `bun run check`: 1273 passed.

Review round 2 (delta vs `22c7189`): `/code-review low`, arch-reviewer (sonnet), security-reviewer.
- code-review and security: no findings.
- [Fixed] arch (risk): `kill_failed` logged every tick, and ESRCH (exited since the lookup) counted as a failure. Now
  ESRCH is skipped and a failure is logged once per pid; regression test.
- [Verified, no fix needed] arch: a 4xx/5xx stop answer is re-sent each tick; bounded by the 30 s timeout, and every
  build has the endpoint.
- [Verified, no fix needed] arch: a timed-out lookup: `spawnSync` gives exit code null, so `killExe` returns `failed`
  and `exeProcesses` throws.
- [Disputed] arch nits: inline `SPAWN_METHOD` (round 1's opus pass asked for the constant; it keeps the log true to
  the method) and pass the count key directly (the map keeps flag and counter from being paired wrongly).
- [Verified, no fix needed] arch q: `supervisor.ts`'s "would race" comment stays true for two long-lived writers.
- Live re-run on the rebuilt scratch exe (port 49150): (c) `--quit` with the app running: one stop (202), done in
  1.3 s, exit 0; (d) tracker force-killed, `--quit` in the backoff: `killed` the supervisor by pid, done 1.2 s, nothing
  restarted 6 s later; (g) `--open` waiting on a non-tracker 200 app, then `--quit`: `killed` the `--open`, exit 0, no
  scratch process left.
- `bun run check`: 1274 passed.

Review round 3 (delta: the `kill` helper's ESRCH skip and once-per-pid log): `/code-review low`, arch-reviewer
(sonnet), security-reviewer. No findings; two arch nits: the test now also pins the logged pid [Fixed, test-only];
`killFailed` never cleared after a later success [Verified, no fix needed: a killed pid leaves the list]. Review done.

After review: `bun run check` 1274 passed, `bun run e2e` 96 passed (4.4 min). Docs: BACKLOG 2a closed, PROJECT_INDEX
updated, review summary `docs/reviews/2026-11-10-wp2a-process-control.md`.

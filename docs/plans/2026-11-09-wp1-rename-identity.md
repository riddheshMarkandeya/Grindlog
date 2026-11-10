# WP1: rename, identity and data move (distribution package 1)

## Context
Friends release step 4 is built as seven packages (BACKLOG; frozen design in
`docs/plans/2026-11-06-distribution-map.md`). Package 1 comes first. Every later package (tray, installer, updater)
assumes three things it sets up: the grindlog internal names, a baked dev/prod channel that keeps the developer's
CLI install apart from a friend's install, and a single `grindlog.exe` that is both tracker and supervisor. It
also moves the developer's data from `%LOCALAPPDATA%\RLTracker` to `GrindlogDev`, so that source scripts
(`start`, `stop`, `recompute`, `deploy`) keep finding the running install. Map sections that bind this
package: "Build work packages" item 1, "Dev and prod identity", "Dev stays separate", "Diagnostics for friends"
(logs to `<data>\logs\` only; rotation and `started` fields belong to package 2), and "Process model" (only the
one-exe flag).

Tier: Substantial. Pure logic gets TDD (`tdd-live-code-carveout`); the badge is UI work, so
`ui-implementation-guidelines` applies; the end goes through `independent-review-pass`.

## User decisions (2026-11-09, this session)
- **The old install is removed by today's own uninstall, not by the new script.** At switch-over, run
  `bun run uninstall-autostart` from a temporary git worktree of the pre-rename commit. That removes task
  `RLTracker`, `Grindlog.url` and `RL Tracker.url`, stops the old pair through the old shutdown header and deletes
  `RLTracker\bin`, but keeps the data. The new script takes its folders as arguments, so the tree has no old names.
  This changes the map's wording, not what happens: the map has "the one-off script also removes the
  `RLTracker` task, `Grindlog.url` and `RL Tracker.url`". Why: with legacy names hardcoded, the closing git grep
  check can't pass while the script stays, and package 7 needs its copy mode.
- **Backup:** after verifying, move mode renames the source to `%LOCALAPPDATA%\GrindlogDev.pre-move-backup`. The
  user deletes it once the dev dashboard shows their history.

## Design

### Channel and identity
- New `src/shared/channel.ts`: `declare const GRINDLOG_CHANNEL: string | undefined;` gives
  `CHANNEL = typeof GRINDLOG_CHANNEL !== "undefined" && GRINDLOG_CHANNEL === "prod" ? "prod" : "dev"` and
  `APP_NAME` ("Grindlog" or "Grindlog Dev"). It is a bare global identifier replaced by `--define`, never a
  runtime `process.env` read, so an environment variable can't flip a dev run to prod. Both the server and the
  web use it. `vite.config.ts` always defines it: `'"prod"'` when the build's own environment has
  `GRINDLOG_CHANNEL=prod` (package 5's release build sets it), otherwise `'"dev"'`. The bundled web build then
  never depends on how Vite/Rolldown treats `typeof`; the `typeof` guard only covers unbundled Bun runs.
  Accepted: `deploy` run from a shell with `GRINDLOG_CHANNEL=prod` set gives the dev install a dashboard that
  looks like prod. The server's identity can't flip that way.
- `src/server/paths.ts` gets `identity(channel = CHANNEL)`: `{ dataDirName: "Grindlog" | "GrindlogDev", port:
  49100 | 49102, exe: "grindlog.exe" | "grindlog-dev.exe", task: "Grindlog" | "GrindlogDev", shortcut:
  "Grindlog.url" | "Grindlog Dev.url" }`. `dataDir`, `dashboardPort` and `staticDir` use it. `DASHBOARD_PORT`
  leaves `src/shared/constants.ts`; nothing in `src/web` uses it. `SUPERVISOR_EXE` and `TRACKER_EXE` go.
  `bun run dev` keeps `.dev-data` and 49101 through its env vars, and the `vite.config.ts` proxy is unchanged.
- Add `logsDir(env)` = `<dataDir>\logs`. `log.ts`'s default logger and the supervisor's logger write there. The
  tracker opens no log file by path anywhere else. In `test/e2e/stack.ts`, both `logTail` and the seed
  logger move to `logsDir`, so a run doesn't write two log files.

### One exe: tracker plus supervisor
- New compiled entry `src/server/grindlog.ts`. With `--supervisor` in `process.argv` it dynamically imports
  `./supervisor` and calls the exported `superviseSelf()`. Otherwise it dynamically imports `./main`, which runs
  the tracker. The dynamic imports keep the supervisor from loading the tracker's modules. The pure
  `mode(argv): "supervisor" | "tracker"` is unit-tested. Bare means tracker, so `bun run start`
  (`src/server/main.ts`) is unchanged and Task Manager shows `APP_NAME` for both processes.
- `supervisor.ts`: the `import.meta.main` block becomes `superviseSelf()`, which runs
  `cmd: [process.execPath]` (itself, no flag) with `cwd` set to its own folder. `runSupervisor` is untouched. A
  one-line comment says it only works compiled: from source, `execPath` is bare `bun.exe`.
- The task runs `<bin>\<exe> --supervisor`: `taskXml` gains an `<Arguments>` element (xml-escaped), with a test.
- `scripts/stop.ts`: `endSupervisor` kills `identity().exe`. That kills only processes with this channel's exe
  name, and only when the port refused, so nothing is recording. The "installed port" check compares with
  `identity().port`.

### Rename, with no aliases (map list)
`RLTRACKER_DATA_DIR/PORT/STATIC_DIR` → `GRINDLOG_*`, `RLT_E2E_KEEP` → `GRINDLOG_E2E_KEEP`, `X-RLTracker-*` →
`X-Grindlog-*`, package `rl-tracker` → `grindlog` (and `bun.lock`), `rlt-theme`/`rlt-events` → `grindlog-*`,
`[rlt]` → `[grindlog]`, and the `rlt-`/`rltracker-` temp prefixes → `grindlog-`, test files included (about 60
files; hit list from `git grep -i -E 'rltracker|rl-tracker|rlt-|\[rlt\]|RLT_'`). `LEGACY_SHORTCUT` goes. It is
mechanical: one scripted replace per pattern, then read the diff. `registry.ts`'s doc path and old doc files keep
their names. `rlt-theme` gets no migration (the map's call; the port change gives a new origin anyway). Comments
naming `RLTRACKER_PORT` and "49101" are updated with their code.

### Dev identity shown to the user
- Header: a small "Dev" badge next to the brand when `CHANNEL === "dev"`, using existing theme tokens (follow
  `ui-implementation-guidelines` and the Header's existing chip styles).
- Tab: `main.tsx` sets `document.title = APP_NAME`; `index.html` keeps "Grindlog" for first paint.
- Toast: `game-watch.ts`'s `TOAST_TITLE` uses `APP_NAME`.
- Task Manager and the exe: `autostart.ts` builds with `description`/`--windows-title` set to `APP_NAME`.
- Shortcut: `identity().shortcut`. The share card stays "Grindlog" (the existing e2e assertion stays).

### Dev installer (`scripts/autostart.ts`)
- It builds one exe (`grindlog.ts` → `<bin>\grindlog-dev.exe` through `grindlog-dev.new.exe`) and uses task and
  shortcut from `identity()`, temp XML `grindlog-task.xml`. `removeShortcuts` covers only this channel's shortcut.
- **Fold-in, exe-replace bug** (BACKLOG "Install: if replacing an exe fails after the tracker is stopped"): when
  `replace(fresh, exe)` fails, record it like `swapFailed` and skip the web swap (the old exe stays with its old
  dashboard). If `exe` still exists, re-register and run the task, then throw "running again, but not updated:
  …". If there's no exe (a first install), skip `/Run` and throw "not installed: …". The decision after `replace`
  is pulled into a small function that takes a fake `replace`/`existsSync`, so it gets unit tests.

### One-off data script (`scripts/move-data.ts`, `bun run move-data`)
`bun run move-data <from> <to> [--copy]`. A bare name resolves under `%LOCALAPPDATA%`.
0. It writes to the console only. It never imports `log.ts` or anything that loads it (`storage.ts`,
   `maintenance.ts`), since the default logger's first write would create `GrindlogDev\logs`, that is `<to>`.
   A test checks that `<to>` doesn't exist after a refused run.
1. It refuses when `<from>` is missing, when `<to>` exists and isn't empty, or when `<from>` is in use (probe:
   rename `<from>` to `<from>.probe` and back; Windows refuses while a file inside is open). The rename back
   retries for about 10 s. If it still fails, the script exits non-zero naming both paths, so the data dir is
   never left renamed without a message.
2. It copies everything except `bin\` (rebuilt by deploy; a dev bin must never reach prod). Root `*.log` and
   `*.log.N` files go into `<to>\logs\`.
3. It checks that each copied file's SHA-256 matches its source, then opens every `*.db` in `<to>` read-only and
   runs `PRAGMA quick_check`. On any failure it deletes `<to>`, leaves `<from>` untouched and exits 1.
4. Move mode renames `<from>` to `<to>.pre-move-backup`. If that rename fails, `<to>` (verified) and `<from>`
   are both kept, and the script exits non-zero saying so. Copy mode leaves `<from>` alone (package 7:
   `GrindlogDev` → `Grindlog`).

It prints file count, bytes and each check's result. Log questions it must answer: what was copied, which file
failed which check, and where the backup is.

## Steps
0. Commit the already-finished map freeze first (`BACKLOG.md`, `PROJECT_INDEX.md`, both map files): "docs: freeze
   the distribution map into seven build work packages". The global §3 rule covers that one commit.
1. Save this plan to `docs/plans/2026-11-09-wp1-rename-identity.md`.
2. Write failing tests first, then implement: `channel.ts` (a `Bun.build` of a tiny entry with and without
   `define` gives prod and dev; plus a Vite `build()` of the web with `GRINDLOG_CHANNEL=prod`, whose output has no
   "Dev" badge string, or the check runs once by hand if a Vite build in a unit test is too slow),
   `identity`/`dataDir`/`dashboardPort`/`logsDir` for both channels, `mode(argv)`, `taskXml` arguments,
   `compileArgs` description, the toast title from `APP_NAME`, `stopTracker` with the channel port, the install
   fold-in's decision function (old exe present or missing), and `move-data`'s pure parts against temp dirs (copy
   skips bin, logs relocate, a tampered byte fails verification and removes `<to>`, non-empty `<to>` refused and
   left absent after refusal, move renames the source and copy keeps it). Update Header unit tests the badge
   breaks.
3. The rename sweep, then `bun run check` (typecheck, lint, test).
4. Badge, title and toast, then `bun run e2e`, plus a new e2e assertion for the Dev badge and the title.
5. Manual repros for live-only code that leave `%LOCALAPPDATA%\GrindlogDev` untouched (it must stay absent
   until step 6): (a) `bun build --compile` `grindlog.ts` into a scratch dir, then run it with `--supervisor`
   and `GRINDLOG_DATA_DIR`/`GRINDLOG_PORT` pointed at scratch. It starts a child tracker, both show "Grindlog Dev"
   in Task Manager, and both logs land in scratch\logs. (b) The `move-data` in-use probe refuses while a scratch
   dir has an open file.
6. Switch-over on the user's PC, each command run with the user's go-ahead. Before: note the match count on
   49100, and check that `Test-Path $env:LOCALAPPDATA\GrindlogDev` is false. Then
   `git worktree add <scratchpad>\old <pre-rename sha>`, `bun install` and `bun run uninstall-autostart` in
   that worktree, and `git worktree remove`. Then `bun run move-data RLTracker GrindlogDev` and `bun run deploy`
   (which installs and recomputes `GrindlogDev` on 49102). Check that the dashboard on 49102 shows the same count.
   Then repro (c), the exe-replace fold-in as a reinstall over the real dev install: a scratch PowerShell script
   holds `grindlog-dev.new.exe` open once it appears, so `install-autostart` reports "running again, but not
   updated" and the `GrindlogDev` task is running.
7. Closing checks (map): `git grep -n -i -E 'rltracker|rl-tracker|rlt-|\[rlt\]|RLT_|rl tracker'` hits only old
   docs and `registry.ts`'s doc path. In `grindlog-dev.exe` (`Select-String` on bytes; check every hit by hand),
   the only expected hit is that same `registry.ts` doc-path string literal; any other hit fails the check. `Test-Path $env:LOCALAPPDATA\RLTracker` is false, `schtasks /Query /TN
   RLTracker` fails, and neither old `.url` remains.
8. `/compact` line, then `independent-review-pass`, then docs (`documentation-backlog-hygiene`): close the
   package 1 and exe-replace BACKLOG items, update PROJECT_INDEX (channel, one exe, logs dir, `move-data`), and a
   commit body that records the uninstall-route revision. The user deletes `GrindlogDev.pre-move-backup` when ready.

## Verification
- `bun run check` and `bun run e2e` green (latest figures recorded in the Review log).
- Manual repros 5a, 5b and 6's (c) observed.
- Switch-over: the dev dashboard on 127.0.0.1:49102 shows the same match count as before the move (count it on
  49100 before step 6), the `GrindlogDev` task runs `grindlog-dev.exe --supervisor`, and logs land in
  `GrindlogDev\logs\`.
- Step 7 closing checks pass.

## Out of scope (later packages)
Baked version, log rotation changes and the `started` fields (package 2), `--open`/`--quit`, the tray, the
installer and the prod build (5), and the updater (6).

## Plan review
Plan-reviewer agent (opus), 2026-11-09. All findings folded in:
1. High: the fold-in repro ran a real install before the move, creating `GrindlogDev` and blocking `move-data`.
   Moved to after the switch-over, with a `Test-Path` precheck. Fixed.
2. Med: `move-data` must avoid the default logger, which creates `GrindlogDev\logs`. Console only, plus a test.
   Fixed.
3. Med: the prod define was tested only through Bun, not Vite. Vite now always defines the channel, plus a
   prod-build check. The environment-variable flip of the web build is noted as accepted. Fixed.
4. Med: the fold-in on a first install would run a task with no exe. Branch on the exe existing, as a
   unit-tested decision function. Fixed.
5. Med: the probe could leave the data dir renamed. Retry, then fail loudly; the final-rename failure is stated.
   Fixed.
6. Low: the e2e seed logger and `logTail` move to `logsDir`. Fixed.
7. Low: the `registry.ts` doc-path literal will show up in the exe. Listed as the expected hit. Fixed.
8. Low: `superviseSelf` from source loops. A comment says it only works compiled. Fixed.
9. Low: test seams for the toast title, the fold-in and the Header tests were added. The supervisor log path
   stays manual (5a). Fixed.
Checked and fine: argv in compiled exes, dynamic import under `--compile`, readers of the removed constants,
unit tests not touching the real data dir, WAL safety, and the switch-over order.

## Review log

### Progress (2026-11-09, paused by the user mid step 6)
- Steps 0-5 done. Map freeze committed as `74599a6` (also the pre-rename sha). `bun run check` green
  (93 files, 1233 tests); `bun run e2e` green (96). Prod web build checked by hand: no "Grindlog Dev" and
  no badge JSX, while the dev build has both. 5a: the compiled `grindlog-dev.exe --supervisor` started a
  bare child, both show "Grindlog Dev", both logs were in `<data>\logs`, and the shutdown stopped both
  (supervisor exit 0). 5b: `move-data` refused while a file was held open and left nothing renamed.
- Step 6 so far: baseline was 211 matches in tracker.db, 210 on the dashboard's 2026 played-days, served
  from 49100. The old uninstall ran from a `74599a6` worktree: it removed task `RLTracker`, `Grindlog.url`
  and `RLTracker\bin` and stopped the tracker, and the worktree was removed. Then
  `move-data RLTracker GrindlogDev` copied 11 files (494,126,283 bytes); every SHA-256 and `quick_check`
  passed, and the source is now `GrindlogDev.pre-move-backup`.
- The first `bun run deploy` was stopped by the user during its e2e, before the install.

### Step 6 finished and step 7 checks (2026-11-10)
- `bun run deploy` passed: check, e2e 96, then the install on 49102, then a recompute that wrote 211 with
  0 failed. Afterwards 49102 showed 211 matches in tracker.db and 210 on the 2026 played-days, the same as
  the baseline, and 49100 no longer answered. Task `GrindlogDev` runs `grindlog-dev.exe` with
  `<Arguments>--supervisor</Arguments>`, and that supervisor's bare child is the tracker; both show
  "Grindlog Dev". Logs are in `GrindlogDev\logs\`.
- Repro (c): a scratch script held `grindlog-dev.new.exe` open, then `install-autostart` ran. The rename
  stayed refused (EBUSY), the web swap was skipped, the task ran again (status Running, 49102 answered 200),
  and the install exited 1 with "Grindlog Dev is running again, but not updated: Could not replace ...".
- Step 7: `git grep` hits in code are only `registry.ts`'s doc path. The rest are old doc names, and
  PROJECT_INDEX/BACKLOG text that step 8 updates. The exe has one latin1 hit, that same literal, and no
  UTF-16 hits. `RLTracker` dir: gone. Task `RLTracker`: not found. `Grindlog.url` and `RL Tracker.url`:
  gone.
- The `-shm`/`-wal` files in `GrindlogDev` came from `move-data`'s read-only `quick_check`: a read-only open
  of a WAL database leaves empty ones (reproduced in a temp dir). They are harmless, so a comment notes it
  and nothing works around it.

### Review round 1 (2026-11-10)
Tier: Substantial by design (468 non-test lines changed). Passes: `/code-review high`, `arch-reviewer` (opus),
`security-reviewer`, `/simplify`. Snapshot `a6adb78`. The user approved deleting
`GrindlogDev.pre-move-backup`, and it is deleted.
- Security: no findings. [Verified, no fix needed]
- code-review: `taskkill /IM grindlog-dev.exe` in `stop.ts` (`endSupervisor`) and in `autostart.ts`
  (`stopInstalled`) now also ends trackers, because both roles share one exe name. A hand-run copy elsewhere
  could be killed mid-match. [Fixed] `killExe(path, arg?)` filters processes on the full exe path through
  CIM, and `endSupervisor` also requires `--supervisor` on the command line. Live repro with two same-named
  exes in scratch dirs: only A's supervisor died, then only A's tracker, and B survived both kills.
- code-review and arch: an `rmSync` failure after a failed copy escaped as a stack trace. [Fixed] Now it is
  try/catch with "delete it by hand", with a `remove` seam and a test.
- code-review: a source holding only `bin\` gave an empty plan, yet a move still put the source aside.
  [Fixed] Now refused, with a test.
- code-review: `<to>` being a file threw ENOTDIR. [Fixed] Now refused, with a test.
- code-review: `resolveDir` duplicated `dataDir`'s LOCALAPPDATA fallback. [Fixed] `paths.ts` exports
  `localAppDataDir`.
- code-review: `verify` hashes the source again after copying. [Verified, no fix needed] It is a one-off
  script, about 1 GB of reads takes seconds, and an independent source read is the point of the check.
- code-review: `.channel` CSS copies `.chip`. [Disputed] The two deliberately differ in color, size and
  padding, and `composes` would pull in `.chip`'s later-cascading size. The comment no longer says "the
  chip's look".
- code-review: the LOCKED errno set duplicates `autostart.ts`'s `replace`. [Verified, no fix needed]
  `move-data` must not import `autostart.ts`, and two three-code lists in one-off scripts aren't worth a
  shared module.
- code-review and arch (q): the e2e Dev-badge test fails on a prod web build. [Fixed] The expectation
  follows `GRINDLOG_CHANNEL`, as `vite.config.ts` does.
- arch nits: [Fixed] all of these.
  - `stop.ts` messages use `APP_NAME`.
  - Named `SwapDeps`.
  - Single `exe` in `stopInstalled`.
  - The spawn test unsets `GRINDLOG_DATA_DIR`.
  - `stop.test.ts` uses `identity("dev").port`.
  - `staticDir` takes `channel`, with a prod test.
  - Fixed the `main.tsx` import order.
- After the fixes: `bun run check` passed, 93 files and 1236 tests. `bun run e2e` passed, 96 tests.
- `/simplify` ran four agents (reuse, simplification, efficiency, altitude).
  - [Fixed] `stopInstalled` ends the supervisor before the rest, so it can't restart the tracker in between.
  - [Fixed] The kill script gets the image name from the path, so it needs one env var fewer. The live repro
    re-ran with the same result.
  - Skipped, because the plan chose these:
    - The `channel` parameters (testability).
    - `swapExe`'s three outcomes.
    - Separate `task`/`shortcut` fields.
    - The Dev badge.
    - `move-data`'s checks, kept for package 7's copy mode.
  - Skipped, too small to be worth a change: shared retry or argument helpers, brand-name strings,
    `installedExe()`, running the builds in parallel, and inlining `mode()`.
  - Altitude, a supervisor pidfile or stop channel instead of a filtered kill. [Deferred → BACKLOG]
    Package 5's `--quit` is that stop channel; once it exists, `killExe` goes.
  - `bun run check` passed after these edits.

### Review round 2 (2026-11-10, delta from `a6adb78`)
Passes: arch-reviewer (sonnet) and security-reviewer. `/code-review low` reviewed the wrong range (it took the
snapshot as a commit and saw round 1's content); its one finding, that `superviseSelf` from source relaunches bare
bun, is plan review item 8 and is covered by a comment. [Verified, no fix needed] The low pass ran again in round 3.
- Security: no findings.
- arch, risk: `killExe` had only a manual repro. [Fixed] Added a Windows-only test in `stop.test.ts`: two copies of
  a compiled sleeper in temp dirs; it ends only the path's supervisor, then the path's tracker, and the other copy
  survives. It goes red when the path filter is removed (checked by mutating it).
- arch, nit: a failed PowerShell or CIM lookup read as "nothing running". [Fixed] The script exits 3 for no match;
  any other code logs `Could not look for <exe> processes` to stderr.
- arch, nit: a comment said "values ... never quoted" while the leaf name is quoted into the filter. [Fixed] Reworded.
- arch, nit: inline `remove` default. [Fixed] Now a named `removeDir`.
- `bun run check` passed: 93 files, 1237 tests.

### Review round 3 (2026-11-10, delta from `d517fd4`)
Passes: `/code-review low` (on `stop.ts`, `move-data.ts`, `autostart.ts` and `paths.ts`) and security-reviewer.
No findings. The backup is named after `<to>`, which is the user's 2026-11-09 decision. Review closed.

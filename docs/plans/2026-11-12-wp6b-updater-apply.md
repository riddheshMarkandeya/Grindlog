# WP6b: updater apply, health check and rollback (friends release step 4, package 6, part b)

Tier: Substantial. Repo copy: `docs/plans/2026-11-12-wp6b-updater-apply.md` (step 1). One plan, one session, two
halves with a `/compact` point between them (user, 2026-11-12).

## Context
WP6a ends with "a verified installer is ready, and the user's choice is recorded"
(`docs/plans/2026-11-12-wp6a-updater-check.md`). Nothing applies it yet, so no release can be tagged
(BACKLOG item 6b). This plan builds the map's Apply, Healthy, Rollback, raw.db backup, free-space and
"Interrupted by a shutdown" paragraphs (`docs/plans/2026-11-06-distribution-map.md:150-206`). It also covers every
item in 6a's "Handed to 6b".

Facts from the code:
- `superviseSelf` (`src/server/supervisor.ts:356`) starts `startSupervisorUpdates`, then runs `runSupervisor`. The
  tracker exits 0 on an accepted stop, so `decide` stops the supervisor.
- `quitApp` (`src/server/launcher.ts:126`) ends every process running a given exe path and its tray. It returns
  0 once none is left, which is the same as "the exes are unlocked". It matches on the full path, so an updater
  running from `<data>\update\grindlog-updater.exe` is never one of its targets.
- `spawnDetached` (`control.ts:150`) survives the parent and the job object. `statusProbe` (`control.ts:68`) reads
  only `pid`.
- `/api/status` has `connection`, `version` and `pid`. The host answers 503 until the API mounts, which happens
  after migrations and startup recovery (`main.ts:186`).
- Pre-migration backups exist only for `tracker.db`. They go to `<data>\backups\tracker-<stamp>-premigration.db`,
  from `storage.ts:76` and `db/backup.ts:52`, with keep-newest-7 pruning across daily and premigration
  backups. `raw.db` has none. No free-space check exists anywhere. A failed `openStorage` exits
  `EXIT_START_FAILED` (2), which is restarted with backoff.
- `migrate.ts:27` refuses a database newer than the code (`newer_than_code`). Migrations commit one version per
  transaction.
- The Inno script writes itself to `<data>\update\previous\Grindlog-Setup.exe` and runs `--quit` in
  `PrepareToInstall`. `[Run]` is `skipifsilent`, and an existing logon task is left alone.
- `showToast` (`notifier.ts:20`) shows a PowerShell-app toast and works from any process. Tray lines come from
  `tray-view.ts` `updateLines`, fed by `update/view.ts`.
- `parseTasklist` is exported from `game-watch.ts:18`.

## Approach

### 1. State contract: `update/state.ts` (TDD)
The schema gains two loose objects, with versions validated as today:
- `apply: {from, to, startedAt, phase}`. This code writes the phases `starting | stopping | installing | checking |
  rolling_back | checking_previous`. Present means "an apply owns state.json".
- `lastApply: {from, to, outcome, reason?, at}`. This code writes the outcomes `updated | rolled_back |
  rollback_failed | not_started | interrupted | unhealthy`.
- `phase`, `outcome` and `reason` are plain `z.string()` in the schema, not enums. A value from a newer version
  would otherwise fail the whole parse, and the next merge-write would rebuild the file from the default, wiping
  `skipped`, `available` and `apply` during a rollback. An unknown value means a neutral tray line, or nothing.
  Test: an unknown phase survives a read and a write.

**Ownership rule (new):** while `apply` is set, the supervisor neither checks nor applies. `runCheck` returns early
with `apply_in_progress`, and the gate refuses. Only the updater, or the supervisor's interrupted-update handling,
writes then. This keeps the 6a promise that state.json has one writer at a time, now that a new supervisor runs
beside the updater during the health check.

New file `<data>\update\start-failure.json` `{v, version, reason: "low_disk", freeBytes, needBytes, at}`. Only the
tracker writes it. It's how the updater learns why a health check failed. Readers ignore an entry with
`at < apply.startedAt` or `version !== apply.to`, so it never needs deleting.

### 2. Tracker data safety: `db/backup.ts`, `storage.ts`, `main.ts` (TDD, temp dirs)
- `backupTracker` becomes `backupDb(db, {name: "tracker" | "raw", …})`, keeping the same partial-then-rename.
  `storage.ts` gives raw.db the same `beforeMigrate` hook as tracker.db (`from > 0` only).
- Pruning:
  - **One backup per schema version**: skip the pre-migration backup when a premigration backup of the same DB
    under 24 h old already has `user_version === from` (read-only open, then close). A migration that fails
    partway restarts every ≤5 min. Without this, each restart would add another 447 MB raw copy. With it,
    there's at most one copy per schema version. Test: a second start after a failed migration makes no second
    backup.
  - tracker: keep the newest 7, as now.
  - raw: `raw-<stamp>-premigration.db`. It must not match `BACKUP_FILE` (`backup.ts:14`), or it would count
    toward keep-7 and the daily check (tested). On create, raw backups older than 24 h are deleted, and a healthy
    update deletes them all (section 5), so the 447 MB copies don't pile up.
- Free space, before each pre-migration backup: `ensureSpace(dir, dbPath)` uses `statfsSync` (checked:
  Bun 1.4.3 returns `bavail` and `bsize` on Windows). It needs db + `-wal` size + 256 MiB, with `statfs`
  injectable. If space is short, it throws `LowDiskError {freeBytes, needBytes}` and nothing is migrated.
- `main.ts`'s `start_failed` catch: on a `LowDiskError`, it also writes `start-failure.json` (best effort). The
  exit code stays 2. No new exit code: the supervisor's backoff is right, and space may be freed.

### 3. Shared pieces
- `control.ts`: `statusInfo(port)` returns `"refused" | "starting" | {pid, version, connection?}`. It reads with a
  pick that tolerates older builds. `statusProbe` becomes a thin wrapper, so the updater and the gate share one
  fetch.
- `shared/release.ts`: `RELEASES_LATEST_PAGE` (`…/releases/latest`), the reinstall link in toasts.
- `notifier.ts` `showToast` takes an optional `url`, set as the toast's protocol `launch`. The URL also goes in
  the body, in case the click doesn't open it (check in the rehearsal).
- `grindlog.ts` `mode()`: `--update` maps to the role `"update"`. `--quit` still wins.

### 4. Health check: `update/health.ts` (TDD, injected probe, clock and sleep)
`waitHealthy({port, version, probe, now, sleep}): {ok: true, pid} | {ok: false, last}`. It polls every 2 s.
- Healthy: the first answer with `version === expected` records `pid` and `seenAt`. Any answer with another pid
  or version clears that record.
- It passes when the same pid answers at `seenAt + 2 min`.
- It fails at 10 min from the start.

### 5. The updater: `update/apply.ts` plus the `--update` entry (TDD with injected deps, temp dirs)
`runUpdate(deps)` takes injected `quit(exe)`, `runInstaller(path, logPath)`, `spawnDetached`, `probe`, `toast`,
clock and fs dirs. Its entry `runUpdater()` builds a logger for `updater.log`. The command line is
`grindlog-updater.exe --update --app-dir <dir>`. It refuses with a log line if `<dir>\<identity().exe>` doesn't
exist.
1. `started {pid, from, to, appDir, …runtimeInfo}`. It needs `apply` with `from === VERSION` (the updater is the
   old code) and `to === available.version`, else it logs `no_apply` and exits.
2. Before stopping anything:
   - Re-verify `download\<installerName(to)>` with minisign plus the comment check, on the bytes it's about to
     run. The path is built from the validated `to`, never from `available.file`.
   - Copy `previous\Grindlog-Setup.exe` to `rollback-setup.exe`.
   - A bad signature puts `to` in `skipped`. A missing rollback installer is `not_started
     (no_rollback_installer)`.
   - Either way, the updater starts the old supervisor again (`spawnDetached`), clears `apply` and exits.
3. `stopping`: `quit(<app>\grindlog.exe)`, i.e. `quitApp`. If it doesn't return 0, that's `not_started
   (stop_failed)`: restart the supervisor and clear.
4. `installing`: run `installer /VERYSILENT /SUPPRESSMSGBOXES /NOCLOSEAPPLICATIONS /LOG=<logs>\install-<to>.log`
   with a 10 min timeout. On timeout it's ended with `taskkill /T /F`, so `Setup.tmp` goes too, and counted as a
   failure. The argv is built by a pure function. A unit test gives it a profile path with a space, and the
   rehearsal confirms Inno reads the `/LOG=` path. Any nonzero exit goes to rollback
   (`installer_failed`).
5. `checking`: `spawnDetached([<app>\grindlog.exe, "--supervisor"])` with the updater's env (so a rehearsal's
   `GRINDLOG_*` carries over), then `waitHealthy(to)`.
   - Healthy: delete the raw premigration backups and `<data>\failed-update\`, then drop `available` and its
     download.
   - Then `lastApply updated`, clear `apply`, done.
   - Unhealthy: the reason is `low_disk` if a matching `start-failure.json` exists, else `health_check_failed`.
     Go to rollback.
6. Rollback: `rolling_back`.
   - `quit` again.
   - **Restore**: done before reinstalling, so an interruption here still leaves an old-schema database that
     either version can open.
     - Applies to each of tracker and raw whose `user_version` is higher than this (old) code's migration
       count.
     - **Find the backup first**: the earliest premigration backup with `stamp >= apply.startedAt` and
       `user_version` equal to the old count. Close every read handle before moving anything (Windows refuses
       to move an open file).
     - Only when that backup exists: move `<db>`, `-wal` and `-shm` into `<data>\failed-update\<to>\`, then
       **rename** the backup into place. A rename on the same volume is atomic and needs no extra space, unlike
       a 447 MB copy that a full disk or a kill could tear.
     - With no backup, the newer DB stays where it is (`restore_no_backup`). Moving it away would make the old
       exe create an empty one, pass its health check and hide the history. Left in place, the old version
       refuses it (`newer_than_code`), the outcome is `rollback_failed`, and the toast's reinstall of the newest
       release can open it.
     - Restore is idempotent: a DB that's already old is left alone.
   - Run `rollback-setup.exe` with the same flags and `/LOG=<logs>\rollback-<from>.log`.
   - `checking_previous`: start the old supervisor, then `waitHealthy(from)`.
   - Add `{version: to, reason}` to `skipped`, drop `available`, set `lastApply rolled_back`, or `rollback_failed`
     if the old version is unhealthy too, then clear `apply`.
   - Toast:
     - rolled back: "Grindlog's update didn't work", "Went back to <from>."
     - rollback failed: "Grindlog couldn't restart", "Reinstall it from <RELEASES_LATEST_PAGE>", with the url.

A broad catch around the whole run logs `crashed`. If the run got past `installing`, the catch goes to rollback;
otherwise it starts the old supervisor and clears `apply`. It's deliberate: a crashed updater must never leave the
app stopped.

The failed DB is kept until the next healthy update deletes `failed-update\`.

### 6. Supervisor side: `update/gate.ts` plus wiring in `supervisor.ts` / `checker.ts` (TDD, pure decision)
- **Startup (`resumeApply`)**, synchronous, before the tracker starts. Its side effects go through injected deps
  (process lookup, restore, writeState), and every branch is unit-tested.
  - The process lookup (`exeProcesses`, about 1 s of PowerShell) runs only when `grindlog-updater.exe` or
    `apply` exists. A failed lookup counts as "updater running" and is logged. Clearing `apply` while an updater
    is mid-rollback would let two processes move the same DB files.
  - If no updater runs, delete `update\grindlog-updater.exe` (best effort).
  - If `apply` is set and no updater runs, it was interrupted:
    - `VERSION === from`: run the idempotent restore. If the phase was `rolling_back` or `checking_previous`,
      add `to` to `skipped`. Then set `lastApply interrupted` and clear `apply`.
    - `VERSION === to`: after the tracker starts, run `waitHealthy(to)` against its own port, in the background
      with no rollback.
      - Healthy: the cleanup from 5.5 and `lastApply updated`.
      - Unhealthy: `lastApply unhealthy` (logged and shown in the tray). Then clear `apply`.
    - Anything else: log and clear.
- **Gate (`applyDecision`, pure)**: apply when all of these hold:
  - `available` is set and its files exist, and no `apply` is set.
  - `autoApply` is on, or `install === available.version`.
  - `lastApply` isn't a `not_started`/`interrupted` from under 1 h ago, so a stop that keeps failing doesn't loop
    every 30 s.
  - Rocket League isn't running (`tasklist` plus `parseTasklist`).
  - The tracker isn't `recording`. A tracker that doesn't answer counts as not recording, so a crash-looping
    tracker still gets fixed.
- **Poll**: every 30 s, folded into the existing `startSupervisorUpdates` handle. It spawns `tasklist` and reads the
  status only once the cheap file checks pass.
  - The gate doesn't fire while a check is in flight. A check doesn't start while `apply` is set. So a check
    can't write `skipped` from a stale read over the updater's writes.
  - A stuck start: `apply` at `starting` or `stopping`, older than 2 min, with no updater process (antivirus
    quarantining a fresh exe in AppData is likely). It's treated as interrupted (`lastApply not_started
    (updater_died)`, clear `apply`, 1 h cooldown). Otherwise updates would be blocked until the next logon.
    Unit-tested in `gate.ts`.
- **Apply**:
  - `writeState({apply: {from: VERSION, to, startedAt, phase: "starting"}})`.
  - Copy `<app>\grindlog.exe` to `update\grindlog-updater.exe`.
  - `spawnDetached([updater, "--update", "--app-dir", <app>])`.
  - A failed copy or spawn clears `apply` and logs it.
  - The supervisor then does nothing more: the updater's `quitApp` stops it through the usual quit path, so
    `runSupervisor` needs no change.

### 7. What the user sees: `update/view.ts`, `tray-view.ts`, Settings (TDD for view/tray-view; e2e for Settings)
- `UpdateResponse` gains `lastApply: {outcome, from, to, reason, at} | null`.
- `skipped` leaves out apply-failure reasons. Those are said through `lastApply`, so the "failed its signature
  check" line stays true.
- Tray lines:
  - `updated`, running `to`, under 24 h: "Updated to <to>", plus "What changed in <to>" (the release page). This is
    the after-update line.
  - `rolled_back` / `rollback_failed`, running `from`, under 7 days:
    - "Update <to> didn't start, so Grindlog went back to <from>"
    - for `low_disk`: "Update <to> needed more disk space, so Grindlog went back to <from>".
  - `unhealthy`, running `to`, under 7 days: "Update <to> may not have finished; reinstall if something's
    wrong".
- Settings' Updates status sentence states the same failure, so the dashboard isn't left saying "up to date".
  Invoke `ui-implementation-guidelines` first.

## Error handling and logging
- Category `update`:
  - `updater.log` (updater), `supervisor.log` (gate, resume) and `tracker.log` (free space).
  - Category `backup` for backups.
- Each log answers:
  - Why did, or didn't, an apply start?
  - Which phase failed, and with what installer exit or health reading?
  - What was restored from which file?
  - How did an interrupted apply end?
- Lines:
  - Gate:
    - `apply_waiting {reason}`: game running, recording, cooldown. Logged once per change, not every 30 s.
    - `apply_starting {to}`, `apply_spawn_failed`.
  - Updater:
    - `started {pid, from, to, appDir, …runtime}`, `phase {phase, ms}`.
    - `reverify_failed {reason}`, `no_rollback_installer`, `stop_failed {code}`.
    - `installer_exited {path, code, ms, log}`, `installer_timeout`.
    - `health {version, ok, pid, last, ms}`.
    - `restored {db, backup, keptAt}`, `restore_no_backup {db, wanted}`.
    - `done {outcome, reason, ms}`, `crashed`.
  - Supervisor: `apply_interrupted {phase, from, to, running}`, `apply_in_progress` (check skipped),
    `updater_removed` / `updater_remove_failed`.
  - Tracker:
    - `db/low_disk {db, freeBytes, needBytes}` (error).
    - `backup/created` with `db`, and `backup/pruned`.
    - `start_failure_write_failed`.
- **Fire once offline**:
  - A tampered download through `runUpdate`'s reverify (`reverify_failed`).
  - A scratch script calling `openStorage` with a fake `statfs` (1 MB free) and a fake next migration, the
    `migrations` option tests already use (`db/low_disk` plus `start-failure.json`). No env hook is added.
  - A non-version `apply.to` in state.json (`state_unreadable`).
  - Read the real lines.

Test seams: `statusInfo` gets a test against a local `Bun.serve` stub, as `statusProbe`'s tests do.
`showToast`'s url is tested through the generated script text. `runUpdater`'s and `superviseSelf`'s wiring is
rehearsal-only.

## Steps
1. Copy this plan to `docs/plans/2026-11-12-wp6b-updater-apply.md`. BACKLOG 6b: link the plan.
2. TDD sections 1–2, the tracker side. `bun run check` green. *Offer `/compact`.*
3. TDD sections 3–4.
4. TDD section 5 (`runUpdate` against fakes, restore against real SQLite files in temp dirs).
5. TDD section 6.
6. Section 7, invoking `ui-implementation-guidelines` before the Settings change. `bun run check`,
   `bun run e2e -- test/e2e/settings.spec.ts`.
7. Docs:
   - `PROJECT_INDEX.md` entries.
   - `docs/releasing.md` "When something fails": rollback, the `install-*.log` / `rollback-*.log` paths, and the
     failed DB in `failed-update\`.
   - The note that the "no tag between 6a and 6b" rule is lifted.
   - A BACKLOG Watch item: the restore picks a backup by schema version, and no real multi-restart migration
     failure has been seen.
8. Rehearsal (below), then `independent-review-pass`.

## Verification
- `bun run check` and `bun run e2e`.
- **Rehearsal: real installs on this PC** (user, 2026-11-12). WP5 already installed prod here. Uninstall at the
  end.
  - Builds, all with `--update-key` set to a throwaway test key (as in 6a's rehearsal):
    - `0.1.0` and `0.1.1` from master, via `build-release --tag`.
    - `0.1.2` from a throwaway `git worktree` (never committed) that adds a no-op migration to both tracker
      and raw.
    - Each is signed into a folder feed's `latest.json`.
  - Setup:
    - Install 0.1.0 by hand, record a fake match or two, quit.
    - Start it with `GRINDLOG_UPDATE_FEED=<folder>` and `GRINDLOG_UPDATE_FIRST_CHECK_MS=2000` through
      `grindlog.exe --open`. The env flows to the supervisor, the updater and the new supervisor.
  - **Healthy path** (feed points at 0.1.1, auto-apply on, game closed):
    - `apply` goes through its phases, and `install-0.1.1.log` exists.
    - `/api/status` says 0.1.1 and passes after 2 min. `lastApply updated`.
    - The tray shows "Updated to 0.1.1" plus "What changed". `grindlog-updater.exe` is gone after the next start.
  - **Rollback path** (feed points at 0.1.2):
    - During the health window, a PowerShell loop kills the 0.1.2 tracker every 30 s.
    - Expect: `health ok:false`, then `restored` for both DBs from the `raw-…`/`tracker-…-premigration` backups,
      and `rollback-0.1.1.log`.
    - Then 0.1.1 is healthy, the DBs are at the old `user_version`, and `failed-update\0.1.2\` holds the 0.1.2
      DBs.
    - `skipped` has 0.1.2, the toast appears (check that its click opens the URL), and so does the tray line.
    - A later check doesn't offer 0.1.2 again.
  - **Interrupted**: during 0.1.1 → 0.1.2's `installing` or `checking`, kill the updater process.
    - Restart via `--open`. `apply_interrupted` is logged, and the outcome matches section 6 for the version
      that's running.
  - **Low disk**: unit and offline only. Filling the real disk isn't worth it.
  - Uninstall with Yes. The prod data dir and task are gone.

## Plan review
plan-reviewer (opus), one pass. All findings were accepted and folded in:
1. (High) A restore with no backup moved the DB away, so the old exe made an empty one and passed its health check.
   Now the backup is found first, and the newer DB stays put without one (`rollback_failed`, reinstall toast).
2. (High) A partly failed migration restarting every ≤5 min added a 447 MB raw backup each time. Now there's one
   backup per DB per schema version within 24 h. The "never prune young tracker premigration backups" rule was
   dropped as no longer needed.
3. (Med) An updater that dies right after spawning left `apply` stuck until the next logon. The poll now treats a
   stale `starting`/`stopping` with no updater as interrupted.
4. (Med) A failed process lookup read as "no updater". It now counts as running, and the lookup runs only when
   an updater file or `apply` exists.
5. (Med) Strict enums for phase, outcome and reason would let a newer value wipe state.json through the fallback.
   They're plain strings now.
6. (Med) The restore copy wasn't atomic and doubled disk use. It's a rename now, with handles closed first.
7. (Low) A check in flight could overwrite the updater's writes. The gate and checks now exclude each other.
8. (Low) `/LOG=` with a space in the path wasn't tested, and a timeout kill left `Setup.tmp` running. Added an argv
   unit test and a rehearsal check, and the timeout kill is now `taskkill /T`.
9. (Low) Test seams named: `statusInfo`, the toast url, `resumeApply` deps, the low-disk offline run through the
   `migrations` option, the raw pattern vs `BACKUP_FILE`. The wiring is rehearsal-only.

## Progress
- Steps 1–2 done (2026-11-12). `bun run check`: 1666 passed, 1 skipped. One full-suite failure was
  `src/tray/tray.test.ts` "goes red within ~5 s" (7634 ms against a 6500 ms limit). It's a timing test under
  load, untouched by this work, and it passes alone (7 passed, 1 skipped).
- Deviation: `start_failure_write_failed` isn't a separate line. `writeStartFailure` logs
  `update/state_write_failed` with the `start-failure.json` path.
- New in `db/backup.ts`: `backupDb`, `backupBeforeMigrate` (logs `backup/premigration_kept` when it reuses a
  backup), `premigrationBackups`, `readUserVersion`, `removeRawBackups`, `ensureSpace`/`LowDiskError`. Section 5's
  restore and cleanup use these.
- Steps 3–4 done (2026-11-12). `bun run check`: 1702 passed, 1 skipped (the tray timing test flaked once more
  in a run between these, at 7999 ms, and passed in the final run).
  - Section 3: `control.ts` `statusInfo`/`StatusInfo` (version and connection are read with `.catch`, so only
    the pid is required); `RELEASES_LATEST_PAGE`; `notifier.ts` `toastScript` + `PowerShellToast.url` (the
    caller puts the URL in the body); `mode()` `"update"`, dispatched in `grindlog.ts` to `update/updater.ts`.
  - Section 4: `update/health.ts` `waitHealthy`.
  - Section 5: `update/files.ts` (download paths, `clearDownloads`, `checkInstaller`, moved out of
    `checker.ts` so the updater shares them), `update/restore.ts` `restoreDbs` (real SQLite tests), `update/apply.ts`
    `runUpdate` + `installerArgs`, `update/updater.ts` `runUpdater` (the real wiring: `quitInstall` from
    `launcher.ts`, the installer runner with `taskkill /T /F` on timeout, `spawnDetached`, `statusInfo`, `showToast`).
- Fire once offline (done, real logger to files): a tampered download gives `update/reverify_failed {reason:
  bad_signature}` then `done not_started`; `openStorage` with a 1 MB statfs and a fake next migration gives
  `db/low_disk {db: tracker, freeBytes: 1048576, needBytes: 268562432}` and `start-failure.json` (written as
  main.ts's catch does); a non-version `apply.to` gives `update/state_unreadable` with the ZodError on `apply.to`.
- Deviations in section 5:
  - **Restore picks the newest backup at the old schema version back to 24 h before `startedAt`**, not the earliest
    one after it. The tracker skips a pre-migration backup when one at the same version under 24 h old exists, so
    the backup a restore needs can predate the apply (e.g. raw.db's migration failed and was restored once, and
    its backup stayed). Only one can match per version inside that window, so "newest" only matters across
    windows. The BACKLOG Watch item (step 7) covers it.
  - A refusal before stopping (bad signature, no rollback installer) doesn't start the supervisor: the old one
    is still running. A crash in `starting` doesn't either. `stop_failed` and later failures do.
  - A bad signature at reverify is skipped for good; an unreadable download (`download_unreadable`) only drops
    `available`, so the next check fetches it again.
  - A failed rollback installer isn't its own outcome: what's on disk is started and checked, and an unhealthy
    old version is `rollback_failed`. A crash during the rollback is `rollback_failed (crashed)` with the
    reinstall toast.
  - `rollback-setup.exe` is deleted after a healthy update.
- Step 5 done (2026-11-12). `bun run check`: 1735 passed, 1 skipped.
  - `update/gate.ts`: `applyDecision` (pure; returns `check_live` until the file checks pass), `stuckApply`,
    `resumeApply` (deps), `finishInterrupted` (background health check when the new version runs), `gateTick`
    (deps; logs `apply_waiting` once per reason), `startApplyGate` (real wiring). `runCheck` returns
    `apply_in_progress` while `apply` is set.
  - Checks and gate ticks share one promise queue in `startSupervisorUpdates` (`serial`), instead of a busy
    flag: a check due during a tick waits rather than being dropped for 6 h.
  - `superviseSelf` passes `apply: {dataDir, appExe, port}`; without a valid port there's no gate.
  - Choices: a failed game check counts as the game running (`game_check_failed`); an interrupted apply's
    `lastApply.reason` is the phase it was cut short in; an apply naming neither version is ended as
    `interrupted`.
- Step 6 done (2026-11-12). `bun run check`: 1750 passed, 1 skipped. `bun run e2e -- test/e2e/settings.spec.ts`:
  20 passed.
  - `UpdateResponse.lastApply` is filtered in `view.ts` to what's worth saying (updated: a day on `to`;
    rolled_back/rollback_failed: a week on `from`; unhealthy: a week on `to`; anything else, unknown outcomes
    included: null), with `page`. `skipped` counts only signature reasons.
  - `shared/update-text.ts` `lastApplyText` gives the tray line and the Settings sentence the same words.
    Settings puts it before the status sentence, and in place of "up to date".
  - UI: no new controls, so there's no interaction contract; the e2e runs in a real browser (Playwright). Not
    checked yet: the sentence at 320 px, and the toast's URL click (rehearsal).
- Step 7 done: `PROJECT_INDEX.md`, `docs/releasing.md` "When something fails" (rollback, the logs, `failed-update\`,
  the end of the 6a/6b tag rule), BACKLOG 6b note and the Watch item for the restore's backup pick.
- **Step 8 rehearsal done (2026-11-12)**, real installs on this PC, with a throwaway passwordless key and a
  folder feed.
  - Builds: all three from the working tree (WP6b is uncommitted, so a worktree off HEAD would lack it).
    0.1.1 bumped package.json temporarily; 0.1.2 also added `CREATE TABLE rehearsal_noop` to both migration
    lists. Both edits were reverted (`git status` clean for those files). Each smoke run said "updates on".
  - 0.1.0 installed by hand (Git Bash had rewritten `/VERYSILENT`, so the wizard opened). One fake match
    recorded through `scripts/replay.ts` on a private port with `STATS_API_URL`, so the dev tracker never
    saw it (1 match, 724 raw events).
  - **Healthy** 0.1.0 → 0.1.1: starting → stopping (stop request, 1.4 s) → installing (exit 0, 5.3 s,
    `install-0.1.1.log` written, so `/LOG=` was read) → checking → `health ok` at 122 s → `updated`.
    `rollback-setup.exe` was gone, the next start logged `updater_removed`, and `/api/update` gave `lastApply
    updated` with the v0.1.1 page. The user saw "Updated to 0.1.2" / "What changed in 0.1.2" in the tray later
    (same lines).
  - **Rollback** 0.1.1 → 0.1.2, with a loop killing the tracker every 30 s during `checking`: `health ok:false
    last:refused` at 600.5 s; `restored` tracker 8→7 and raw 3→2 from the 0.1.2 premigration backups; the
    rollback installer exited 0 (`rollback-0.1.1.log`); 0.1.1 `health ok` at 122 s; `done rolled_back
    health_check_failed`. DBs back at 7/2 with the match intact, `failed-update\0.1.2\` held both DBs plus
    `-wal`/`-shm`, `skipped` had 0.1.2, and the user got the toast. The next start's check said
    `skipped_before`. Seen: after a rollback, `rollback-setup.exe` (36 MB) stays until the next healthy update,
    as designed.
  - **Interrupted**: `skipped` cleared by hand, the updater killed (`taskkill`) in 0.1.1 → 0.1.2's `checking`.
    The restart logged `apply_interrupted {phase: checking, running: 0.1.2}`, then `health ok after:
    interrupted` 2 min later → `lastApply updated`, and the cleanup removed `failed-update\`, the raw backup
    and `rollback-setup.exe`. Not run: an interruption while the old version runs (`VERSION === from`); it's
    unit-tested.
  - Reinstall toast: sent from a scratch script with `showToast` (the real path needs `rollback_failed`); its
    click opened `releases/latest` (user).
  - Uninstall with Yes (user clicked through): the prod data dir, program folder and the Grindlog task are
    gone; `GrindlogDev` untouched.
  - Not checked: the Settings sentence at 320 px.
- Review done (3 rounds, see the Review log). Next: commit, on the user's go-ahead.

## Review log

Tier by the diff: Substantial (about 1130 non-test lines, Substantial design tier). Snapshot before fixes:
`146db8b68f1efbeaa546f044c2c4fb072bca65fd`. Prerequisites: `bun run check` (typecheck, eslint at max-warnings 0,
tests) green, 1750 passed.

### Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer

Merged by topic (cr = code-review, arch, sec):
1. (cr, arch) The gate never checked that `available` is newer than the running version, so a version installed by
   hand, or one that just ran unhealthy, could be applied over itself or downgraded. [Fixed] `GateInput.running`,
   wait `not_newer`; test.
2. (cr, arch) `recover`'s fallback wrote `rollback_failed` without skipping the version or dropping `available`, so
   the gate re-applied it. [Fixed] Skip and drop, as any failed rollback; test asserts both.
3. (arch q) A crash in `checking_previous` started a second old supervisor. [Fixed] `runUpdate` tracks whether one
   was started since the last stop (`up`), and `recover` only starts one if not; test.
4. (cr, arch) A pre-migration backup reused at the same schema version could be older than the live data (a
   migration failed, the old version recorded for hours, the next release reused the backup and rolled back), so
   the restore dropped those matches. [Fixed] When a DB opens with no migration due, its pre-migration backups
   under 24 h old at that version are deleted (`dropSupersededPremigration`, `backup/premigration_superseded`), so
   the next migration backs up afresh; storage test of the whole sequence.
5. (cr) An updater that died in `checking`/`checking_previous` left `apply` set (blocking checks and the gate) until
   the next supervisor start. [Fixed] Past stopping, the tick looks the updater up and settles the apply as the
   startup does (`settleInterrupted`, split out of `resumeApply`); a background health check is started once
   (`memo.finishing`); tests.
6. (cr) `resumeApply` with the new version running sent a rollback cut short to the health check, which could record
   `updated` and delete `failed-update\`. [Fixed] `rolling_back`/`checking_previous` with the new version running:
   `unhealthy` (reason = the phase), skipped, `available` dropped, `failed-update\` kept; test.
7. (arch) `finishInterrupted`'s `unhealthy` kept `available` (the running version). [Fixed] Dropped either way,
   downloads cleared; test.
8. (cr, arch) A failed copy or spawn cleared `apply` with no `lastApply`, so it retried every 30 s. [Fixed]
   `not_started (spawn_failed)`, under the hour's cooldown; test.
9. (cr) A start that keeps failing (`no_rollback_installer`, an updater that exits early) retries hourly and is
   never shown. [Deferred → BACKLOG] Watch list: Inno always writes the previous installer, so no real case.
10. (sec Low, cr) The installer was verified, then run by path after the quit's up to 30 s. [Fixed] Verified again
    once the app is stopped, right before the run; a failure starts the app again (`not_started`, skipped for a bad
    signature); test. The rollback installer (`previous\Grindlog-Setup.exe`, written by Inno) isn't signed and
    can't be checked: [Verified, no fix needed] only a same-user process can change it, and that one already owns
    the install.
11. (arch, cr nits) The previous-installer path built twice, `installerFiles` recomputed, `cleanUpAfterUpdate` living
    in the updater module, the health log fields written twice. [Fixed] `previousSetup`, `files.installer`,
    `cleanUpAfterUpdate` moved to `restore.ts`, `healthFields` in `health.ts`.
12. (arch, cr) `SIGNATURE_REASONS` hand-copied. [Fixed] Built from a record that `satisfies
    Record<InstallerCheck failure, true>`.
13. (cr) `endApply` and `runUpdate`'s `finish` both build `lastApply`. [Verified, no fix needed] `finish` adds the
    skip/drop/toast rules the updater owns; the shared part is one object literal.
14. (arch) The updater's `started` line lacks `from`/`to`. [Verified, no fix needed] `runUpdater` doesn't read
    state.json; `runUpdate`'s `no_apply` and `phase` lines carry them. Recorded here as a deviation.

All 10 new tests failed on the snapshot's apply.ts/gate.ts (and the storage test before its fix). `bun run check`:
1759 passed, 1 skipped.

### Round 1: `/simplify` (reuse, simplification, efficiency, altitude)

Applied:
- One `endApply` (moved to `update/apply-end.ts` with an options object in round 2), used by the
  updater's `finish` and the gate (it replaced gate's own `endApply`, `skipTo` and the separate `clearDownloads`
  calls). Skipping always drops `available` and its download.
- `DAY_MS` in `shared/constants.ts` for the files this change touches (backup.ts, restore.ts, view.ts);
  retention.ts and maintenance.ts keep theirs (outside the diff).
- `youngAtVersion` in backup.ts: the "under 24 h, at this schema version" pick shared by `backupBeforeMigrate`
  and `dropSupersededPremigration`.
- The gate looks up the updater past stopping only once the apply is 45 min old (longer than a whole apply), so a
  normal apply costs no second of synchronous PowerShell per tick; test.
- restore.ts's three-valued nested ternary is two plain checks; `UPDATER_EXE` un-exported.

Skipped:
- (altitude) Drop backup reuse and always back up fresh: it would undo plan-review finding 2 (a copy of raw.db per
  crash-loop restart, which a broken version installed by hand would repeat every few minutes). Staleness is now
  handled by `dropSupersededPremigration`.
- (altitude) Settle at startup and in the tick through one function returning the health-check need, instead of
  `memo.finishing`: medium rewiring of `startApplyGate` for a single flag; both paths already call
  `settleInterrupted`.
- (simplification) Inline `recover` into `runUpdate`: keeps `runUpdate` shorter; `RecoverDeps` names what the
  crash path needs.
- (simplification) Lazy `filesPresent`/`live` instead of the two-pass `check_live`, a safe `updaterRunning` wrapped
  once, the `now` idiom, the install log's three branches, the race in the installer runner: minor, behavior-neutral.
- (efficiency) Reading request.json on idle ticks, `view()` re-reading per poll, a filename-encoded schema version:
  tiny files and human-scale polling.

`bun run check`: 1760 passed, 1 skipped.

### Round 2 (delta `git diff 146db8b`): correctness-reviewer, arch-reviewer (sonnet), security-reviewer

- security: no findings; the round-1 Low is closed.
- (correctness, arch; same finding) `start()` set `up` before the spawn, so a spawn that threw left the crash
  path's retry a no-op and the app stopped (a regression from round-1 item 3). [Fixed] `up` is set after
  `startSupervisor` returns; test (red on the old order).
- (arch, correctness) `DAY_MS` was inserted between the session-gap doc comment and `SESSION_GAP_MS`, under a
  header that doesn't fit it. [Fixed] Moved above the header.
- (arch nit) `endApply` stretched `files.ts`' purpose and took 7 positional params; `finish` translated its options
  with spreads. [Fixed] `update/apply-end.ts` with one options object; `finish` takes `EndApplyOptions` directly.
- (correctness nit) `endApply` cleared the download before writing state, so a failed write left `available`
  naming a deleted file. [Fixed] Downloads are cleared only after a successful write.
- (arch nit) view.ts doc comment followed by a `//` comment. [Fixed] Merged.

`bun run check`: 1761 passed, 1 skipped.

### Round 3 (delta: round 2's fixes): correctness-reviewer, arch-reviewer (sonnet), security-reviewer

- correctness, security: no findings. Every `endApply` call site keeps its old skip/drop semantics.
- (arch nit) `DAY_MS` had no doc comment. [Fixed]
- (arch nit) The round-1 `/simplify` entry still placed `endApply` in `files.ts`. [Fixed] Notes the round-2 move.

Review done: round 3 had no new findings beyond nits, and nit fixes don't reopen a round.

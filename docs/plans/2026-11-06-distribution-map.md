# Grindlog: distribution map (friends release step 4)

## Destination
A design ready to build for this: a friend downloads one installer from GitHub Releases and installs it
without admin rights or dev tools. It then records, shows a small tray and updates itself from then on.

## Notes
- Parent: step 4 of `docs/plans/2026-11-05-friends-release-map.md`. The user confirmed the decisions below
  on 2026-11-06.
- A friend is an end user and this is a proper release; friends are just early beta testers.
- Friend feedback drives polish, so pick the plainest thing that meets the destination.
- Facts from the code that shape every ticket:
  - `scripts/autostart.ts` compiles on the user's machine, so a release has to split build from install.
  - `bin` sits inside the data dir (`paths.ts`, and `supervisor.ts` finds the tracker beside itself).
  - Each exe is about 92 MB.
  - Bun has no native tray.
  - `bun run recompute` is a dev script, so a release can't recompute today.
  - `raw.db` is 447 MB of the developer's 628 MB data dir.
- Friends' machines won't send us logs, so failures have to show up in the tray or in a log file they can send.
- Licences of any tool we ship (tray, updater) must suit a public repo. The LICENSE itself is step 5.
- The repo is public, and `captures/` and `HARs/` were never committed.

## Decisions so far
### Who gets what
Early v0.x builds are for the user, tested with manual installs. Friends only get a build once auto-update
works, so there is no separate update-notice step. This replaces the parent map's "notice in v1.0, auto-update
in v1.1". Friends get v0.x until their feedback lands, then v1.0.0, so plain `x.y.z` needs no `compileArgs`
prerelease handling, and the CHANGELOG starts one step later than step 5 says.

### Tray
In the first friends' build, and small: status, open dashboard, stop, open logs folder. It replaces the no-data
toast as the reliable signal.

### Update behaviour
Download in the background and apply while Rocket League is closed (`game-watch` knows). The tray says what
changed, and a setting turns auto-apply off. A failed update rolls back to the previous version and the
pre-migration database backup, then logs it and shows it in the tray. The new version recomputes its own
records when rules change, in the background and never mid-match. The docs must say this is the app's first
outbound request.

### Install layout and lean
Per-user install: exes in `%LOCALAPPDATA%\Programs\Grindlog`, data in `%LOCALAPPDATA%\Grindlog`. Uninstall asks
about match history and defaults to keeping it. "Lean" means the package: only the exes and dashboard, with no
dev scripts, tests or Bun. Data behaviour stays the same as dev, because recomputes need raw events. The user may
revisit leaner data later.

### Dev stays separate
CLI-only through `bun run install-autostart`, documented in CONTRIBUTING, and it never self-updates. Dev uses
`%LOCALAPPDATA%\GrindlogDev`, task `GrindlogDev`, port 49102. Prod uses `Grindlog` and 49100, and `bun run dev`
keeps 49101. A one-off script with backup and verification moves the user's data there, so friends' installers
carry no migration code. This revisits the backlog's "with installer migration": only that machine has the old
ids, the reasoning `LEGACY_SHORTCUT` already uses. The whole internal rename lands before the first release.

### Stats API setup
One click writes the Documents ini, leaves other settings in the file alone and says to restart the game. A guide
is the fallback when the write fails or the game isn't found.

### Releases
A tag runs the checks on a Windows runner and builds a draft that the user publishes by hand. Standard runners are
free and unlimited on public repos (GitHub Actions billing docs, 2026-11-06). If e2e is flaky there, CI runs
`check` only and the user runs e2e locally before tagging. Test builds are GitHub prereleases, which the updater
ignores.

### Code signing
Unsigned for now, nothing spent, with the SmartScreen warning explained in the download notes. No option removes
the warning on day one. Note: `docs/research/2026-11-06-code-signing.md`, not yet checked against its sources.
Azure Artifact Signing's fit depends on whether the user is in the US or Canada, which is still unanswered.

### Proof before friends
On a clean Windows environment: install, auto-update with data intact, watch a broken build roll back, and check
whether an app-downloaded update trips SmartScreen (read its `Zone.Identifier` stream). Also check that closing the game doesn't overwrite a Stats API write made
while it was open. Then record one live match
on prod on the user's PC. This covers the open WP3b autostart check.

### Backlog fold-ins
The install exe-replace bug and the antivirus backup-rename retry get fixed in step 4 rather than waiting for their
triggers. The memory footprint is measured, not a blocker. These were assumptions the user confirmed. The supervisor
orphan needs no fix (see Process model).

### Tray technology research
The note recommends a small .NET Framework 4.8 WinForms `NotifyIcon` exe: nothing to install on Windows 10 1903+ and
11, with a tiny Rust or Win32 exe as the fallback. `bun:ffi` is rejected as experimental. Any viable tray is a separate
exe, and it could also be the supervisor. Memory, antivirus behaviour and `csc.exe` on the runner are unverified, so
Process model settles the choice, after building the exe and reading its working set. Note:
`docs/research/2026-11-06-tray-technology.md`, not yet checked against its sources.

### Installer and updater tooling research
The note recommends an Inno Setup per-user installer plus a small hand-written updater that verifies the download, runs
it with `/VERYSILENT` and does its own rollback. Velopack is the runner-up, but its hooks can't show a keep-data prompt
and its docs never describe rollback. MSIX and WiX are out. SHA-256 from the same release only catches corruption, while
minisign with a baked-in key also covers a compromised release or account. Updater design settles the choice. Its open
questions include Inno's uninstall prompt and a Bun-side minisign verifier. Note:
`docs/research/2026-11-06-installer-updater.md`, not yet checked against its sources.

### Dev and prod identity
The release build bakes in `GRINDLOG_CHANNEL="prod"` (tested on Bun 1.4.3); no define means dev, including source
runs and the dashboard build, so `start`, `stop`, `recompute` and `deploy` target `GrindlogDev`. Dev exes are
`grindlog-dev*.exe`, because `taskkill /IM` would hit prod. Dev shows a coloured header badge and says "Grindlog Dev"
in the tab, shortcut, Task Manager and toast, never on the share card. `rlt-theme` gets no migration: it only caches
`tracker.db`'s theme. See the rename list and checks below.

Rename, with no aliases: `RLTRACKER_*` and `RLT_E2E_KEEP` to `GRINDLOG_*`, `X-RLTracker-*` to `X-Grindlog-*`,
`rl-tracker` to `grindlog`, `rlt-theme` and `rlt-events` to `grindlog-*`, `[rlt]` to `[grindlog]`, the `rlt-` and
`rltracker-` temp and test prefixes to `grindlog-`. `LEGACY_SHORTCUT` goes. The user renames the GitHub repo to
`Grindlog` before the first release; the local folder stays. Doc filenames and old docs keep the old name. The one-off
script also removes the `RLTracker` task, `Grindlog.url` and `RL Tracker.url`. `tracker.db` stores no old paths.

The rename work package ends with these checks: `git grep` finds old names only in those docs and the `registry.ts`
doc path, the built exes contain none, and the user's PC has no `RLTracker` folder or task after the move.

### Recompute in a release
The tracker stores the last recomputed version in `tracker.db` and recomputes when the running version differs,
which also covers a rollback. This replaces Update behaviour's "when rules change": rule versions miss
`playlists.ts` and unbumped fixes. It runs in the tracker, one match at a time, yielding like retention, over all
history. It pauses only while a match records; a stop means a full rerun at next start. A failed match keeps its
record and leaves the marker unwritten, so it retries at next start, with a quiet tray line if failures remain.
Measured on a copy of the user's data: 18 ms a full match, 7 ms thinned; estimated 5-7 min after a year at 10 h/day.
No tray status while it runs; one event at the end refreshes open pages. Recompute failures never trigger rollback
and "healthy" doesn't wait for it. Dev builds have no baked-in version, so they never self-recompute; `deploy` does it.

### Dashboard after an update
Every static file gets `Cache-Control: no-cache`. After an update, each open tab learns the server's version when its
events stream reconnects and reloads itself once if it differs. The build tests this with several tabs open, since a
tab can stay on the old build's shared worker until it reloads.

### Process model
The logon task starts the supervisor, which starts the tracker and the tray. The tray only talks HTTP, and the
supervisor restarts it, so a tray crash can't stop recording; without .NET 4.8 the tray gives up after a few tries and
recording continues. `grindlog.exe` is tracker and supervisor (a flag), plus `grindlog-tray.exe` on .NET Framework 4.8
(Windows 10 1903+). Task Manager shows "Grindlog" twice plus the tray. Dev gets the same model and a "Grindlog Dev" tray.

The tray's one "Quit Grindlog" exits 0. The supervisor then stops the tracker through `/api/shutdown`, or cancels a
waiting restart, closes the tray's stdin so it removes its icon, and exits. A tracker stopped another way ends the
supervisor and tray too. The Start menu shortcut becomes `grindlog.exe --open`: dashboard if the port answers, else start
the supervisor detached, wait for the port, then open it. It doesn't run the task, because `schtasks /Run` refuses a
disabled one (tested 2026-11-06; revised by Updater design). A dashboard "Start with Windows" setting, on by default, reads and changes
the task directly (`schtasks /Change`, works without admin).

Tested 2026-11-06 on Bun 1.4.3. `Bun.spawn` puts children in a job object that kills them with the parent: the real
pair on a force-kill, and a stand-in Bun parent under Task Scheduler's End. So the backlog's orphan doesn't happen, and
the Limit in `docs/decisions/2026-10-19-supervisor-autostart.md` is wrong; the build's decision file corrects it. That
kill is abrupt, and startup recovery covers it. The stdin close is untested. Tray idle: 5.9 MB private working set,
22.8 MB private bytes, 5.6 KB exe. Supervisor: 2.7 and 63.4 MB. A one-exe supervisor measured the same as a separate one.

### Updater design
Inno Setup plus our own updater; Velopack can't show the keep-data prompt and documents no rollback. Each update is a
full installer, about 45 MB (`grindlog.exe` zipped: 42.7 MB).

Check and download: the supervisor does both, so a crash-looping tracker can still be fixed by the next release. It
checks `releases/latest` a few minutes after start, then about every 6 hours, and never downgrades. With auto-apply off
it still checks and downloads, and the tray and dashboard offer "Install update". Checks can't be turned off.

Verify: minisign only, with the public key baked in and the version and file name in the signed comment. The secret key
stays on the user's PC, and a local script signs the draft before publishing. This stops a stolen account or swapped
file, not a tampered CI build; a lost key means friends reinstall by hand once. Bun 1.4.3's `node:crypto` has Ed25519
and Blake2b-512 (tested), not yet against a real `.minisig`.

Apply, once the game is closed and nothing is recording:
1. The supervisor copies `grindlog.exe` to `<data>\update\grindlog-updater.exe`, starts it detached and quits as usual.
2. The updater, old code outside the install folder, waits for the exes to unlock and runs the installer with
   `/VERYSILENT`.
3. It starts the new supervisor detached (or it dies with the updater's job object), never through the task, so a
   disabled task stays disabled and still updates.
4. The new supervisor deletes the updater file at its next start.

Healthy: `/api/status` reports the new version and the same process ID is still answering 2 minutes later, within 10
minutes in total. The API only mounts after migrations and startup recovery. Recording can't be tested with the game
closed, so a recording bug is fixed by the next release. There is no automatic rollback after an update passes.

Rollback, run by the updater when the installer or the health check fails: stop what's running, then silently run the
copy of the previous installer each install keeps in `<data>\update\previous\`, which also keeps the installed apps
list correct. Restore this update's pre-migration backups and delete `-wal` and `-shm`, keeping the failed database
until the next successful update. Start the old version, check it the same way, and skip the failed version until a
newer one appears. The tray says what happened; if the old version won't start either, a toast links to a reinstall.

`raw.db` now gets a pre-migration backup too, because old code refuses a newer schema. It is deleted once the update is
healthy, and the update is skipped if disk space is short.

Interrupted by a shutdown: a state file tells the next supervisor. On the old version it clears the state and retries
later; on the new version it finishes the health check without rollback, and a failure is only logged and shown in the
tray. Half-written exes mean a manual reinstall, with data untouched. If the game opens mid-update the update carries
on and the new tracker records the match; a rollback may cut that match short.

Manual install or uninstall while running: the installer runs `grindlog.exe --quit` first, and restarts the app after a
manual install. A silent install from the updater skips that restart.

### Tray behaviour and first run
A friend installs past the SmartScreen warning without admin, and the dashboard opens by itself. Setup lives in a
dashboard card, shown on any page whenever it's needed, including later; the tray's "Set up Stats API…" opens it. An
installer-only setup can't fix a later problem, and Windows 11 probably hides a new tray icon under `^` (not tested).

The write changes only a wrong `PacketSendRate` (to 30) or `WebPort` in the Documents copy, in place. A missing file
isn't created: the card says to open the game once. A failed write shows the manual guide. A custom `WebPort` moves to
49124 after the card warns about it; there is no port setting (BACKLOG Watch list). With the game open it still writes,
then asks for a restart. `parseStatsIni` must also accept decimals: Psyonix documents the rate as a float, so `30.0`
reads as off today.

Tray icon: normal when ready, green dot when connected or recording, amber when the friend must act, red while
restarting. Left-click opens the dashboard. Menu: status line, any update or failure lines, "Set up Stats API…", "Install
update" or "What changed" when they apply, Open dashboard, Open logs folder, Quit Grindlog. Update and recompute-failure
notes are added lines rather than states of their own.

Toasts: only "isn't getting data", "first match recorded" and "update failed", through the tray icon if testing shows that
works, since today's use PowerShell's app ID. The recap shows a small dismissible "Is this you?" card whenever a guess is
unanswered, so a new alt gets asked too. The Documents path isn't confirmed for Steam; `user_missing` flags it if wrong.
Prototype rejected variants: a page in the installer, and tray only. Prototype discarded after the decision.

### Release workflow
`package.json`'s `version` is the only source: the user bumps it in a commit and tags `vX.Y.Z`, and CI fails if the
two differ. The release build bakes in `GRINDLOG_VERSION` beside `GRINDLOG_CHANNEL`. A tag with a suffix (`-rc.1`)
builds as a prerelease; `--windows-version` gets the numeric part and the baked version the full string. The updater
compares numeric `x.y.z` and never sees prereleases, since `releases/latest` skips them and drafts.

A `v*` tag runs on `windows-latest` (Server 2025) with only `contents: write` and no secrets: setup-bun, Playwright
Chromium, `check`, `e2e` (fallback as in Releases), the web build, the prod `grindlog.exe`, `grindlog-tray.exe` through
`csc`, then Inno, whose compiler path the workflow looks up. The draft's one asset is `Grindlog-Setup-X.Y.Z.exe`. The
image has Inno Setup 6.7.1 and .NET Framework 4.8 and 4.8.1, but not Bun or Playwright; the first run confirms the
legacy `csc.exe` and records the checks' runtime. Release notes are the draft body the user writes, and the tray's "What
changed" opens that release's GitHub page.

Signing: `bun run sign-release vX.Y.Z` fetches the draft's installer with `gh`, checks its version, signs it with the
official minisign CLI (installed with scoop) and uploads the `.minisig`; the user then publishes. minisign prehashes by
default and appends a tab and `hashed` to the trusted comment, so the Bun verifier allows that and is tested against real
signatures. The password-protected secret key goes in the user's password manager plus one offline copy. The app bakes
in one key: a rotation ships the new key in a release signed with the old one, and a lost key means a manual reinstall.
Runner facts: runner-images Windows 2025 readme and toolset, minisign README and `src/minisign.c`, checked 2026-11-09.

### Two Stats API clients at once
Yes: dev and prod can both record a live match, so the live proof needn't stop dev. Tested 2026-11-09 with the
installed tracker and `scripts/capture.ts` both connected (32 ms apart) through a 3-0 online 2v2
(`31E5553011F1DC9880C5D39C9AC9546B`). Both kept the same 1,482 events, and the tracker stored a completed match with no
flags. The capture also wrote the freeplay frames before and after it, so the game sends every frame to both clients.

### Clean test environment
A standard local account is the routine clean environment: no-admin install, first run, SmartScreen, tray, autostart
at sign-in, updates across sign-ins and uninstall. It has none of the user's per-user state, Bun (`~/.bun`) included,
but machine-wide Node (nvm4w) and Git stay on its PATH. A clean uninstall resets it, or it can be recreated. Live
recording is proved on the user's own account, since neither environment runs Rocket League. Windows Sandbox (enabled
2026-11-09) runs once before the first friend release, from a saved `.wsb`, to catch machine-wide dependencies. The user
first chose Sandbox for every throwaway install, then cut it to that one run the same day, since a new Sandbox per check
is slow and the exes are self-contained. Autostart at sign-in was confirmed after a reboot on 2026-11-09: the sign-in
task fired 1 s after sign-in.

## Open tickets
### Memory footprint measurement
- Question: Private bytes vs shared working set in a real match: is the 108–111 MB peak really over the user's 100 MB
  threshold? The tray adds 5.9 MB private working set, 22.8 MB private bytes at idle (see Process model).
- Type: task
- Blocked by: none
- Status: open

### Inno Setup check
- Question: Does Inno do what Updater design assumes? Confirm that `{autopf}` with `PrivilegesRequired=lowest` gives
  `%LocalAppData%\Programs\Grindlog`, an uninstall `MsgBox` works and a silent uninstall keeps data, the installer can
  copy itself with `{srcexe}`, `/VERYSILENT` returns a failing exit code on a locked file, and a saved installer
  carrying a `Zone.Identifier` stream still runs silently from a Bun parent. Inno isn't installed on this PC. Updates
  must never re-create an existing task (`/Create /F` re-enabled a disabled one in a test).
- Type: task
- Blocked by: none
- Status: open

## Not yet specified
- Diagnostics for friends: is `tracker.log` enough to send, and does anything need scrubbing or size limits first?
- How the build work splits into ordered packages, including the order of the rename and the fold-ins. The identity
  change and the one-off data move land together, or source scripts would miss the running install.
- Whether the Bun version info left in the exes (`InternalName`) raises antivirus trouble for an unsigned updater.

## Out of scope
- Buying a code signing certificate: nothing spent for now, and it can't remove the warning on day one.
- A Steam locator: no friend is on Steam. The first Steam user is the Watch list trigger, which also covers the Documents
  path.
- A dev installer: dev stays CLI-only.
- Storing less raw data: recomputes need it. The user may revisit it later, as a new effort; BACKLOG Watch list has
  the trigger and figures.
- README, LICENSE, CHANGELOG and CONTRIBUTING: step 5.
- Automatic new seasons: its own BACKLOG item, after the friends release.
- A dashboard "What changed" card: release bodies are markdown the dashboard can't render, so it waits for friend
  feedback as a BACKLOG idea.

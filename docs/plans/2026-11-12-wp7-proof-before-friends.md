# WP7: Proof before friends

## Context
The friends-release map (`docs/plans/2026-11-05-friends-release-map.md`) is at step 4, Distribution. Its last
work package is BACKLOG WP7 (`BACKLOG.md:98`): "clean account, one Sandbox run, rollback through the feed
override, copy history into prod, one live match on prod, one VirusTotal scan. Closes WP3b's autostart check."
The spec is distribution map § "Proof before friends" (`:72`) and § "Clean test environment" (`:255`) in
`docs/plans/2026-11-06-distribution-map.md`. WP6b's step-8 rehearsal (`docs/plans/2026-11-12-wp6b-updater-apply.md:369`)
already proved the healthy, rollback and interrupted paths on this PC, but with a throwaway key, local builds and
a folder feed. WP7 proves the real path: CI builds, the real minisign key, GitHub's `releases/latest`, a clean
account and Windows Sandbox.

Tier: Standard (test coverage). It's mostly a manual runbook, and many steps are the user's own actions:
renaming the repo, tagging and pushing, the key password, publishing, signing in to the test account,
VirusTotal. The only code is a temporary broken-build edit, reverted afterwards, plus any fixes the proof turns up.
The proof likely spans more than one session, so step 1 saves this plan to the repo and the results go there.

User decisions (2026-11-12):
- Commit the leftover `lastApplyLink` diff first, as a WP6b follow-up.
- **Real GitHub releases** for the install and the healthy update: the repo renamed to `Grindlog`, CI builds, the
  real key, published. Only the broken build goes through the feed override, and it's never published.
- **The broken build's tracker throws at start**: a temporary edit, reverted. No kill loop.

Facts found:
- `api.github.com/repos/riddheshMarkandeya/Grindlog` is 404 today, while `/RL-Tracker` is 200 (public).
  `UPDATE_REPO` (`src/shared/release.ts`) is already `riddheshMarkandeya/Grindlog`, so the rename has to come first.
- `gh` isn't installed. minisign is (scoop shim), and `minisign.pub` is committed. There are no tags or releases,
  and `.github/workflows/release.yml` has never run.
- Reuse: `bun run build-release` (local build and smoke run), `bun run sign-release vX.Y.Z`, `trustedComment()`
  (`src/shared/release.ts`), the folder feed (`src/server/update/feed.ts`: `latest.json` in GitHub's shape, with
  bare-name `browser_download_url`s), `GRINDLOG_UPDATE_FIRST_CHECK_MS` (honoured only with the feed overridden),
  `scripts/replay.ts`, and `bun run move-data GrindlogDev Grindlog --copy` (tracker stopped; it refuses a
  non-empty target).
- The test account's profile isn't readable from the user's account, and the test account has no Bun. So after
  each test-account step, the user copies `%LOCALAPPDATA%\Grindlog\logs\` and `update\state.json` into a shared
  folder, `C:\GrindlogProof\out\<step>\`. I read them from there. Counts come from a copied `tracker.db`/`raw.db`
  (copy them with the tracker quit from the tray), counted from the user's account with `bun:sqlite`.

## Steps

### 0. Review and commit the leftover diff
`bun run check` and `bun run e2e -- test/e2e/settings.spec.ts`. Review passes chosen by the diff
(`independent-review-pass`; about 70 lines, so at least `/code-review low`). Then commit the four files as
`feat: link what changed, or the latest release, under the last-update line`.

### 1. Save the plan
Copy this plan to `docs/plans/2026-11-12-wp7-proof-before-friends.md` with an empty `## Results` section, and mark
WP7 in progress in BACKLOG.

### 2. Prerequisites (user)
- Rename the GitHub repo to `Grindlog`. Then `git remote set-url origin git@github.com:riddheshMarkandeya/Grindlog.git`
  (I run that), and check the API URL gives 200.
- `winget install GitHub.cli`, then `gh auth login`.
- Create `C:\GrindlogProof\out` and `C:\GrindlogFeed`. Both must be writable by the test account.

### 3. First real release, v0.1.0
- `package.json` is already `0.1.0`. Run `bun run build-release` locally first (the smoke run says updates on).
- The user tags `v0.1.0` and pushes. On CI's first run, record the runtime of `check` and e2e and confirm `csc.exe`
  and Inno. Known risk: `src/tray/tray.test.ts` "goes red within ~5 s" is a timing flake in `check` (7.6 to 8 s
  against a 6.5 s limit), and a 2-vCPU runner makes it likelier. If it fails, re-run the job once. If it fails
  again, loosen or skip that one test on CI as its own small fix. If e2e itself flakes, take the map's fallback
  (CI runs `check` only) as its own fix. Record which happened.
- `bun run sign-release v0.1.0` (the user types the password). The user writes short notes and publishes.
- For the record: the repo is public with a release but no README until map step 5. Friends aren't told yet.

### 4. Clean account: install, first run, autostart, seed data
On the standard local test account:
- Download `Grindlog-Setup-0.1.0.exe` from GitHub in a browser, and record the SmartScreen text. Install without
  admin, then check: the dashboard opens by itself, the tray icon (and whether Windows 11 hides it under `^`), the
  Stats API card (no game here, so it says "open the game once"), and the Settings › Updates section.
- **Turn auto-apply off now** (it defaults to on). Otherwise a jittered check could install 0.1.1 on its own
  before step 5.
- Sign out and back in. **WP3b autostart check**: `supervisor.log` shows `supervisor/started` and then
  `app/started` (copied to `out\4-autostart`).
- Seed data: on the test account, `setx STATS_API_URL ws://127.0.0.1:<private port>`, then sign out and in.
  Confirm from the copied `tracker.log` that it connects to that port (the setx-reaches-the-logon-task check).
  From the user's account, run `scripts/replay.ts` with a named capture (the 6b rehearsal's) on that port,
  with `--speed` set so it doesn't take a full match. Stop the replay server once it's done, so a reconnect
  can't play the match twice. The user's dev tracker only connects to 49123, so it never sees it. Then
  `reg delete HKCU\Environment /v STATS_API_URL /f` on the test account and sign out and in.
  Baseline: matches and raw events counted from the copied DBs.
- Fallback if setx doesn't reach the logon task: Quit from the tray, then from PowerShell on the test account,
  `$env:X = "..."; & "$env:LOCALAPPDATA\Programs\Grindlog\grindlog.exe" --open` (the path the rehearsal proved).

### 5. Healthy update through GitHub, v0.1.1
- Bump `package.json` to `0.1.1`, commit, the user tags and pushes, `sign-release`, notes, publish.
- On the test account, wait for the check (3 min after a sign-in, or the 6-hour cycle; the user signs out and in
  to trigger it). With auto-apply off, the download waits.
  - `Get-Item "$env:LOCALAPPDATA\Grindlog\update\download\Grindlog-Setup-0.1.1.exe" -Stream Zone.Identifier`.
    Record whether the stream exists. If it doesn't, an app-downloaded update can't trip SmartScreen.
  - Click Install. `updater.log` should read starting → stopping → installing → checking → `health ok` →
    `updated` (copied to `out\5-update`). The tray and Settings say "Updated to 0.1.1", and "What changed in
    0.1.1" opens the real release page. Counts match the baseline.

### 6. Broken build through the feed override, v0.1.2 (never published)
- On the user's account, two temporary edits. Set `package.json` to `0.1.2`. In `src/server/main.ts`, just after
  `log.info("app", "started")`, add
  `if (process.env.GRINDLOG_DATA_DIR === undefined) throw new Error("WP7 broken build")`. Placing it after the
  log line means the error is logged, since the tracker's stderr isn't captured.
  - The guard matters: `build-release` smoke-runs the exe *before* Inno (`scripts/build-release.ts:238-248`)
    with `GRINDLOG_DATA_DIR` set, so the smoke run passes. An installed exe sets nothing there
    (`src/server/paths.ts`), so it throws.
  - `main.ts` loads only for the tracker role, so `--quit`, the supervisor and the updater still work.
- Run `bun run build-release`, then revert both edits right away (`git status` clean for them).
- Sign with the real key: `minisign -S -m release\Grindlog-Setup-0.1.2.exe -t "version=0.1.2 file=Grindlog-Setup-0.1.2.exe"`.
  Then put the installer, the `.minisig` and a hand-written `latest.json` into `C:\GrindlogFeed`.
  `latest.json`: `tag_name: v0.1.2`, `draft: false`, `prerelease: false`, and two assets with bare-name urls and
  real byte sizes.
- On the test account, `setx GRINDLOG_UPDATE_FEED C:\GrindlogFeed` and `setx GRINDLOG_UPDATE_FIRST_CHECK_MS 60000`,
  then sign out and in. Before going on, check that `update/checks_started` shows `source.kind: "folder"` and
  `firstDelayMs: 60000`. If it doesn't, use the step 4 fallback.
- Click Install. Expect, in order:
  - the supervisor's `child_exited` lines with code 1 and the broken-build error in `tracker.log`;
  - `health ok:false` after the full **10 minutes** (don't step in early);
  - no `restored` line (0.1.2 has no migration, so `restoreDbs` returns "old" silently);
  - the rollback installer exiting 0, then 0.1.1 `health ok` about 2 minutes later;
  - `done rolled_back health_check_failed`, the toast, and `skipped` holding 0.1.2;
  - counts unchanged.
- Clean up: `reg delete` both variables, sign out and in, and confirm `checks_started` shows source http.
  **Delete `C:\GrindlogFeed` and `release\Grindlog-Setup-0.1.2.exe*`**. That installer passes the real key's
  check, so it mustn't stay around. 0.1.2 is now burned: the next real release is 0.1.3 (write that in Results).
- Uninstall with No (data kept, task and shortcut gone), reinstall 0.1.1 from GitHub, then uninstall with Yes
  (data gone).

### 7. Windows Sandbox, once
A `.wsb` saved outside the repo (`%USERPROFILE%\grindlog-proof\proof.wsb`; `HostFolder` needs this PC's absolute
path) that maps a folder holding `Grindlog-Setup-0.1.1.exe` read-only. Install inside the Sandbox and check the
first run: the dashboard served, the tray, and `/api/update` enabled. This catches a machine-wide dependency.

### 8. Prod on the user's PC
- Stop dev (`bun run stop`), run `bun run move-data GrindlogDev Grindlog --copy` and record its verification
  lines, then restart dev.
- Install 0.1.1 from GitHub. Prod starts with the full history; check its match count against dev's.
- **Stats API write**: with Rocket League open, use the setup card's write. If the ini is already right, put a
  wrong `PacketSendRate` in by hand first. Close the game and re-read the ini, and record whether the write held.
- One live match on prod (dev may record it too). Stored, with no flags.

### 9. VirusTotal (user)
The user uploads `Grindlog-Setup-0.1.1.exe` to virustotal.com, which publishes it there. I record the detection
count.

### 10. Wrap up
- A bug found along the way: its own Standard fix (TDD, review, commit), or a BACKLOG item if it doesn't block
  friends.
- Fill in Results, then `documentation-backlog-hygiene`: WP7 done in BACKLOG, WP3b's autostart item closed, map
  step 4 marked Done in the friends-release map, and the commit body. Commits only on the user's go-ahead.
- Independent review only for code that changed, chosen by the diff.

## Verification
The proof is the verification. Each "record" item goes into `## Results` with real figures: log lines, counts,
exit codes, the Zone.Identifier result, the SmartScreen text, the CI runtime and flake outcome, and VirusTotal
detections. Step 0's code is checked with `bun run check` and the settings e2e. A clean `git status` after step 6
proves the broken-build edits are gone.

## Plan review
plan-reviewer (opus), one pass. All findings accepted and folded in:
1. The test account's logs and DBs weren't readable from the user's account → a shared `out\` folder, and DBs
   copied and counted from the user's account.
2. Untested whether setx reaches the logon task → `checks_started` and connection checks, plus the `--open`
   fallback.
3. The CI fallback covered the wrong test (the flake is `tray.test.ts`, in `check`) → re-run once, then a CI-only
   fix for that test.
4. A broken build signed with the real key was left around → delete it, and 0.1.2 is burned.
5. Step 0 committed without a review → review passes added.
6. Wrong Zone.Identifier path → `update\download\`.
7. Auto-apply defaults to on → turned off in step 4.
8. Expected lines and timings → no `restored` line, a 10-minute wait, and the throw placed after `app/started`.
9. Uninstall No, then Yes, needs a reinstall in between → added.
10. The replay needs a named capture, `--speed`, and stopping the server afterwards; the autostart check gets its
    exact lines → added.

## Results

### Step 0
Committed `7a075d6`. Review: code-review low, security; 1 round, clean.

### Step 3: v0.1.0 on CI
- Local `build-release`: smoke run "Version 0.1.0, channel prod, updates on"; installer built.
- CI run 1 (`43336113685`, tag on `7a075d6`): `check` failed after 112 s of tests, 2 of 124 files. Neither was the
  tray flake, which passed. Both were fresh-Windows-checkout test bugs, not app bugs:
  - `minisign.test.ts` "accepts CRLF line endings": `autocrlf` checked the upstream `.minisig` fixture out with CRLF,
    and the test's `\n` → `\r\n` made `\r\r\n`. Local copies were stale LF checkouts. Fix: `.gitattributes`
    `src/server/update/fixtures/** -text`.
  - `build-tray.test.ts` findCsc: `findCsc(undefined, …)` takes the default, the runner's real `WINDIR`. Fix: `""`.
  - Reproduced both locally (re-checkout under autocrlf; `WINDIR='C:\Windows'`), then green; full `check` 1766 passed.
  - No release or draft was created, so `v0.1.0` moves to the fix commit.
- CI run 2 (`43337601827`, tag moved to `e116b39`): green, 9.5 min in all. Checkout 8 s, install 11 s, Playwright
  chromium 24 s, `check` 2 min 42 s (1766 passed, tests 102 s; the tray test took 6303 ms against its 6500 ms
  limit, so it passed but with only 0.2 s to spare), e2e 5 min 24 s (113 passed, no flake), `build-release` 27 s
  (csc.exe compiled the tray, Inno built the installer, smoke run "Version 0.1.0, channel prod, updates on"),
  draft 7 s. Draft `v0.1.0` holds `Grindlog-Setup-0.1.0.exe`, 36,108,649 bytes. No re-run and no CI-only fix needed.
- Published by the user. `releases/latest` serves `v0.1.0`, not draft or prerelease, with `Grindlog-Setup-0.1.0.exe` (36,108,649 B) and its `.minisig` (309 B). sign-release verified the trusted comment "version=0.1.0 file=Grindlog-Setup-0.1.0.exe".

### Step 4: clean account (Test-User, standard user)
- Download (Edge, from GitHub): Microsoft Defender SmartScreen warned in the downloads list, "isn't commonly
  downloaded. Make sure you trust Grindlog-Setup-0.1.0.exe before you open it", then "Microsoft Defender
  SmartScreen couldn't verify if this file is safe because it isn't commonly downloaded … Publisher: Unknown". Keep
  was needed twice. The user clicked "Report this app as safe". **No SmartScreen prompt when running the installer.**
  Release notes cover both: the browser's download warning and the run-time "Windows protected your PC" (user's choice;
  others may still get the second).
- Install: no admin prompt, wizard "Setup - Grindlog version 0.1.0". Dashboard opened by itself at
  `127.0.0.1:49100/recap`. Tray icon visible. Stats API card "Open Rocket League once" with "Do it by hand".
  Settings › Updates "hasn't checked for updates yet", then "0.1.0 is up to date" after the first check
  (`check_result up_to_date`, 282 ms, 3 min after start). Auto-apply turned off (`update/request auto_apply on:false`).
- **WP3b autostart check passed**: after sign-out and sign-in, `supervisor/started` at 01:16:48.605Z, then
  `app/started` at 01:16:49.367Z and `host/listening 49100`; tray "Open Rocket League once to finish setup".
  `checks_started` source http, `firstDelayMs 180000` (its `apply:true` only means an apply step is wired up).
- Found: at sign-out the tray exited with **code 4**, which isn't one of the tray's codes (0-3) and has never
  appeared in the dev logs. The supervisor scheduled a restart (5 s) that the logoff cut off. Harmless here, so it
  goes on the BACKLOG Watch list.
- Seed: replay of `test/fixtures/completed.ndjson` at 20x on port 49130. **setx reaches the logon task**: after
  the Test-User sign-in, `app/started` 01:41:58.336Z, then `stats_api/connected ws://127.0.0.1:49130` (before that it
  waited on the default 49124). `match_closed` stored 724, storeFailed 0. `summary` completed, playlist 13, 1-2,
  `flags: []`. No error lines. Tray "Recording a match", and Recap showed the 1-2 loss with "Is this you? Player 1".
  Replay stopped after "replay finished".
- Baseline (copied with the tracker quit, after a sign-in without the variable, which put it back on 49124):
  `tracker.db` matches 1, match_players 6, match_goals 3, my_ids 1; `raw.db` events 724.

### Step 5: v0.1.1 through GitHub
- CI run `43348180704` attempt 1 failed `check`: `apply.test.ts` "a new version that keeps crashing is rolled back,
  with the DBs it migrated put back from their backups" **timed out at 5000 ms** (75-83 ms locally over three runs,
  342 ms in run 2). Unproven lead: `restore.ts` moves the DB and its -wal/-shm with `renameRetry`, which really sleeps
  for up to 2 s per file while it's held; something on a fresh runner (Defender scanning new SQLite files?) could
  hold them. Attempt 2 (re-run of the failed job) green: that test 718 ms, tray test 6319 ms, 1766 passed,
  e2e 113 passed (5.8 min), smoke run "Version 0.1.1, channel prod, updates on". Draft holds
  `Grindlog-Setup-0.1.1.exe`, 36,108,413 B. Watch-listed, not fixed.
- Signed by the user (`sign-release` from their own terminal; the `!` shell lacked gh on PATH) and published. `releases/latest` serves `v0.1.1` with the installer and its 309 B `.minisig`.
- Test-User, auto-apply off. Sign-in 02:59:27 → check 03:02:29: `download_done` 36,108,413 B in 1.8 s,
  `check_result downloaded`, `apply_waiting not_chosen`. Settings: "Grindlog 0.1.1 is ready to install".
- **Zone.Identifier: absent** on `update\download\Grindlog-Setup-0.1.1.exe` ("Could not open the alternate data
  stream"). So an app-downloaded update carries no mark of the web and can't trip SmartScreen.
- Install clicked 03:07:01 (`request install 0.1.1`; Settings then said "Installs when Rocket League is closed").
  `apply_starting` 03:07:28. `updater.log`: stopping (87 ms) → installing (2.1 s) → `installer_exited code 0`
  (6.3 s, `install-0.1.1.log` written) → checking → `supervisor_started` → `health 0.1.1 ok:true` at 122 s →
  `done updated` (131 s in all). 0.1.1 `app/started` 03:07:38. `state.json lastApply` updated 0.1.0 → 0.1.1.
- User saw: tray menu "Updated to 0.1.1" with the release-notes item; Settings "Grindlog 0.1.1 is up to date" with
  "What changed in 0.1.1" opening the right GitHub page (before the install too, as the ready update's link);
  recap still shows the 1-2 match.
- **Counts match the baseline**: matches 1, match_players 6, match_goals 3, raw events 724 (user_version 7).

### Step 6: broken v0.1.2 through the feed override (never published)
- Temporary edits: `package.json` 0.1.2, and in `main.ts` after `app/started`:
  `if (process.env.GRINDLOG_DATA_DIR === undefined) { log.error("app", "wp7_broken_build"); throw … }`. The log line
  was added because main.ts has no process-level crash logging and the tracker's stderr isn't captured, so a bare
  throw would show only `app/started` then exit code 1. `build-release` smoke run passed ("Version 0.1.2 … updates
  on") as designed; both edits reverted straight after (`git status` shows only docs; package.json 0.1.1).
- Signed by the user with the real key; `minisign -V` verified "version=0.1.2 file=Grindlog-Setup-0.1.2.exe".
  `C:\GrindlogFeed`: installer (36,111,619 B), `.minisig` (309 B), hand-written `latest.json`. The app's own
  `fetchLatest` + `pickCandidate` read it as candidate 0.1.2 against a running 0.1.1.
- Test-User: `setx` both variables, sign-in → `checks_started` source folder `C:\GrindlogFeed`, `firstDelayMs 60000`
  (03:20:53). 0.1.2 downloaded 03:21:55 and was offered in 2 min. Install clicked; `updater.log`:
  stopping (87 ms) → installing (1.7 s) → `installer_exited code 0` (5.7 s) → checking → supervisor 0.1.2 started.
  Supervisor: `child_exited code 1` after ~68 ms uptime, restarts backing off 5 s, 10 s, 20 s, 40 s … up to 300 s
  (7 `wp7_broken_build` lines in `tracker.log`). `health 0.1.2 ok:false last:refused` at **601 s** → rolling_back →
  `rollback-setup.exe` exit 0 (6.4 s, `rollback-0.1.1.log`) → checking_previous → `health 0.1.1 ok:true` at 122 s →
  `done rolled_back health_check_failed` (739 s in all). **No `restored` line**, as expected (no migration).
  Toast 03:37:17 "Grindlog's update didn't work / Went back to 0.1.1." `state.json`: `skipped` 0.1.2
  (health_check_failed), `lastApply rolled_back`. Settings and tray: "Update 0.1.2 didn't start, so Grindlog went
  back to 0.1.1." Dashboard works, 1-2 match there. **Counts unchanged**: matches 1, players 6, goals 3, events 724.
- Found: the toast's header reads **"Windows PowerShell"**, not Grindlog (it's sent through PowerShell's app
  identity). Works, but confusing for a friend → BACKLOG.
  - Fixed 2026-11-18 (public release map step 2): prod sends PowerShell toasts under `Grindlog.Grindlog`, which the
    installer sets on the Start menu shortcut (`[Icons]` `AppUserModelID:`). Dev keeps PowerShell's ID.
    - Probe first: a toast under `Grindlog.Grindlog` with no shortcut registering it still appeared (exit 0), so a
      missing shortcut doesn't drop toasts and there's no shortcut-exists fallback.
    - Local `build-release` 0.1.5 installed silently over prod: the shortcut's `System.AppUserModel.ID` is
      `Grindlog.Grindlog` at once, but `Get-StartApps` showed the old auto-generated ID until about 5 s later (the
      indexing race, no handling).
    - The generated script, without and with a url, showed a Grindlog header and icon. Both toasts were listed in
      Action Center, and clicking the url toast opened it.
    - Real fallback: prod `grindlog.exe` with no tray, and a stand-in `RocketLeague.exe`. After 80 s the app logged
      `notice/powershell` (`lastPollAgoMs null`), then `toast/shown appId Grindlog.Grindlog` for "Grindlog isn't
      getting data", and the toast read Grindlog.
- Cleanup: both variables deleted, sign-in → `checks_started` source http, `firstDelayMs 180000` (03:47:01), check
  `up_to_date latest 0.1.1`. **Deleted `C:\GrindlogFeed` and `release\Grindlog-Setup-0.1.2.exe*`.** Test-User's
  `update\download` copy goes with the uninstall-Yes below. **0.1.2 is burned: the next real release is 0.1.3.**
- Browsers (user, downloading 0.1.1 only): Chrome, Firefox, Brave, Opera and Vivaldi gave no warning; Edge warned
  every time (3 times). Release notes on v0.1.0 and v0.1.1 now name Edge.
- Install states (Test-User, `C:\GrindlogProof\check-install.ps1`):
  - 0.1.1 setup run over a running 0.1.1: no prompts, the dashboard reopened with the 1-2 match. App 0.1.1.0, shortcut,
    task, data all present. Test-User's downloaded 0.1.2 installer was already gone.
  - Uninstall, "Also delete your match history?" → No, then "successfully removed": app folder, shortcut, task gone;
    data folder, `tracker.db`, `raw.db` kept; no processes.
  - Reinstall 0.1.1: the 1-2 match came back (kept data picked up); everything present again.
  - Uninstall → Yes: app, shortcut, task, data folder all gone; no processes.

### Step 7: Windows Sandbox
- `%USERPROFILE%\grindlog-proof\proof.wsb`: the published 0.1.1 installer (downloaded from GitHub, `minisign -V`
  verified) mapped read-only at `C:\installer`, plus `C:\GrindlogProof` writable for output.
- Installed with no warnings (the file came through a mapped folder, so it carries no mark of the web). The dashboard
  opened by itself at `127.0.0.1:49100`, and the tray ran ("Open Rocket League once to finish setup"). Settings ›
  Updates showed the real section with the auto-apply switch and "0.1.1 hasn't checked for updates yet", which
  means updates were enabled. No machine-wide dependency was missing.
- The Sandbox itself crashed before the 3-minute first check and before the logs were copied, so there's no
  `out\7-sandbox`. Not re-run: the per-user app can't crash the Sandbox VM, and the check was already proven on
  Test-User.

### Step 8: prod on the user's PC
- `bun run stop` (dev, port 49102), then `bun run move-data GrindlogDev Grindlog --copy`: 12 files (549,848,151 bytes,
  `bin\` left out), "SHA-256: 12 of 12 files match", `quick_check ok` on `tracker.db`, `raw.db` and all 7 backups,
  "Verified 12 files". Dev restarted with `schtasks /Run /TN GrindlogDev` (its dashboard answers 200).
- Counts identical in dev and prod: 240 matches, 1,054 players, 1,348 goals, 376,854 raw events.
- Installed 0.1.1 from GitHub on the user's own account. **SmartScreen did come up here**: "Windows protected your
  PC … prevented an unrecognized app from starting", with More info showing App: Grindlog-Setup-0.1.1.exe,
  Publisher: Unknown publisher, then Run anyway. Test-User saw no prompt for the same file, so SmartScreen
  can't be counted on either way; the release notes keep both warnings. The dashboard opened with the full history,
  and the prod and dev tray icons both showed.
- Stats API write: with the game closed, `PacketSendRate=0` set by hand (backup in `C:\GrindlogProof`), then the game
  opened. Both prod and dev toasted that the Stats API was off (expected with two trackers running). The prod card's
  button wrote the file (`game/stats_setup_fixed`, `changed: ["packetSendRate"]`, `POST /api/stats-setup/fix 200`, 207 ms). After the game
  closed, the ini still read `PacketSendRate=30`: **the write held**.
- Live match on prod (game restarted): `match_closed` `324746FC…`, `stored: 1508, storeFailed: 0`; a completed 1-2
  match (playlist 2, `cs_p`), `check_flags: []`. Dev recorded the same match with the same values; both now hold 241
  matches and 378,362 raw events.

### Step 9: VirusTotal
- The user uploaded the published `Grindlog-Setup-0.1.1.exe`. Its SHA-256 `9c2b008f…6b245` matches the GitHub asset
  (hashed locally). **0/70**, "No security vendors flagged this file as malicious", tags `peexe`, `overlay`:
  https://www.virustotal.com/gui/file/9c2b008f1c1731dc3c15b604d60e8d2ffbaf13cebc16e654b693d99cd7f6b245/detection

### Step 10: wrap-up
- No bug found that blocks friends. Filed along the way: the toast app name "Windows PowerShell" (UX), and Watch items
  for the tray's code 4 at sign-out and the `apply.test.ts` CI timeout. No product code changed in WP7 (only the
  test fix `ab5cefd`, `.gitattributes` and the 0.1.1 bump), so no review pass ran for this step.
- VirusTotal upload automation: considered and dropped (user, 2026-11-12). A manual upload per release takes a
  minute; releases are rare.
- Cleanup: `C:\GrindlogFeed` and the 0.1.2 installer deleted in step 6; `C:\GrindlogProof` (step files, copied logs,
  screenshots, ini backup) and `%USERPROFILE%\grindlog-proof` (the `.wsb` and the installer copy) sent to the
  Recycle Bin. The Test-User account is left for the user to remove.

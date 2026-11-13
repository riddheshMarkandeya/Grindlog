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

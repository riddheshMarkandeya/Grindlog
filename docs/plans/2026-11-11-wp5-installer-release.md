# WP5: installer and release pipeline (friends release step 4, package 5)

Tier: Substantial. Repo copy: `docs/plans/2026-11-11-wp5-installer-release.md` (step 1).

## Context
The friends release needs one `Grindlog-Setup-X.Y.Z.exe` on GitHub Releases. A friend installs it per-user
without admin, and package 6's updater later runs it silently, both forward and as a rollback. Today the only
install path is the dev CLI (`scripts/autostart.ts`), which compiles on the machine and puts `bin` inside the
data dir. This package adds the release build, the Inno script, the tag workflow, `sign-release` and
`rcedit`. The design is frozen in `docs/plans/2026-11-06-distribution-map.md` ("Decisions so far": Install
layout, Process model, Updater design, Release workflow, Inno Setup check, Bun version info, Clean test
environment). Scope is Build work packages item 5. No prod install goes on the user's own account before
package 7's copy step.

Facts from the code:
- `compileArgs` (`scripts/autostart.ts:54`) and `buildTray` (`scripts/build-tray.ts:66`) already build both
  exes. No `--define` is passed anywhere yet. `CHANNEL` (`src/shared/channel.ts`) and `VERSION`
  (`src/shared/version.ts`) read the defines and are tested.
- The dashboard's channel comes from `process.env.GRINDLOG_CHANNEL` at Vite build time (`vite.config.ts:9`).
  Vite's `root` is `src/web`, so `--outDir` must be absolute (as `autostart.ts:290` does it).
- `staticDir` (`src/server/paths.ts:66`) serves `<dataDir>\bin\web`, and prod needs `web` beside the exe.
  Everything else (supervisor, tray, `--open`, `--quit`, logs) already uses `process.execPath` or `logsDir`.
  The plan review confirmed this.
- `quitApp` (`src/server/launcher.ts:127`) ends processes by exe path and exits 0 when none is left.
- `taskXml` (`scripts/autostart.ts:30`) is the tested task definition.
- `identity("prod").shortcut` is the stale `"Grindlog.url"` (`paths.ts:29`).
- Not on the user's PC: `gh`, `scoop`, `minisign`. ISCC is at `%LOCALAPPDATA%\Programs\Inno Setup 6\`; CI's
  copy is under Program Files (x86).
- `dist/` is emptied by `vite build`, so release output goes in a new gitignored `release/` folder, and the
  rcedit download in a gitignored `.cache/`.

## Approach

### 1. Shared release facts: `src/shared/release.ts` (pure, TDD)
- `parseReleaseVersion(s)` accepts `x.y.z` or `x.y.z-suffix` and returns `{ full, numeric, prerelease }`. It
  throws on anything else.
- `installerName(full)` returns `Grindlog-Setup-${full}.exe`.
- `trustedComment(full)` returns `version=${full} file=${installerName(full)}`. Package 6's verifier parses
  this contract and must accept it with or without minisign's appended `\thashed`, which isn't verified yet.
  The first `sign-release` records the real output.

### 2. Build helpers (pure parts TDD, `scripts/`)
- Move `compileArgs` to `scripts/build-exe.ts` and give it an optional `defines` record that becomes
  `--define K=JSON`. `--windows-version` always comes from `parseReleaseVersion(version).numeric + ".0"`, so
  dev deploys keep working once `package.json` carries an `-rc.N`. `autostart.ts` imports it and keeps dev
  free of defines.
- `findIscc(env, exists)` tries the `ISCC` env override, then `%ProgramFiles(x86)%`, `%ProgramFiles%` and
  `%LOCALAPPDATA%\Programs`, each with `Inno Setup 6\ISCC.exe`. It has the same shape as `findCsc`.
- `taskTemplate()` is `taskXml(...)` with placeholder tokens (`@@USER@@`, `@@EXE@@`, `@@WORKDIR@@`) and the XML
  declaration dropped. That suits the Inno check: no declaration, written as UTF-8 without a BOM. The task
  definition keeps one source, and Inno XML-escapes each value before substituting it.
- `rcedit`: pinned `electron/rcedit` v2.0.0 `rcedit-x64.exe`, with its SHA-256 as a constant. Take the hash
  from the GitHub release asset's `digest` field and cross-check it against a local hash of the download.
  The exe is downloaded once to `.cache/rcedit/`, and a mismatch fails the build. `sha256Matches` and the arg
  builders are unit-tested.
- `identity("prod").shortcut` becomes `"Grindlog.lnk"`. ISCC gets its stem, so the `.iss` and `paths.ts`
  agree.

### 3. `scripts/build-release.ts` (`bun run build-release [--tag vX.Y.Z]`)
Each step is printed, and a failure fails fast with a `StepFailed` message:
1. `parseReleaseVersion(package.json version)`. With `--tag`, fail unless the tag is `v` + version.
2. Empty `release/`, then run `vite build --outDir <abs release/app/web> --emptyOutDir` with
   `env: { ...process.env, GRINDLOG_CHANNEL: "prod" }`.
3. Compile `release/app/grindlog.exe` with defines `GRINDLOG_CHANNEL="prod"` and `GRINDLOG_VERSION=<full>`.
4. `buildTray({ channel: "prod", version: numeric })` to `release/app/grindlog-tray.exe`. A failure fails the
   release.
5. rcedit sets `InternalName` to `grindlog`.
6. **Smoke run of the edited exe**: run `release/app/grindlog.exe` (bare tracker) with a temp
   `GRINDLOG_DATA_DIR`, a free `GRINDLOG_PORT`, a temp `GRINDLOG_STATS_CONFIG_DIR` and a dummy `GRINDLOG_TASK`,
   so it never touches a real task or ini. No `GRINDLOG_STATIC_DIR` is set, so the new prod `staticDir` is
   exercised. Within a 30 s cap, check:
   - `/api/status` `version` = full.
   - The `started` line in `<tmp>\logs\tracker.log` says `channel: "prod"`.
   - `GET /` returns 200 from `release/app/web`.
   - The built web JS carries the prod channel literal and not the dev one.
   Then stop it through `stopTracker` (`scripts/stop.ts`), with a kill as fallback, and check `InternalName`
   with PowerShell `(Get-Item).VersionInfo`. If rcedit breaks the exe this step fails: drop rcedit and record
   why, as the map says.
7. Write `release/app/task.xml` from `taskTemplate()`.
8. ISCC `/DAppVersion=<full> /DAppNumericVersion=<numeric> /DSourceDir=... /O release`, plus `/DExeName`,
   `/DTrayExeName`, `/DDataDirName`, `/DTaskName` and `/DShortcutName`, all from `identity("prod")`. Output:
   `release/Grindlog-Setup-<full>.exe`.
9. At the end it prints the asset path and whether this is a prerelease, as `prerelease=true|false` on its own
   line, for the workflow.

### 4. Production `staticDir`
`staticDir(env, channel, execPath = process.execPath)`: prod is `join(dirname(execPath), "web")`. Dev is
unchanged, and `GRINDLOG_STATIC_DIR` still overrides both. TDD in `paths.test.ts`.

### 5. `installer/grindlog.iss`
- `[Setup]`:
  - Identity and version: a fixed `AppId` GUID, `AppName=Grindlog`, `AppVersion={#AppVersion}`,
    `VersionInfoVersion={#AppNumericVersion}.0`, `VersionInfoProductTextVersion={#AppVersion}`.
  - Install location and wizard: `PrivilegesRequired=lowest`, `DefaultDirName={autopf}\Grindlog`,
    `DisableDirPage=yes`, `DisableProgramGroupPage=yes`.
  - Requirements: `MinVersion=10.0.18362` (1903, for .NET 4.8) and `ArchitecturesAllowed=x64compatible`.
  - Icons, output and logging: `SetupIconFile` set to the favicon, `UninstallDisplayIcon`,
    `OutputBaseFilename=Grindlog-Setup-{#AppVersion}`, `SetupLogging=yes`.
  - `RestartApplications=no`, so Restart Manager never restarts a supervisor itself.
  - `AppPublisher=Grindlog` and a support URL.
  - No define named `Ver`.
- `[InstallDelete]`: `{app}\web`.
- `[Files]`, **all with `ignoreversion`**, so a rollback (an older installer) and an rc-to-final install with
  the same numeric version both replace the exes:
  - both exes
  - `web\*` (`recursesubdirs`)
  - `{srcexe}` → `{localappdata}\{#DataDirName}\update\previous\Grindlog-Setup.exe` (`external`)
  - `task.xml` (`dontcopy`)
- `[Icons]`: `{userprograms}\{#ShortcutName}` → `{app}\{#ExeName}` with `--open`. This closes the non-ASCII
  `.url` Watch item for friends.
- `PrepareToInstall`: if `{app}\{#ExeName}` exists, run it with `--quit` and wait. Log the exit code. A
  nonzero code is logged and the install goes on, with Inno's CloseApplications as the backstop. The updater
  stops the app itself and passes `/NOCLOSEAPPLICATIONS`.
- `CurStepChanged(ssPostInstall)`: run `schtasks /Query /TN {#TaskName}`. Only if the task is missing:
  extract `task.xml` and fill in `DOMAIN\user` (`GetEnv('USERDOMAIN')` + `GetUserNameString`),
  `{app}\{#ExeName}` and `{app}`, each XML-escaped. Save it as UTF-8 without a BOM and run `schtasks /Create
  /XML`. An existing task, enabled or disabled, is left alone. Every result is logged. A failed create shows
  a MsgBox when not silent, saying it won't start with Windows and the Start menu still works, and never
  aborts.
- `[Run]`: `Filename: {app}\{#ExeName}; Parameters: --open; Flags: nowait skipifsilent`.
- `[UninstallRun]`, in this order, each with `runhidden waituntilterminated` and a `RunOnceId`:
  - `Filename: {sys}\schtasks.exe; Parameters: /Delete /TN {#TaskName} /F`
  - `Filename: {app}\{#ExeName}; Parameters: --quit`
- `CurUninstallStepChanged(usPostUninstall)`: unless `UninstallSilent()`, ask "Also delete your match
  history?" with No as the default (`MB_DEFBUTTON2`). Yes runs `DelTree` on the data dir, with a MsgBox naming
  the folder if that fails. A silent uninstall keeps the data.

### 6. `.github/workflows/release.yml`
- Trigger, permissions and runner: `on: push: tags: ['v*']`, `permissions: contents: write`,
  `windows-latest`.
- Credentials: none beyond the automatic token.
- Actions are pinned to commit SHAs (found with `git ls-remote`).
- Steps:
  - checkout
  - setup-bun `1.4.3`
  - `bun install --frozen-lockfile`
  - `bunx playwright install chromium`
  - `bun run check`
  - `bun run e2e`
  - `bun run build-release --tag $env:TAG`, with `TAG: ${{ github.ref_name }}` passed through `env:`, never
    inlined.
  - `gh release create $env:TAG --draft --title "Grindlog $env:TAG" --notes "" <asset>`, adding
    `--prerelease` when `build-release` printed `prerelease=true`. This is pwsh, the default shell, and the
    step sets `env: GH_TOKEN: ${{ github.token }}`.
- e2e fallback, as in the map: if it's flaky on the runner, run `check` only and record why.

### 7. `scripts/sign-release.ts` (`bun run sign-release vX.Y.Z`)
1. `gh release view` must show a draft holding `installerName(full)`.
2. `gh release download` saves it to a temp dir, and its `ProductVersion` must equal full.
3. `minisign -S -m <file> -t "<trustedComment>"` runs with inherited stdio, for the password prompt.
4. `minisign -V -p minisign.pub -m <file>` checks it against the public key committed at the repo root.
5. It prints the trusted comment line from the `.minisig`, to record the `\thashed` behaviour.
6. `gh release upload <tag> <file>.minisig`.
7. It prints "publish the draft by hand".

Every step fails fast with a message.

### 8. Docs
- `docs/releasing.md`. One-time setup: gh plus `gh auth login`, scoop plus minisign, `minisign -G`, the key in
  the password manager plus one offline copy, and `minisign.pub` committed. Then each release: bump, commit,
  tag, push, wait for CI, `sign-release`, notes, publish.
- `PROJECT_INDEX.md` entries.
- BACKLOG: tick 5, and close the non-ASCII `.url` Watch item.
- A decision file only past the ADR gate.

## Error handling and logging
- Build scripts print each step. A failure names the step and quotes the tool's output (the `run` pattern
  from `autostart.ts`).
- The Inno setup log (`SetupLogging=yes`, in `%TEMP%`; the updater can pass `/LOG=`) answers four questions:
  did `--quit` succeed before the files were replaced (with its exit code), was the task found, created or
  failed, was data deleted at uninstall, and which version was installed.

## Steps
1. Copy this plan to `docs/plans/2026-11-11-wp5-installer-release.md`.
2. TDD for sections 1, 2 and 4. `bun run check` green.
3. `build-release.ts`, then `grindlog.iss`. Iterate a local build until the smoke run passes and the
   installer is written. *Offer `/compact`.*
4. Workflow and `sign-release.ts`.
5. Docs.
6. Verification, then `independent-review-pass`.

## Verification
- `bun run check` and `bun run e2e` locally.
- `bun run build-release` locally. The smoke run passes on version, prod channel in the log, `GET /`, the web
  prod literal and `InternalName`, and ISCC writes `release/Grindlog-Setup-0.1.0.exe`.
- **Clean standard account checklist.** The user runs it, never on their own account. It is the only test seam
  for the Pascal code, so each step names what it covers. I'll write it with exact commands:
  1. Manual install, no UAC (`[Setup]`). It lands in `%LOCALAPPDATA%\Programs\Grindlog`, the dashboard opens
     with no Dev badge (`[Run]`), the tray shows, and Start menu "Grindlog" opens the dashboard (`[Icons]`).
     `schtasks /Query /TN Grindlog` finds the task (ssPostInstall), and `update\previous\Grindlog-Setup.exe`
     exists.
  2. Manual reinstall over the running app: it quits first (PrepareToInstall, `--quit` in the setup log) and
     comes back.
  3. Silent update path: switch "Run at Windows startup" off, run `--quit`, then
     `Grindlog-Setup-0.1.1.exe /VERYSILENT /SUPPRESSMSGBOXES /NOCLOSEAPPLICATIONS` (a local 0.1.1 build).
     Expect exit 0, no dashboard opening, the task still disabled, the exe `FileVersion` at 0.1.1, and
     `previous\` holding 0.1.1.
  4. Downgrade (package 6's rollback): with 0.1.1 installed, run the 0.1.0 installer silently with the same
     flags. The exes' `FileVersion` goes back to 0.1.0 (`ignoreversion`), and `previous\` holds 0.1.0.
  5. Uninstall with No: data kept, task and shortcut gone (`[UninstallRun]`, the prompt). Reinstall, then
     uninstall with Yes: the data dir is gone. A `/VERYSILENT` uninstall keeps the data.
- CI: once the user pushes a `v0.1.0` tag, the workflow goes green and leaves a draft with one asset.
  `bun run sign-release v0.1.0` uploads a `.minisig` that `minisign -V` accepts. Publishing v0.1.0 is the
  user's call, since there's no updater yet.
- **User prerequisites before the CI check**: install `gh` (`winget install GitHub.cli`, `gh auth login`),
  scoop and `minisign`, run `minisign -G` and commit `minisign.pub`, and ideally rename the repo to `Grindlog`
  first.

## Plan review
plan-reviewer (opus), one pass. All findings accepted and folded in:
1. No `ignoreversion` broke rollback, rc-to-final installs and the `previous\` copy. Added it to every
   `[Files]` line, plus a downgrade step in Verification.
2. The web build would be dev, since Vite reads `GRINDLOG_CHANNEL` from the env. The build now sets it, and
   the smoke run checks the web literal.
3. A relative `--outDir` resolves against `src/web`. It's absolute now.
4. Verification lacked the silent and downgrade paths. Added both, with each checklist step named for the
   Pascal code it covers.
5. CI's `gh` lacked `GH_TOKEN`. Added; the tag goes through `env:`, and the prerelease flag is printed by
   `build-release`.
6. The smoke run overclaimed. It now checks channel from the `started` line, `GET /` (the prod
   `staticDir`), and a dummy `GRINDLOG_TASK`.
7. Dev deploys broke on a suffixed version. `--windows-version` now always uses the numeric part.
8. The prod shortcut name was stale. It's now `Grindlog.lnk` and passed to ISCC.
9. `\thashed` isn't verified. Package 6 accepts the comment with or without it, and `sign-release` prints the
   real line.
10. The `[UninstallRun]` syntax used `Filename`/`Parameters` loosely. Fixed.

## Implementation notes
- **rcedit pin**: the v2.0.0 release asset's `digest` is `null` (the release predates GitHub's digests). The pin is the
  SHA-256 of the download, `3e7801db…eade2a`, cross-checked against the identical `rcedit-x64.exe` that npm's
  `rcedit@5.0.0` bundles (npm's 3.1.0/4.0.1 bundle an older build). The cached copy is re-hashed on every use.
- **Found while building**: `compileArgs` put the building script's own `APP_NAME` in `--windows-title`, which is
  always "Grindlog Dev" since the script runs unbundled. The title now follows `description` (tested). The tray's
  `assemblyInfo` drops an `-rc` suffix too, so dev deploys keep working on a suffixed version.
- **Web channel check**: the minifier folds the define, so a prod bundle has no `dev` string literal and two `prod`
  ones; a dev bundle has one of each (compared on real builds). The smoke run checks that.
- `UninstallLogging=yes` was added, since `SetupLogging` covers only setup and the data-deletion question needs the
  uninstall log.
- First local `bun run build-release`: 34 s, smoke run passed, `release/Grindlog-Setup-0.1.0.exe` 34.4 MB; ISCC
  printed no warnings. Failure paths fired once: tag mismatch, ISCC missing, `--tag` with no value; `sign-release`
  with a bad tag, with `minisign.pub` missing, and with `gh` not on PATH.
- Verification run (2026-11-11): `bun run check` 1486 passed, 1 skipped; `bun run e2e` 106 passed (4.7 min).
  `build-release` passed for 0.1.0, 0.1.1 and `0.1.1-rc.1 --tag v0.1.1-rc.1` (`prerelease=true`; installer
  ProductVersion `0.1.1-rc.1`, FileVersion `0.1.1.0`). `release/` and `.cache/` are ignored by eslint too.

## Clean standard account checklist
Run on a fresh standard (non-admin) Windows account, never the developer's own. It's the only test of the Pascal
code. Copy `Grindlog-Setup-0.1.0.exe` and `Grindlog-Setup-0.1.1.exe` there first (both built locally into the
gitignored `.cache/checklist/` on 2026-11-11; the 0.1.1 one from a temporary version bump). PowerShell commands:

1. **Manual install** (`[Setup]`, `[Run]`, `[Icons]`, `ssPostInstall`, `[Files]`): run the 0.1.0 installer.
   - No UAC prompt. It lands in `$env:LOCALAPPDATA\Programs\Grindlog`.
   - The dashboard opens with no Dev badge, and the tray icon shows.
   - Close the browser tab, then Start menu "Grindlog" opens the dashboard again.
   - `schtasks /Query /TN Grindlog` lists the task.
   - `Test-Path "$env:LOCALAPPDATA\Grindlog\update\previous\Grindlog-Setup.exe"` is True.
2. **Reinstall over the running app** (`PrepareToInstall`): run the 0.1.0 installer again with the app running.
   - It finishes with no "files in use" prompt, and the dashboard comes back.
   - The newest `$env:TEMP\Setup Log*.txt` has a `grindlog.exe --quit exited 0.` line and `Logon task Grindlog found`.
3. **Silent update path** (the updater's flags):
   - Switch "Run at Windows startup" off in the dashboard's settings, then
     `& "$env:LOCALAPPDATA\Programs\Grindlog\grindlog.exe" --quit`.
   - `$p = Start-Process .\Grindlog-Setup-0.1.1.exe '/VERYSILENT /SUPPRESSMSGBOXES /NOCLOSEAPPLICATIONS' -Wait -PassThru; $p.ExitCode`
     prints 0, and no dashboard opens.
   - `schtasks /Query /TN Grindlog` shows `Disabled`.
   - `(Get-Item "$env:LOCALAPPDATA\Programs\Grindlog\grindlog.exe").VersionInfo.FileVersion` is `0.1.1.0`.
   - `(Get-Item "$env:LOCALAPPDATA\Grindlog\update\previous\Grindlog-Setup.exe").VersionInfo.ProductVersion` is `0.1.1`.
4. **Downgrade** (package 6's rollback, `ignoreversion`): the same `Start-Process` line with `.\Grindlog-Setup-0.1.0.exe`.
   Exit 0; both `grindlog.exe` and `grindlog-tray.exe` FileVersion back to `0.1.0.0`; `previous\` ProductVersion `0.1.0`.
5. **Uninstall** (`[UninstallRun]`, `CurUninstallStepChanged`):
   - Settings > Apps > Grindlog > Uninstall, and answer **No** (the default button). `$env:LOCALAPPDATA\Grindlog` is
     still there with `tracker.db`; `schtasks /Query /TN Grindlog` says it can't find it; the Start menu entry and
     `$env:LOCALAPPDATA\Programs\Grindlog` are gone; no `grindlog*` process in Task Manager.
   - Install 0.1.0 again, uninstall, answer **Yes**: `$env:LOCALAPPDATA\Grindlog` is gone.
   - Install again, then `& "$env:LOCALAPPDATA\Programs\Grindlog\unins000.exe" /VERYSILENT`: no prompt, and
     `$env:LOCALAPPDATA\Grindlog` is kept.
6. Afterwards delete the test account.

## Review log

### Round 1 (code-review high, arch-reviewer opus, security-reviewer)
- security: no findings. Hardening taken: `persist-credentials: false` on checkout; `sign-release` refuses a tag whose
  commit isn't on `origin/master`. [Fixed]
- `sign-release.ts:3` doc-pointer comment (arch, code-review). [Fixed]
- `.iss` logs "Data kept" when there's no data dir (arch). [Fixed]
- `StepFailed`/`run`/`step` copied into three scripts, already diverging; the PowerShell VersionInfo read copied
  twice (arch, code-review). Moved into `scripts/steps.ts` for the two new scripts; `autostart.ts` left as is. [Fixed]
- `build-release`'s `run` doesn't catch a program that can't start (code-review). Closed by `steps.ts`. [Fixed]
- `startedLine`'s `JSON.parse` unguarded (arch, code-review). [Fixed]
- Stray blank line in `build-release.test.ts` (arch). [Fixed]
- Smoke-run fetches have no timeout, and the job has no `timeout-minutes` (code-review). [Fixed]
- Re-running `sign-release` fails at upload after the password prompt (code-review). [Fixed]
- Re-running the workflow for a tag fails on the existing draft (code-review). [Fixed]
- `PROJECT_INDEX.md` still says no script builds prod (code-review). [Fixed]
- `staticDir` could use "web beside the exe" for dev too (code-review). [Disputed]: the plan keeps dev as it is, and
  a source run's exe is `bun.exe`, so the shared rule would point it at Bun's folder.
- simplify (reuse, simplification, efficiency, altitude): applied: `TrayBuildFailed`/`RceditFailed` extend
  `StepFailed` (build-release's two re-wrap catches gone), InternalName computed once for set and check, the smoke
  poll loop without a null sentinel, rcedit's download without the self-rethrow, `versionFromTag` throws `StepFailed`
  directly, `sign-release`'s `main` reads argv itself, `freePort` reused from `src/server/testing.ts`. Skipped:
  moving `autostart.ts` onto `steps.ts` (outside this change), `staticDir` in `Identity` (the disputed topic), a
  channel meta tag in the web build (changes the app for a build check), merging `run`/`runInteractive`, narrowing
  `rceditArgs`, dropping the `.minisig` replace log, exporting `notifier.ts`'s `psQuote` (would load runtime
  modules into a build script for a one-line escape), parallel build steps (release-only script).
- After the fixes: `bun run check` 1486 passed; `build-release` passed for 0.1.0 and 0.1.1 (rebuilt into
  `.cache/checklist/`); failure paths fired: ISCC not executable ("could not start"), `sign-release` tag fetch
  for a tag not on the remote.

### Round 2 (delta `git diff 3a416eb`: correctness-reviewer, security-reviewer)
- security: no findings.
- correctness: `freePort` from `testing.ts` throws a plain `Error` when the probe has no port (nit).
  [Verified, no fix needed]: a TCP `Bun.serve` always has a port, so it's unreachable.
- Done: a round with no new finding. 2 rounds, 13 fixed, 1 disputed, 0 deferred.

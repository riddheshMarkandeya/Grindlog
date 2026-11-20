# Sharp Grindlog icons in Start, search and the tray (ships in 0.1.6)

## Context
The user reported that the Grindlog and Grindlog Dev icons look blurry in the Start menu and search, and that tray
icons go slightly soft at 150 % and 175 %. They asked for the fix to ride in the 0.1.6 release. The release prep
(version bump and CHANGELOG `[0.1.6]` heading) is uncommitted in the working tree. `bun run check` (1928 tests)
and e2e (143) pass, and nothing is tagged yet.

**Root cause (measured):** Bun 1.4.3's `--windows-icon` leaves two `RT_GROUP_ICON`s in the exe, both in
language 1033:
- Bun's own `IDI_MYICON`: one entry that says 256 × 256 and points at `RT_ICON` 1. Bun has overwritten that
  icon with our **16 px** frame.
- `#0`: our full set (16, 24, 32, 48, 64, 128, 256), whose icons 1..7 are correct.

Windows uses the first group (named entries sort first), so Start, search, Explorer and toasts scale one 16 px
image up to every size. Both installed exes show it. The csc-built tray exes are fine. Upstream: oven-sh/bun
issue 32428 ("only the first icon in the .ico is embedded"), still open. 1.4.5, the latest Bun, has no fix.
rcedit `--set-icon` rewrites `#0`, leaves `IDI_MYICON` first, and changes nothing.

The metric below is the mean pixel difference between the shell render (`IShellItemImageFactory`) and an
exact-size render of `icon.svg`, on a 0–255 scale. It is 14–17 at every size today. With the icon group fixed
(probed with `UpdateResource` on a copy) it is **0.0 at 32/48/64**, 1.3–2.3 between frames and 0.1–0.2 at
56–80, and the copy boots. Putting the 256 frame first (the workaround in the issue) gives 2.7–4.9 at 16–32,
loses the hand-hinted 16/24 design, and is rejected.

**Tray:** `Tray.cs` loads its state icons once, at `SystemInformation.SmallIconSize`, which is the process's
system DPI, fixed when the tray starts. The tray starts at sign-in, so it never sees a live scale change, and
Explorer stretches the old size. The display is at 125 % now (20 px, an exact frame), so it looks fine. The
tray .ico also has no 28 px (175 %) or 36 px (225 %) frame.

## Approach

**Order:**
1. Probe the repoint on a temp copy of the prod exe with the scratch shell-render loop
   (`$CLAUDE_JOB_DIR/tmp/shellicons.ps1` and `compare.ts`).
2. Write the exe-icon tests (red), then the module (green).
3. Wire up the callers.
4. Add the frames and measure them.
5. Tray tests, then the tray change.
6. Records.
7. Verification.
8. Review (`independent-review-pass`), then the release.

### 1. `scripts/exe-icon.ts`: repoint the stray group (pure TS, no Win32 calls)
Bun's `#0` group is already right. The fix makes the first group resolve to it, by pointing `IDI_MYICON`'s
name-directory entry at `#0`'s language subdirectory: 4 bytes, written in place. Nothing grows, no sections move,
and no 96 MB rewrite happens.

Pure, unit-tested:
- `parseIco(bytes)`: the frames (size, image bytes), the inverse of `packIco` in `scripts/make-icons.ts`.
- `readIconResources(pe)`: find the resource directory through `DataDirectory[2]`, not the section name, and
  map RVAs to file offsets through its section. Walk the `RT_GROUP_ICON` (14) and `RT_ICON` (3) subtrees. Return
  the groups in directory order (name or id, the file offset of the name-entry's `OffsetToData`, the
  subdirectory offset, the language, entries with declared size and icon id), and every icon's real width
  (from the PNG IHDR or the BMP header).
- `planIconFix(resources, frames)`, which returns one of:
  - `{ kind: "ok" }`: the first group's entries match the .ico, and each real size equals its declared size;
  - `{ kind: "repoint", from, to, offset, value }`: a later group matches;
  - `{ kind: "unfixable", reason }`: a sentence naming what's wrong.
- `iconIssue(resources, frames)`: `null` when the plan is `ok`, else the sentence. Used by the read-backs.

Live:
- `fixExeIcon(exe, ico)`: read, plan, write the 4 bytes at `offset` (open `r+`), read back, and throw
  `StepFailed` if `iconIssue` isn't `null`.
- It prints what it found and did. Either "first group IDI_MYICON (1 entry: declares 256, really 16) →
  repointed to #0 (7 frames)", or "already right: first group #N matches". That line is how a future Bun fix
  will show.
- `unfixable` throws `StepFailed`. Opening is retried for ~10 s on EBUSY/EPERM/EACCES, because antivirus holds a
  fresh exe. That retry moves out of `replace()` in `scripts/autostart.ts` into one helper in
  `scripts/steps.ts`, used by both.

If the step-1 probe shows the shell doesn't honour the repoint, stop and re-plan with the `UpdateResource`
route. That route is probe-proven, but needs a safe copy and a section-layout check.

### 2. Callers
- `scripts/build-release.ts`: a new `Icon` step right after `Exe` runs `fixExeIcon(exe, EXE_ICON)`; a failure is
  fatal. The smoke step re-checks `iconIssue` after rcedit, beside the `InternalName` and `LegalCopyright`
  read-backs. rcedit re-enumerates and rewrites every resource, so this proves the fix survives it.
- `scripts/autostart.ts` (dev install): `fixExeIcon(fresh, EXE_ICON)` after the compile. A failure warns and
  continues, the way a failed tray build does: the patch only touches the icon subtree, and recording matters more.

### 3. More frames, kept only if measured to help
- `make-icons.ts` `SIZES`: add 20 (small design), then 30, 36, 40, 60, 72, 80 and 96 (master). Microsoft's app
  icon construction page lists 16, 20, 24, 30, 32, 36 and 40 as the App List targets, and says Windows scales
  down from the next larger frame. 60–96 cover the larger surfaces at 125–200 %; that part is not confirmed by
  Microsoft. Regenerate both favicons with `bun run icons`.
- Keep the extra exe frames only if the phase-1 loop shows the shell render improving at 20/30/40/60/80.
- `TRAY_SIZES`: add 28 and 36. Fix the comment above it ("16 and 32 px frames at 100/125/150 %").

### 4. Tray follows the current scale (`src/tray/Tray.cs`)
- `SmallIconPx()`: the primary monitor's effective DPI (`shcore!GetDpiForMonitor` on
  `MonitorFromPoint(0,0, MONITOR_DEFAULTTOPRIMARY)`; the notification area lives on the primary taskbar), then
  `user32!GetSystemMetricsForDpi(SM_CXSMICON, dpi)`. If either call fails, fall back to
  `SystemInformation.SmallIconSize`.
- `LoadIcons(px)` replaces the one-shot fill. The size check goes **first** in `Apply` (UI thread, every ~2 s),
  ahead of the early returns for failed, starting and bad polls. When the size changed: reload, re-set
  `icon.Icon` to the shown state, and dispose the old icons.
- Log `icons_loaded {px, dpi, source: "monitor"|"fallback", reason: "start"|"scale_changed"}`. It answers: what
  size the tray loaded, at which DPI and from which source, and whether a scale change reached it.
- Replace the stale "SmallIconSize follows the display scale" comment.

### 5. Records
- CHANGELOG `[0.1.6]` Fixed: "Grindlog's icon is sharp in Start, search and Explorer; it was a 16 px image
  scaled up. The tray icon stays sharp when you change the display scale."
- `docs/releasing.md`: the smoke-run list gains "the exe's icon".
- `PROJECT_INDEX.md`: `exe-icon.ts` in the scripts line, and the Icon step in the build-release step list
  (lines 84–87).
- Release map row 5: the icon fix ships in 0.1.6.
- Commit body: the confirmed cause and the upstream issue.

## Tests (TDD: red first)
- `scripts/exe-icon.test.ts`:
  - `parseIco` round-trips with `packIco`.
  - `planIconFix` and `iconIssue` with literal resource lists:
    - ok;
    - Bun's layout, which plans a repoint to `#0` at the right offset;
    - declared 256 but really 16 with no good group, which is unfixable;
    - a missing frame;
    - each with the right sentence.
  - Integration (Windows only, CI included; explicit timeout ~60 s):
    - compile a one-line entry through `compileArgs` (`scripts/build-exe.ts`) with `favicon.ico` into a temp dir;
    - `fixExeIcon`;
    - then `iconIssue` is `null`, the first group's sizes equal the .ico's, the exe runs and prints its line, and
      a second `fixExeIcon` reports "already right";
    - red before step 1 exists. The temp dir (~96 MB) is deleted after.
  - A cheap failure case: a nonexistent exe throws `StepFailed` naming the path.
- `src/tray/tray.test.ts:117-118`: the event list becomes started, icons_loaded, view, stdin_closed. Assert
  `icons_loaded` has `reason: "start"`, `source: "monitor"`, `dpi >= 96` and `px === Math.round(16 * dpi / 96)`.
  Only the live scale switch stays manual.
- `scripts/make-icons.test.ts`: the tray sizes include 28 and 36.

## Verification
1. `bun run check` and `bun run e2e`.
2. `bun run build-release`: the Icon step prints the repoint, and the read-back passes after rcedit.
3. The phase-1 loop (scratch scripts) on `release/app/grindlog.exe`: the shell render diff is ~0, against 14–17
   before.
4. **Upgrade path:** prod has the local 0.1.5 build. Run `release/Grindlog-Setup-0.1.6.exe` over it, with no
   `ie4uinit`, and look at Start and search. Dev: `bun run install-autostart`. If Start keeps the old icon, add
   `ChangesAssociations=yes` to `installer/grindlog.iss` and re-test. The real updater path follows once
   0.1.6 is published.
5. Tray: the user switches 125 → 150 → 175 % live. `tray.log` shows `icons_loaded` with px 24 and then 28
   (`scale_changed`) within ~2 s, and the icon looks sharp.
6. Then the release continues: commit, tag `v0.1.6`, the user pushes, CI, the user runs `sign-release`, publish.

## Plan review
plan-reviewer (opus), round 1. All findings folded in:
1. The dev path could install a half-rewritten exe → moot. The repoint is a 4-byte in-place write that touches
   only the icon subtree, and the integration test boots the result.
2. The section-layout risk after `EndUpdateResource` → moot with the repoint, since nothing moves. It applies
   only if the fallback route is taken.
3. `tray.test.ts:117-118` would break, and is the missing seam → the test now asserts `icons_loaded`.
4. Simpler option: repoint `IDI_MYICON` in place → adopted as the primary approach.
5. The upgrade path was untested, and `ie4uinit` was the only fallback → install the 0.1.6 Setup over 0.1.5
   prod without it; `ChangesAssociations=yes` if needed.
6. The scale check has to come before `Apply`'s early returns → placed first.
7. Antivirus can lock a fresh exe → a shared ~10 s retry helper in `steps.ts`.
8. Integration test details → compiles through `compileArgs`, has an explicit timeout, plus a failure case.
9. Two decision points weren't logged → the icon fix prints found and done, and `icons_loaded` has `source`.
10. Stale `make-icons.ts:24` comment, the PROJECT_INDEX step list, and system DPI being per-process (not
    per-sign-in) → all fixed. The design is unchanged.

## Results (2026-11-19)
- **Probe (step 1):** the 4-byte repoint on a copy of the installed 0.1.5 prod exe gives the first group all 7 frames
  (16–256, real sizes matching). The shell render diff is 0.0 at 32/48, 0.1–0.2 at 56–80 and 1.3–2.3 between
  frames, and the copy boots (`/api/status` 200). The shell honours the repoint, so the `UpdateResource` route
  wasn't needed. `fixExeIcon` on another copy changes one byte (0x70 → 0x88, the low byte of the field at
  0-based offset 95911564; `cmp` counts it as byte 95911565). `IDI_MYICON` now points at offset 392, `#0`'s
  language directory, and a second run says "already right".
- **Frames (step 3):** a 15-frame favicon (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256) left the
  shell render unchanged at every measured size (20: 1.7, 30: 2.3, 36: 1.3, 40: 1.5, 60: 0.2, 72: 0.1, 80: 0.2,
  the same as with 7 frames). Only `PrivateExtractIcons` used the new frames. So, by the plan's rule, the exe
  frames were dropped and `favicon.ico` is unchanged. Also, at 20 and 24 the shell draws from the 32 px master
  frame, not the 24 px small design. The tray `.ico`s gained 28 and 36.
- **Implementation notes:** `scripts/autostart.ts` had its own `StepFailed` class. It now uses `steps.ts`'s, so
  its handlers catch `fixExeIcon`'s failures. `retryWhileLocked` reuses `LOCKED` from `src/server/fs-retry.ts`
  (now exported). `steps.ts` joins the PROJECT_INDEX scripts line. Tray lines go to `supervisor.log` (category
  `tray`), not to a `tray.log`. Review changes to the design above: `parseIco` returns frame sizes only (nothing
  read the image bytes), and `IconGroup` has no language (nothing read it). The tray also logs `dpi_unavailable` and
  `dpi_available`, once per transition. They answer whether the monitor DPI read failed and when it came back; a
  failed read keeps the loaded icons.
- **Verification:**
  - `bun run check`: 1938 passed (10 new in `exe-icon.test.ts`). After review: 1942 (11 in `exe-icon.test.ts`, 2 in
    the new `steps.test.ts`).
  - `bun run e2e`: 143 passed.
  - `bun run build-release`: the Icon step printed "first group IDI_MYICON (1 entry: declares 256, really 16) →
    repointed to #0 (7 entries: 16, 24, 32, 48, 64, 128, 256)", and the read-back after rcedit passed.
  - `release/app/grindlog.exe` through the shell loop: the same numbers as the probe, against 14–17 before.
- **Upgrade path:** `Grindlog-Setup-0.1.6.exe /VERYSILENT` over prod 0.1.5, with no `ie4uinit`. Afterwards the Start
  shortcut and the installed exe render sharp through the shell, with the same numbers. `ChangesAssociations` isn't
  needed.
  - Dev (`bun run install-autostart`): its Icon line shows the repoint, and the dev shortcut is 0.0 at 32/48
    against the teal master.
  - Both trays logged `icons_loaded {px: 20, dpi: 120, source: "monitor", reason: "start"}` (125 %).
- **Flake found:** `tray.test.ts` "goes red within ~5 s" failed 3 of 10 full `bun run test` runs with this change
  (7.6–8.3 s against 6.5 s). With the change stashed it failed 1 of 5 at `9a0fccf`, so it was already there, and
  it passes alone every time. Logged in BACKLOG.
- **Manual checks (user, after review):** passed. Start and both trays look sharp. A live scale change 125 → 150 → 175 →
  125 % logged `icons_loaded` `scale_changed` at px 20 → 24 → 28 → 20 (dpi 120/144/168) in both the prod and dev
  trays' `supervisor.log`, with no `dpi_unavailable`.

## Review log
Snapshot for re-rounds: `0c69be07898a360eee8d7b05e7fa30c0c5202671` (`git stash create` of the reviewed state).

**Round 1** (Substantial: ~320 non-test lines and a new module). Passes: `/code-review high`, arch-reviewer (opus),
security-reviewer, `/simplify`.
- security: no findings. Its aside, an uncaught `DllNotFoundException` before Windows 8.1, can't happen (the floor is
  10 1903). [Verified, no fix needed]
- code-review:
  1. `autostart.ts`: a non-`StepFailed` parse error would abort the dev install. [Verified, no fix needed] Same
     convention as the tray build (only `TrayBuildFailed` is caught). Such an error is a bug, and it lands before the
     old tracker is stopped, so recording goes on.
  2. `exe-icon.ts` `fileOffset`: a data RVA outside the resource section gives a negative offset, and `subarray`
     then reads from the file's end. [Fixed] It throws `IconFormatError`, and the Watch list item covers a new
     layout.
  3. `build-release.ts`: the fix runs before rcedit and is only checked after it. [Verified, no fix needed] rcedit is
     pinned (v2.0.0, SHA-256), so a change would be a deliberate bump, and the read-back fails it loudly with the
     sentence.
  4. `Tray.cs`: the `EntryPointNotFoundException` catch handles a state that can't occur (the floor is 10 1903,
     `MinVersion=10.0.18362`). [Fixed] Removed.
  5. `steps.ts` `retryWhileLocked` retried silently. [Fixed] It takes a `what` label and prints one line after a
     retried success.
  6. `Tray.cs`: an intermittent DPI failure would flip the icons between the fallback and monitor sizes. [Fixed]
     Only a monitor reading reloads, and `dpi_unavailable`/`dpi_available` log each transition once.
- arch:
  1. (important) the PROJECT_INDEX Plans list was missing this plan. [Fixed]
  2. The BACKLOG flake wording overclaimed. [Fixed] It now says the compile test may add load, and lists a second
     lead.
  3. No Watch item for removing the workaround. [Fixed] Trigger: "already right", or a new layout.
  4. Release map row 5 had no plan pointer. [Fixed]
  5. The Results byte offset didn't match the fixture. [Fixed] It is `cmp`'s 1-based count of the field's low byte at
     0-based 95911564.
  6. `build-release.ts` hard-coded "favicon.ico". [Fixed] It uses `basename(EXE_ICON)`.
  7. `IconGroup.language` was never read. [Fixed] Dropped.
  8. Duplicate of code-review 5. [Fixed]
  9. `steps.ts` is now more than a release step runner. [Fixed] Its header now says release and install scripts;
     `retryWhileLocked` stays there (the plan names `steps.ts`, and `fs-retry.ts` is sync and logger-based runtime
     code).
  10. Duplicate of code-review 4. [Fixed]
- `/simplify` (4 angles):
  - Applied:
    - `parseIco` returns sizes only. `IcoFrame.data`, its copy and the frame bounds check go: nothing read them.
    - `parseIco` uses `ICO_HEADER_BYTES`/`ICO_ENTRY_BYTES`, now exported from `make-icons.ts`.
    - `fixExeIcon` re-checks with the frames it already parsed, rather than re-reading the .ico.
    - Tray.cs `IconSize.Source` (a string compared in two places) is now `bool FromMonitor`. `dpiUnavailable` starts
      false and the first poll logs a failure, so the duplicated init is gone.
  - Skipped:
    - Merging `retryWhileLocked` with `renameRetry`, and `move-data.ts`'s own `LOCKED` and loop: outside the diff,
      and `renameRetry` is sync code used inside synchronous storage opening.
    - `DisplaySettingsChanged` instead of polling: the plan chose polling, and its cost is trivial.
    - Inlining `iconIssue` (the plan names it, the tests use it); dropping `repoint.reason` (`iconIssue` uses it).
    - An `assertExeIcon` helper, `StepFailed` inside the retry helper, and a `LoadAll` split: marginal, and their
      contexts differ.
    - Efficiency: three 96 MB reads per build and three P/Invokes per 2 s poll are negligible.

**Round 2** (delta from the snapshot). Passes: correctness-reviewer, arch-reviewer (sonnet), security-reviewer.
- correctness: no findings. Every round-1 `[Fixed]` closes with no regression.
- security: no findings.
- arch (4 nits):
  1. The plan's design bullets still say `parseIco` returns image bytes and `IconGroup` has a language. [Fixed]
     Results records both as review changes.
  2. The logging bullet doesn't name `dpi_unavailable`/`dpi_available`. [Fixed] Results says what each answers.
  3. The `fileOffset` guard had no unit test. [Fixed] `tinyPe` builds a minimal PE32+ by hand, which also gives
     `readIconResources` a test that doesn't need Windows.
  4. `retryWhileLocked` had no test. [Fixed] New `scripts/steps.test.ts`: a held file retries and prints its line;
     any other error is rethrown at once with no line.
- Full suite: 1938 passed. The other run that delta produced failed only the known BACKLOG tray flake (8317 ms).
  Snapshot for round 3: `f1e7e2f079b77cf5370c482c638e1ac3b2e3bb0b`; the round-2 fixes are tests and docs only.

**Round 3** (delta from round 2's snapshot). Passes: correctness-reviewer, arch-reviewer (sonnet). No bugs; every
round-2 fix closes. Nits only, so the review is done:
- arch: the Results test count was stale. [Fixed] Updated to 1942.
- correctness: `tinyPe` covers only the PE32+ and bitmap-width paths. [Verified, no fix needed] The Windows
  integration test reads a real Bun exe, which runs the PNG-width and group-parsing paths. Bun only emits PE32+, and
  the PE32 offset is one ternary.
- correctness: `steps.test.ts` needs `Bun.sleep`. [Verified, no fix needed] The suite always runs under `bun --bun`.
- Full suite after round 3: 1942 passed, 1 skipped; typecheck and lint clean.

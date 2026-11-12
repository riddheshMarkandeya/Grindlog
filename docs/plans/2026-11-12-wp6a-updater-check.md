# WP6a: updater check, download and verify (friends release step 4, package 6, part a)

Tier: Substantial. Repo copy: `docs/plans/2026-11-12-wp6a-updater-check.md` (step 1). WP6b (apply, health
check, rollback) gets its own plan in its own session.

## Context
Friends only get a build once auto-update works (map "Who gets what"). Package 6 is the map's whole "Updater
design" (`docs/plans/2026-11-06-distribution-map.md:150-206`). It's too big for one session, so it splits like
WP2 and WP3 (user, 2026-11-12):
- **6a (this plan)** ends at "a verified installer is ready, and the user's choice is recorded". That covers
  version compare, the minisign verifier, the feed plus `GRINDLOG_UPDATE_FEED`, download, the shared state
  file, the supervisor's check loop, the tracker's update endpoint, the auto-apply choice, the tray and dashboard
  lines, and the antivirus backup-rename retry fold-in. The retry helper is born here, so the fold-in moved
  from 6b to 6a.
- **6b** covers `--update` mode, the apply gate, apply, health check, rollback, the raw.db pre-migration backup,
  the free-space check, interrupted updates, and `updater.log`.

Facts from the code:
- The supervisor (`src/server/supervisor.ts`) has no timers today. `superviseSelf` (`:356`) builds the logger
  (`supervisor.log`) and the tray command, then runs `runSupervisor`. All its dependencies are injectable.
- `grindlog.ts` `mode()` routes the flags. 6a adds no flag.
- `paths.ts` has `dataDir`, `logsDir` and `identity()`, but no update dir.
- `VERSION` (`src/shared/version.ts`) is null in dev. `CHANNEL` comes from a define.
- `src/shared/release.ts` has `parseReleaseVersion`, `installerName` and `trustedComment`, but no compare.
- `/api/status` (`main.ts:156`) gives `connection` (`waiting|connected|recording`), `version` and `pid`.
- Routes live in a table in `src/server/api/index.ts`. Writes need `X-Grindlog-Request: 1` (`:343`).
- The tray view is `src/server/tray-view.ts`. Lines are `{text, url?}`.
- `Tray.cs` `ViewUrl` (`:303`) opens only `/...` paths. wp3b left "a fixed https url" to package 6.
- `trayCmd` (`supervisor.ts:59`) builds the tray's args.
- `backup.ts:61` `renameSync(partial, path)` has no retry. That is the BACKLOG Watch antivirus item
  (`BACKLOG.md:268`). Retry patterns already exist in `scripts/move-data.ts:113` and `scripts/autostart.ts:122`.
- The research note (`docs/research/2026-11-06-installer-updater.md:26-28`) says three things about the feed.
  `releases/latest` skips drafts and prereleases. Anonymous calls are limited to 60/h. Send `If-None-Match`.
- `minisign.pub` isn't committed yet, and minisign isn't on this PC (see Prerequisites).

## Prerequisites (user, before step 2)
- Install scoop and minisign (`scoop install minisign`), which `sign-release` needs anyway.
- Run `minisign -G -p minisign.pub` and commit `minisign.pub` (`docs/releasing.md:10-15`). It is **required
  before the next tag**, since CI's `build-release` will refuse to build without it (section 7). 6a's tests
  don't need it, and the local rehearsal build uses `--update-key` with the test key.
- **No release tag between 6a and 6b.** A 6a build can download but not apply, so its users would have to
  reinstall by hand. The Install button and tray line write a request that only 6b reads. This rule goes on the
  BACKLOG 6b item too.

## Approach

### 1. Shared release facts: `src/shared/release.ts` (pure, TDD)
- `compareNumeric(a, b)` compares the `x.y.z` parts and returns -1, 0 or 1.
- `parseTrustedComment(line)` matches `^version=(\S+) file=(\S+)(\thashed)?$` and returns `{version, file}` or
  null. It accepts the WP5 contract with or without minisign's `\thashed`, and nothing else.
- `UPDATE_REPO = "riddheshMarkandeya/Grindlog"` (the map renames the repo before the first release).
  - `RELEASES_API` is `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`.
  - `RELEASE_PAGE_PREFIX` is `https://github.com/${UPDATE_REPO}/releases/tag/`.
- `src/shared/update-key.ts`: `UPDATE_KEY: string | null` reads a `GRINDLOG_UPDATE_KEY` define, in the same
  pattern as `version.ts`. It is null in dev and source runs.

### 2. Minisign verifier: `src/server/update/minisign.ts` (pure, TDD on real fixtures)
`verifyMinisign({ publicKey, signature, file }): { ok: true, trustedComment } | { ok: false, reason }`. It uses
`node:crypto` only. The rules follow minisign's documented format:
- Public key: base64 of `"Ed"` + an 8-byte key id + a 32-byte Ed25519 key. It is turned into a KeyObject
  through JWK (`kty: "OKP", crv: "Ed25519"`).
- `.minisig`: 4 lines.
  - Line 1 is `untrusted comment:`, ignored.
  - Line 2 is base64 of a 2-byte algorithm (`"ED"` prehashed, `"Ed"` legacy) + the key id + a 64-byte signature.
  - Line 3 is `trusted comment: <text>`.
  - Line 4 is base64 of a 64-byte global signature.
- Checks, each with its own `reason`:
  - `malformed`: wrong line count, prefixes, base64 or lengths.
  - `unknown_algorithm`.
  - `key_mismatch`: the key id differs.
  - `bad_signature`: Ed25519 over `BLAKE2b-512(file)` for `ED`, or over the raw file for `Ed`, fails.
  - `bad_comment_signature`: Ed25519 over `signature ‖ trustedCommentBytes` fails.
- Fixtures go in `src/server/update/fixtures/`. All are made with the real minisign CLI and a throwaway
  passwordless test key (`minisign -G -W`), with no hand edits. Files:
  - `test.pub`, `other.pub`, `payload.bin` (a few KB).
  - `payload.prehashed.minisig`, signed with `-t "version=9.9.9 file=Grindlog-Setup-9.9.9.exe"`.
  - `payload.hashed-suffix.minisig`, signed with `-t` set to the same text plus a literal tab and `hashed`. This
    covers both comment forms whichever one the CLI really appends.
  - `payload.legacy.minisig`, signed with `-l`.

  Tests cover both algorithms, a flipped byte in the file, the comment or each signature, `other.pub`, and
  malformed inputs. Implementation notes record what line 3 really holds after a plain `-t` sign.

### 3. Shared state: `src/server/update/state.ts` (TDD on a temp dir)
`updateDir(env, channel)` is `dataDir/update`, added to `paths.ts`. It holds two files, each with one writer, so
the supervisor and the tracker never race on a file:
- `state.json`, written by the supervisor (6b's updater also writes it): `{ v: 1, checkedAt, lastOutcome:
  "up_to_date"|"downloaded"|"skipped"|"error", lastError?, etag?, available?: { version, file, verifiedAt },
  skipped: [{ version, reason }] }`.
  - 6b adds its own phase fields under the same `v`.
  - Rollback runs older code against a newer file, so the schemas ignore unknown fields (never `.strict()`).
    A rewrite merges into the fields it read, so a 6b field survives a 6a writer. Each rule gets a test.
  - The page URL isn't stored. It is always built as `RELEASE_PAGE_PREFIX + "v" + version`.
- `request.json`, written by the tracker: `{ v: 1, autoApply: boolean, install?: version }`. Auto-apply lives
  only here, not in the settings table, so it has one source. That way a crash-looping tracker's supervisor
  still knows the last choice. A missing file means `autoApply: true`.

Behaviour:
- Zod schemas sit beside the files.
- `readState` and `readRequest` return a parsed value, or a default with one `update/state_unreadable` warn per
  process for a corrupt file. A missing file is normal and isn't logged.
- `writeJsonAtomic(path, value)` writes `path.tmp` and then calls `renameRetry`.

### 4. `renameRetry`: `src/server/fs-retry.ts` (TDD) plus the fold-in
- `renameRetry(from, to, { logger, timeoutMs = 2000, sleepSync = Bun.sleepSync })` retries on
  `EPERM`/`EBUSY`/`EACCES` every 100 ms until the timeout. Then it rethrows the last error.
  - It is **synchronous**, because `backupTracker` (`backup.ts:51`) and its callers (`storage.ts:77` at startup,
    `backup.ts:139`) are synchronous. The sleep is injectable for tests.
  - It logs `fs/rename_retried {to, tries, code}` once when it succeeded after retrying. That is the trail the
    Watch item asked for.
- `backup.ts:61` uses it, tested in `backup.test.ts` with a rename that fails twice. The BACKLOG Watch item is
  closed ("fixed in WP6a").
- The two scripts keep their own loops, since that code isn't otherwise touched (§1).

### 5. Feed and download: `src/server/update/feed.ts`, `download.ts` (pure parts TDD)
- `feedSource(env)`:
  - With no `GRINDLOG_UPDATE_FEED`, it is GitHub `RELEASES_API`.
  - An `http(s)://` override is fetched as the same releases JSON.
  - Any other value is a folder holding `latest.json` in the same shape. Its asset urls must be bare file names
    resolved inside that folder, and names with path separators or `..` are refused.
  - Signing still applies to every source, so the override can't bypass it.
- `fetchLatest(source, { etag, fetch })` sends `User-Agent: Grindlog-updater`, `Accept:
  application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and `If-None-Match` when it has an etag. It
  uses a 30 s timeout and returns one of:
  - `{ kind: "not_modified" }`
  - `{ kind: "release", tag, page, assets, etag }`
  - `{ kind: "error", status?, rateLimitReset?, err }`
- The response is parsed with a Zod schema of only the fields used (`tag_name`, `html_url`, `prerelease`,
  `draft`, and `assets[].name/size/browser_download_url`). Unknown fields are ignored.
- The parser fixture is a real captured `releases/latest` JSON from a public repo (minisign's own),
  trimmed. Unseen shapes (a missing field, a non-`v` tag) parse to `error` with the raw field logged. They
  aren't guessed at.
- `pickCandidate(release, running, skipped)` (pure) returns one of:
  - `up_to_date`: tag ≤ running numeric, a draft or prerelease, or a suffixed tag. Friends never get an rc. A
    same-numeric rc→final is not offered, as the map says.
  - `skipped_before`: the version is in `skipped`.
  - `assets_missing`: the installer or its `.minisig` isn't attached yet, for example published before
    `sign-release`. This retries at the next check and never skips.
  - `{ candidate }`: the installer asset must be named `installerName(version)`, plus `<name>.minisig`. The
    feed's `html_url` isn't used. Local paths are always built from `parseReleaseVersion(tag)`, never from the
    feed's asset names.
- `download(url, dest, { maxBytes, expectedSize })`:
  - It streams to `dest.partial` and then calls `renameRetry`.
  - Caps: 200 MB for the installer, 4 KB for the `.minisig`, counted on streamed bytes rather than
    `Content-Length`.
  - Timeouts: 60 s idle and 15 min total.
  - These fail the download: a non-2xx status, or a size that differs from the asset's `size`. A `.minisig`
    body that doesn't start with `untrusted comment:` also fails, for example an HTML error page. All three are
    *download* errors that retry, never a skip.
  - It deletes the partial on any failure.
  - Folder-feed urls are copied, not fetched.

### 6. Check loop: `src/server/update/checker.ts` (TDD with injected fetch, clock and temp dir)
`runCheck(deps): Promise<Outcome>` does one check:
1. Read the state.
2. Fetch the latest release.
3. Pick a candidate.
4. If it's the version already in `state.available` **and both files still exist**, stop. Antivirus may have
   quarantined them, in which case it downloads again.
5. Otherwise download both files into `update/download/`.
6. `verifyMinisign` with `UPDATE_KEY`.
7. `parseTrustedComment`, then require `version === candidate` and `file === installerName(version) === asset name`.
8. Verify passes: delete older downloads, write `available`, outcome `downloaded`.
9. Signature or comment fails: delete both files, add to `skipped` with the reason, warn, outcome `skipped`.
   That's the map's "Failures before apply".
   - Skipped entries at or below the running version are pruned on each write.
10. A network, HTTP, rate-limit or download error: log it, write `lastOutcome: "error"`, and retry at the next
    check.

**ETag rule:** the new ETag is saved only when the release was fully handled, meaning `up_to_date`,
`downloaded`, `skipped` or `skipped_before`. After a download error or `assets_missing` it is cleared. So the
next check gets a full body and retries, rather than a 304 that hides the release. A test covers this: the
download fails, the next check is sent without `If-None-Match`, and the download runs again.

The installer is verified again before it runs (6b), since `update/` sits in user-writable data.

`startUpdateChecks(deps): { stop() }`:
- The first check runs 3 min after start, then every 6 h plus up to 30 min of jitter. Each check is scheduled
  after the previous one finishes, so checks never overlap. The download timeouts bound how long one check can
  take.
- Every run is wrapped in a deliberate broad catch, so an updater bug can never take down the supervisor that
  keeps recording alive. Its comment says why.
- Checks can't be turned off.
- It runs only when `CHANNEL === "prod"`, `VERSION !== null` and `UPDATE_KEY !== null`. Otherwise it logs
  `update/disabled {reason}` once. Dev never self-updates.
- `superviseSelf` starts it beside `runSupervisor` and stops it before exiting. `runSupervisor`'s loop doesn't
  change.

### 7. Build: bake the key
`build-release.ts` reads `minisign.pub`'s key line, or `--update-key <path>` for a rehearsal build, and passes
`--define GRINDLOG_UPDATE_KEY=<json>`. It fails with `StepFailed` if the file is missing or not a minisign public
key. The smoke run also checks that `/api/update` reports `enabled: true`. Tests cover the arg and the key-line
parse.

### 8. Tracker endpoint: `src/server/api/update.ts`
- `GET /api/update` returns `{ enabled, version, status, available: {version, page}|null, skipped:
  version|null, autoApply, installRequested, checkedAt }`. It is read from both files at request time, since
  they're small. The schema `updateResponse` lives in `src/shared/schemas/responses.ts`.
  - `skipped` is the newest skipped version above the running one.
  - `status`: `disabled | not_checked | up_to_date | ready | skipped | error`. `ready` wins over `skipped`.
  - `enabled` is the same three-way condition as section 6.
- `POST /api/update/install?version=X` writes `install: X` only when `X === available.version`. Otherwise it
  returns 409. 6b's supervisor consumes the request.
- `POST /api/update/auto-apply?on=true|false` writes `autoApply`.
- Both writes need the existing request header and log `update/request {kind, ...}`.
- Tests: route tests against `/api/update` in the existing API test idiom, covering the 409, the missing
  header, corrupt or missing files, and `enabled: false` in dev. `superviseSelf`'s wiring is covered only by
  the rehearsal.

### 9. Tray: `tray-view.ts` plus `Tray.cs`
- `TrayInputs` gains `update: { available, autoApply, installRequested, skipped }`, the same view the endpoint
  serves.
- Lines:
  - With auto-apply off and an update ready: `"Install update <v>…"` → `/settings#updates`, and `"What changed
    in <v>"` → the built page.
  - The newest skipped version only: `"Update <v> failed its signature check"`, with no url.
  - With auto-apply on, no line. 6b applies it and then adds the after-update "What changed" line.
- `trayCmd` passes `--release-url-prefix RELEASE_PAGE_PREFIX`, so the prefix has one source.
- `ViewUrl` also accepts exactly that prefix followed by `v[0-9A-Za-z.-]+` and nothing else. No `/`, so a port
  squatter can't use `../` to leave the repo.
- `build-tray.test.ts`, `supervisor.test.ts` (`trayCmd`) and `tray-view.test.ts` are updated.

### 10. Dashboard: Settings "Updates" section
Follows `ui-implementation-guidelines` and the existing `Section` and `StartupSection` idiom
(`src/web/pages/settings/SettingsPage.tsx:188`). It sits after Startup, with the anchor `updates`:
- Status sentences:
  - "Grindlog 0.1.0 is up to date."
  - "Grindlog 0.2.0 is ready to install."
  - "0.2.0 was skipped: its signature didn't check out."
  - "Couldn't check for updates; it'll try again later."
  - Dev: "Dev builds don't update."
- A toggle, "Install updates automatically", with the hint "when Rocket League is closed".
- An "Install update" button when ready and auto-apply is off. It says "Installs when Rocket League is closed"
  once requested.
- A "What changed" external link when `page` is set.
- It uses `useQuery` on `/api/update` with a 30 s refetch while the page is open. Writes go through the existing
  mutation helper.
- Component tests in the project's web test idiom.

## Error handling and logging
Category `update`, in `supervisor.log` (checker) and `tracker.log` (endpoint). Each log answers: did a check
run, and what did it see? Why wasn't an update offered? Why was a version skipped? Did a download or rename
fail, and why?
- `checks_started {source, enabled}`, or `disabled {reason}`.
- `check_result {latest, outcome, status, notModified, ms}`.
- `rate_limited {reset}`.
- `assets_missing {version, have}`.
- `download_done {file, bytes, ms}` and `download_failed {file, err}`.
- `verify_failed {version, reason}` (warn) and `comment_mismatch {version, comment}` (warn).
- `state_write_failed`, `state_unreadable`, `check_crashed` (the broad catch).
- `request {kind, version|on}`.
- `fs/rename_retried`.

Fire once offline: a tampered `.minisig` through a folder feed (`verify_failed`), an unreachable http feed
(`check_result error`) and a corrupt `state.json` (`state_unreadable`). Read the real lines.

## Steps
1. Copy this plan to `docs/plans/2026-11-12-wp6a-updater-check.md`. In BACKLOG, split item 6 into 6a and 6b and
   move the antivirus fold-in to 6a.
2. Make the minisign fixtures (needs minisign), then TDD sections 1–4. `bun run check` green.
3. TDD sections 5–6 and section 7's build change. `bun run check` green. *Offer `/compact`.*
4. Sections 8–10, invoking `ui-implementation-guidelines` before the dashboard code.
5. Docs: `PROJECT_INDEX.md` entries, the "first outbound request" in the README or privacy docs (map "Update
   behaviour"), and `docs/releasing.md`'s note that the build needs `minisign.pub`.
6. Verification, then `independent-review-pass`.

## Verification
- `bun run check` and `bun run e2e`.
- **Rehearsal on this PC, with no install.**
  - Build: `bun run build-release --update-key src/server/update/fixtures/test.pub`, plus a fake
    `Grindlog-Setup-9.9.9.exe` signed with the test key. The fake is any small file, since 6a never runs it.
  - Feed: a temp folder holding `latest.json`.
  - Run `release/app/grindlog.exe --supervisor` with these environment variables, as WP5's smoke run does:
    `GRINDLOG_DATA_DIR`, `GRINDLOG_PORT`, `GRINDLOG_STATS_CONFIG_DIR`, a dummy `GRINDLOG_TASK`, and
    `GRINDLOG_UPDATE_FEED` set to the folder.
  - A test-only `GRINDLOG_UPDATE_FIRST_CHECK_MS` would shorten the 3 min wait. Decide at implementation; if
    added, it is read only next to the feed override.
  - Expect, in this order:
    - `state.json` reaches `available: 9.9.9`.
    - `/api/update` says `ready`.
    - With auto-apply off, the tray shows both lines, and "What changed" opens the built GitHub URL. The page
      itself 404s until a real release exists.
    - Settings shows the section, and Install writes `request.json`.
    - A re-signed 9.9.10 with a flipped byte ends `skipped` with a tray line.
  - Stop it with `--quit`.
- The tray's new url rule is checked by hand in that run. A `/api/tray` line with `…/releases/tag/../x` would be
  refused. That rule is unit-checked through the C# build test if the build-tray harness allows it. Otherwise
  it's a manual check.

## Handed to 6b (from the user's WP6 brief, so nothing is lost)
- Apply gate: Rocket League closed (the supervisor runs its own `tasklist` through the exported `parseTasklist`)
  and `connection !== "recording"`. Then it checks `autoApply` or a matching `install` request.
- The supervisor can never clear `request.json`, since only the tracker writes it. So the trigger is
  `install === state.available.version`, and a stale request for an older version is ignored.
- `state.json` writers merge rather than replace, and the schemas ignore unknown fields, because rollback runs
  older code on a newer file.
- Re-verify the installer with minisign before running it, on the exact bytes that run, with the
  comment-to-version check too. Build its path from the validated version, never from `available.file`
  (state.json is a user-writable file). (Security review, round 1.)
- Copy `update\previous\Grindlog-Setup.exe` to `update\rollback-setup.exe` **before** running the new installer.
- Run installers with `/VERYSILENT /SUPPRESSMSGBOXES /NOCLOSEAPPLICATIONS` plus `/LOG=`, and treat any nonzero
  exit as failure.
- The `--update` mode from a copy at `update\grindlog-updater.exe`, started with `spawnDetached`. Health check.
  Rollback with backup restore and failed-DB keep. Skip the failed version in `skipped`. raw.db pre-migration
  backup and free-space check. Interrupted-update state. `updater.log` `started` fields. The "update failed"
  toast. The after-update "What changed" line.

## Plan review
plan-reviewer (opus), one pass. All findings were accepted and folded in:
1. A stored ETag hid a failed download behind a 304. The ETag is now saved only once the release is fully
   handled, and is cleared otherwise. A test covers it.
2. `renameRetry` has to be synchronous, since `backupTracker` and its startup caller are. It now uses
   `Bun.sleepSync` and takes a logger. The fold-in is tested in `backup.test.ts`.
3. The `\thashed` fixture plan relied on a hand edit. Both comment forms now come from the CLI via `-t`.
4. Feed-supplied page URLs could escape the repo through `../`. The page is now built from the verified
   version, and `ViewUrl` accepts only the prefix plus `v[0-9A-Za-z.-]+`.
5. Downloads had no timeout, checks could overlap, and a quarantined file was never noticed. Added idle and
   total timeouts, chained checks, and a file-exists check.
6. The Install control does nothing until 6b. Kept, with a "no release tag between 6a and 6b" rule in
   Prerequisites and BACKLOG.
7. The hand-off missed two 6a contracts: the `install === available` trigger, and merge-on-write with an
   unknown-field-tolerant schema. Both were added to "Handed to 6b" and section 3.
8. An HTML or error `.minisig` counts as a download error, not a skip. Skipped versions are pruned and the
   newest is shown. `status` gained `skipped`.
9. The endpoint test seam is named. The `superviseSelf` wiring is stated as rehearsal-only.
10. Paths are built from the parsed tag, and folder names with separators are refused. `minisign.pub` is
    required before the next tag.

## Implementation notes
- **Progress (2026-11-12)**: sections 1–10 and the docs are implemented with tests. The rehearsal is done
  too; `independent-review-pass` is under way (see Review log).
- **minisign 0.12 CLI facts** (from making the fixtures): a `-t` comment is written as given, with no `\thashed`
  suffix; only the default comment gets one. So the WP5 contract's comment, signed by `sign-release`, has no
  suffix, and the `hashed-suffix` fixture (a literal tab plus `hashed` in `-t`) covers the other form. The
  Windows CLI writes CRLF line ends, which the verifier accepts.
- **Section 8**: the endpoint's logic is `src/server/update/view.ts` (`createUpdates`, unit-tested), with the
  routes in `api/index.ts` rather than a separate `api/update.ts`, as every other route is. An install that
  can't be written is a 500 `write_failed` (the plan named only the 409).
- **Section 9**: with auto-apply off and an install asked for, the Install line becomes "Update <v> installs
  once Rocket League is closed" (no url), so the tray doesn't offer a button that's already been pressed.
  `Tray.cs` refuses a `--release-url-prefix` that isn't `https://…/` (exit 2), checked live in `tray.test.ts`.
- **Section 10**: the project's UI tests are Playwright e2e, so the "component tests" are
  `test/e2e/settings.spec.ts` cases with `/api/update` faked per test (the stack is a dev build, so its real
  answer is only the disabled state, which one case checks). The read has `retry: false`: the 30 s refetch is
  the retry, as with autostart. A refused (409) Install says "That update isn't available any more." and
  refetches. The section intro states the "first outbound request" (no README exists; `docs/releasing.md`
  says it too).
- `bun run check` after sections 8–10: 1637 passed, 1 skipped, 2 failed. Both failures were 5 s timeouts under
  full-suite load (`records/record.test.ts` overtime-leavers, `rules-diff.test.ts`). They pass alone, 49/49,
  and neither file is touched. `bun run e2e -- test/e2e/settings.spec.ts`: 20 passed.
- **Extra real fixture**: minisign's own 0.12 release asset (`minisign-0.12-wasm.gz`, 48 KB) and its published
  `.minisig`, with the key from minisign's README (`jedisct1.pub`). It's a third-party prehashed signature
  with minisign's default comment (`timestamp:…\tfile:…\thashed`). The verifier passes on it under
  `bun --bun vitest`, so Bun's `node:crypto` Ed25519 and BLAKE2b-512 are now proven on a real `.minisig`.
  The checker also uses it to exercise `comment_mismatch` (a valid signature, the wrong comment). The
  CLI-made fixtures are still needed for the version contract, both comment forms, and the legacy algorithm.
- **Feed fixture**: `github-latest.json` is jedisct1/minisign's real `releases/latest` (captured 2026-11-12),
  trimmed to the two win64 assets. It shows `digest: null`, `state: "uploaded"` and a weak ETag (`W/"…"`).
  `tag_name` has no `v` there, so it's a `bad_tag` for us, as intended.
- **`renameRetry`** takes an injectable `rename` and `now` as well, so its tests need no real locked file.
  `backup.ts` only swaps the call. No `backup.test.ts` case reproduces a held `.partial`: libuv opens files
  with share-delete, so a test can't hold one the way antivirus does. The retry is covered by
  `fs-retry.test.ts`. This is a deviation from the plan's "tested in backup.test.ts".
- **Download order**: the `.minisig` is fetched before the installer. It's 4 KB, so an HTML or garbage
  signature fails before 45 MB is spent.
- **`GRINDLOG_UPDATE_FIRST_CHECK_MS`** was added, and it counts only when `GRINDLOG_UPDATE_FEED` is set (tested).
- `bun run check`: 1602 passed, 1 skipped. One run failed `src/tray/tray.test.ts`'s "goes red within ~5 s"
  under full-suite load. It passes alone twice. It's a timing test of the real tray exe, untouched by this
  change.
- **Rehearsal (2026-11-12)**: `build-release --update-key <throwaway k.pub>` passed, and its smoke run said
  "updates on". With a folder feed and `--supervisor` (`GRINDLOG_UPDATE_FIRST_CHECK_MS=2000`):
  - 9.9.9 became `available` in `state.json`, and `/api/update` said `ready`.
  - Auto-apply off gave the tray both lines. Install for 9.9.8 got a 409; for 9.9.9 it wrote
    `request.json`, and the tray line turned into "installs once Rocket League is closed".
  - A 9.9.10 with a byte flipped after signing ended `skipped` (`bad_signature`), with its files deleted.
    The verified 9.9.9 stayed ready, and the tray added "Update 9.9.10 failed its signature check".
  - A corrupt `state.json` read as `not_checked` and logged `state_unreadable`. An http feed on a dead port
    logged `check_result` `error` (ECONNREFUSED).
  - In Chrome, the Updates section matched the page. Keyboard: Tab reached Install, and Enter moved focus to
    "Installs when Rocket League is closed.". No console errors.
  - Not checked: the 320 px width (the window wouldn't resize), and clicking the tray's "What changed" menu
    item. Both are handed to the user.
  - One open question: once an update is ready, the Settings sentence doesn't mention a skipped newer version.
    Only the tray shows it.

## Review log

Tier by the diff: Substantial (about 1000 non-test lines, Substantial design tier). Snapshot before fixes:
`2046e46967ab8bd91852ae525c2f0ac32c51190b`.

### Round 1: `/code-review high`, arch-reviewer (opus), security-reviewer

- security: no findings. Its 6b note (re-verify the exact bytes, path from the version) is in "Handed to 6b".
- code-review + arch (same finding): a version string in state.json that isn't x.y.z made `parseReleaseVersion`
  throw in every `runCheck` (nothing ever rewrote the file) and in `view()`, taking down `/api/update` and
  `/api/tray`. [Fixed] The state and request schemas check versions (`isReleaseVersion`), so a bad file reads as
  the default, logs `state_unreadable` and is replaced by the next write. Tests in state.test.ts.
- code-review + arch: a 304 skipped the stale-download cleanup, so an `available` the running version had
  caught up with (and its files) stayed while the ETag held, and a stale `install` request would match it in 6b.
  [Fixed] The "available ≤ running" check runs before the fetch. Test: seeded ETag, 304.
- code-review: a pulled release (latest falls back below a downloaded version) was still offered. [Fixed] An
  `up_to_date` pick always drops `available` and its files. Test.
- code-review: a version skipped for a bad signature is never retried, even if its files are re-uploaded.
  [Verified, no fix needed] By design (map "Failures before apply"): a bad release is fixed with a new version.
  `docs/releasing.md` "When something fails" now says so.
- code-review: the verify step's `readFileSync` wasn't caught, so antivirus taking the file after the rename
  crashed the check with no state written. [Fixed] Read back inside the download try, so it's a
  `download_failed` that retries. Test via an injected `readFile`. The same finding's memory point (the
  installer read whole, up to the 200 MB cap, once per new release) is [Verified, no fix needed]: bounded and
  brief, and legacy `Ed` signatures need the whole file anyway.
- code-review: every tray poll reads both small files. [Verified, no fix needed] Two reads of files under 1 KB
  every 2 s cost nothing measurable; an mtime cache would add state for no measured gain.
- code-review + arch: the tracker imported `disabledReason` from checker.ts, pulling the whole checker into its
  graph. [Fixed] Moved to `src/shared/update-key.ts`.
- code-review: the http-URL regex was copied in feed.ts and download.ts. [Fixed] `isHttpUrl` in feed.ts.
- code-review + arch: comments pointing at docs or work packages (minisign.test.ts, SettingsPage.tsx `UPDATES_INTRO`,
  checker.ts and state.ts headers). [Fixed]
- arch: nested `available` and `skipped[]` objects stripped unknown fields, against section 3. [Fixed]
  `z.looseObject`; test with nested fields.
- arch: `pick.installer.name !== installerName(version)` could never be true. [Fixed] Removed.
- arch: the idle timeout didn't cover waiting for response headers. [Fixed] A header timer at the idle bound.
  Test with a fetch that never answers.
- arch: `UpdateView` copied `UpdateResponse` by hand. [Fixed] It is now `UpdateResponse`, with the field docs
  moved onto the schema.
- arch: the web query key `UPDATE_KEY` had the same name as the minisign key constant. [Fixed] `UPDATE_QUERY_KEY`.
- arch: the plan's Progress line was stale. [Fixed]
- arch (no change): `checks_started` logs `{source, firstDelayMs}` rather than `{source, enabled}`. A disabled
  build logs `disabled` instead, so `enabled` would always be true.

### Round 1: `/simplify` (reuse, simplification, efficiency, altitude)

Applied:
- `isNewer(version, than)` in `src/shared/release.ts` (TDD), replacing three hand-built comparisons in checker.ts,
  view.ts and feed.ts. view.ts picks the newest skipped version with a reduce instead of a re-parsing sort.
- feed.ts `pickCandidate` checks the tag with `isReleaseVersion` instead of throw-to-catch.
- `USER_AGENT` shared by feed.ts and download.ts.
- checker.ts builds the fetch option once (`fetchOpt`) and removes a failed download through one `discard()`.
- view.ts reads request.json only after the disabled early return (a disabled build's tray poll reads nothing).

Skipped:
- A shared atomic-write helper, and the retry for log.ts's rotation rename: outside this diff (§1).
- Have download.ts return the bytes instead of the checker reading them back: the read-back is deliberate (it
  verifies what is on disk, and catches antivirus taking the file).
- Hard-coding the release prefix in Tray.cs instead of passing `--release-url-prefix`: the plan chose one
  source for the prefix (section 9).
- Deriving the trusted-comment parse from `trustedComment()`: the WP5 contract is parsed explicitly, `\thashed`
  included, by design.
- Fewer injection seams in `startUpdateChecks` and `renameRetry`, a shared `updateResult` mapper in the API,
  `isNodeError` in state.ts (it lives in stats-config.ts, an odd dependency), the derived-flag reshuffle in
  `runCheck` (just reviewed for correctness), dropping `copyTo`'s size check (it stops a huge copy before it
  starts), and a discriminated `UpdateResponse`: low value against the churn.

Verification after round 1 fixes and simplify: `bun run check` 1648 passed, 1 skipped; typecheck and lint clean;
`bun run e2e -- test/e2e/settings.spec.ts` 20 passed.

### Round 2 (delta from the snapshot): correctness-reviewer, arch-reviewer (sonnet), security-reviewer

- security: no findings.
- arch: every round 1 `[Fixed]` entry closes without regressions. Nit: the disabled view's literal
  `autoApply: true` duplicates the request default. [Fixed] A comment says it's schema filler (comment only, so
  the round isn't reopened).
- correctness: every `[Fixed]` entry closes. Question: an `up_to_date` pick for a draft or prerelease latest
  now drops a good download. [Verified, no fix needed] GitHub's `releases/latest` never returns drafts or
  prereleases, so only a hand-made test folder feed could hit it.

Review closed: round 2 had no new findings. Totals: 2 rounds; 17 fixed, 5 verified with no fix, 1 nit fixed,
and 6 simplify edits applied.

## Manual checks (user, 2026-11-12)

Run on the rebuilt rehearsal build (with the round 1 and 2 fixes), with 9.9.9 ready and auto-apply off.
- The Updates section at 320 px: correct. The status line, the Install button, the "What changed" link and the
  switch wrap cleanly.
- The tray's "What changed in 9.9.9": opens the GitHub release URL, as expected. "Install update…" opens
  Settings at the Updates section.

# WP2b: release data (distribution package 2, second part)

## Context
Package 2 ("Release-aware app") of friends release step 4 is split three ways (BACKLOG, user 2026-11-10). 2a
(process control) is done: `docs/plans/2026-11-10-wp2a-process-control.md`. 2b makes a release build look after its
own data and pages after an update:
- **Recompute in a release** (map `docs/plans/2026-11-06-distribution-map.md`, that section): the tracker keeps the
  last recomputed version in `tracker.db` and recomputes all history in the background when the running version
  differs (also covers a rollback). One match at a time, yielding like retention; pauses only while a match records;
  a stop means a full rerun at next start; a failed match keeps its record and leaves the marker unwritten; one
  event at the end refreshes open pages; never triggers rollback; "healthy" doesn't wait for it; dev builds
  (`VERSION` null) never self-recompute.
- **Dashboard after an update** (map, that section): every static file gets `Cache-Control: no-cache`; each open
  tab learns the server's version when its events stream reconnects and reloads itself once if it differs; tested
  with several tabs open, because of the shared worker.

Tier: Standard (BACKLOG). Pure logic gets TDD; the browser reload gets an e2e test (fallback: manual repro).

Facts from the code:
- `recomputeAll` (`src/server/records/recompute.ts:32`) is sync, loops `store.matches()` one match per try/catch,
  skips the open (live) match, logs `records/recompute_*`. Callers: `scripts/recompute.ts` (also run by `deploy`),
  `rules-diff.ts:268`, `recompute.test.ts`.
- Retention yields with a `setImmediate` promise after each match and stops on `isRecording()`/`stopping()`
  (`db/retention.ts:18-21, 92-96`); `maintenance.ts` schedules it, and `main.ts:44` stops it before storage closes.
- `recorder.isRecording()` (`recorder.ts:277`) is what maintenance uses.
- `tracker.db` has a `settings` table, but `createSettings().get()` warns `unknown_key` on any key outside the
  settings schema, so the marker can't live there. Migrations are an ordered SQL array (`db/migrations.ts:5`).
- Static files: `send()` in `src/server/api/static.ts:33` sets only `content-type`.
- SSE: `sseEvents` (`responses.ts:345`) lists `status`, `match_ended`, `session_break`; `createApi` has
  `matchEnded()` publishing through the hub (`api/index.ts:317`). The web hub (`src/web/events/hub.ts`) forwards
  every name in `sseEvents` automatically; `useLiveEvents.ts` handles each type.
- `status.version` exists since 2a; the web doesn't read it. Vite hashes the worker (`dist/assets/worker-<hash>.js`),
  so a new build gets a new SharedWorker; a tab on the old build keeps the old worker until it reloads.
- The e2e stack (`test/e2e/stack.ts`) runs the tracker from source (`bun run src/server/main.ts`), so `VERSION`
  is null there.

## Design

### 1. Recompute as steps
`recompute.ts` gains `recomputeSteps(opts): Generator<void, RecomputeResult>`: the current loop body, yielding
after each match. `recomputeAll` drains it and keeps its sync signature, so the script, `rules-diff` and the
existing tests don't change. No behaviour change for them. One option, `quietSkips`: info-level skips
(`lobby`, `trimmed`, the newest `open`) are only counted, not logged, so a release run doesn't write thousands of
lines a year in. Warn-level skips and failures are still logged per match. The release path sets it; the
script doesn't.

### 2. The marker
New tracker migration: `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, for app state that isn't a
user setting. Key `recomputed_version`. Two statements, read and upsert, inside the release-recompute module (no
general meta API until a second key needs one). The migration takes the normal pre-migration backup.

### 3. Release recompute (`src/server/release-recompute.ts`)
`startReleaseRecompute({ storage: { raw, tracker }, version, isRecording, onDone, logger, yieldFn, sleep,
pauseCheckMs = 5000, steps = recomputeSteps })` returns `{ stop(): Promise<void> }`:
Everything, including the marker read, runs inside one guarded async body, so nothing throws into `main()` after
the host is listening:
- `version === null`: log `records/release_recompute_skipped {reason:"dev"}`, return.
- marker equals version: log skipped `{reason:"current", version}`, return.
- Otherwise log `release_recompute_started {from: marker ?? null, to: version}` and step: after each step,
  `await yieldFn()`; then while `isRecording()` and not stopped, wait `pauseCheckMs` or until `stop()`, whichever
  comes first (a stop promise raced against the injected sleep), logging `release_recompute_paused` once per pause
  and `_resumed` with the paused ms. A stop between steps logs `release_recompute_stopped {done: n}` and ends
  without marker or event.
- At the end: `failed === 0` writes the marker. Either way log `release_recompute_done {from, to, ...result,
  activeMs, markerWritten}` and call `onDone()` once (records may have changed even with failures). `activeMs`
  sums the steps' own time, so it compares with the map's 18 ms/match; `ms` includes pauses and yields.
- Any throw (the marker read or write, `store.matches()`) is caught and logged as `release_recompute_crashed`;
  broad on purpose, with a comment: it must never take down the tracker.
- `stop()` sets the flag, wakes a pause and awaits the running promise; it's a `main.ts` stop step before
  `maintenance`/`storage`.

Wiring in `main.ts`: started after `parts.host.mount(api.handle)`, so the end event can reach pages, with
`version: VERSION`, `isRecording: recorder.isRecording`, `onDone: () => api.recordsRecomputed()`. Retention can
run beside it: each step and each retention step is a sync unit on the one thread, and recompute already handles
thinned matches. Health (`/api/status` 200) doesn't wait for it.

The map's "quiet tray line if failures remain" needs the tray (package 3). 2b logs the count in
`release_recompute_done`; package 3 adds the status field its tray line reads (pointer on BACKLOG package 3).

### 4. End event
`sseEvents.records_recomputed: z.object({})`. `createApi` gains `recordsRecomputed()`: publish, log
`api/records_recomputed {subscribers}`, never throws (same shape as `matchEnded`). The web's `useLiveEvents`
handles it with `queryClient.invalidateQueries()` (all: any record may have changed). A pre-2b worker would
ignore the unknown event, but no release build predates 2b, so there is no such worker in the field.

### 5. `Cache-Control: no-cache`
`send()` in `static.ts` adds `cache-control: no-cache`, which covers every served file and the `index.html`
fallback. Without it Chrome's heuristic caching can serve an old `index.html` after an update, pointing at old
hashed assets the new build no longer has (404). Hashed assets could be `immutable`, but the map says every file
and loopback refetches are cheap.

### 6. Reload once on a new version
New pure `src/web/logic/version-watch.ts` `createVersionWatch(): (version: string | null) => boolean`: the first
status sets the baseline and returns false; a later different version returns true once, then false forever
("once": no reload loop even if the reload fails). `null` to `null` never differs, so dev never reloads; a
rollback (new to old) does.

The version must reach an old tab even when the new tracker's status fails the old build's strict schema. The
hub drops a status that fails `safeParse` (`hub.ts:99-108`), and `connection`/`configProblems` are strict enums,
so a new `configProblems` value (package 4 is a likely source) would otherwise stop every old tab from ever
reloading. So the hub reads `version` leniently first, with `z.object({ version: z.string().nullable()
}).safeParse`, posts a separate `{ type: "version", version }` message to every port (and to a late port with the
last one), and only then strict-parses the status as today. A comment on `statusSchema.version` says it must stay
a top-level nullable string that every later build can read.

`useLiveEvents` handles `version` with one module-level watch (not inside the effect: `main.tsx` uses
`StrictMode`, which runs effects twice in dev). On true it logs `console.info("[grindlog] reload/version",
{from, to})` and calls `location.reload()`. A version only changes when the tracker restarts, so the first status
after a reconnect is when a tab learns it, as the map says. Comparing every status rather than only reconnect
ones costs nothing and needs no reconnect tracking.

Accepted race: a tab whose first status already comes from the new tracker takes the new version as its baseline
and keeps old JS (it loaded old assets just before the restart, and its stream opened just after). It's rare, and
comparing against a version baked into the web build instead would bring back reload loops whenever `dist` and
the exe drift apart.

Shared worker: an old tab's old worker reconnects to the new tracker and fans the new status to every old tab,
and each reloads. A reloaded tab loads the new `index.html` (no-cache), so it gets the new worker's URL; once the
last old tab reloads, the old worker goes. If two builds' workers are byte-identical, the hash and so the worker
are shared, which is harmless because the protocol is then identical too.

## Tests (failing first)
- `recompute.test.ts`: `recomputeSteps` yields once per match and returns the same result as `recomputeAll`;
  `quietSkips` counts info skips without logging them and still logs warn skips.
- `migrate.test.ts` (or the migrations' existing coverage): the `meta` table exists after migrating.
- `release-recompute.test.ts`, with real migrated in-memory dbs, a memory logger and injected `steps`, `yieldFn`,
  `sleep`: dev (null) never steps; marker equal never steps; a differing (or missing) marker runs, writes the
  marker, calls `onDone` once; a failure leaves the marker unwritten and still calls `onDone`; `isRecording` true
  pauses until false, then resumes (logs paused/resumed); `stop()` mid-run resolves, writes no marker, no
  `onDone`; `stop()` while paused resolves without waiting out the injected sleep; a throwing step source is
  logged `crashed` and doesn't reject; a tracker db without the `meta` table (marker read throws) is logged
  `crashed` and doesn't throw from `startReleaseRecompute`. One run with the real `recomputeSteps` on the existing
  recompute fixture.
- `static.test.ts`: `cache-control: no-cache` on a file and on the index fallback.
- `api` test: `recordsRecomputed()` publishes the event (existing hub/api test pattern). `hub.test.ts`: the new
  event fans out; a valid status posts a `version` message; a status with an unknown `connection` or
  `configProblems` value still posts `version` (and is dropped as `bad_payload` as today); a late port gets the
  last version.
- `version-watch.test.ts` (Vitest): first status false; same false; different true then false; null/null false;
  old-after-new true.
- e2e `test/e2e/update-reload.spec.ts`: two pages in one context on the dashboard (one SharedWorker), each marked
  with `window.__beforeUpdate = true`; the stack restarts the tracker with another version; both pages lose the
  marker (reloaded) exactly once, and the header still shows live status. Stack support: a stdin line
  `restart <version>` stops the tracker (`requestStop`, wait for exit) and respawns it on the same port and data
  dir with `bun --define GRINDLOG_VERSION='"<version>"' run …`; the first start takes an optional version argv
  too (so the baseline is non-null). That restart also runs the release recompute on the seeded data, so the test
  checks `tracker.log` has `release_recompute_done` with `failed: 0`.

## Steps
0. `git status` clean (checked at plan time).
1. Gate: in the scratchpad, check that `bun --define GRINDLOG_VERSION='"x"' run` on a file importing
   `src/shared/version.ts` prints `x` (Bun 1.4.3). If it doesn't, the e2e test is replaced by the manual repro in
   step 5b, and the stack change is dropped.
2. Failing tests, then code: sections 1, 2, 5 and the version watch. `bun run check`.
3. Failing tests, then code: sections 3 and 4, wiring in `main.ts`, `useLiveEvents`. `bun run check`.
4. Stack `restart <version>` and the e2e spec; `bun run e2e`.
5. Manual repros on a scratch compiled `grindlog.ts` (`--define GRINDLOG_VERSION`, `GRINDLOG_DATA_DIR` and
   `GRINDLOG_PORT` in scratch, a copy of the dev data so recompute has real history; never the dev install):
   - (a) first start with `0.0.1-a`: log `release_recompute_started {from:null}`, `done` with `failed: 0`, marker
     row present; restart same exe: `skipped {reason:"current"}`. Note `activeMs` per match against the map's
     18 ms.
   - (b) two Chrome tabs open, swap to an exe built with `0.0.1-b`: both tabs reload once, the responses show
     `Cache-Control: no-cache`, and recompute runs again (`from: "0.0.1-a"`). Step 1's fallback makes this the
     shared-worker test.
   - (c) stop mid-recompute (`--quit`): `release_recompute_stopped`, no marker; next start reruns in full.
6. `bun run deploy` to dev with the user's go-ahead: dev logs `release_recompute_skipped {reason:"dev"}`.
7. `/compact` line, `independent-review-pass`, then docs (`documentation-backlog-hygiene`): close 2b on BACKLOG, a
   pointer on package 3 for the recompute-failures status field, PROJECT_INDEX (release recompute, `meta` table,
   `records_recomputed` event, version reload). Commit body records the decisions.

## Verification
- `bun run check` and `bun run e2e` green, with figures in the commit body.
- e2e multi-tab reload passes (or manual repro 5b observed).
- Manual repros 5a-5c observed; dev deploy logs the dev skip.

## Out of scope
2c (Start with Windows). The tray's failure line and its status field (package 3). The release build's `--define`
(package 5). The updater, rollback and health check (package 6); a BACKLOG line on package 6 notes that the
migrator refuses a database newer than the code (`migrate.ts:28-30`), so a rollback across a schema change relies
on the pre-migration backup being restored first.

## Plan review
Plan-reviewer agent (opus), 2026-11-10. All findings folded in:
1. High: the old worker drops any status failing its strict schema, so a new enum value would stop old tabs from
   ever reloading. Fixed: the hub reads `version` leniently and posts it as its own message; tests for an unknown
   enum value; a comment on `statusSchema.version`.
2. Med: `stop()` could wait out a 5 s pause. Fixed: the pause wakes on stop; test.
3. Med: the marker read sat outside the crash catch, after the host listens. Fixed: one guarded async body; test
   with no `meta` table.
4. Low: first-status baseline race. Accepted and stated in Design 6.
5. Low: wrong claim that pre-2b tabs reload. Corrected.
6. Low: the watch must be module-level (StrictMode). Stated.
7. Low: per-match skip lines and `ms` including pauses. Fixed: `quietSkips` and `activeMs`.
8. Low: missing test seams. Added with 1-3.
Also from the review: a package 6 BACKLOG line on the migrator refusing a newer database (Out of scope).

## Implementation log
- Step 1 gate: passed, with a different spelling. `bun run --define 'GRINDLOG_VERSION:"x"' <file>` (or `bun -d …`)
  sets `VERSION`; the plan's `bun --define GRINDLOG_VERSION='"x"' run …` doesn't (the flag takes `K:V`, after `run`).
  The e2e stack uses the working form. `bun build --compile --define 'GRINDLOG_VERSION="x"'` takes `K=V`.
- Step 2: red first (static `no-cache`, `meta` at v7, `recomputeSteps` missing). First green run caught a real bug: a
  skip's `continue` jumped past the `yield` (1 yield for 3 matches); the loop body is now its own function. The v5
  migrate test and the storage table list were pinned to the new schema. `bun run check`: 1282 tests.
- Step 3: `release-recompute.test.ts` (11) red then green; the return value gained `done` (the run's promise) as a
  test seam. Lint caught TS narrowing `stopped` across awaits; it's read through `isStopped()`. Hub: 3 new tests red
  (fan-out already passed: the hub forwards every `sseEvents` name). `bun run check`: 1296 tests.
- Step 4: `restart <version>` in the stack, an `update` seed (rich, first start as `e2e-a`), `update-reload.spec.ts`.
  Passed first run; red check: with `location.reload()` disabled it fails (tab keeps its marker). `bun run e2e`: 97
  passed (4.5 min).
- Step 5, scratch exes (`--compile --define`), a `VACUUM INTO` copy of the dev data, port 49150, Stats API on a dead
  port; stopped with `scripts/stop.ts` (the stop request `--quit` sends) instead of `--quit`:
  - (a) `0.0.1-a`: migrated 6→7 with a pre-migration backup; `started {from:null}`, `done` written 211, skipped
    lobby 1 + ignored_playlist 1, failed 0, markerWritten, `activeMs` 3837 for 213 matches = 18.0 ms/match (map: 18);
    no per-match skip lines. Same exe again: `skipped {reason:"current"}`.
  - (b) two Chrome tabs (shared worker), swap to `0.0.1-b`: both tabs reloaded once (navigation type `reload`,
    marker gone, live status back), one `reload/version` line each, `records_recomputed {subscribers:1}` (one
    stream for both tabs), `/` and the JS asset `Cache-Control: no-cache`; recompute `from:"0.0.1-a"`, failed 0.
  - (c) `0.0.1-c` stopped 1.8 s in: `release_recompute_stopped {done:94}`, clean exit 0, marker still `0.0.1-b`;
    next start reran in full (211 written, failed 0).
  - Dev install (49102) answered throughout.
- Not in the plan: `guarded()` yields once before the marker read, so startup returns before any database work.

## Review log
Diff classified Standard (about 254 non-test lines, no high-risk paths named). Snapshot `f6b82cf`.

### Round 1: `/code-review medium`, arch-reviewer (opus), security-reviewer
Security: no findings.

`/code-review`:
1. A match that always fails reruns the full recompute on every start, invalidating every tab's queries each
   time. [Verified, no fix needed] The map decided that a failed match keeps its record and leaves the marker
   unwritten, so the next start retries; package 3's tray line (BACKLOG pointer) surfaces failures that remain.
2. The recording check ran only after each step, so the first match could be rebuilt while a match records.
   [Fixed] The check now runs before every step; test "a match already recording at startup…" (red on the
   reviewed code).
3. `recomputeSteps` snapshots `matches` and `newest` once, and a paused run can last long. [Verified, no fix
   needed] The snapshot is taken at the first step, after the recording check. A match recorded during a pause
   isn't in it and gets its record live, and raw data is append-only, so a snapshot match can't become open later.
4. A stop during a pause leaves the 5 s timer pending. [Verified, no fix needed] Shutdown ends in `process.exit`,
   and tests inject `sleep`.
5. `no-cache` on hashed assets with no validator means full refetches. [Verified, no fix needed] Design 5 weighed
   `immutable` and kept one rule for every file, as the map says; loopback refetches are cheap.
6. `setImmediateYield` duplicated retention's. [Fixed] Exported from `db/retention.ts` and imported.
7. The `baseline` in `useLiveEvents` duplicated the watch's state. [Fixed] The watch returns `{ from }` or
   undefined (also arch 8).
8. Stack `void restart()` raced teardown and dropped errors. [Fixed] Teardown awaits the restart in flight; a
   failed restart calls `fail`.
9. `Stack.restart` didn't reject when the stack exited. [Fixed] It races `exited`, as `ready` does.

arch-reviewer:
1. nit: the `meta` migration comment sat on the previous entry's line. [Fixed]
2. low: a stop during the startup yield logged nothing. [Fixed] Logs `release_recompute_stopped {done:0}`; test.
3. low: the startup yield wasn't recorded as a deviation. [Fixed] Implementation log line above.
4. nit: `run(version)` shadowed and `done` meant two things. [Fixed] `to` and `stepped` (the log field stays `done`).
5. nit: `fakeSteps` doc. [Fixed]
6. nit: the gated-yield comment. [Fixed]
7. nit: the hub `version` comment didn't parse. [Fixed]
8. low: the duplicated baseline. [Fixed] (with code-review 7)
9. low: the shared-worker assertion could pass vacuously. [Fixed] `expect(paths).toHaveLength(2)` first.

After the fixes: `bun run check` exit 0, 99 files, 1298 tests; `update-reload.spec.ts` passed (19.0 s).

### Round 2 (full: the fix touched `db/retention.ts`): `/code-review medium`, arch-reviewer (sonnet), security-reviewer
Snapshot: the staged state after round 1's fixes. Security: no findings.

`/code-review`:
1. An always-failing match reruns every start. Already dispositioned (round 1, item 1).
2. The pre-step stop check also ran before the final step, which only returns the result, so a stop in the
   yield after the last match discarded a finished run (no marker, no event). [Fixed] `recomputeSteps` yields the
   count of matches left, and the check is skipped once it reaches 0; test "stop() in the yield after the last
   match…" (red without the guard).
3. The snapshot goes stale over a long run, now with retention alongside. Already dispositioned (round 1,
   item 3). Retention only drops states it has checked leave the record unchanged, so a stale `minSeq` still
   reads the same record.
4. The e2e spec could flake if the first start's recompute were still running at the restart. [Fixed] It waits
   for the first `release_recompute_done` before restarting.
5. Each pause wait added a reaction to one shared stop promise. [Fixed] Each wait sets its own `wake` resolver.
6. The status JSON is parsed twice in the hub. [Verified, no fix needed] A small payload; microseconds.
7. The stack could run two `restart` lines at once. [Fixed] Restarts are chained.
8. `Stack.restart` left its line listener attached on a timeout or exit. [Fixed]
9. The spec comment pointed to "the map". [Fixed] It states the reason.

arch-reviewer:
1. risk: `VersionChange` sat between the watch's doc block and the function. [Fixed] Moved above it.
2. nit: the shared `setImmediateYield` doc. [Verified, no fix needed] It already says "between background steps".

After the fixes: `bun run check` exit 0, 99 files, 1299 tests; `bun run e2e` 97 passed (4.4 min).

### Round 3 (delta): `/code-review low`, security-reviewer
Snapshot `3980128`. Round 2's state had no snapshot, so the passes got the round-3 files and a description of
the changes. No findings: the review is done.

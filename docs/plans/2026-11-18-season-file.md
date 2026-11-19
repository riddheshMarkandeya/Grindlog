# Plan: new seasons from a season file in the repo

## Context
BACKLOG item "set up new seasons automatically" (BACKLOG.md:101, Med, Standard). The Stats API carries no
season, so each new one is added by hand in Settings → Seasons (`src/server/seasons.ts`). S25 starts around
2026-12-09 (reported, not confirmed). The user picked the route the item leaves open: **a `seasons.json` in the
GitHub repo that every install fetches**. There is no scraping, and the file can change without a release.
User decisions (this session):
- **Corrections flow to unedited rows.** A row the file created, and still holding the file's last start, moves
  when the file's date changes. Rows the user edited or deleted are never touched.
- **Settings switch "Add new seasons automatically", on by default.**

Facts that bind the design:
- The tracker process (`src/server/main.ts`) owns `tracker.db`. The update check runs in the supervisor and
  only when compiled, so the season sync has to live in the tracker and needs an env override to keep e2e
  offline.
- Future seasons already work (`periodRange` in `src/shared/periods.ts:101`: "a season entered ahead"), so S25
  can go in the file now.
- The README Privacy section says "Grindlog goes online only for updates", which has to change.
- Migrations are append-only (`src/server/db/migrations.ts`). The seed has S22/S23/S24, and the ggseason page
  says S23 started on June 10, not June 9.

## Part A (first, docs only): public release map + backlog cleanup
User request (2026-11-18): save the order agreed in the previous session as a map, and clean up BACKLOG.md.
1. New `docs/plans/2026-11-18-public-release-map.md`, same shape as `docs/plans/2026-11-05-friends-release-map.md`
   (Destination / Notes / Steps table with Status and Plan-or-next-action). Destination: a public Reddit release
   strangers can trust. Notes: order agreed 2026-11-18; take the first open step; SmartScreen line for the FAQ
   ("Windows warns on the first install only, because the app isn't code-signed"); account profiles wait on whether
   anyone plays on alts. Steps:
   1. Seasons from a repo season file (S25 deadline ~2026-12-09). **This plan, Part B.**
   2. Toast app name ("Windows PowerShell" → Grindlog; BACKLOG item).
   3. Steam check (Watch list "first Steam user"; a Steam friend, or a self-test).
   4. Landing page on GitHub Pages: one static page, download → releases/latest, What's new from the GitHub
      releases API with a plain-link fallback; `/prototype` 2–3 looks, then build; a few `/grill-me` questions at most.
   5. Reddit post: `/research` subreddit self-promotion rules, then draft (pitch, GIF/screens, FAQ: official Stats
      API with no injection or memory reading, data stays local, Windows only, SmartScreen, where to report bugs plus
      GitHub issue templates).
   6. Public release.
   7. Account profiles (header dropdown of all accounts or one; Substantial: `/grill-me` → plan, maybe `/wayfinder`).
   8. Controls drift and the rest of the polish (themes, colour pairs, "What changed" card, guided tour if needed).
   9. Code signing, once there are public downloads (SignPath wants a track record; Azure's option is US/Canada only).
   Add a pointer line in the friends map's Notes ("next: public release map") and mark its step 6 "folded into the public map, step 8".
2. Update memory `work-queue.md` (and its `MEMORY.md` line) to point at the new map.
3. BACKLOG.md cleanup, with no item content lost unless it's done:
   - Delete closed `[x]` items whose record lives elsewhere (e.g. the `.partial` rename item, the done distribution
     package items under "Friends release step 4"). That section shrinks to its still-open items.
   - Top v1-roadmap item: drop "add S25 in Settings" (Part B covers it); keep its open sub-items.
   - Tag items that are now map steps with "(public release map step N)": seasons (1), toast app name (2), Steam
     Watch item (3), controls drift / themes / colour pairs / "What changed" (8). Reword "After the friends release
     map:" on the seasons item.
   - Add missing items as map pointers: landing page, Reddit post plus issue templates, account profiles, code signing.
   Show the BACKLOG diff (`git diff --stat` then per file) before moving on; commit Part A only when the user asks.

## Part B: seasons (map step 1)
### Approach

### 1. The file: `seasons.json` at the repo root (on `master`)
`{ "seasons": [ { "name": "S22", "start": "2026-03-11" }, …, { "name": "S25", "start": "2026-12-09" } ] }`
URL constant `SEASONS_FILE_URL = https://raw.githubusercontent.com/${UPDATE_REPO}/master/seasons.json`, placed next
to `UPDATE_REPO` in `src/shared/release.ts`. Before the file is written, check S23's real start date against an
official source (Rocket League news / patch notes). The file holds the checked date. If nothing settles it,
keep 06-09 and record that in the commit body.

### 2. Migration (append one entry to `trackerMigrations`)
```sql
ALTER TABLE seasons ADD COLUMN file_name  TEXT; -- the season file's name for this row; null if added by hand
ALTER TABLE seasons ADD COLUMN file_start TEXT; -- the start the file last set; null once edited by hand
CREATE UNIQUE INDEX seasons_file_name ON seasons (file_name COLLATE NOCASE);
CREATE TABLE seasons_dismissed (file_name TEXT PRIMARY KEY COLLATE NOCASE); -- file seasons the user deleted
UPDATE seasons SET file_name = name, file_start = start_date
  WHERE (name, start_date) IN (VALUES ('S22','2026-03-11'), ('S23','2026-06-09'), ('S24','2026-09-23'));
```
Seed rows the user never changed are adopted as file rows, so the file can correct S23. An edited seed row stays the user's.

### 3. Parse and sync (`src/server/seasons-file.ts`, new; DB writes stay in `seasons.ts`)
- `parseSeasonFile(json)`: zod `{ seasons: z.array(seasonInput).min(1).max(500) }`, reusing `seasonInput` from
  `src/shared/schemas/tables.ts`. Names are unique case-insensitively and starts are unique; a single bad entry
  rejects the whole file.
- `seasonsSource(env)`, pure and modelled on `feedSource` (`update/feed.ts:30`), reusing `isHttpUrl`:
  `GRINDLOG_SEASONS_FEED` unset → the raw URL; `off` → disabled; an http(s) URL → that URL; anything else → a file path.
- `fetchSeasonFile(source, {fetch})` never throws. It takes an http(s) URL or a local file path (for the override),
  uses a 30 s timeout, `User-Agent: Grindlog`, and caps the body at 64 KB (`res.text()`, then a length check). It returns `{ok, entries} | {ok:false, error, status?}`.
  It follows the shape of `fetchLatest` in `src/server/update/feed.ts` but without the GitHub API, ETag or asset handling.
- `seasons.sync(entries)` in `createSeasons` (`src/server/seasons.ts`) runs in one transaction. For each entry E:
  1. A row with `file_name = E.name`: if `file_start` is not null, equals `start_date`, and differs from E.start →
     move it (`start_date = file_start = E.start`), unless E.start is another row's start, which counts as `start_taken`. Otherwise `edited`/no-op.
  2. E.name is in `seasons_dismissed` → `dismissed`.
  3. Any row whose name matches E.name (NOCASE) and whose `file_name` is not E.name → `name_taken`. This covers rows
     added by hand **and** a file row the user renamed (for example `S25` renamed to `S26`, then the file adds `S26`), so the
     insert can never hit `name UNIQUE`.
  4. E.start is already another row's start → `start_taken`.
  5. Otherwise insert with `file_name = file_start = E.name/E.start` → `added`.
  Seasons that drop out of the file are left alone (the sync never deletes user data). If the file renames an
  entry and keeps its start, that gives `start_taken` and leaves the old row as it is; that's accepted. Returns counts and whether anything changed.
- `edit` sets `file_start = NULL` **only when name or start actually changes**, because the editor always posts the
  full draft and a Save with no changes must not detach the row. A real edit takes over the row (`file_name` stays, which stops a re-add).
  `remove` inserts `file_name` into `seasons_dismissed` when it's set. `readSeasons` and the `Season` shape are unchanged.

### 4. Scheduling (`startSeasonSync` in `seasons-file.ts`, wired in `main.ts` after the API mount)
- Construction: `main.ts` builds its own `createSettings({tracker, logger})` and its own
  `createSeasons({tracker, reader, logger})`. Both are stateless over the same `storage.tracker`, and bun:sqlite
  transactions are synchronous, so an API edit can't interleave. `main.ts` keeps the reader in a `const`, shared with `createApi`.
- First run 60 s after start, then every 24 h. This copies the `maintenance.ts` timer pattern with **injected timers**
  so the scheduler tests are deterministic. The timer is unref'd and stopped through `parts`. Each run sits inside a
  deliberately broad catch with a comment (as in `maintenance.ts:51-54`) that logs `sync_crashed {err}` and still
  schedules the next run.
- Turning the switch on takes effect at the next run, which can be up to 24 h later. That's accepted; there's no "run now".
- Each run reads `settings.autoSeasons`; off → logs `skipped {reason:"setting_off"}`.
- `GRINDLOG_SEASONS_FEED`: `off` disables the sync, an http(s) URL or a file path replaces the source. The e2e stack
  (`test/e2e/stack.ts` env) sets `off` by default, and a fixture file for the one e2e below.
- When `sync` changed something → `api.seasonsChanged()` publishes `seasons_changed`. That needs an entry in the event
  schema in `src/shared/schemas/responses.ts` (near :441), with the hub/api tests updated. A new event is used rather than
  reusing `records_recomputed`, so the logs say what happened. `useLiveEvents.ts` handles it like
  `records_recomputed` (`invalidateQueries()`), because every season period may move.

### 5. Setting + UI
- `autoSeasons: z.boolean()` in `src/shared/schemas/settings.ts`, default `true`; `autoSeasons: boolParam` in
  `settingsPatch` (:53); a `seasons` entry in `SETTINGS_SECTIONS`, which `settings.test.ts:7` requires and which drives
  reset-to-defaults in `src/web/logic/settings.ts`.
- `SeasonsSection.tsx` gets a toggle using the same control and pattern as the existing boolean settings (`remarks`,
  `moodLine`), plus one line of help: "Checks Grindlog's GitHub repository once a day. Seasons you edit or delete stay as you
  left them." Rewrite the Seasons intro "Add each new one here" (`SeasonsSection.tsx:241`) to fit. Follow `ui-implementation-guidelines` for this part.

### 6. Logging (category `seasons_sync`)
Events: `skipped {reason}`, `fetch_failed {status?, error, ms}`, `file_rejected {error}`,
`sync_crashed {err}`, `synced {added, moved, edited, dismissed, nameTaken, startTaken, ms}`, plus per-row `added`/`moved {name, from, to}` from `seasons.ts`.
They answer whether it ran, whether the fetch worked, what changed, and why an entry wasn't applied.

### 7. Docs
- README Privacy, and the in-app `UPDATES_INTRO` (`src/web/pages/settings/SettingsPage.tsx:228`, "Grindlog's only
  internet use…"): online for updates **and** a daily `seasons.json` fetch from this repo, switchable in Settings.
  Update any test that asserts that string.
- PROJECT_INDEX: new file and env var. BACKLOG: close the item and note the S23 outcome.
- `documentation-backlog-hygiene` decides on a decision file (the route choice with its rejected alternatives).

## Tests (TDD, `tdd-live-code-carveout`; written first)
- `seasons-file.test.ts`, parse: valid; duplicate name in any case; duplicate start; bad date; empty; >500; not JSON.
- `seasons-file.test.ts`, fetch with an injected fetch: 200 ok, 404, throw/timeout, oversize body, file-path source.
- `seasons.test.ts`, sync on a real test DB: add; move an unedited row; skip an edited row; skip a dismissed one;
  `name_taken` (hand-added row **and** a renamed file row); `start_taken`; a no-op edit keeps `file_start`; dropped from the file means untouched; a second identical run changes nothing. `edit` clears `file_start`;
  `remove` records the dismissal.
- `seasonsSource(env)`: unset / `off` / URL / path.
- Migration (`src/server/storage.test.ts`, next to the existing migration tests): unchanged seed rows are adopted, an edited seed row isn't.
- Scheduler (injected timers): setting off → no fetch; env `off` → no fetch; a change → `seasonsChanged` called once;
  a throwing sync → `sync_crashed` logged and the next run still scheduled.
- e2e (`settings.spec.ts`): a stack with `GRINDLOG_SEASONS_FEED` pointing at a fixture holding an extra season shows
  it in the Seasons table, and the toggle persists across a reload.

## Verification
- `bun run check` and `bun run e2e` both green.
- Fire the failure path once: run from source with `GRINDLOG_SEASONS_FEED=http://127.0.0.1:1/` and read the
  `fetch_failed` line in `tracker.log`. Then use a local file holding S25, check that the row appears in Settings, edit it,
  change the file's date, and confirm that the edited row doesn't move.
- After the user commits and pushes `seasons.json`, run once against the real raw URL and read the `synced` line.
- Follow-up outside this plan: friends get the sync with the next release (0.1.6, `docs/releasing.md`). It has to ship
  before 2026-12-09 for S25 to arrive on its own; otherwise S25 gets added by hand as it is today.

## Plan review
plan-reviewer (opus), 1 round. All findings folded in:
1. High: the in-app "only internet use" text (`SettingsPage.tsx:228`) → added to §7.
2. High: a renamed file row plus a new file entry with the same name would crash every sync on `name UNIQUE` → rule 3 widened, test added.
3. Med: a no-op Save detached the row → `file_start` clears only on a real change, test added.
4. Med: settings plumbing (`settingsPatch`, `SETTINGS_SECTIONS`, Seasons intro copy) → §5.
5. Med: no crash handling for the sync → `sync_crashed` with a broad catch and reschedule, test added.
6. Med: wiring and env-parsing seam → `seasonsSource(env)` and construction in `main.ts` named.
7. Low: event schema entry → kept a new `seasons_changed` event, for honest logs.
8. Low: scheduler → copy the maintenance pattern with injected timers; the 24 h lag after re-enabling is accepted.
9. Low: the file renaming an entry gives a stale row → accepted and noted.
10. Low: test seams → storage.test.ts named; size cap via `res.text()`.

## Results (2026-11-18)
- Part A done, uncommitted: public release map, friends map pointer, memory, BACKLOG cleanup.
- S23: Rocket League's own news post (2026-06-05) and several outlets put the start at **June 10**, so `seasons.json`
  says 2026-06-10. The migration adopts the unchanged seed row at 06-09, and the first sync moves it.
- Deviations from the plan:
  - The migration test sits in `src/server/db/migrate.test.ts`, next to the other per-version tests, not storage.test.ts.
  - `GRINDLOG_SEASONS_DELAY_MS` was added (`firstRunDelayMs`), because the 60 s first run is too slow for e2e. The e2e
    uses its own `seasons` seed and spec (`test/e2e/season-file.spec.ts`) with `test/fixtures/season-file.json`, and
    the toggle-persists check went into settings.spec's "each setting saves" test.
  - Fetch results carry `kind: "fetch" | "rejected"` so the scheduler logs `fetch_failed` and `file_rejected` apart.
    Per-entry skips log `seasons/file_skipped {name, reason}`; the run logs `seasons_sync/scheduled {source}` at start.
  - The Seasons section has no reset link: the page keeps reset off table sections (it would read as resetting the rows).
  - Decision file: `docs/decisions/2026-11-18-season-file-in-repo.md` (it passes the ADR gate: the baked URL is hard to move).
- Verified: `bun run check` (1873 passed, 1 skipped), `bun run e2e` (129 passed). Source run on a temp data dir:
  feed `http://127.0.0.1:1/` → `fetch_failed` (ECONNREFUSED, 4 ms). Then a local file: S23 moved 06-09 → 06-10 and
  S25 was added (`synced` added 1, moved 1); S25 was edited to 12-10 through the API, the file changed to 12-16, and the
  next run left it alone (`synced` edited 1). Browser: the switch shows under Seasons, toggles off with no console errors.
- Still open: independent review; the run against the real raw URL once the user pushes `seasons.json`; release 0.1.6
  before 2026-12-09.

## Review log
Diff re-classified at review: 333 non-test lines, so Substantial. Snapshot of the reviewed state: `c4ad345`.

### Round 1: code-review high, arch-reviewer (opus), security-reviewer, simplify
- [Fixed] code-review: a seed season deleted before version 9 was never dismissed, so the file would add it back. Migration 9 now records those names in `seasons_dismissed` (test in `migrate.test.ts`, confirmed red without the insert).
- [Fixed] code-review and arch (the same risk): `stop()` waited on a fetch in flight for up to 30 s, as long as the quit timeout, and a fetch that finished after stop still synced. Stop now aborts it (`AbortSignal.any` with the timeout), and a stopped run logs `stopped` and skips the sync (test with a fetch that never settles).
- [Fixed] code-review: the User-Agent and the timeout were copies. Both now come from `update/feed.ts`, along with `FetchFn` (arch nit).
- [Fixed] arch nit: `fetchSeasonFile`'s options default to `{}`, and the scheduler passes `{ fetch, signal }` straight through.
- [Fixed] code-review: the size cap read the whole body first. A declared Content-Length past the cap is now refused before the body is read (test). A streamed byte cap is deferred to BACKLOG with the scheduler extraction below.
- [Fixed] code-review and arch: the `SeasonsSection.tsx` header still said new seasons are added there. Rewritten.
- [Fixed] code-review: comments named other source files by path (the `seasons.ts` and `seasons-file.ts` headers). Reworded.
- [Verified, no fix needed] code-review: the S23 move from 06-09 to 06-10 on untouched installs is the intended correction (Rocket League's own news post), and the CHANGELOG has it under Fixed.
- [Verified, no fix needed] code-review: re-enabling the switch takes effect at the next daily run. The plan (§4) accepted that, with no "run now".
- [Verified, no fix needed] code-review: `file_skipped` repeats daily for a steady clash. That's one line per clashing entry per day, and it answers which entry wasn't applied. The logger has no debug level.
- [Verified, no fix needed] code-review, and the simplify agents: `main.ts` builds second settings and seasons stores. That's the plan's choice (§4): both are stateless, bun:sqlite transactions are synchronous, and arch agreed.
- security: no findings.
- simplify, applied: one `nameTaken`/`startTaken` pair shared by `clash` and `sync`; a redundant null check dropped; `stopped` replaced by `abort.signal.aborted`; `FetchResult` renamed `SeasonFileResult` (it clashed with the updater's); `seasonSync` typed by `ReturnType`; the seed list in migration 9 written once (a temp table).
- simplify, skipped: a shared scheduler and fetch with the updater [Deferred → BACKLOG], because it changes `update/` outside this diff. A tombstone column in place of `seasons_dismissed`, one generic `data_changed` event, and SeasonsSection reading settings itself were all skipped as plan choices (§2, §4 and review item 7) or a seam the page already uses. Dropping `changed` from `SyncResult` was skipped as marginal.
- After the fixes: `bun run check` passes (1876 passed, 1 skipped).

### Round 2 (delta `git diff c4ad345`): correctness-reviewer, arch-reviewer (sonnet), security-reviewer
- Every round-1 [Fixed] entry is closed with no regressions. Side effect noted: the season fetch now sends the updater's User-Agent, `Grindlog-updater`.
- [Fixed] nit (correctness and arch): a stale `clash` doc comment was stacked above `nameTaken`. Moved.
- [Verified, no fix needed] arch q: migration 9 also dismisses a seed season the user renamed. That's intended, since the user's change wins; the migration comment now says so.
- security: no findings.
- Clean apart from nits, so the review is done. Review: code-review high, arch (opus, then sonnet), security, simplify; 2 rounds, 9 fixed, 1 deferred.

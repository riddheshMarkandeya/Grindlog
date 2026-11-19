# Project index

Grindlog is a personal Rocket League stats tracker: a local Windows tracker first, with a web or
mobile app maybe later. It was called RL Tracker; the internal ids moved to grindlog in step 4's package 1.

## Code layout and commands
- `src/server/` (Bun process: `main.ts` entry, `host.ts` HTTP server and shutdown endpoint,
  `grindlog.ts` the compiled entry (`--supervisor` runs `supervisor.ts`'s restart loop over the same
  exe, `--open` and `--quit` run `launcher.ts`, bare runs `main.ts`), `launcher.ts` the short-lived modes
  (`--open` starts the supervisor detached if nothing answers and opens the dashboard; `--quit`, for the
  installer and updater, asks the tracker to stop and ends supervisors and waiting `--open`s, never a
  recording tracker), `control.ts` probing, listing, ending and starting this install's processes
  (shared with `stop.ts` and `autostart.ts`), `runtime-info.ts` version, channel, Windows and Bun for
  `started` lines, `game-watch.ts` game detection and the "Stats API off" toast, `notifier.ts` routes toasts through the
  tray (acked queue, 10 s PowerShell fallback) or PowerShell (under Grindlog's own app ID `Grindlog.Grindlog` in prod, set on the
  installer's Start menu shortcut; PowerShell's in dev), `tray-view.ts` the pure tray view for `/api/tray` (update lines included), `fs-retry.ts` `renameRetry` (EPERM/EBUSY/EACCES, for antivirus holds), `exit-codes.ts`, `log.ts`
  logger, `paths.ts` per-channel `identity()` (data dir, port, exe, task, shortcut) and paths from it, `storage.ts` opens both DBs, `maintenance.ts` schedules retention and backups, `seasons.ts` the seasons table's writes (with the season-file
  `sync`: an edited row stops following the file, a deleted one goes on `seasons_dismissed`), `seasons-file.ts` parses
  and fetches the repo-root `seasons.json` (`SEASONS_FILE_URL`) daily, 60 s after start (`GRINDLOG_SEASONS_FEED`: `off`, an
  http(s) URL or a file path; `GRINDLOG_SEASONS_DELAY_MS` brings the first run forward for e2e; ends with the
  `seasons_changed` event when it added or moved one), `release-recompute.ts` rebuilds every match record in
  the background when a release build's version differs from tracker.db's `meta.recomputed_version` (dev builds
  never; pauses while a match records; ends with the `records_recomputed` event); `db/`: `sqlite.ts` driver seam, `migrate.ts`, `migrations.ts`,
  `backup.ts`, `retention.ts`; `recorder/`: Stats API client, lifecycle, raw store, dedup,
  summary, checks, `play.ts` live-play view, `extras.ts` stat registry, `read-match.ts`, `thin.ts`
  which old UpdateStates retention deletes); `records/`: `record.ts` summary → rows, `save.ts` writer,
  `recompute.ts`, `rules-diff.ts`); `rules/`: `registry.ts` every stat rule with its version,
  `definitions.ts` renders the doc; `query/`: `read.ts` match records for pages with "you"
  joined, `sessions.ts` session cutting, `aggregate.ts` stats and the 30-day baseline; `api/`: the
  dashboard API mounted on the host: `index.ts` routes and writes, `pages.ts` composes each page,
  `events.ts` SSE (`status`, `match_ended`, `session_break`, `records_recomputed`), `router.ts` (a `quiet` route
  logs no 2xx request lines), `static.ts` built web app (every file `Cache-Control: no-cache`); `remarks/`: the recap headline,
  `copy.ts` line pool, `triggers.ts` mood and quip triggers, `pick.ts` the pure picker, `store.ts`
  stored picks and history); `update/` (WP6a): `checker.ts` the supervisor's check loop (3 min, then 6 h
  plus jitter; prod builds with a baked key only; `checkDue`'s 5 s poll of `request.json` runs a
  dashboard-asked check at once), `feed.ts` GitHub `releases/latest` or the
  `GRINDLOG_UPDATE_FEED` override (http or a folder with `latest.json`) and the candidate pick, `download.ts`
  capped, timed downloads through `.partial`, `minisign.ts` the verifier (node:crypto, both algorithms),
  `state.ts` `<data>/update/state.json` (supervisor writes; the updater alone while `apply` is set),
  `request.json` (`autoApply`, `install`, `checkRequestedAt`) and `start-failure.json` (tracker writes);
  state.json's `checkedAt`/`finishedAt` are a check's start and end (a request is pending until a check
  starts after it; the manual-check cooldown counts from the end), `view.ts` the tracker's `/api/update`
  view (with `lastApply`) and writes, `fixtures/` real minisign-made signatures; WP6b: `files.ts` download paths and
  `checkInstaller`, `apply-end.ts` `endApply` (how an apply ends, for both sides), `gate.ts` the supervisor's
  30 s apply gate, its startup `resumeApply` and per-tick `settleInterrupted` of an interrupted apply and
  `startApplyGate`, `apply.ts` `runUpdate` (stop, install, health check, rollback), `updater.ts` the
  `--update` entry (`<data>/update/grindlog-updater.exe`, logging to `updater.log`), `health.ts` `waitHealthy`
  (one pid for 2 min passes, 10 min fails), `restore.ts` puts migrated DBs back from pre-migration backups by
  rename, keeping the failed ones in `<data>/failed-update/<version>/`); `db/backup.ts` also backs up raw.db
  before a migration (`raw-…-premigration.db`, kept 24 h), once per schema version (dropped once the DB opens at
  that version with no migration due), after a free-space check
  (`LowDiskError`); `shared/update-text.ts` the last-update sentence the tray and Settings share,
  `src/web/` (the dashboard: Vite + React + React Router + TanStack Query; `main.tsx`, `App.tsx`
  routes, `api.ts` fetch + Zod parse; `events/`: `hub.ts` one `/api/events` stream fanned out to
  tabs from a SharedWorker (`worker.ts`, in-page fallback in `client.ts`; it reads each status's `version`
  leniently first and posts it on its own), `live.ts` header state, `useLiveEvents.ts` refetch on events and
  one reload when the tracker's version changes (`logic/version-watch.ts`); `logic/` pure header logic; `components/` header and empty
  state, `Icon.tsx` every dashboard icon by `IconKey` (`logic/icons.ts`; Lucide, Phosphor's ball, two drawn),
  `Contribution.tsx` the share bars (Friends and the recap), `TouchThirds.tsx` touches by third (`logic/thirds.ts`),
  `Bars.module.css` their shared styles and `BarPct.tsx` a segment's % label that hides where it can't fit,
  `ModeSwitch.tsx` the team size and Online/Private picker, `WlBar.tsx` a thin win/loss bar,
  `PlaylistRecords.tsx` By playlist rows, `useIndicator.ts` the sliding selection indicator (header nav, Recap
  tabs, match rail, X axis, Settings segments, ModeSwitch; `.ind-x`/`.ind-y` in `global.css`);
  `usePageTransition.ts` the shown location behind a view transition (`<main>` rises on a new path, crossfades on
  a new filter; `logic/page-transition.ts`), `redirect.tsx` replace-redirects skipped once the URL has moved on;
  `styles/tokens.css` themes carbon, slate, oled and the motion tokens (durations, easings, springs, `--press`,
  `--rise`; the reduced-motion block zeroes the spatial ones, and a test bans raw durations elsewhere),
  `global.css` the shared `.button`; `pages/trends/chart-motion.ts` the charts' draw-once and tween;
  `pages/` placeholders until WP6+),
  `src/tray/` (`Tray.cs` the C# 5 tray exe: polls `/api/tray` every 2 s, icon states, menu, balloons; `tray.manifest`
  DPI awareness; `icons/<channel>-<state>.ico` from `bun run icons`; built by `scripts/build-tray.ts`; live
  `tray.test.ts`),
  `src/shared/` (`channel.ts` the baked dev/prod channel and `APP_NAME`, `version.ts` the baked
  `GRINDLOG_VERSION` (null in dev and source runs), `release.ts` release version parsing and compare, installer name, the
  minisign trusted comment and its parser, the update repo URLs, `update-key.ts` the baked `GRINDLOG_UPDATE_KEY`, `constants.ts`, `result.ts` your W/L, `lobby.ts` a match's lines and `Thirds`, `contribution.ts`
  the carry and per-session contribution (shares and touch thirds per mode), `playlists.ts` ID map, `goal-range.ts`
  close/mid/long, `periods.ts` local days and periods, `playlist-filter.ts` filter groups, `schemas/` API params
  and response shapes),
  `scripts/` (standalone `capture.ts`; `make-icons.ts` packs `src/web/assets/icon.svg` and
  `icon-small.svg` into `src/web/public/favicon.ico`, a teal dev copy (`src/web/assets/favicon-dev.ico`,
  `icon-small-dev.svg`) and the tray set with state dots and a teal dev line into `src/tray/icons/`
  (`bun run icons`, output committed; on dev builds `vite.config.ts` adds the dev favicon and aliases
  `@channel/logo.svg` to the teal logo, and the dev exes embed the teal icon); `build-tray.ts` compiles the tray with `csc.exe`;
  `build-exe.ts` the shared `bun build --compile` args and `COPYRIGHT` (exes, tray, installer; LICENSE repeats it);
  `build-release.ts` (`bun run build-release [--tag vX.Y.Z]`:
  prod web, exe and tray staged in `release/app`, `rcedit.ts` sets `InternalName`, a smoke run of the exe, then
  `installer/grindlog.iss` through ISCC into `release/`); `sign-release.ts` (`bun run sign-release vX.Y.Z`: minisign
  a CI draft and upload the `.minisig`); `.github/workflows/release.yml` builds a draft on a `v*` tag; how to
  release: `docs/releasing.md`;
  `stop.ts`, `autostart.ts`, `move-data.ts` (`bun run move-data <from> <to> [--copy]`: a verified
  copy of a data dir without `bin`; a move keeps the source as `<to>.pre-move-backup`), `replay.ts` fake Stats API,
  `import-capture.ts` (also writes records), `recompute.ts`, `make-fixture.ts`, `definitions.ts`,
  `rules-diff.ts`), `test/fixtures/`
  (anonymised capture excerpts), `test/e2e/` (Playwright on Node: `fixtures.ts` starts
  `stack.ts` under Bun, which seeds a temp data dir and runs the real tracker against a gated
  replay; `shell.spec.ts`).
- Root docs: `README.md` (friends first: install, privacy, updates, uninstall, building), `LICENSE` (MIT),
  `THIRD_PARTY_NOTICES.md` (what ships: Bun and zod in the exe, the dashboard's packages; the installer puts it
  and LICENSE next to the app as `.txt`), `CHANGELOG.md` (Keep a Changelog; Unreleased moves to the version at
  release), `CONTRIBUTING.md` (working rules for people and AI agents).
- `bun run recompute` rebuilds match records in `tracker.db` from `raw.db` (safe with the
  tracker running; never deletes records).
- Rules: `docs/definitions.md` is generated from `src/server/rules/registry.ts` (`bun run
  definitions`, which also writes `src/server/rules/constant-pins.json`; a test fails when out of
  sync or when a constant changed without a version bump). To change a rule, one at a time: edit its entry and bump its
  version, `bun run rules-diff` (recomputes into a scratch DB and reports what moved; read-only on
  the data dir), ADR if past the gate, `bun run definitions`, `bun run deploy`.
- `STATS_API_URL` points `bun run start` at a replay: `bun run scripts/replay.ts <file> --port P`.
- `bun run check` = typecheck + lint (zero warnings) + tests (Vitest under Bun);
  `bun run start` runs the server from source on the dev install's data dir and port 49102;
  `bun run dev` runs it beside the background one (`.dev-data/`, port 49101); `bun run stop`
  stops it (`GRINDLOG_PORT=49101` for dev). `bun run web:dev` serves `src/web` on
  `127.0.0.1:5173` with `/api/` proxied to the dev tracker; `bun run web:build` builds `dist/`.
  `bun run e2e` builds `dist/` and runs Playwright in the installed Chrome (`GRINDLOG_E2E_KEEP=1` keeps
  the temp data dir and its logs). Bun lives at `~/.bun/bin/bun` and may not be on PATH.
- Channel: every source run and the CLI install are the dev channel (`GrindlogDev`, port 49102,
  `grindlog-dev.exe`, task `GrindlogDev`, "Grindlog Dev" with a Dev badge). Only a build with
  `GRINDLOG_CHANNEL=prod` baked in (`--define`, never read at runtime; only `build-release` passes it, with
  `GRINDLOG_VERSION`) is prod (`Grindlog`, 49100,
  `grindlog.exe`), so a friend's install and the developer's share no data, port, task or exe.
- Background: `bun run install-autostart` compiles `grindlog-dev.exe` and the dashboard (`bin\web`,
  which the tracker serves) into `%LOCALAPPDATA%\GrindlogDev\bin\`, registers the `GrindlogDev`
  logon task (`grindlog-dev.exe --supervisor`) and adds the `Grindlog Dev.lnk` Start menu app shortcut
  (`grindlog-dev.exe --open`: starts the tracker if needed, then opens `http://127.0.0.1:49102/`; it
  replaces older installs' `Grindlog Dev.url`). It runs that snapshot, not the repo. `bun run deploy` ships code
  changes: check, e2e, then install-autostart (builds while the old one records, then swaps and
  restarts), then recompute. `uninstall-autostart` removes the task, both shortcut kinds and `bin`.
- Data and logs: `%LOCALAPPDATA%\GrindlogDev\` (`logs\tracker.log`, `logs\supervisor.log` and `logs\launcher.log` (`--open`/`--quit`),
  5 × 5 MB, JSON lines); `GRINDLOG_DATA_DIR` overrides it for tests and dev runs. Also `tracker.db` (settings, seasons,
  IDs, match records, `meta` app state such as the last recomputed version; backed up to `backups/`, 7 kept), `raw.db` (raw events; after 90 days a
  match's UpdateStates are thinned to the scoreboard changes, with its car stats and camera
  snapshotted in `retention_matches`; a flagged match is kept whole, as is one whose thinned
  rebuild gives a different record (`retention/thin_mismatch`), and every other event is kept).

## Decisions
- `docs/decisions/2026-11-18-season-file-in-repo.md`: new seasons from `seasons.json` in the repo, fetched daily;
  scraping and a migration per release rejected; the user's edits and deletes always win.
- `docs/decisions/2026-11-10-tray-view-contract.md`: `/api/tray` (header-gated GET, view from the pure `trayView`);
  toasts through the tray, acked with a 10 s PowerShell fallback; acks name the tracker run; `/`-only urls.
- `docs/decisions/2026-11-10-tray-process-model.md`: the tray exe as a second supervised child; exit 0 = Quit,
  3 = stdin closed; the quit protocol and own-pid check; tray logs through `supervisor.log`; corrects Task
  Scheduler End (it ends the whole tree).
- `docs/decisions/2026-10-21-query-sessions-baseline.md`: sessions cut at read time over every
  match, key = first match's GUID; baseline = 30 days before the session; "everything" leaves out
  private and offline.
- `docs/decisions/2026-10-20-raw-thinning.md`: retention thins old UpdateStates and keeps every
  other event; dense outputs snapshotted; flagged matches kept whole; dense rules in the registry.
- `docs/decisions/2026-10-20-rule-registry-versions.md`: one rule registry generates the
  definitions doc; each match stores the rule versions it was computed under; rules-diff warns per
  match, reviews per column.
- `docs/decisions/2026-10-20-match-extras-play-view.md`: match extras and goal points read one
  live-play view; shot, aerial, touch, woodwork and goal-origin rules; registry with ranges.
- `docs/decisions/2026-10-20-match-records-per-player.md`: match records cover every player and
  "you" is joined at read time; result with no winner; camera share; final player stats.
- `docs/decisions/2026-10-19-supervisor-autostart.md`: the background tracker is a compiled
  snapshot run by a supervisor exe from a logon task; exit codes; the port as single-instance guard.
- `docs/decisions/2026-10-19-recorder-websocket-raw-store.md`: recorder reads the Stats API over
  WebSocket, stores raw and dedups on read, attribution to a match is final at write time.
- `docs/decisions/2026-10-16-bun-runtime.md`: Bun runtime, Vitest under Bun, Playwright on Node;
  Task Scheduler doesn't restart a crashed task.

## Plans
- `docs/plans/2026-11-18-public-release-map.md`: the public release map (order agreed 2026-11-18); take the first open step.
- `docs/plans/2026-11-18-season-file.md`: public release step 1, seasons from `seasons.json` in the repo: migration,
  sync rules, daily fetch, the Settings switch; review log.
- `docs/plans/2026-11-17-motion.md`: motion build: tokens and reduced motion, shared button and press, dialog
  fade-rise, sliding indicators, chart draw/tween, page transitions and the redirect guard, Settings motion.
- `docs/reviews/2026-11-17-motion.md`: motion build review summary.
- `docs/plans/2026-11-16-contribution-stats.md`: friends release step 6.1, contribution stats: the `touch_thirds`
  rule and migration, `shared/contribution.ts`, the recap's Contribution and touches panels, the match page's
  touch rows, named goal hovers; implementation notes per package and review log.
- `docs/reviews/2026-11-16-contribution-stats.md`: step 6.1 review summary (two packages, 2 rounds each,
  nothing deferred).
- `docs/plans/2026-11-16-icons.md`: friends release step 6, icons: Lucide icon + text across the dashboard,
  the statfeed PNGs dropped, explicit icon keys instead of label matching; plan review and review log.
- `docs/reviews/2026-11-16-icons.md`: step 6 icons review summary (2 rounds, nothing deferred).
- `docs/plans/2026-11-12-wp7-proof-before-friends.md`: step 4 package 7, proof before friends: v0.1.0/v0.1.1 from CI,
  clean account, healthy update and feed-override rollback, Sandbox, prod data copy, Stats API write, VirusTotal.
- `docs/plans/2026-11-12-wp6b-updater-apply.md`: step 4 package 6b, updater apply, health check and rollback; review
  log and the step-8 rehearsal.
- `docs/plans/2026-11-12-wp6a-updater-check.md`: step 4 package 6a, updater check, download and verify (state
  files, minisign verifier, feed override, `/api/update`, tray lines, Settings Updates); what 6b inherits.
- `docs/reviews/2026-11-11-wp5-installer-release.md`: step 4 package 5 review summary (2 rounds, 1 disputed); what only
  the clean-account checklist and the first tag can test.
- `docs/plans/2026-11-11-wp5-installer-release.md`: step 4 package 5, installer and release pipeline: release build,
  Inno script, tag workflow, `sign-release`, rcedit pin; clean-account checklist; review log.
- `docs/reviews/2026-11-10-wp3b-tray-view.md`: step 4 package 3b review summary (2 rounds, 1 deferred); manual checks.
- `docs/plans/2026-11-10-wp3b-tray-view.md`: step 4 package 3b, tray view: icon prototype verdict, icon set,
  `trayView`, notifier, `/api/tray`, Tray.cs poll loop; balloon check result; implementation notes; review log.
- `docs/reviews/2026-11-10-wp3a-tray-process-model.md`: step 4 package 3a review summary (4 rounds, 1 limit recorded).
- `docs/plans/2026-11-10-wp3a-tray-process-model.md`: step 4 package 3a, the tray exe, supervisor with two
  children, quit protocol, `--quit` covering the tray, manual checks; 3b outline; review log.
- `docs/plans/2026-11-10-wp2b-release-data.md`: step 4 package 2b, the release recompute and its `meta` marker,
  `records_recomputed`, `Cache-Control: no-cache`, tabs reloading once on a new version; review log (3 rounds).
- `docs/reviews/2026-11-10-wp2a-process-control.md`: step 4 package 2a review summary (3 rounds, 2 disputed nits).
- `docs/plans/2026-11-10-wp2a-process-control.md`: step 4 package 2a, the detached-spawn spike, baked version,
  `version`/`pid` in `/api/status`, `--open`, `--quit` and the shared control module; review log.
- `docs/reviews/2026-11-10-wp1-rename-identity.md`: step 4 package 1 review summary (3 rounds, 1 deferred,
  1 disputed).
- `docs/plans/2026-11-09-wp1-rename-identity.md`: step 4 package 1, grindlog ids, the dev/prod channel,
  one exe, the logs dir and the data move to `GrindlogDev`; review log.
- `docs/plans/2026-11-06-distribution-map.md`: the wayfinder map for friends release step 4: installer, tray,
  auto-update, releases and the dev/prod split (frozen 2026-11-09; its Decisions so far is the design, built as seven BACKLOG work packages).
- `docs/plans/2026-11-05-friends-release-map.md`: the friends release map, the ordered steps to shipping
  and each one's status. Start here for what's next.
- `docs/reviews/2026-11-05-name-and-icon.md`: name and icon review summary (2 deferred, 2 disputed).
- `docs/plans/2026-11-05-name-and-icon.md`: friends release step 2, the rename to Grindlog and the
  app icon (B3), review log.
- `docs/plans/2026-11-03-display-drift.md`: display drift plan (audit of display drift and data
  sense across every page; WP-A colour roles and three number bugs, WP-B the big-number face and
  StatCard, WP-C the shared Section heading and global panel/table/muted/up/down), review log.
- `docs/reviews/2026-11-05-pre-friends-fixes.md`: pre-friends backlog fixes review summary (one
  finding deferred to the Watch list).
- `docs/reviews/2026-11-03-wp-a-display-drift.md`: WP-A review summary (4 rounds).
- `docs/reviews/2026-11-04-wp-c-display-drift.md`: WP-C review summary.
- `docs/plans/2026-11-02-wp9b-friends-page.md`: WP9b plan (the Friends page: suggestion banners,
  pair cards, never-suggest list; a friend's scorebug and with/against zones, mode switch, carry and
  compare, head-to-head pager; `readLobbies`, `/api/friends/detail`, suggest-again), review log.
- `docs/reviews/2026-11-02-wp9b-friends-page.md`: WP9b review summary (2 rounds).
- `docs/plans/2026-11-02-wp9a-friends-data.md`: WP9a plan (friends tables, suggestions, `?with=`
  filter, friend remarks), review log.
- `docs/reviews/2026-11-02-wp9a-friends-data.md`: WP9a review summary.
- `docs/plans/2026-10-28-wp8b-settings-tables.md`: WP8b plan (Settings: the You table answering
  "is this you?", the Seasons table with add/edit/delete, `/api/ids` and `/api/seasons` writes,
  the section list), review log.
- `docs/reviews/2026-10-28-wp8b-settings-tables.md`: WP8b review summary (2 rounds).
- `docs/plans/2026-10-28-wp8a-settings.md`: WP8a plan (Settings: per-key store + Zod, `/api/settings`,
  theme / clock / speed, start page and default filters, rolling window via `?window=`, remarks and
  mood-line switches, the Settings page), review log.
- `docs/reviews/2026-10-28-wp8a-settings.md`: WP8a review summary (3 rounds).
- `docs/plans/2026-10-28-wp7b-trends-charts.md`: WP7b plan (Trends charts: the big chart By date /
  By match with rolling 20 served by `/api/period`, auto x mode and `x` in the URL, the W/L chart
  whose columns open a day's recap or a week/month), review log.
- `docs/reviews/2026-10-28-wp7b-trends-charts.md`: WP7b review summary (4 rounds).
- `docs/plans/2026-10-27-wp7a-trends-page.md`: WP7a plan (Trends page: shared buckets and previous
  period, `/api/period` with previous + buckets, `/api/played-days`, period controls, year strip,
  header, six tiles with sparklines), review log.
- `docs/reviews/2026-10-27-wp7a-trends-page.md`: WP7a review summary (2 rounds).
- `docs/plans/2026-10-27-wp6b-remarks.md`: WP6b plan (recap remarks: mood bands, tiered quips,
  picks stored per session + filter, repeat avoidance, ↻), review log.
- `docs/reviews/2026-10-27-wp6b-remarks.md`: WP6b review summary (3 rounds).
- `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`: WP6a-c plan (Matches & numbers, the
  match page with its side list, scoreboard and flag note, links from cards and goal dots, the
  `match_flags` read rule), review log.
- `docs/reviews/2026-10-27-wp6a-c-matches-and-match-page.md`: WP6a-c review summary (2 rounds).
- `docs/plans/2026-10-27-wp6a-b-overview-sections.md`: WP6a-b plan (Overview sections 5–8, the SVG
  goal map), review log.
- `docs/reviews/2026-10-27-wp6a-b-overview-sections.md`: WP6a-b review summary (3 rounds).
- `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`: WP6a-a plan (session picker, playlist
  filter, Overview 1–4, narrowed refresh), review log.
- `docs/reviews/2026-10-26-wp6a-a-recap-navigation.md`: WP6a-a review summary.
- `docs/plans/2026-10-21-wp5b-b-harness-install.md`: WP5b-b plan (Playwright harness with a seeded
  temp DB and gated replay, axe, web build at install, `bin\web`, Start menu shortcut), live install
  checks, review log. Confirms Playwright on Node.
- `docs/reviews/2026-10-21-wp5b-b-harness-install.md`: WP5b-b review summary (4 rounds).
- `docs/plans/2026-10-21-wp5b-a-web-shell.md`: WP5b-a plan (tooling, themes, header, shared SSE via
  SharedWorker, TanStack Query), live Chrome check, review log.
- `docs/reviews/2026-10-21-wp5b-a-web-shell.md`: WP5b-a review summary (3 rounds).
- `docs/plans/2026-10-21-wp5a-b-api.md`: WP5a-b plan (host `mount`, router, static, SSE, page
  composition, endpoints, schemas), live replay check, review log.
- `docs/reviews/2026-10-21-wp5a-b-api.md`: WP5a-b review summary (3 rounds).
- `docs/plans/2026-10-21-wp5a-a-query-logic.md`: WP5a-a plan (periods, playlist filters, sessions,
  aggregates, baseline, read layer, `queries` rules), real-DB figures, review log.
- `docs/reviews/2026-10-21-wp5a-a-query-logic.md`: WP5a-a review summary (2 rounds).
- `docs/plans/2026-10-20-wp4c-b-retention-split.md`: WP4c-b plan (thinning rule, raw migration 2,
  snapshot substitution in `readMatch`, dense rules, retention rewrite), 46-match figures, review log.
- `docs/plans/2026-10-20-wp4c-a-rule-registry.md`: WP4c-a plan (registry and backfill, generated
  definitions, migration 4 `rule_versions`, read-only `openDb`, `rules-diff`), review log.
- `docs/reviews/2026-10-20-wp4c-a-rule-registry.md`: WP4c-a review summary (9 rounds).
- `docs/reviews/2026-10-21-wp4c-b-retention-split.md`: WP4c-b review summary (2 rounds).
- `docs/plans/2026-10-20-wp4b-match-extras.md`: WP4b plan (play view, extras registry, checks,
  migration 3, `match_goals`, goal range), real-data figures, review log.
- `docs/reviews/2026-10-20-wp4b-match-extras.md`: WP4b review summary.
- `docs/plans/2026-10-20-wp4a-match-records.md`: WP4a plan (schema, record writer, recompute,
  result, MVP, pending guess, playlist map), capture-driven changes, review log.
- `docs/plans/2026-10-19-wp3b-background-process.md`: WP3b plan (host, supervisor, autostart,
  game watch, stop/dev scripts), spike and footprint figures, review log.
- `docs/plans/2026-10-19-wp3a-recorder.md`: WP3a plan (recorder: lifecycle, raw store, dedup,
  summary and checks, client, replay/import tools, fixtures); done, with review log.
- `docs/plans/2026-10-16-wp2-storage.md`: WP2 plan (SQLite storage, migrations, backups,
  retention, Bun check).
- `docs/plans/2026-10-16-v1-roadmap.md`: v1 roadmap, ordered work packages WP1–WP9 with per-WP
  status.
- `docs/plans/2026-10-16-wp1-foundations.md`: WP1 plan (package, strict TS/ESLint, Vitest,
  logger, constants); done.
- `docs/reviews/2026-10-20-wp4a-match-records.md`: WP4a review summary (12 rounds, 1 deferred,
  1 disputed).
- `docs/reviews/2026-10-16-wp1-foundations.md`: WP1 review summary (2 rounds, all fixed).
- `docs/plans/2026-10-15-rl-tracker-features-map.md`: the wayfinder map for the v1 feature spec
  (done; the spec WPs cite; build order lives in the roadmap).

## Research
- `docs/research/2026-11-17-ui-motion.md`: what motion to add and how (tokens, springs, reduced motion); its
  "Prototype verdict" section is the motion build's spec.
- `docs/research/2026-11-17-route-view-transitions.md`: page-transition mechanisms for React Router, ranked.
- `docs/research/2026-11-06-installer-updater.md`: installer and self-update tooling; recommends Inno Setup plus a
  small hand-written updater, with Velopack the runner-up.
- `docs/research/2026-11-06-tray-technology.md`: what to build the tray with; recommends a .NET Framework 4.8
  `NotifyIcon` exe, with memory and antivirus behaviour unverified.
- `docs/research/2026-11-06-code-signing.md`: Windows code signing options, cost and eligibility; none removes
  the SmartScreen warning on day one.
- `docs/research/2026-10-19-weekend-captures.md`: weekend captures (casual/ranked, private,
  spectated 1v1): duplicates, mis-tagged teardown, winner/MVP sources, bots, WP3a requirements,
  captures still wanted.
- `docs/research/2026-10-16-bun-windows-check.md`: Vitest/Playwright under Bun, Task Scheduler
  restart and console behaviour (sources only; results in the Bun ADR).
- `docs/research/2026-10-15-rl-stats-api-and-trackers.md`: Stats API events and limits, MMR
  sources, features of existing trackers, season dates.
- `docs/research/2026-10-15-rl-playlist-ids.md`: playlist ID to name mapping and how to handle
  unknown IDs.
- `docs/research/2026-10-15-live-capture-findings.md`: what the Stats API actually sends in online
  play (6 captured matches): car state for your team only, match-end and leave signatures, playlist
  IDs, and stream volume.

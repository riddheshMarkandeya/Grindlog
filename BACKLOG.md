# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[test-coverage, Med, Standard]** `test/e2e/season-file.spec.ts:8` is flaky and blocks `bun run deploy`:
  the S25 row never appears within 15 s. It failed 2 of 2 deploys and 1 of 2 solo runs on 2026-11-24 (at commit
  4416217, which only changed Clutch display strings). It then passed 8 of 8 solo runs (`--repeat-each 8`) and a
  full run (157 passed). On a failing run, the tracker log showed S25 added and `seasons_changed` published to 1
  subscriber. Lead: the page's seasons read races the sync (`GRINDLOG_SEASONS_DELAY_MS=1000`), or the refetch after
  the event misses the row. Not yet reproduced on demand; first step is a loop with a higher repro rate (e.g. the
  full `bun run deploy` sequence, `GRINDLOG_E2E_KEEP=1`, trace on).

- [ ] **[misc, Med, Trivial]** v1 roadmap (`docs/plans/2026-10-16-v1-roadmap.md`): every work package
  is deployed (WP9, the last, on 2026-11-02). Open items from the work packages:
  - **[design, Low, Trivial]** (from public release map step 8) Add back the themes midnight, dusk, steel and daylight (values in the
    `prototype/settings-layout` tokens; each needs a `tokens.css` block, and the token test covers
    it). Daylight has the real cost: every chart gets checked in light mode, and so does the WP6c
    share card's corner glow (built for dark themes). Record:
    `docs/plans/2026-10-21-wp5b-a-web-shell.md`.
  - **[design, Low, Trivial]** Around 2026-12-27, check the "What stood out" threshold
    (`STOOD_OUT_MIN_PCT`, 10%). On 2026-10-27, the 5 sessions that had a baseline had 4–6 stats past
    ±10% (3–5 past ±20%). Every baseline was under a month old (13–65 matches), so swings ran
    large. Re-run that table against full 30-day baselines and pick the number then. Record:
    `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.
  - **[feature, Low, Standard]** Per-tier and per-trigger remark switches: deferred from v1
    (user, 2026-10-28, simplest settings first). WP8a ships only the master and mood-line
    switches, which change what's shown and not the pick; clock and speed go through
    `fillRemark` there. If the switches come back, they drop triggers before `pick()`, and a
    stored pick whose trigger is switched off re-picks, as a cut line does. Record:
    `docs/plans/2026-10-27-wp6b-remarks.md`, `docs/plans/2026-10-28-wp8a-settings.md`.
  - **[performance, Low, Standard]** The remarks GET and ↻ each build the full `sessionDetail`
    (session cut, goals, summaries, baseline), so a recap load does that work twice. Fine at 76
    matches; give remarks a lighter read if recap loads get slow. Record:
    `docs/plans/2026-10-27-wp6b-remarks.md` (Review log).
  - **[design, Low, Standard]** The remarks GET writes the first pick, and the request-header
    guard covers only non-GET methods, so another site could fix first-view lines (and fill the
    repeat history) for sessions you haven't opened, if it guessed their keys and the port. Make
    the first-view write a POST, or send the header on that GET, if the app is ever reachable
    beyond localhost. Record: `docs/plans/2026-10-27-wp6b-remarks.md` (Review log).
  - WP3a's manual check still open: Ctrl+C on `bun run start` mid-match should end `tracker.log`
    with `app/stopped` (Git Bash can't send a console SIGINT). The shutdown endpoint path is
    covered by `src/server/main.test.ts`.
- [ ] **[design, Med, Trivial]** The "no data" toast is suppressed over the full-screen game and
  only waits in the notification panel. (Its body now names the ini problem to fix.) WP5's status
  display is the reliable signal (`statsConfig()` carries the same diagnosis). WP8 has no toast switch, dropped
  2026-10-28 (user, simplest settings first). An urgent/priority toast is still untried. Record: Verification results in
  `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[refactor, Low, Standard]** `scripts/capture.ts` keeps its own envelope parse
  (`eventNameOf`/`matchGuidOf`), hardcoded URL and reconnect loop; reuse `parseFrame`,
  `statsApiUrl` and maybe `startStatsClient`, or retire it now the recorder stores raw events.
  Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.
- [ ] **[refactor, Low, Standard]** The season sync (`src/server/seasons-file.ts`) and the update checks
  (`update/checker.ts`, `update/feed.ts`) each have their own delayed-then-interval scheduler and capped
  GitHub fetch. Extract a shared `startPeriodicJob` and a streamed `fetchText({maxBytes, signal})`, which would
  also give the season fetch a real byte cap where today it checks Content-Length and then the text length.
  Record: Review log in `docs/plans/2026-11-18-season-file.md`.
- [ ] **[design, Low, Standard]** (from public release map step 8) Controls drift: about six button styles, two segmented controls
  (Trends `.xmode` buttons, Settings `.seg` radios, plus Friends' own `.seg`), two `.link` rules,
  and Trends `.picks button` against the match page's `.chip`. One shared set, as the display-drift
  work did for panels and tables. On the way, `PeriodControls.tsx:45` uses `styles.controls`,
  which no CSS defines. Recurring (user, 2026-11-22): after a UI change, re-check the current controls for new drift
  rather than treating this as done once. The four dropdowns are now one shared set (`components/Select.tsx`,
  2026-11-22, `docs/plans/2026-11-22-dropdowns-and-trio.md`). Record: `docs/plans/2026-11-03-display-drift.md`.
- [ ] **[design, Low, Standard]** (from public release map step 8) Trends data line: the line, dots and sparklines use `--accent`,
  which the colour rule in `src/web/styles/tokens.css` now keeps for selection and focus; on oled
  the accent is white, the same as the text. Choose a data colour (a new token, checked on every
  theme). Record: `docs/plans/2026-11-03-display-drift.md`.
- [ ] **[feature, Low, Standard]** (from public release map step 8) Settings › Appearance: choose the colour pair for sides (blue /
  orange) and for results (green / red), each on its own and apart from the theme (user,
  2026-10-28). Also helps red-green colour blindness. The pairs are already tokens
  (`--blue`/`--orange`, `--win`/`--loss` in `src/web/styles/tokens.css`), so it's a setting that
  overrides them on `<html>`, plus a check that each pair stays readable on every theme. Unblocked
  (2026-11-04): each token now has one meaning, written at the top of `tokens.css`, and
  `--up`/`--down` are mixed from `--win`/`--loss`, so overriding the result pair moves both.
- [ ] **[idea, Low, TBD]** (from public release map step 8) Playful UI touches: the flat peeling corner (variant L on the
  `prototype/recap-stood-out` branch, never merge) was liked as a stood-out mark (user, 2026-11-04).
  Look at where flat-but-fun details fit the dashboard. Trigger: a UI polish pass.
- [ ] **[idea, Low, TBD]** (from public release map step 8) A dashboard "What changed" card after an update, instead of the tray opening the GitHub
  release page (user, 2026-11-09). Needs markdown rendering for the release body, an update-state field and a way to
  dismiss it. Trigger: friend feedback asks for it. Context: "Release workflow" in
  `docs/plans/2026-11-06-distribution-map.md`.

- Deferred from friends release step 4 (distribution, done; design in the frozen map
  `docs/plans/2026-11-06-distribution-map.md`):
  - [ ] **[refactor, Low, Standard]** 2 (release-aware app) is done; left over: once a deployed exe has `--quit`,
    `stop.ts` and `stopInstalled` end a sleeping supervisor through it instead of `killExe`'s path-filtered kill
    (deferred from package 1's review, `docs/reviews/2026-11-10-wp1-rename-identity.md`).
  - [ ] **[bug, Low, Standard]** A match that fails every release recompute reruns the whole recompute at each start
    (the marker isn't written while any match fails). The tray shows the failed count as a line since 3b
    (`docs/plans/2026-11-10-wp2b-release-data.md`, `docs/plans/2026-11-10-wp3b-tray-view.md`).
  - [ ] **[misc, Low, Standard]** Rate-limit the rejected-request warn lines (`api/tray_rejected`, `write_rejected`,
    host `shutdown_rejected`): a page looping header-less requests writes one each and can rotate match diagnostics
    out of the logs. Deferred from 3b's review (`docs/reviews/2026-11-10-wp3b-tray-view.md`).

- [ ] **[misc, Low, TBD]** (from public release map step 9, deferred 2026-11-22) Code signing, once there are public
  downloads (SignPath wants a track record; Azure's option is US/Canada only). The Reddit post (2026-11-20) drew 0
  comments and v0.1.6 had 4 installer downloads on 2026-11-22. Trigger: around 2026-12-22, check the release
  download counts (`gh api repos/riddheshMarkandeya/Grindlog/releases`); start only if they've picked up.
- [ ] **[test-coverage, Low, Standard]** `season-file.spec.ts` "a season in the file shows up in Settings" timed out
  (S25 not listed within 15 s) once in a full `bun run e2e` on 2026-11-22; it passed 4 of 4 runs alone. Repeated the
  same way in a full run on 2026-11-24 (Tilt build; passed alone right after): the repeat is in, so the first sync's
  timing under load is next to look at.
- [ ] **[test-coverage, Med, Standard]** `tray.test.ts` "goes red within ~5 s of the tracker stopping" is flaky under
  the full suite: on 2026-11-19, 3 of 10 local `bun run test` runs took 7.6–8.3 s against its 6.5 s bound. It was
  already there before the 0.1.6 icon change (1 of 5 at `9a0fccf`), though that change's `bun build --compile` test
  (`scripts/exe-icon.test.ts`) adds load and may make it more frequent. Alone it passes every time. The nominal path is
  already up to ~5.5 s (the next poll up to 2 s away, then two failed polls of up to 1.5 s each with a 0.5 s retry
  between), so a loaded machine overruns. CI runs `bun run check` on a release tag, so a failure there is re-run
  first. Leads: time it from the first `poll_failed` instead of the server stop, which takes the poll phase out; or
  keep the compile test from running beside the tray tests.
- [ ] **[feature, Low, Standard]** (from the analytics map, deferred 2026-11-23) A concede heatmap over a whole
  period on Trends, as a density view, since ~1,900 goals as dots would just be clutter. Lowest priority: the
  recap's "Where the goals came from" already shows scored and conceded per session and match. Record:
  `docs/plans/2026-11-23-analytics-map.md`.
- [ ] **[bug, Med, Standard]** (found in analytics step A, 2026-11-23) An own goal is credited to the wrong team.
  Match `6437938E11F1E4A6451A93B20A8916A6` (Ranked Doubles, final 3–7) stores 2 goals for team 0 and 8 for team 1.
  In raw.db, team 0's scoreboard goes 2→3 at seq 1500 while no team-0 player's goal count moves, then the GoalScored
  at seq 1501 names a team-1 player as `Scorer` (`TeamNum: 1`, also the last toucher). The Stats API names whoever
  put the ball in, and the recorder credits a goal to `Scorer.TeamNum`. The `own_goal` rule ("the scoring team never
  hit the ball since kickoff") can't catch it, because the credited team is the one that touched it. Ruled out:
  replay goals (every replay GoalScored has an empty scorer and is dropped) and a lost goal (10 live GoalScoreds,
  10 scoreboard steps). The fix changes the goal-team rule: credit a goal to the team whose scoreboard score rose
  at that GoalScored (falling back to `Scorer.TeamNum` with no scoreboard step), and make `own_goal` also mean "the
  credited team isn't the scorer's", with no scorer credit or point. One rule at a time with version bumps,
  `rules-diff`, then `release-recompute` moves it. Clutch already leaves this match out of goal-order stats (goals
  per team ≠ score), so it doesn't wait on the fix. Seen 1 time in ~1,931 goals.
- [ ] **[design, Low, Standard]** (from analytics step A, the user's future task) Drop support for unknown and
  limited-time playlists: they'd stop showing in the playlist filter and the stats. `clutchCounts` in
  `src/shared/clutch.ts` already gives the casual/ranked/tournament rule and can be reused.

## Watch list
- [ ] **[bug, Low, Standard]** Trigger: the first match flagged `goals_clocked` (a goal with no
  `ClockUpdatedSeconds` reading before it) or `clock_overtime_flagged` (a reading whose `bOvertime` isn't a boolean; none in 1,988 stored
  goals). Fit the `goal_clock` rule (and, for a bad `bOvertime`, `regulation_length`) to that match. Record: `docs/plans/2026-11-24-goal-clock.md`.
- [ ] **[bug, Low, Standard]** Trigger: the first match flagged `moments_clocked` (a Shot, Save or Assist statfeed
  with no clock: no reading before it, in a match joined in progress, with no regulation length, or whose first
  reading is more than 2 s short of the length (early readings missing); none in 6,838 stored moments, where the 9
  kickoff shots before the first tick take the regulation length). Fit the
  `timeline_moments` rule to that match. Record: `docs/plans/2026-11-24-goal-timeline.md`.
- [ ] **[bug, Low, Standard]** Trigger: the first match flagged `forfeit_end_clocked` (a forfeit with no Win
  statfeed, or no clock reading before it; all 81 stored forfeits have both). Its end clock would be the reset to 0;
  fit the `end_clock` rule to where that match's forfeit shows. Record: `docs/plans/2026-11-24-goal-timeline.md`.
- [ ] **[feature, Low, Standard]** Trigger: the analytics map's Tilt section (step B) says "You drop …" (2.5 standard
  errors) in the wide all-matches view, not only in a filtered one, where four buckets checked per view leave room
  for a chance false alarm. Then add an in-session nudge (e.g. "3 losses in a row; your win rate here is X%").
  Upheld 2026-11-24 after the Tilt prototype: no dip in any view on real data. Record:
  `docs/plans/2026-11-23-analytics-map.md`.
- [ ] **[bug, Low, Standard]** Trigger: a user reports the header picker disagreeing with the page, or runs two
  dashboard tabs. An account picked in one tab leaves the other tab's picker on the old value, while that tab's
  pages follow the new account at their next refetch. A reload corrects it. Fix with a hub event on a settings
  save that invalidates `settings` plus `staleAfterTables`. Record: Review log round 1 in
  `docs/plans/2026-11-22-account-profiles.md`.
- [ ] **[refactor, Low, Trivial]** Trigger: after a Bun upgrade, `build-release`'s Icon step prints "already right"
  (Bun fixed oven-sh/bun issue 32428, "only the first icon in the .ico is embedded"), or it fails with a resource
  layout `scripts/exe-icon.ts` doesn't know. On "already right", delete the repoint (`fixExeIcon` and its two
  callers) and keep the read-back after rcedit as the check. On a new layout, fit the repoint to it. Record:
  `docs/plans/2026-11-19-sharp-icons.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a friend shares a PC with another Windows user who also runs
  Grindlog. Only one user per PC works: the port (49100) is machine-wide, and so is the logon task name
  (`\Grindlog`). Seen on 2026-11-13 installing on Test-User while the main account ran prod: the tracker and tray
  couldn't start, and the installer said "schtasks /Create exited 1" (the other user owns the task, and Test-User's
  `/Query` doesn't see it). That dialog's "open it from the Start menu" advice doesn't help then, because the port
  is taken too. Fix: a per-user task name and port, or a clear "already running for another user" message.
- [ ] **[test-coverage, Low, Standard]** Trigger: `apply.test.ts` "a new version that keeps crashing is rolled back"
  timing out on CI a second time (first: v0.1.1 run `43348180704` attempt 1, 5000 ms against 75 ms locally; the re-run
  took 718 ms). Lead to check first: `restore.ts` renames through `renameRetry`, whose real `Bun.sleepSync` waits up
  to 2 s per held file, so a runner holding new SQLite files can push the test past 5 s. Likely fix: let the restore
  take `renameRetry`'s `sleepSync`/`now` so the test doesn't wait for real. Record:
  `docs/plans/2026-11-12-wp7-proof-before-friends.md` Results.
- [ ] **[bug (latent), Low, Standard]** Trigger: a tray `exited` with code 4 outside a sign-out, or a sign-out that
  hangs on Grindlog. At a clean account's sign-out (WP7 step 4) the tray exited with code 4, which isn't one of its
  own codes (0-3), and the supervisor scheduled a 5 s restart that the logoff cut off. Harmless there. If it matters,
  have the supervisor treat a session ending as a stop rather than a crash. Record:
  `docs/plans/2026-11-12-wp7-proof-before-friends.md` Results.
- [ ] **[bug (latent), Med, Standard]** Trigger: a `restore_no_backup` line, or a rollback restoring an older backup
  than expected, in a friend's `updater.log`. The restore picks the newest pre-migration backup at the old schema
  version from up to 24 h before the apply (the tracker reuses one that young rather than making another), and no
  real migration that failed and restarted several times has been seen. Fit the pick to that log. Record:
  `docs/plans/2026-11-12-wp6b-updater-apply.md` Progress.
- [ ] **[bug (latent), Low, Standard]** Trigger: a friend's `supervisor.log` showing `apply_starting` hourly with
  `not_started` each time (`no_rollback_installer`, `updater_died`). A start that keeps failing retries once an hour
  and isn't shown in the tray or Settings (`not_started` isn't in `SHOWN`), and `available` stays. The Inno script
  always writes `previous\Grindlog-Setup.exe`, so no real case is known. Then add a line ("Update X couldn't start")
  or stop after a few tries. Record: `docs/plans/2026-11-12-wp6b-updater-apply.md` Review log, round 1.
- [ ] **[bug (latent), Low, Standard]** Trigger: a `logon_task/unexpected_xml` line in a friend's log. The "Run at
  Windows startup" read takes the task's state from `<Settings>` in `schtasks /Query /XML` (no `<Enabled>` there = on,
  `false` = off), captured on one Windows 11 PC only; an unreadable shape shows the switch as unavailable. Fit
  `parseTaskState` to that XML.
- [ ] **[feature, Low, Standard]** Trigger: a friend loses a match to an update rollback. Rollback restores the
  pre-migration backup, so matches the failed version recorded are dropped; the failed database is kept until the next
  successful update. Then add a manual merge of its newer matches. Record: "Updater design" in
  `docs/plans/2026-11-06-distribution-map.md`.
- [ ] **[feature, Low, Standard]** Trigger: a friend's match gets flagged. The log shows the flag but not the events,
  which live only in their `raw.db`, so add a way to export one match's raw events (for now they'd send the whole
  `raw.db` through a file host). Record: "Diagnostics for friends" in `docs/plans/2026-11-06-distribution-map.md`.
- [ ] **[performance, Low, Standard]** Trigger: the tracker's working set passes 100 MB in real play, or a friend reports
  high memory. Two real matches on 2026-11-09 peaked at 31.9 MB (18.5 MB private). The WP3b 10× replays showed a ~75 MB
  one-step jump at replay start, mostly shared pages, that real play didn't reproduce. Record: "Memory footprint
  measurement" in `docs/plans/2026-11-06-distribution-map.md`, "Footprint" in `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[improvement, Low, Standard]** Trigger: a friend's other tool needs a `WebPort` other than 49124. One-click
  setup moves the game to 49124 after a warning, and there is no port setting. Then consider a setting, or following
  the port in the file.
- [ ] **[bug (latent), Low, Standard]** Trigger: a `game/stats_setup_key_added` line in a friend's log. The setup
  card's fix inserts a wrong exporter key the Documents ini lacks (after the section's last setting), or appends the
  whole section. No game-written Documents ini has been seen without them, so the insert is fitted to an assumption.
  Check that the game read the inserted line, and fit `fixStatsIni` to that file.
- [ ] **[bug (latent), Low, Standard]** Trigger: the first Steam user. Nothing confirms the Documents ini path for Steam;
  Epic is the only install locator. `user_missing` flags a wrong path, so fit it to that user's log.
- [ ] **[bug (latent), Low, Standard]** Trigger: `send_rate_off` returns after a game patch on a machine that had it on.
  The Documents ini's `[IniVersion]` matches the default ini's timestamp, so a patch might regenerate it (not seen). The
  setup card covers it; check whether the game rewrote the file before changing anything.
- [ ] **[improvement, Low, Substantial]** Trigger: a user's `raw.db` passes about 5 GB, or anyone complains about
  disk use. A full match takes about 2.3 MB and a thinned one about 0.6 MB (real data, 2026-11-06), and thinned
  matches stay forever, so growth has no cap: an estimated 27 GB after a year at 10 h/day, 5 GB at 2 h/day.
  Options: compress stored events (not measured), or thin sooner (30 days saves about a quarter in the first year
  at 10 h/day, but less history can be fully recomputed). Recomputes need the raw events, so deleting them isn't one.
- [ ] **[bug (latent), Low, Standard]** Trigger: "Couldn't make the image" again on the share card. It
  showed once on 2026-11-06 at the end of a live session, then cleared by itself. The same card exported
  fine in the same Chrome, and in a clean one, so there is no repro. Next time, before retrying, read
  `[grindlog] share/export_failed` in that tab's console, since the error goes nowhere else: `empty blob` means
  the canvas gave nothing back, and anything else is the SVG step of `toBlob`.
- [ ] **[tooling, Low, Standard]** Trigger: a rules-diff report saying "removed: N in an ignored
  playlist" while the same run's recompute skipped or failed an ignored-playlist match. `diffRecords`
  counts every stored ignored-playlist match missing from the recompute as removed. A skipped or
  failed one actually keeps its record, which the report's skip and fail counts show. No stored
  freeplay record is left after the 2026-11-05 deploy, so this needs an un-ignore or a manual
  insert. Fix: pass recompute's ignored guids into the diff. Record: `ignored_playlist` commit body.
- [ ] **[a11y, Low, Standard]** Trigger: a report that a Settings section link, below 768px,
  leaves its heading partly under the sticky section row. The jump offset is a fixed
  `scroll-margin-top: 56px` (`Settings.module.css`, `.section h2`), and the row scrolls sideways at
  320px. Where scrollbars take space (Windows with classic scrollbars) the row is about 60px tall.
  Headless e2e hides scrollbars, so it passes. Fix: a taller offset, or measure the row. Record:
  `docs/plans/2026-11-03-display-drift.md` (WP-C, round 3).
- [ ] **[bug (accepted), Low, Standard]** Trigger: a friend or pair page showing old stats for
  someone already removed, after the removal was made in another tab. React Query keeps the
  cached page (staleTime Infinity) and a failed 404 refetch keeps its data; this tab's Remove
  drops the cached pages, but another tab's doesn't, until a reload or the next live event. A
  "404 wins over cached data" fix was tried and reverted (it lost focus on the swap and misfired
  after a re-add); the user chose to accept this. Record: `docs/plans/2026-11-03-friends-pairs.md`
  (part b, round 3).
- [ ] **[a11y, Low, Standard]** Trigger: a report that the friend or pair page's error state
  ("Not a friend", "Not both friends", or the Retry state) leaves focus on the page body. Focus
  moves to the h1 only once data loads (`FriendPage`/`PairPage` key the effect on `loaded`);
  outside part b's focus contract ("focus like Friend"), and Tab still reaches everything. Fix
  both pages together. Record: `docs/plans/2026-11-03-friends-pairs.md` (part b, round 2).
- [ ] **[design, Low, Standard]** Trigger: a `query/friend_switched_team` warn in tracker.log (a
  friend's `teams_seen` is 3, or yours with `you: true`). No captured match shows a mid-match team
  switch; a switched friend counts as "with you", and your own switch is judged by your final team.
  Fit the rule to the first real one. Record: `docs/plans/2026-11-02-wp9a-friends-data.md`.
- [ ] **[feature, Low, Standard]** Trigger: a `recorder/unknown_field` line in tracker.log for a
  playlist or mode name (e.g. under `UpdateState`'s `Game`). The Stats API sends only
  `Game.PlaylistId`, no name (checked 2026-11-02 across all raw events), so an unmapped id shows
  as "Unknown playlist (N)". The user wants the game's name used for an unmapped id once it sends
  one: store it with the match and let `playlistInfo` fall back to it.
- [ ] **[design, Low, Standard]** Trigger: a second Dropshot match (playlist 23 or 29) flagged
  `statfeed_matches_scoreboard`. The first one (2026-11-02, `9DF929B6…`) had no Shot statfeeds
  for any player while the scoreboard showed 27–33 shots each, so Dropshot may count shots
  (damage hits) without a statfeed. Then exempt Dropshot's shots from the check, or take
  Dropshot shots from the scoreboard. Playlists 81 and 90 (2026-11-02, likely Spike Drop and a
  points-scored LTM) stay unmapped: the user is fine with unknown casual extra modes.
- [ ] **[design, Low, Standard]** Trigger: an `ids/unknown_platform` warn in tracker.log, or the first
  `PS5|` or `Switch|` id in my_ids. The You table maps the raw primary-id prefix to a platform name
  (`src/shared/platforms.ts`); PS5 and Switch are mapped on assumption, never seen in a capture, and
  any other prefix shows as itself. Fit the table to the real prefix. Record:
  `docs/plans/2026-10-28-wp8b-settings-tables.md`.
- [ ] **[performance, Low, Standard]** Trigger: `/api/played-days` getting slow as matches pile up
  (paging the Trends strip's year feels slow, or the request log shows it). It reads every result
  on each request just for one year's ticks, plus the first day and total. Read only the year's
  range for the ticks, and get the first day and total from a cheap count. Record:
  `docs/plans/2026-10-27-wp7a-trends-page.md` (Review log).
- [ ] **[design, Low, Standard]** Trigger: a `[grindlog] share/null_stat` warn in the browser console.
  A share card tile (streak, goals, assists, saves, shots, MVPs, demos) got a null stat and shows
  "–"; a session with a played match shouldn't give one. Then fit the handling to that session.
  Record: `docs/plans/2026-10-27-wp6c-share-card.md`.
- [ ] **[feature, Low, Standard]** Trigger: deciding to record which goals were bicycle kicks. The
  `bicycle_goal` remark is inert: the game sends `BicycleHit` (34 of 76 matches) but no bicycle-goal
  event, so a rule would have to tie a BicycleHit to a goal's origin touch (an order no data has
  shown yet). Record: `docs/plans/2026-10-27-wp6b-remarks.md`.
- [ ] **[feature, Low, Standard]** Trigger: deciding to record demos taken. The `demoed_a_lot`
  remark is inert: the Demolish statfeed's victim (`SecondaryTarget`) is in raw events but not
  recorded; a `statfeed_counts` bump plus a recompute would add it. Record:
  `docs/plans/2026-10-27-wp6b-remarks.md`.
- [ ] **[design, Low, Standard]** Trigger: a `[grindlog] recap/player_no_team` warn in the browser
  console. A scoreboard player with a null team is listed under "Unknown team" (none in real data
  on 2026-10-27). Then fit the handling to that match. Record:
  `docs/plans/2026-10-27-wp6a-c-matches-and-match-page.md`.
- [ ] **[design, Low, Standard]** Trigger: a `[grindlog] recap/goal_no_team` warn in the browser
  console. A match with goals but a null `me.teamNum` can't be oriented, so its goals are left off
  the goal map and its counts (0 of 76 player rows had a null team). Then fit the handling to that
  match. Record: `docs/plans/2026-10-27-wp6a-b-overview-sections.md`.
- [ ] **[design, Low, Standard]** Trigger: a `replay_playback` flag (a stretch of a match's
  states at least 90% `bReplay`). Replay playback of a match you left, or of one never recorded,
  still gets stored as play; a finished match's guid is refused. Then fit the handling to that
  real stream. Record: `git log --grep=finished_match_stays_closed`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a match cut at a `RecorderClosed` with events
  stored after it (both real cuts were at a MatchDestroyed). Thinning keeps the last state of the
  whole list, not of the cut, so it can drop the state that gives the cut match its `ended_at`.
  Then keep the last state before the cut too. Record: `git log --grep=finished_match_stays_closed`.
- [ ] **[design, Low, Standard]** Trigger: a stored match you played with a null `playlist_id`
  (none among the first 65). `latest`'s `playlistsPresent` drops null ids, so a history of only
  such matches reads "Not enough data yet" under a narrow filter. Then add a played-anything flag
  to `latestResponse`. Record: `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`.
- [ ] **[test, Low, Standard]** Trigger: Playwright sharding, `workers` above 1, or a spec rename
  that puts `shell.spec.ts` before `recap.spec.ts`. Both share the rich-seed stack, and the shell
  spec's replay and session break change it, so the recap spec must run first. Then give the
  replay spec its own stack. Record: `docs/plans/2026-10-26-wp6a-a-recap-navigation.md`.
- [ ] **[design, Low, Standard]** Trigger: a `query/two_yous` warn in `tracker.log` (two of your
  ids in one match, never seen). Pages take the camera's player, else the lowest key; check that
  match and fit the rule to it. Record: `docs/plans/2026-10-21-wp5a-a-query-logic.md`.
- [ ] **[design, Low, Standard]** Trigger: a `retention/kept_whole` with reason `trimmed` (a match
  that lost its start; only the old time-based retention could cut one, and it never reached a
  match) or a `retention/thin_failed` that repeats daily. Look at that match, then thin it or
  drop the row. Record: `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
- [ ] **[design, Low, Standard]** Flagged matches are kept whole for good, including expected
  cases such as `camera_on_roster` on a spectated match (1 of 46 so far, about 2 MB each).
  Trigger: `exempt` rows hold more raw.db than the thinned ones, or one check accounts for most of
  them. Then decide whether that check's matches should thin. Record: Review log in
  `docs/plans/2026-10-20-wp4c-b-retention-split.md`.
- [ ] **[design, Low, Standard]** Match records treat only team 0 and 1 as real teams (user's
  choice). Knockout (playlist 54, an 8-player free-for-all) may number teams per player, and then
  its players would get no team and no result. Trigger: a captured Knockout match → check its
  `TeamNum`s and decide. Record: Review log round 6 in
  `docs/plans/2026-10-20-wp4a-match-records.md`.
- [ ] **[bug (latent), Low, Standard]** A match whose close marker failed to store is never closed,
  so recompute skips it on every run, and retention keeps it whole and logs it daily once it is
  90 days old. Trigger: a real `records/recompute_skipped` with reason `open` at warn, or a
  `retention/kept_whole` with reason `open` → let recompute close it (as `restart`) or add a
  manual close. Record: Review log
  round 2 in `docs/plans/2026-10-20-wp4a-match-records.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a match whose clock stepped back (it fails the car_ms range). The woodwork window compares `ev.ts - lastWoodworkTs` unclamped, so crossbar hits after the step go uncounted until the clock catches up. Record: Review log round 11, BB7, in `docs/plans/2026-10-20-wp4b-match-extras.md`.
- [ ] **[feature, Low, Standard]** Trigger: a `goals_placed` flag (a goal whose scorer didn't
  resolve gets no goal-map point; none seen in 214 goals). Look at that match's real event order,
  then give such goals a team fitted to it. Record: Review log round 4 in
  `docs/plans/2026-10-20-wp4b-match-extras.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: a rule change that drops one goal and adds
  another in the same match (`rules-diff` shows goal values moved where the goal count didn't
  change). Goal rows are keyed by order, so equal counts look aligned. Then
  key goals by something stable (e.g. the GoalScored seq). Record: Review log round 3 in
  `docs/plans/2026-10-20-wp4c-a-rule-registry.md`.

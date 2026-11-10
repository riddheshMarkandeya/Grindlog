# Backlog

Tags: `[type, priority, effort]` — type bug/refactor/feature/performance/test-coverage/design/misc;
priority Low/Med/High; effort Trivial/Standard/Substantial/TBD.

- [ ] **[misc, Med, Trivial]** v1 roadmap (`docs/plans/2026-10-16-v1-roadmap.md`): every work package
  is deployed (WP9, the last, on 2026-11-02). Left: add S25 in Settings › Seasons when it starts. Open items from the work packages:
  - **[design, Low, Trivial]** Add back the themes midnight, dusk, steel and daylight (values in the
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
  - WP3b's manual check still open: sign out and back in, and the tracker should autostart
    (`supervisor/started`, then `app/started`).
- [ ] **[design, Med, Trivial]** The "no data" toast is suppressed over the full-screen game and
  only waits in the notification panel. (Its body now names the ini problem to fix.) WP5's status
  display is the reliable signal (`statsConfig()` carries the same diagnosis). WP8 has no toast switch, dropped
  2026-10-28 (user, simplest settings first). An urgent/priority toast is still untried. Record: Verification results in
  `docs/plans/2026-10-19-wp3b-background-process.md`.
- [ ] **[refactor, Low, Standard]** `scripts/capture.ts` keeps its own envelope parse
  (`eventNameOf`/`matchGuidOf`), hardcoded URL and reconnect loop; reuse `parseFrame`,
  `statsApiUrl` and maybe `startStatsClient`, or retire it now the recorder stores raw events.
  Record: Review log in `docs/plans/2026-10-19-wp3a-recorder.md`.
- [ ] **[design, Low, Standard]** Controls drift: about six button styles, two segmented controls
  (Trends `.xmode` buttons, Settings `.seg` radios, plus Friends' own `.seg`), two `.link` rules,
  and Trends `.picks button` against the match page's `.chip`. One shared set, as the display-drift
  work did for panels and tables. On the way, `PeriodControls.tsx:45` uses `styles.controls`,
  which no CSS defines. Record: `docs/plans/2026-11-03-display-drift.md`.
- [ ] **[design, Low, Standard]** Trends data line: the line, dots and sparklines use `--accent`,
  which the colour rule in `src/web/styles/tokens.css` now keeps for selection and focus; on oled
  the accent is white, the same as the text. Choose a data colour (a new token, checked on every
  theme). Record: `docs/plans/2026-11-03-display-drift.md`.
- [ ] **[feature, Low, Standard]** Settings › Appearance: choose the colour pair for sides (blue /
  orange) and for results (green / red), each on its own and apart from the theme (user,
  2026-10-28). Also helps red-green colour blindness. The pairs are already tokens
  (`--blue`/`--orange`, `--win`/`--loss` in `src/web/styles/tokens.css`), so it's a setting that
  overrides them on `<html>`, plus a check that each pair stays readable on every theme. Unblocked
  (2026-11-04): each token now has one meaning, written at the top of `tokens.css`, and
  `--up`/`--down` are mixed from `--win`/`--loss`, so overriding the result pair moves both.
- [ ] **[idea, Low, TBD]** Playful UI touches: the flat peeling corner (variant L on the
  `prototype/recap-stood-out` branch, never merge) was liked as a stood-out mark (user, 2026-11-04).
  Look at where flat-but-fun details fit the dashboard. Trigger: a UI polish pass.
- [ ] **[idea, Low, TBD]** A dashboard "What changed" card after an update, instead of the tray opening the GitHub
  release page (user, 2026-11-09). Needs markdown rendering for the release body, an update-state field and a way to
  dismiss it. Trigger: friend feedback asks for it. Context: "Release workflow" in
  `docs/plans/2026-11-06-distribution-map.md`.

- Friends release step 4, distribution: seven build work packages, in order, each planned in its own session. The
  design is the frozen map `docs/plans/2026-11-06-distribution-map.md` ("Decisions so far"; each package's scope is
  under "Build work packages").
  - [ ] **[refactor, Low, Standard]** 2 (release-aware app) is done; left over: once a deployed exe has `--quit`,
    `stop.ts` and `stopInstalled` end a sleeping supervisor through it instead of `killExe`'s path-filtered kill
    (deferred from package 1's review, `docs/reviews/2026-11-10-wp1-rename-identity.md`).
  - [ ] **[feature, Med, Substantial]** 3. Tray and process model: `grindlog-tray.exe`, supervisor-managed, quit
    protocol, icon states, menu, toasts; decision file corrects the supervisor-autostart Limit. Fold-in: the map's
    quiet tray line for release-recompute failures needs a status field; 2b only logs `failed` in
    `records/release_recompute_done`, and a match that fails every run reruns the whole recompute at each start
    (`docs/plans/2026-11-10-wp2b-release-data.md`).
  - [ ] **[feature, Med, Standard]** 4. Stats API setup card: the one-click ini write, decimal `parseStatsIni`, the
    "Is this you?" card.
  - [ ] **[feature, Med, Substantial]** 5. Installer and release pipeline: Inno script, Start menu `.lnk`, tag workflow,
    `sign-release`, `rcedit` on `InternalName`.
  - [ ] **[feature, Med, Substantial]** 6. Updater: check, download, minisign, apply, health check, rollback, shared
    state file, feed override. Fold-in: the antivirus backup-rename retry. Detached starts use `spawnDetached` (`Bun.spawn` with
    `detached: true`), which survives the parent's exit, a force-kill and Task Scheduler's End (spike result in
    `docs/plans/2026-11-10-wp2a-process-control.md`). The migrator refuses a database newer than the code
    (`newer_than_code` in `db/migrate.ts`), so a rollback across a schema change must restore the pre-migration
    backup before starting the old exe (2b's `meta` table is the first such change).
  - [ ] **[test-coverage, Med, Standard]** 7. Proof before friends: clean account, one Sandbox run, rollback through the
    feed override, copy history into prod, one live match on prod, one VirusTotal scan. Closes WP3b's autostart check.

- [ ] **[feature, Med, Standard]** After the friends release map: set up new seasons automatically, and
  keep them editable. Source the user found: `ggseason.com/blog/rocket-league-all-seasons-dates/`, captured
  in `HARs/`, with a season table of number, name, start and end. Not trivial, because:
  - It would be this local-only app's first outbound request, which friends should be told about.
  - It scrapes a third party's HTML, so a page change needs a sanity check and a logged failure. A plain
    script fetch got a 200 on 2026-11-06, but the site is behind Cloudflare and that may change.
  - A fetch must not overwrite an edit or bring back a deleted season, so rows need to record their source.
  - The table gains a season only once it has launched. S25's December 9 is only "reported", in the prose.
  The user prefers a simpler route, to settle when this is picked up: a season file in the GitHub repo that
  every install fetches, which needs no scraping or release, though it is still an outbound request and
  the row-source rule still applies. Or ship the list in the app and add each season by migration in a
  release, once step 4's update path exists. Also: the seed has S23 starting 2026-06-09 and that page says June 10,
  so check which is right, since it decides which season a match on that day counts in.

## Watch list
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
- [ ] **[bug (latent), Low, Standard]** Trigger: `autostart.ts` logs "has non-ASCII characters", or a
  friend's Start menu shows a generic icon. The `.url` is written as UTF-8 and Windows is expected to
  read it in the system code page, so a non-ASCII profile path may break `IconFile`. Reasoned from
  the format, not seen. Fix: the `[InternetShortcut.W]` section, or a `.lnk` from the step 4 installer.
  Record: `docs/plans/2026-11-05-name-and-icon.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: an install reports "the dashboard was not updated"
  with EPERM or EBUSY on `bin\web`. The shortcut's `IconFile` points inside the folder the install
  renames, so a shell handle on `favicon.ico` could block the swap. Not seen. Fix: a stable icon path
  outside `web`, such as `bin\grindlog.ico`. Record:
  `docs/plans/2026-11-05-name-and-icon.md`.
- [ ] **[bug (latent), Low, Standard]** Trigger: the Friends landing e2e or the shell "redirect is
  pending" e2e flakes, or a header click is seen undone after `/` → `/recap`. `<Navigate>` replaces
  from a passive effect, so a click landing between the redirect's commit and that effect can
  still be overwritten; `useTransitions={false}` only closed the transition window. Fix: a redirect
  that checks `window.location.pathname` in its effect, at the 5 replace-after-async sites
  (`RecapPage` ×3, `TrendsPage`, `App` `/`) plus `FriendPage`'s mutation `onSuccess`. Record:
  `useTransitions` commit body.
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
- [ ] **[bug (latent), Low, Trivial]** Windows antivirus may hold a fresh backup `.partial` and
  fail its rename (EPERM/EBUSY), aborting a pre-migration startup. Trigger: a real
  `backup/failed` on the rename → retry it briefly. Record: Review log round 3 #8 in
  `docs/plans/2026-10-16-wp2-storage.md`.
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

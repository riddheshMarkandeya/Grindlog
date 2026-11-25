# Analytics map step C, part 2: the goal timeline (variant H)

## Context
Part 1 (`docs/plans/2026-11-24-goal-clock.md`, commit 51cb267) stores a clock per goal and each match's regulation
length. Its step 9 prototype (branch `prototype/goal-timeline`, `897860b`, never merged) settled the look: **H, a
row per player** under the scoreboard on the match page. The verdict is recorded in that plan's "Prototype verdict"
section. This plan builds H for real. The prototype read saves, assists and shots straight from raw.db, so the
build first needs recorded rules that store a clock for each of them, plus the match's end clock.

Tier: Substantial (new stored rules, a new table, a new chart). Size is about 450 non-test lines, so it runs as
**two work packages**, each with its own tests, review and commit: WP1 backend, then WP2 the timeline.
Step 1 copies this plan to `docs/plans/2026-11-24-goal-timeline.md`. The two uncommitted doc edits on master
(part 1's verdict section and analytics map row C) continue this work, so they go into WP1's commit.

## User decisions (2026-11-24)
- **H as chosen:**
  - Rows run you, then teammates, then opponents, with a blue or orange left edge and the player's name (yours
    in bold).
  - The running score has its own packed row above the clock.
  - Goals, saves and assists are bare 16 px icons (`goal`, `save`, `assist`), blue for your team and orange for
    the other.
  - Shots are 3.5 px dots.
  - Marks that would touch step into another lane, at the real pixel width.
  - Each mark shows its details on hover.
  - The legend is just "Your team / Opponents".
  - Minute gridlines, and overtime is a shaded band labelled "OT".
- **Forfeit or left:**
  - The clock that wasn't played is hatched behind a dashed stop line, labelled "Forfeit · 0:44" or "You left".
  - A match you left in overtime gets the dashed line and label but no hatch, since overtime has no fixed end.
- **Shots note: only when really off.**
  - A shot that became a goal isn't drawn as a dot; the goal shows it.
  - A goal the game didn't count as a shot says "Not counted as a shot" in its hover.
  - The note under the timeline shows only when the recorded marks of a kind (shots, saves or assists) don't
    equal the scoreboard's total. Saves and assists are included because it's the same comparison.
  - Measured on all matches: dots plus goals would differ from the scoreboard in 94–111 of the 355 matches with
    goals (109 goals have no Shot statfeed), so that rule would be noise.
- **Hide the timeline** in a joined-in-progress match, and in "any complicated edge case or other non supported
  playlist". Hidden means the section isn't rendered at all, with no note. The hide cases are listed under WP2.
- Honor Duel's 3:00 matches are supported. `regulationSeconds` already gives the axis 180.

## Facts from the real data (dev data copy `%TEMP%\grindlog-proto-clock`, read-only, 2026-11-24)
- **Statfeed phases:** Shot statfeeds are 4,370 in play and 1 in countdown. Save (1,241), EpicSave (411) and
  Assist (815) are all in play.
- **Statfeeds against the scoreboard** (non-joined matches, 1,601 player rows): Save+EpicSave and Assist statfeeds
  equal the scoreboard for every player. Shot statfeeds equal it for all but 5 players.
- **A goal's own shot:** 1,878 of 1,987 goals have a Shot statfeed by the scorer since the last kickoff. 109 have
  none, because the game didn't count them as shots. Of the paired ones, the median gap is 1.0 s, p99 is 5.4 s,
  23 are over 5 s and the largest is 84 s. So pairing uses "the scorer's last unpaired shot since the kickoff",
  not a time window.
- **End clock** (the last ClockUpdatedSeconds reading before the first Win statfeed, else the last reading):
  - All 81 non-joined forfeits (`early_end`) have a Win statfeed and a non-zero regulation reading.
  - 199 of 207 regulation completions read 0, and 8 read 1.
  - All 53 overtime completions read in overtime.
  - Of the 11 `left` matches, none has a Win statfeed: 9 have a reading and 2 have none.
- **Playlists** in the data: 11 Ranked Doubles (181), 2 Doubles (94), 13 Ranked Standard (68), 53 Honor Duel (2,
  180 s), and a few each of 1, 3, 4, 6, 10, 27–30, 63, 65, 81 and 90.

## WP1: stored moments and the end clock (backend)
**Rule `timeline_moments`** (`area: "match"`, `applied: "recorded"`, version 1, not dense):
- **What it stores:** every Shot, Save, EpicSave and Assist statfeed, from the start of the match until the first
  Win statfeed or MatchEnded, whose MainTarget resolves to a roster player. Each one gets its kind, player key, the
  last ClockUpdatedSeconds reading before it (as for goals) and, for a shot, `goal_idx`.
- **Pairing:** `goal_idx` is the goal it became. At each live GoalScored, the scorer's last shot since the last
  RoundStarted that isn't paired yet takes that goal's index.
- **Flags:** a moment with no reading has a null clock and is counted in a new fact, `momentsWithoutClock`. An
  unresolved target is already counted by the summary's `unresolvedStatfeed` (`statfeed_resolved`), so it isn't
  counted again.
- **Evidence:** the figures above.
- **Checks:** `moments_clocked`, and `moments_match_statfeed`: per player, the moments of each kind equal that
  player's `s.statfeed` counts (Shot; Save+EpicSave; Assist). This doesn't compare against the scoreboard, which
  `statfeed_matches_scoreboard` already does. It catches play's filters (phase, the Win cut-off, resolving through
  `latestPlayers`) drifting from summary's, and it doesn't flag the game's own scoreboard gaps.
- **Outputs:** the `match_moments` columns. Refs: `ANALYTICS_MAP` and a new `PLAN_GOAL_TIMELINE`.

**Rule `end_clock`** (`area: "match"`, recorded, version 1, not dense):
- The match's end clock is the last ClockUpdatedSeconds reading before the first Win statfeed, or the last
  reading at all when no Win comes (left, orphaned).
- It's null with no reading. It's stored as read, with the reading's overtime flag.
- A forfeit resets the clock to 0 only after the vote, which is why the cut is at the Win statfeed.
- **The first Win:** it sets the cut whether or not its target resolves. Play exposes it as a new fact, `sawWin`.
- **Unseen shape (global §2):** a forfeit with no Win statfeed hasn't been seen. Its end clock would fall back to
  the reset to 0. A new check, `forfeit_end_clocked`, flags it: it applies to a summary with `endKind ===
  "early_end"` (the summary carries the end kind, `summary.ts:45`) that isn't joined, and fails when
  `!x.facts.sawWin` or the end clock is null. A BACKLOG Watch item names its trigger.
- **Two rules in one change:** CONTRIBUTING.md says one rule at a time. These two share one migration and one
  recompute, as part 1's pair did (51cb267), so they go together.

**Storage** (one migration appended to `trackerMigrations`, null or empty until recompute):
```sql
CREATE TABLE match_moments (
  match_guid    TEXT NOT NULL,
  idx           INTEGER NOT NULL, -- order in the match
  kind          TEXT NOT NULL CHECK (kind IN ('shot', 'save', 'epic_save', 'assist')),
  player_key    TEXT NOT NULL,
  clock_seconds INTEGER,          -- as for match_goals: time left in regulation, or time played in overtime
  clock_overtime INTEGER,
  goal_idx      INTEGER,          -- a shot that became that goal; null otherwise
  PRIMARY KEY (match_guid, idx)
);
ALTER TABLE matches ADD COLUMN end_clock_seconds INTEGER;
ALTER TABLE matches ADD COLUMN end_clock_overtime INTEGER;
```
- **Why one table:** it's one table of rows rather than columns on `match_goals` or `match_player_statfeed`. Moments
  are per event like goals, and the reader needs their order and clocks.
- **Assists:** they're stored here even though goals carry `assister_key`. The Assist statfeeds equal the scoreboard
  for every player, while the goal assisters differ from it in 2 matches.
- **Before recompute:** a row stored before recompute has no moments. The read tells "not computed" apart from
  "none" by the match's `rule_versions` lacking `timeline_moments`, so the response's `moments` is null.

### WP1 steps
1. Copy this plan to `docs/plans/2026-11-24-goal-timeline.md` and add it to `PROJECT_INDEX.md` Plans.
2. **TDD in `src/server/recorder/play.test.ts`** (red first), then `play.ts`. The goal-clock handlers there are the
   model:
   - `Play` gains `moments: Moment[]` and `endClock: Clock | null`, where `Moment = { kind, key, clock, goalIdx }`.
     `Acc` gains `ending` (a Win statfeed was seen) and `kickoffMoment` (the moments index at the last
     RoundStarted).
   - The `StatfeedEvent` handler records moments in any phase but `ended` and while `!acc.ending`. The first Win
     sets `ending` and `endClock = acc.clock`. The existing play-only Shot and AerialGoal logic stays as it is.
   - `GoalScored` pairs the scorer's shot after `addGoal`. Dropped goals pair nothing.
   - At the end of `buildPlay`, `endClock` is `acc.clock` if no Win came.
   - Synthetic cases:
     - Each kind is recorded with the last reading before it. EpicSave becomes `epic_save`.
     - An unresolved target is skipped.
     - A moment with no reading gives a null clock and counts the fact.
     - Statfeeds after the first Win aren't recorded.
     - The end clock is the reading before Win and not the later reset to 0. With no Win, it's the last reading.
       With no readings, it's null.
     - A shot pairs with its scorer's goal. A shot before the kickoff doesn't. Two shots then a goal pair the
       later one. A goal with no shot leaves every shot unpaired.
   - Real fixture cases in `recorder.test.ts` (the seam part 1 used), with expected values read from each fixture's
     raw events:
     - `overtime-leavers`: moment counts per kind and player equal its statfeed counts, plus the shot pairing count
       and an overtime end clock.
     - `test/fixtures/early-end.ndjson`: the forfeit's end clock is the reading at the first Win, not the later
       reset. It also has Save, EpicSave and Assist moments, and `sawWin` is true.
     - `left-early.ndjson`: there's no Win, so the end clock is the last reading.
3. **Checks** in `checks.ts`:
   - `moments_clocked` goes beside `goals_clocked`.
   - `moments_match_statfeed` goes beside `statfeed_matches_scoreboard` and reuses `STATFEED_FOR`'s kind-to-events
     map for shots, saves and assists.
   - `forfeit_end_clocked`, as above.
   Each gets tests in `checks.test.ts`.
4. **Migration** as above, with its test in `migrate.test.ts` in the one-test-per-migration pattern.
5. **Save and read:**
   - Carry the moments and the end clock from play to the save the way `regulationSeconds` travels:
     `MatchExtras` → `MatchRow` → `save.ts`.
   - `save.ts` deletes and inserts `match_moments` beside `match_goals`.
   - `read.ts`: `readMatch` selects the end clock. A new `readMoments(guid)` runs its own query for `rule_versions`,
     since `readMatch` doesn't select it, and returns null when that lacks `timeline_moments` (`json_extract`;
     a null map gives null too).
   - `src/server/api/pages.ts:156-159` assembles the match detail. It gains `moments: reader.readMoments(guid)`
     beside `goals`. Add an API-level test in the existing pages or api test for both cases (computed and not).
   - `responses.ts`: `matchDetailResponse.match` gains `endClock` (the clock object, nullable). The response gains
     `moments: z.array(momentSchema).nullable()`, where `momentSchema` is `{ idx, kind, playerKey, clock, goalIdx }`.
   - Add `match_moments` to `rules-diff.ts` `TABLES` (key `match_guid, idx`). A base without the table counts every
     row as `onlyNext`, which is already handled.
   - Update hand-built fixtures (`src/server/testing.ts` and any that typecheck finds). Round-trip tests go in
     `save.test.ts` and `read.test.ts`, including the pre-recompute case (`moments: null`, `endClock: null`).
6. **Registry:** add both rules (`registry.ts`, after `regulation_length`), plus an `mo()` output helper beside
   `g()`, and the `PLAN_GOAL_TIMELINE` ref. Then run `bun run definitions`.
7. `bun run check`, then `bun run rules-diff` on the dev data dir. Expect:
   - both rules under rule versions;
   - `match_moments` rows all `onlyNext`;
   - no moved columns;
   - no new flags at all, since moments should equal the statfeeds everywhere (any `moments_match_statfeed` flag
     is a play bug to fix before going on).
   Record the figures.
8. **BACKLOG:** Watch items for a moment with no clock and for a forfeit with no Win. Analytics map row C reads
   "In progress: moments stored, timeline next". Compact point, then `independent-review-pass`, then ask the user to
   commit.

## WP2: the timeline (UI)
**Design contract:**
- **Job:** show when each scoreboard stat happened, and who did it.
- **Primary action:** none. It's a passive chart.
- **States:**
  - Loading: nothing; the scoreboard above has its own.
  - Error: nothing.
  - Hidden: no section at all.
  - Shown, with or without the count note.
- **Responsive:** check at 320, 768, 1024 and 1440 px. Width comes from the existing `useWidth`
  (`src/web/components/useWidth.ts`, whose effect runs once). The prototype's width-0 bug came from a div that
  mounted after the data loaded, so:
  - an outer `GoalTimeline` computes `timelineFor` and returns null when hidden;
  - an inner `TimelineChart`, mounted only once a timeline exists, calls `useWidth`, and its measured div is there
    on its first render.
  Lane packing runs at the real width; at 320 px rows get more lanes, not overlap.
- **Rejected:** a custom tooltip, a legend listing each icon (the hover and the recap's icons already explain them),
  and solid or hollow discs.

**Interaction contract:**

| Trigger | What shows | Focus |
|---|---|---|
| Hover a mark | SVG `<title>`, e.g. "1:23 · Goal · Name · 2–1", "0:44 · Save (epic) · Name", "Not counted as a shot" on such a goal | unchanged |
| Resize | relaid out at the new width | unchanged |
| Reload, Back or Forward | same as the first load | the page's existing rule |
| Slow load or error | no timeline until the match detail arrives | unchanged |
| Screen reader | `role="group"` with an `aria-label` summary, and a visually hidden ordered list of the marks (time, kind, player, score) | in reading order |

**Hide cases** (`timelineFor` returns null):
- the playlist isn't in `TIMELINE_PLAYLISTS`:
  - it lives in `src/shared/playlists.ts` beside `PLAYLISTS`, with a test that each id is there;
  - it holds Duel, Doubles, Standard, Casual Quads, Ranked Duel, Ranked Doubles, Ranked Solo Standard, Ranked
    Standard, Official Tournament and Honor Duel (ids 1–4, 10–13, 34 and 53);
  - Private, extra modes, LTMs and the rest are hidden;
- `match.checkFlags` has any of `forfeit_end_clocked`, `moments_clocked`, `moments_match_statfeed`,
  `goals_clocked`, `goals_placed`, `goals_per_team_equal_score` (a dropped goal would end the score row on the
  wrong score) or `clock_overtime_flagged` (added in WP2 review: an overtime mark would land in regulation);
- a goal whose scorer's team isn't the team it counted for (added in WP2 review; none in the data);
- any player has a null `teamNum` (no row colour);
- joined in progress;
- `regulationSeconds` is null;
- `moments` is null (not recomputed yet);
- any goal or moment has a null clock;
- no player is you (spectated);
- `orphaned`;
- `early_end` or `left` with a null end clock;
- a goal's scorer or a moment's player with no player row (added in WP2 step 1: such a mark would have no row
  to sit in; not seen in the data, since moments only store roster players).

### WP2 steps
1. **TDD in `src/web/logic/goal-timeline.test.ts`** (red first), then `src/web/logic/goal-timeline.ts`. All pure:
   - `timelineFor(detail)`: each hide case gives null. It returns rows in order (you, teammates, opponents), and
     marks with elapsed time `t`: regulation − seconds, or regulation + seconds in overtime.
   - Paired shots aren't drawn as dots. Goals carry `countedAsShot`.
   - The axis end is regulation, or the last overtime mark or end clock.
   - The stop for a forfeit or left match, with its label, and a hatch only in regulation.
   - The score labels at each goal.
   - `pack(items, gap)`: no two items in a lane overlap. Cases include touching, equal x and many in one spot.
   - `countNote(detail)`: null when every kind's recorded moments equal the scoreboard total, else e.g. "The
     scoreboard has 11 shots; 12 shots were recorded." for each kind that's off. It says "recorded" because a goal
     the game didn't count as a shot is drawn, yet isn't one of the shots.
   - Expected values are worked by hand from small details built in the test.
   - **Done (2026-11-24):** `TIMELINE_PLAYLISTS` plus its test; `goal-timeline.ts` exports `timelineFor` (rows,
     marks, `scores`, `ticks`, `end`, `stop`), `pack` and `countNote`, with 40 tests. `bun run check` green
     (2127 passed, 1 skipped).
2. **`src/web/components/GoalTimeline.tsx` plus `.module.css`:** the SVG, rewritten from the prototype's `Players`,
   `Mark`, `ScoreRow` and `Legend` under the project's tokens (`var(--blue)`, `var(--orange)`), with the `Icon`
   component through foreignObject as in the prototype. Mount it in `MatchView.tsx` directly under `<Scoreboard>`,
   from the same `useMatchDetail`.
   - **Done (2026-11-25):** `GoalTimeline` (section "How the match went", legend, count note) and `TimelineChart`
     (`useWidth` box on first render, `role="group"`, visually hidden `<ol>` of the marks in time order, the SVG
     `aria-hidden`). `MatchTimeline` in `MatchView.tsx` mounts it. Layout additions over the prototype: the
     name gutter narrows to 28% of the width (72–132 px) on a phone, and tick labels skip when under 36 px
     apart. `bun run check` green (2127 passed, 1 skipped). Not yet seen rendered: steps 3 and 4 cover that.
3. **e2e** in `test/e2e/recap.spec.ts`:
   - **Seed:** `record()` in `src/server/testing.ts:98` defaults to `ruleVersions: {}`, which would hide every seeded
     timeline, and its default `player()` has `shots: 2`. So the seed match `e2e-first-a` (playlist 11, 3–2,
     `test/e2e/stack.ts:201`) gets `ruleVersions` that include `timeline_moments` (`RECORDED_RULE_VERSIONS`), goal
     clocks, a regulation length, and moments that equal its scoreboard.
   - the timeline shows with the expected number of each mark, and no count note;
   - `e2e-private` (playlist 6, `stack.ts:199`) has no timeline;
   - no console errors;
   - also run at 320 px.
   - **Done (2026-11-25):**
     - **Seed:** `FIRST_A` in `stack.ts` is a 0–2 comeback to 3–2:
       - goal clocks at 4:40, 3:40, 2:30, 1:30 and 0:20;
       - 4 shot moments (3 of them became goals) and the opponent's 1 save, which equal the scoreboard
         (`saves: 1` on the opponent's row);
       - `RECORDED_RULE_VERSIONS` on it and on `e2e-private`, so only the Private playlist hides that one.
     - **Tests** in `recap.spec.ts`:
       - at 1024 and 320 px: the hidden read-out's 7 lines in clock order, 6 icons, 8 circles (1 dot and
         7 hover circles), no count note, no sideways scroll;
       - no timeline on `e2e-private`;
       - the match page joins the axe loop.
     - **Red check:** the Private test fails (1 timeline, expected 0) with playlist 6 added to
       `TIMELINE_PLAYLISTS`.
     - **Results:** `bun run check` green (2127 passed, 1 skipped); `bun run e2e` green (161 passed).
4. **Real browser,** via `/run` and Chrome, on a fresh recompute of the `%TEMP%\grindlog-proto-clock` copy:
   - matches: forfeit `E10448E6…`, the 13-goal `8379F212…`, Honor Duel 180 s `4F38F98A…`, overtime `AA5DF654…`,
     comeback `82A202E8…`, the shots-mismatch match, a joined match (hidden), and a Hoops match (hidden);
   - each at 320, 768, 1024 and 1440 px, keyboard-only, and in dark mode if the app has one.
   Hand the visual check to the user.
   - **Done (2026-11-25):**
     - **Setup:** recompute of the copy, 360 written and 0 failed. The dashboard ran on it at port 49111 (the
       installed dev tracker holds 49102), with `GRINDLOG_STATIC_DIR` set to the fresh `dist`.
     - **Sweep:** each match loaded at 320, 768, 1024 and 1440 px in a same-origin iframe of that exact width.
       - The five drawn matches showed, with no sideways scroll at any width. Score labels, tick labels, row
         names and icons had no overlaps.
       - The joined `32E30E10…` and Hoops `F85A7AF2…` matches showed their scoreboard and no timeline.
       - No console errors on a fresh load of all seven.
     - **Keyboard:** the chart has nothing focusable (passive by design); screen readers get the hidden
       read-out.
     - **Fixed:** at 320 px a mark at kickoff (the Honor Duel's first goal) covered the row's edge bar. The
       clock now starts `PAD` (half an icon plus 2 px) into the track.
     - **Not seen:** the count note. No drawn match in the copy has a mismatch (the only one is playlist 29,
       which isn't drawn). Unit tests and the e2e cover the note.
     - **Results:** `bun run check` green (2127 passed, 1 skipped); the timeline e2e passed (4 tests).
     - **Handed to the user:** the visual check.
5. Analytics map row C changes to "Built: goal timeline" (done 2026-11-25). Compact point, then `independent-review-pass`, then ask
   the user to commit. After that, `bun run deploy` (it recomputes) is the user's call.

## Verification
- `bun run check` (typecheck, zero-warning lint, tests) and `bun run e2e` are green after each WP.
- **WP1 data** (read-only query on the recomputed copy):
  - Moment counts per kind equal the statfeed counts above (Shot 4,371 less any after Win, Save+EpicSave 1,652,
    Assist 815, give or take statfeeds after the first Win; any difference is explained).
  - 1,878 shots have a `goal_idx`.
  - 0 moments have a null clock.
  - `end_clock_seconds` is non-null for all 81 forfeits.
  - Spot-check the forfeit match: end clock 44.
- **WP2:** the real-browser pass above, and the user's visual check.

## Plan review
One round, by the `plan-reviewer` agent (opus) on 2026-11-24. All 10 findings are folded in:
1. Med: a forfeit with no Win, a dropped goal, or a player with no team would still draw a wrong timeline → hide
   on those check flags and on a null `teamNum`.
2. Med: the e2e seed's default `ruleVersions: {}` hides the timeline, and `shots: 2` brings up the note → name the
   seed `e2e-first-a`, give it rule versions and matching moments, and use `e2e-private` for the hidden case.
3. Med: the match detail is assembled in `pages.ts`, not `readMatch`, and `readMatch` doesn't read
   `rule_versions` → `readMoments` runs its own query, it's wired in `pages.ts`, and an API test is added.
4. Med: `forfeit_end_clocked` had no source for "no Win" → added the play fact `sawWin` (set by the first Win
   whether or not it resolves), and dropped the fallback hedge, since the summary carries `endKind`.
5. Low: comparing moments with the scoreboard duplicates `statfeed_matches_scoreboard` → the check is now
   `moments_match_statfeed`, against `s.statfeed`, and step 7 expects no new flags.
6. Low: the real-fixture tests didn't cover the Win cut-off → added `early-end` and `left-early` fixture cases.
7. Low: the `useWidth` wording clashed with "no section" → split into an outer gate and an inner chart.
8. Low: the new playlist list was hand-kept → moved to `playlists.ts` with a test, and the names corrected.
9. Low: the note's wording could disagree with what's drawn → it now says "recorded".
10. Low: two rules in one change goes against CONTRIBUTING.md → noted why (one migration and one recompute, as in
    part 1).

The reviewer also tested and confirmed: no Shot, Assist or Save statfeed comes after its GoalScored, and none
comes after the first Win; rules-diff handles a missing table; `rule_versions` reads right for old matches;
thinning keeps what moments need; `isMe` and the icon keys exist.

## WP1 results (2026-11-24)
- **Decision during the build (user's choice):** the first `rules-diff` flagged `moments_clocked` on 9 of 360
  matches. In each, a kickoff Shot came before the clock's first `ClockUpdatedSeconds` (the 299 tick; the clock
  starts at the first touch, and no 300 reading came under the match's guid), while the states still showed 300.
  Options were: the regulation length, the latest state's `TimeSeconds`, or keep it null and hide the timeline.
  The user picked the **regulation length**: a moment before the first reading takes it, unless the match was
  joined in progress or has no regulation length, where it stays null and is flagged. This step also corrects the
  plan's "0 moments have a null clock" expectation.
- `bun run check`: green, 2,083 tests passed and 1 skipped.
- `bun run rules-diff` on the dev data dir: 360 recomputed, 0 failed. Only in the recompute: `match_moments`
  6,838. Rule versions changed: `timeline_moments`, `end_clock`, plus part 1's `goal_clock` and
  `regulation_length` (that data dir wasn't recomputed after part 1). No moved columns and no new flags.
- On the recomputed `%TEMP%\grindlog-proto-clock` copy:
  - moments: shot 4,371, save 1,241, epic_save 411 and assist 815, equal to the stored statfeed totals;
  - 1,878 shots have a `goal_idx`, and 0 moments have a null clock;
  - all 81 non-joined forfeits have an end clock, and `E10448E6…` reads 44;
  - `left` matches: 2 of 11 have a null end clock, as expected;
  - no match is flagged by the three new checks.
- `scripts/screens-data.ts` also pseudonymises `match_moments.player_key` and trims the table. It's a privacy path
  the plan didn't list, and a test covers it.

## Review log

### WP1 round 1 (2026-11-24), snapshot `71375c5`
Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify` (4 angles). Classified
Substantial by design tier (about 240 non-test lines).
- Security: no findings.
- arch: blank line doubled in the goal-clock plan → [Fixed].
- arch: `moments_clocked` detail misdescribed what's flagged after the regulation-start decision → [Fixed].
- arch: two `Moment` types and the kind list hand-kept in four places → [Fixed]: the server type is `MomentPoint`
  (as `GoalPoint`), `MOMENT_KIND_IDS` in `responses.ts` drives the zod enum and `MomentKind`; the migration CHECK
  stays (append-only SQL), noted at the const.
- arch q: a Win after MatchEnded is ignored, unlike the doc's "resolved or not" → [Fixed] wording: "before
  MatchEnded" in the fact doc and the `end_clock` rule text (the plan's cut is the first Win or MatchEnded).
- arch: the regulation-start fill didn't check that the first reading is the start tick, so missing early readings
  would stamp 300 unflagged → [Fixed]: fills only when the first regulation reading is within 2 s of the length,
  else null and counted; synthetic test; Watch item and rule text updated. Rules-diff rerun: unchanged (360, 0
  failed, 6,838 moments, no moved columns, no new flags).
- arch + code-review: `recompute.test.ts` parity `TABLES` lacked `match_moments` → [Fixed].
- arch: `momentSchema.clock` doc stale → [Fixed].
- code-review: `forfeit_end_clocked` skips joined matches → [Verified, no fix needed]: 2 of the 3 joined forfeits in
  the dev data were joined after the vote (one reading, 0, no Win), so they'd always flag; the comment now says so.
  WP2 hides joined matches anyway.
- code-review: `MOMENT_KINDS[name]` plain-object lookup hits inherited keys (`constructor`) → [Fixed]: a `Map`.
- code-review: extras that threw read as "computed, none" → [Fixed]: `readMoments` is null when `check_flags` has
  `extras_computed`; test.
- code-review: `screens-data.ts` crashes on a dev DB from before this migration → [Fixed]: tables the copy lacks are
  skipped (`hasTable`); test on a version-10 DB. Altitude suggested migrating the copy instead → skipped: the script
  works on a plain `bun:sqlite` handle and `migrate` needs the server `Db` and a logger; two guarded sites.
- code-review + altitude: goals before the first reading don't get the regulation-start fill → [Verified, no fix
  needed]: it changes the shipped `goal_clock` rule, `goals_clocked` flags it (none in 1,988 goals, Watch item
  exists) and WP2 hides such a match.
- simplify: `Acc.ending` duplicated `facts.sawWin` → [Fixed]. `momentMismatches` rebuilt its kind sets per player →
  [Fixed]: hoisted `MOMENT_STATS`. Clock-to-columns unpacked in three places in `save.ts` → [Fixed]: `clockCols`.
- simplify, skipped: fold `readMoments`' probe into `readMatch` (one local PK lookup per page view; keeps the
  reader functions independent); share summary's statfeed filter with play (the plan keeps them apart and checks
  them, by design); fill on the first reading instead of a post-pass (regulation length is only known at the end);
  `forEach` in save (matches the goals loop); derive `momentsWithoutClock` (the facts convention).

### WP1 round 2 (delta `git diff 71375c5`)
Passes: `correctness-reviewer`, `arch-reviewer` (sonnet), `security-reviewer`. Every round 1 [Fixed] entry closes
without regressions. Two nits: the `moments_clocked` detail read ambiguously → [Fixed] wording; this entry was
missing → added, noting that the `timeline_moments` rule text changed while it stays at version 1, which is fine
because the rule hasn't shipped yet. Review closed.

### WP2 round 1 (2026-11-25), snapshot `88d597f`
Passes: `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify`. Substantial by design tier
(452 non-test lines).
- security: no findings.
- code-review (important): a match flagged `clock_overtime_flagged` was still drawn, and an overtime goal would
  land in regulation. [Fixed] Added to `HIDING_FLAGS` and to the hide cases, with a test.
- code-review: a goal whose scorer is on the other team would draw one side's icon while the score counts it for
  the other. None of 1,988 goals in the data. [Fixed] `timelineFor` hides such a match, with a test, and BACKLOG
  has a Watch item.
- code-review: marks at the same second read in row order, so an assist could read before its goal. [Fixed]
  `readOut` puts goals first at a second, with a test.
- code-review + arch: the read-out never said where a forfeit or "You left" stopped play, or that overtime began.
  [Fixed] `readOut` adds both in time order, with tests.
- code-review: row names were cut through an emoji's surrogate pair. [Fixed] `shortName` cuts by grapheme
  (`Intl.Segmenter`), with a test. Wide (CJK) names may still overrun the 7 px guess; the full name is in the hover. [Verified, no fix
  needed] At 320 px they're cut to 8 characters, and there are none in the data.
- code-review: skipped tick labels could drop the end-of-regulation label. [Fixed] They're counted from the end.
- code-review: the score format was written twice. [Fixed] `scoreText` is exported from `goal-timeline.ts`.
- arch (risk): `HIDING_FLAGS` held untested copies of the server's check ids. [Fixed] `checks.test.ts` checks each
  one against `CHECK_IDS`.
- arch (q): row C's "Built" status hid the Trends lines and the late-winner badge. [Fixed] The status now names them
  as next.

- simplify (4 angles):
  - [Fixed] the `Intl.Segmenter` is built once, with a fast path for short names;
  - [Fixed] `useMemo` for `timelineFor` and the read-out (the React Compiler isn't in the build, only its lint
    rules), so a resize doesn't rebuild them;
  - [Fixed] one player map in `checked`;
  - [Fixed] marks are pushed, not copied per add;
  - [Fixed] `yours` is computed once per goal;
  - [Fixed] the tick-gap ternary is gone;
  - [Fixed] `Mark`'s hover circle is written once.
  - Skipped, behaviour or scope:
    - `pack` returning items with their lanes, and slimming `Row`'s props: a refactor of tested, working code;
    - `HIDING_FLAGS` as a shared union, or a server `timelineTrustworthy` flag: the `CHECK_IDS` test covers the
      drift, and a server field needs a recompute;
    - deriving `TIMELINE_PLAYLISTS` from the pitch list: they mean different things (Private uses a standard
      pitch but is hidden);
    - text-width guesses: measuring is out of proportion;
    - overtime from marks past regulation: no such data;
    - the shared "A–B" helper with `recordText`: it adds digit grouping;
    - fixture literals in `stack.ts`: they read better spelled out.
- `bun run check`: green apart from the known flaky `tray.test.ts` timing test (BACKLOG), which passes on a rerun
  (2141 passed). The timeline e2e passed (4 tests).

### WP2 round 2 (delta `git diff 88d597f`)
Passes: `correctness-reviewer`, `arch-reviewer` (sonnet), `security-reviewer`. Every round-1 fix was confirmed closed.
- arch, security: no findings.
- correctness (risk): a regulation goal at 0:00 and an overtime mark at +0:00 share `t = regulation`, so a buzzer-beater
  would read after "Overtime". [Fixed] `TimelineMark` carries `overtime`; `readOut` puts regulation marks, then
  "Overtime", then the overtime clock's marks, then the stop. A test covers it. `bun run check` green (2142 passed).

### WP2 round 3 (delta: the unstaged `git diff` after round 2)
Passes: `correctness-reviewer`, `security-reviewer`. No findings: the round-2 fix is closed, and the new `overtime`
field breaks no consumer. The review is done.

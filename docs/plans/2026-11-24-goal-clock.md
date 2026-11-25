# Analytics map step C, part 1: the goal clock rule, and the timeline prototype

## Context
Step C of `docs/plans/2026-11-23-analytics-map.md` (the goal clock) is the next open step. Grindlog stores no
game-clock time per goal yet. Three UI pieces need one: a goal timeline on the match page, Clutch lines on
Trends, and a late-winner badge on the recap. This plan covers only:
1. **The clock rule** (backend): each goal gets a clock time, stored in `match_goals` and filled for old
   matches by a recompute.
2. **A prototype** of the match-page goal timeline: 3 variants on real data, for the user to pick from.

Building the chosen timeline, the Clutch lines and the badge are later plans. The Clutch lines and badge
get their own short prototype once the timeline is built (user's choice, 2026-11-24).

Tier: Substantial (a new stored rule, then a prototype). Step 1 copies this plan to
`docs/plans/2026-11-24-goal-clock.md`.

## Facts from the real data (dev `raw.db`, read-only, 2026-11-24)
- 356 matches, 2,005 live goals before MatchEnded. **Every goal has a `ClockUpdatedSeconds` reading before it.**
- 57 goals came in overtime, one per overtime match.
- On 13 goals the last UpdateState's `Game.TimeSeconds` is off by 1 s from the last `ClockUpdatedSeconds`
  (it ticks in a different order). That's why the rule uses `ClockUpdatedSeconds` only.
- Reading to goal: median 0.5 s, p99 1.0 s. The 7 gaps over 1.1 s (up to 8.1 s) are all goals at 0:00, with
  the ball still in play after time ran out.
- 341 matches start their regulation clock at 299 and 11 at 300. 2 start at 180, 1 at 372, and a few at odd
  values (private or joined matches).
- Thinning keeps every non-UpdateState event (`src/server/recorder/thin.ts:53`), so thinned matches still
  have their readings.

## Design
> Superseded in part by the Review log (round 1): a second check `clock_overtime_flagged`, and the regulation
> length kept as a running value in the handler rather than a post-loop rounding.

**Rule `goal_clock`** (`area: "goals"`, `applied: "recorded"`, version 1): a goal's clock is the last
`ClockUpdatedSeconds` reading with a numeric `TimeSeconds` before its live GoalScored. It stores the
seconds as read (time left in regulation, time played in overtime) and the reading's `bOvertime`. A goal
with no reading gets a null clock and is counted in a new fact, which flags the match.
- Evidence string: the figures above.
- Outputs: `g("clock_seconds")`, `g("clock_overtime")`.
- Checks: `["goals_clocked"]`.
- Refs: `[ANALYTICS_MAP, PLAN_GOAL_CLOCK]`. `PLAN_GOAL_CLOCK` is a new constant for the plan copy.
- Not dense: it reads no UpdateState.

**Rule `regulation_length`** (`area: "match"`, `applied: "recorded"`, version 1): a match's regulation
length is its largest non-overtime `ClockUpdatedSeconds` reading, rounded up to a whole minute. That gives
299 → 300, 180 → 180 and 372 → 420. It's null with no such reading.
- It's stored as `matches.regulation_seconds`.
- It's computed in `play.ts` next to the goal clock, from `ClockUpdatedSeconds` only, so it isn't dense.
- It undercounts a match joined in progress, which is already flagged `joined`; that's accepted.
- Why now (plan review #2): the timeline's strip and worm variants need it to place goals in matches that
  aren't 5:00. Storing it in the same migration saves a second migration and recompute if one of those
  variants wins. It's one more column for a value the parser already passes through.

**Storage: nullable columns.** We store the raw reading plus the flag, not a derived "elapsed" value. That
keeps the stored data close to the source. "Last 30 s" and "within 15 s" come straight from the readings,
and a goal's elapsed time is `regulation_seconds − clock_seconds` (or `regulation_seconds + clock_seconds`
in overtime). The column is `clock_overtime`, not `overtime`, so it isn't confused with `matches.overtime`.
All of them stay null until recompute, the same as the earlier extras migrations.

**Unseen shapes (global §2).** No goal without a reading has been seen. The new check `goals_clocked` flags
any such match, so retention keeps it whole. A BACKLOG Watch item names the first flagged match as the
trigger for real handling. It also covers a reading with `bOvertime` missing or not a boolean: that would be
stored as a regulation goal, and all 57 overtime goals carried the flag, so no check is added for it.

## Steps
1. Copy this plan to `docs/plans/2026-11-24-goal-clock.md`. Add it to `PROJECT_INDEX.md` Plans.
2. **TDD in `src/server/recorder/play.test.ts`** (red first), then `play.ts`:
   - `GoalPoint` gains `clock: { seconds: number; overtime: boolean } | null`.
   - `Acc` gains `clock`. A new `ClockUpdatedSeconds` handler stores `{ seconds, overtime: bOvertime === true }`
     when `TimeSeconds` is a number (reuse `num` as the file already does; a null TimeSeconds leaves the
     last reading).
   - `addGoal` copies `acc.clock`. A null clock increments `facts.goalsWithoutClock`, which is added to
     `emptyFacts`.
   - `Play` gains `regulationSeconds: number | null`: the running max of non-overtime readings, rounded
     up to a whole minute at the end of `buildPlay`.
   - Synthetic cases:
     - The last reading before the goal is used. A reading that arrives after the GoalScored (by seq) is not.
     - A state's differing `TimeSeconds` is ignored.
     - An overtime reading sets the overtime flag.
     - A null-TimeSeconds reading is skipped.
     - No reading at all gives a null clock plus the fact.
     - Regulation length: 299 → 300, 180 → 180, 372 → 420. Overtime readings are left out. No readings
       give null.
   - Real fixture case: build the `overtime-leavers` fixture's play. Every goal has a non-null clock, only
     the last is `overtime: true`, `goalsWithoutClock` is 0, and `regulationSeconds` is 300.
3. **Check** in `src/server/recorder/checks.ts`: add
   `{ id: "goals_clocked", run: withExtras((_, x) => fails(x.facts.goalsWithoutClock, "goal(s) with no clock reading before them")) }`,
   beside `goals_placed`, with a test in `checks.test.ts`.
4. **Migration** (append to `trackerMigrations` in `src/server/db/migrations.ts`, comment in the file's style):
   `ALTER TABLE match_goals ADD COLUMN clock_seconds INTEGER; ALTER TABLE match_goals ADD COLUMN clock_overtime INTEGER; ALTER TABLE matches ADD COLUMN regulation_seconds INTEGER;`
   (null until recompute). Add a test in `migrate.test.ts` in the file's one-test-per-migration pattern
   (`:174`): a DB at the previous version gains the columns, null on the rows it already had.
5. **Save and read**:
   - `src/server/records/save.ts` `INSERT_GOAL` gains both goal columns (`g.clock?.seconds ?? null`,
     `g.clock ? g.clock.overtime : null`). The matches insert gains `regulation_seconds` from play.
   - `src/server/query/read.ts` `readGoals` selects the goal columns and maps them to
     `clock: seconds === null ? null : { seconds, overtime: clock_overtime === 1 }`.
   - The match detail read gains `regulationSeconds` (`readMatch`, `:567`). The session read gets it only if
     the prototype needs it there; the match page has `useMatchDetail`.
   - `src/shared/schemas/responses.ts`: `goalSchema` (`:109`) gains
     `clock: z.object({ seconds: z.number(), overtime: z.boolean() }).nullable()`. The session and match
     responses both carry it. The match response gains `regulationSeconds: z.number().nullable()`.
   - Update the hand-built goals in `src/server/testing.ts` and `src/web/logic/goal-map.test.ts:23`, plus any
     others typecheck finds.
   - Round-trip tests in `save.test.ts` and `read.test.ts`. One covers a pre-recompute row: null columns
     give `clock: null` and `regulationSeconds: null`.
6. **Registry**: add `goal_clock` after `goal_speed` and `regulation_length` after `overtime` in
   `src/server/rules/registry.ts`, with a `PLAN_GOAL_CLOCK` ref constant. Run `bun run definitions` (it
   regenerates `docs/definitions.md` and `constant-pins.json`).
7. `bun run check`, then `bun run rules-diff` on the dev data dir. rules-diff never migrates the base DB
   (`rules-diff.ts:258`) and compares only columns both sides have (`:210`). So the expected result is: both
   new rules under `ruleVersions`, **no moved columns**, and no match newly flagged `goals_clocked`. Record
   the figures in the plan.
8. **BACKLOG Watch item** for a goal with no clock reading. **Analytics map row C**: mark it "In progress:
   clock rule built". Pause for the compact point and `independent-review-pass`. Ask the user to commit.
   After that, `bun run deploy` (it recomputes the dev data) is the user's call. A release's
   `release-recompute.ts` fills friends' data with no change needed.
9. **Prototype** (`prototype/goal-timeline`, cut from the step-8 commit, never merged), per the prototype
   skill's UI branch:
   - Run it on a consistent copy of the dev data in `%TEMP%\grindlog-proto-clock`. Both DBs are WAL and the
     background tracker writes to them, so take each one with `VACUUM INTO` from a read-only connection
     rather than copying files. Then recompute with `GRINDLOG_DATA_DIR=<copy> bun run recompute`.
   - It mounts in `src/web/pages/recap/MatchView.tsx` directly under `<Scoreboard>`, switched by `?variant=`,
     with the floating ←/→ bar (hidden in prod builds).
   - Three structurally different variants:
     - **A, strip**: a regulation→0:00 axis (from `regulationSeconds`, 5:00 when null) with an overtime tail. Your goals are marks above the line and theirs
       below, with the running score at each mark and the scorer on hover. Drift: small.
     - **B, score worm**: goal difference over time as a step line, shaded by who leads, with the late-goal
       window (last 30 s) tinted. Drift: small.
     - **C, ticker**: a vertical list "4:12 · Scorer (assist) · 1–0", spaced by the time between goals. Late
       and quick-reply goals are tagged. Drift: none.
   - Hand over the URL and the matches worth flipping through: a comeback, an overtime match, a 0:00 goal, a
     forfeit and a 180-s private match.
   - Iterate until the user picks. Record the verdict in this plan's repo copy, and in the prototype commit
     if the user asks to commit it.

## Verification
- Unit: `bun run check` green (typecheck, zero-warning lint, tests).
- Data: `rules-diff` reports the two rules added, no moved columns and no new flags. The real check of the
  columns is a read-only query on the recomputed copy: every stored goal (1,988+) has a non-null clock, 57
  have `clock_overtime = 1`, and `regulation_seconds` is 300 for about 350 matches. Spot-check one match's goal
  times against its raw events.
- e2e: `bun run e2e`. The session and match responses both carry the new field, through Zod.
- Prototype: open the hand-over URL in Chrome and flip through all 3 variants on the listed matches.

## Plan review
One round, by the `plan-reviewer` agent (opus) on 2026-11-24. All 8 findings are folded in:
1. Medium: rules-diff can't show the new columns moving, because the base DB isn't migrated → step 7 and
   Verification now expect no moved columns. The query on the recomputed copy is the real column check.
2. Medium: the timeline axis needs the regulation length, and committing the backend before the pick would
   force a second migration → added the `regulation_length` rule and `matches.regulation_seconds`.
3. Medium: copying WAL DBs while the tracker writes can be inconsistent → the copy uses `VACUUM INTO`.
4. Low: tests only used synthetic events, and the "replay reading leaks backwards" case was circular →
   added a case on the real `overtime-leavers` fixture, and replaced the circular case with "a reading
   after the goal isn't used".
5. Low: missed goal fixtures (`goal-map.test.ts`), and the session response also gets the field → named both.
6. Low: the migration test was vague → named the one-test-per-migration pattern.
7. Low: `refs` wasn't named, and `overtime` collides with `matches.overtime` → refs listed, column renamed
   `clock_overtime`.
8. Low: `bOvertime` missing or not a boolean → added to the Watch item, with no check.

## Results (steps 1–8, 2026-11-24)
- Built as planned. The real-fixture case sits in `recorder.test.ts`'s `overtime-leavers` test, the existing seam
  that records that fixture: 9 goals at 177, 172, 160, 93, 87, 66, 54, 8 and 180 s into overtime, expected values
  read straight from the fixture's raw events. `MatchExtras` and `MatchRow` carry `regulationSeconds` from play
  to the save.
- **Changed from the design:** a largest regulation reading of 0 gives a null regulation length, not 0. On the
  recomputed copy, 2 matches joined at the very end (0–0, no goals) had only the end-of-match reset to 0, and a
  0 s axis is no length. Found by the column query below, after rules-diff.
- `bun run check`: green, 2,056 tests passed, 1 skipped. `bun run e2e`: 157 passed.
- `bun run rules-diff` on the dev data dir: 360 recomputed, 0 failed (skipped: lobby 1, ignored playlist 1).
  "no change", meaning no moved columns and no new flags, and rule versions changed for `regulation_length` and
  `goal_clock` (360 matches each), as expected.
- Recomputed `VACUUM INTO` copy in `%TEMP%\grindlog-proto-clock`: 1,988 goals, 0 with a null clock, 57 with
  `clock_overtime = 1` (one per each of the 57 overtime matches). `regulation_seconds`: 300 for 354 matches, 180
  for 2, null for 4 (the 2 joined at the very end, and 2 left before any reading). 0 matches flagged
  `goals_clocked`. Spot check: match `E340…` stores 280, 144 and 55 (overtime), the same as its raw readings.

## Prototype verdict (step 9, 2026-11-24)
Branch `prototype/goal-timeline`, committed as `897860b` (never merged). Four rounds on the recomputed copy.
- **Chosen: H, players.** A row per player (you first, then teammates, then opponents; blue or orange row edge),
  with the running score in its own row above the clock so it never clips. Goals, saves and assists are bare
  icons (the app's ball, shield, handshake) in blue for your team and orange for opponents. Shots are small
  dots. Marks that would touch step into another lane, at the real pixel width. Each mark's details show on
  hover. The legend is just the two sides. Overtime is a shaded band labelled "OT".
- **Forfeit or left:** the clock that wasn't played is hatched behind a dashed line labelled "Forfeit · 0:44"
  (or "You left"). The end clock is the last clock reading before the end sequence (the first Win statfeed): a
  forfeit resets the clock to 0 only after the vote. If the end time is unknown, a note sits under the timeline.
- **Shots:** a shot that became a goal (the scorer's Shot statfeed up to 5 s before their Goal statfeed) is left
  off, since the goal shows it. In 2 sample matches the shot dots came out 1 over the scoreboard (a goal's
  shot not paired). The real build shows a short note under the timeline when the shot dots don't add up to
  the scoreboard's shots.
- **Rejected:** round 1's score worm and ticker; the strip and tracks layouts; discs with yours solid and a
  teammate's hollow (D–G). The row already says whose mark it is, and the bare icons read better at 16 px.
- **What the build needs** (next plan): recorded rules storing a clock for each save, assist and shot (new
  table or columns) and a match end clock, plus a migration and recompute. Gate the timeline on
  `joined_in_progress`, whose regulation length can read short.

## Review log
Tier: Substantial by design (106 non-test code lines). Snapshot of the reviewed state: `35441ff`.

**Round 1** (2026-11-24): `/code-review high`, `arch-reviewer` (opus), `security-reviewer`, `/simplify`.
- Security: no findings.
- code-review: a reading whose `bOvertime` isn't a boolean is stored unflagged as a regulation reading, and can also
  raise `regulation_seconds` (play.ts handler). [Fixed] Plan-review #8 had chosen Watch item only; revisited because
  the match-level effect on `regulation_seconds` wasn't weighed then, and the review stop rule for unseen shapes asks
  for a flagging check. Readings are counted in `facts.clockReadingsWithoutOvertimeFlag` and flagged by the new
  check `clock_overtime_flagged`; 0 such readings in raw.db, so nothing new is flagged.
- code-review: a joined-in-progress match stores a short regulation length. [Verified, no fix needed] Accepted in the
  design (it's flagged `joined`, and the rule text says it can read short); on real data the 2 joined matches with
  readings read 245 and 296, both giving 300. Consumers placing goals by elapsed time must still gate on
  `joined_in_progress`: carried to the timeline build.
- code-review: the `regulation_length` evidence didn't add up (357 counted against 356, a 372 → 420 match not stored),
  and `goal_clock` said 2,005 goals against 1,988 stored. [Fixed] Re-derived from the copy: the 372 and an 89-s match
  are in raw.db but not stored (lobby, ignored playlist); evidence now uses the 360 stored matches, and `goal_clock`
  names both counts.
- code-review + arch: the `phase === "ended"` guard in the handler had no test or comment. [Fixed] Test added (a 300
  reading after MatchEnded leaves a 180-s match at 180, and its goal unchanged), confirmed red with the guard removed;
  comment added.
- code-review (pre-existing): a negative largest reading gave a `-0` length. [Fixed] Only readings above 0 count; test.
- arch (nit): `goalsWithoutClock` had no doc comment. [Fixed]
- simplify: regulation length folded into the handler (no `maxRegulation` accumulator or post-loop case). [Fixed]
- simplify: two causes under one check id. [Fixed] Split into `goals_clocked` and `clock_overtime_flagged`.
- simplify, skipped: skipping all events after MatchEnded in the dispatch loop (changes other handlers' behavior);
  a shared clock-parse helper with summary.ts (different consumers); a column table for goal inserts like
  `PLAYER_EXTRAS`, a derived `elapsed_seconds`, a `Pick<Play>` for extras, deriving `goalsWithoutClock` from goals,
  scalar clock fields (all wider than this diff or against the stored-as-read design). An elapsed-time helper is for
  the timeline build.
- After fixes: `bun run check` green, 2,059 passed, 1 skipped.

**Round 2** (2026-11-24, delta `git diff 35441ff`): `correctness-reviewer`, `arch-reviewer` (sonnet),
`security-reviewer`. Correctness and security: no findings; all round-1 fixes close. Arch: 2 nits, `regulation_length`
rule text didn't say why `clock_overtime_flagged` is attached, and the Design section read as current. [Fixed] Nit
fixes only, so the review ends: 2 rounds, 9 fixed, 1 verified, 1 skipped group.
